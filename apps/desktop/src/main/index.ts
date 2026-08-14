import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, shell, utilityProcess, WebContentsView } from "electron";
import type { OpenDialogOptions, Rectangle, UtilityProcess } from "electron";
import type {
  AgentRequest,
  AgentResponse,
  AgentMessage,
  AgentRuntime,
  AgentImageAttachment,
  ChatMessage,
  ExtensionPackage,
  ModelCatalog,
  ModelTestResult,
  Plan,
  SetProviderCredentialInput,
  StatusDefinition,
  Label,
  Source,
  ThinkingLevel,
  ToolApproval,
  Automation,
  PermissionMode,
  McpRuntimeServer,
} from "@pi-work/protocol";
import {
  agentResponseSchema,
  appSettingsSchema,
  attachmentDraftSchema,
  attachmentSchema,
  abortTaskInputSchema,
  approvePlanInputSchema,
  artifactSchema,
  createArtifactInputSchema,
  createPersonalSessionInputSchema,
  createTaskInputSchema,
  createWorkspaceInputSchema,
  addWorkspaceDirectoryInputSchema,
  automationSchema,
  browserBoundsInputSchema,
  browserNavigateInputSchema,
  buildInfoSchema,
  cancelRemoteSkillPreviewInputSchema,
  createDomainEntityInputSchema,
  generatePlanInputSchema,
  completeTaskInputSchema,
  createSkillInputSchema,
  externalUrlInputSchema,
  executeManagedCliInputSchema,
  extensionSourceSchema,
  inspectAttachmentPathsSchema,
  importSkillInputSchema,
  installRemoteSkillsInputSchema,
  installManagedCliInputSchema,
  managedCliExecutionResultSchema,
  managedCliPackageSchema,
  mcpAuthorizeInputSchema,
  mcpAuthorizationStatusSchema,
  mcpCallToolInputSchema,
  mcpCallToolResultSchema,
  mcpHttpConfigSchema,
  mcpInspectInputSchema,
  mcpInspectResultSchema,
  mcpStdioConfigSchema,
  planSchema,
  promoteSessionInputSchema,
  publishArtifactInputSchema,
  observabilitySettingsSchema,
  updateObservabilitySettingsInputSchema,
  usageQueryInputSchema,
  previewRemoteSkillInputSchema,
  readSkillFileInputSchema,
  resumeTaskInputSchema,
  sendChatInputSchema,
  searchSkillMarketplaceInputSchema,
  setProviderCredentialInputSchema,
  testModelsInputSchema,
  taskSchema,
  statusDefinitionSchema,
  labelSchema,
  updateAppSettingsInputSchema,
  updateConversationModelInputSchema,
  removeConversationInputSchema,
  removeDomainEntityInputSchema,
  removeManagedCliInputSchema,
  resolveToolApprovalInputSchema,
  sessionSearchInputSchema,
  sessionEnvironmentInputSchema,
  setSessionEnvironmentInputSchema,
  setSkillEnabledInputSchema,
  sourceSchema,
  workspaceSchema,
  updateDomainEntityInputSchema,
  updateManagedCliInputSchema,
  updateSkillInputSchema,
  updateSessionInputSchema,
  updateTaskBriefInputSchema,
} from "@pi-work/protocol";
import { stageArtifact, publishArtifact } from "@pi-work/artifacts";
import { PiWorkStore } from "@pi-work/storage";
import { CredentialBroker } from "./credential-broker.js";
import { ManagedCliRuntime, SessionEnvironmentStore } from "./managed-cli.js";
import { SkillManager } from "./skill-manager.js";
import { McpOAuthManager } from "./mcp-oauth.js";
import {
  createIsolatedPiEnvironment,
  PiConsole,
  type PiConsoleEvent,
  resolveBundledPiRuntime,
} from "./pi-console.js";
import { loadWindowBounds, saveWindowBounds } from "./window-state.js";
import { SecretsBroker, maskSecret } from "./secrets-broker.js";
import { LangfuseExporter, type LangfuseConfig, type RunContext } from "./observability.js";

let mainWindow: BrowserWindow | null = null;
let windowStateTimer: ReturnType<typeof setTimeout> | null = null;
let store: PiWorkStore;
let agentProcess: UtilityProcess | null = null;
let credentialBroker: CredentialBroker;
let secretsBroker: SecretsBroker;
let observabilityExporter: LangfuseExporter | null = null;
let piConsole: PiConsole | null = null;
let managedCliRuntime: ManagedCliRuntime | null = null;
let browserView: WebContentsView | null = null;
let skillManager: SkillManager | null = null;
let mcpOAuthManager: McpOAuthManager | null = null;
const sessionEnvironments = new SessionEnvironmentStore();
const pendingAgentRequests = new Map<string, {
  resolve: (response: AgentResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const activeAgentSessions = new Set<string>();
const approvedAttachmentPaths = new Set<string>();
const clipboardImageExtensions: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const maxClipboardImageSize = 20 * 1024 * 1024;
const pendingToolApprovals = new Map<string, ToolApproval>();
type RunActivity = {
  kind: "thinking" | "tool_result" | "file_change" | "approval" | "error" | "notice";
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
};
class AgentRequestError extends Error {
  constructor(message: string, readonly requestId: string) {
    super(message);
  }
}
const runActivities = new Map<string, {
  thinking: Map<number, string>;
  tools: Map<string, Record<string, unknown>>;
  activities: RunActivity[];
}>();

function collectorFor(requestId: string) {
  let collector = runActivities.get(requestId);
  if (collector === undefined) {
    collector = { thinking: new Map(), tools: new Map(), activities: [] };
    runActivities.set(requestId, collector);
  }
  return collector;
}

function collectRunEvent(response: Extract<AgentMessage, { type: "event" }>): void {
  const { event } = response;
  if (event.kind === "completed" || event.kind === "cancelled") return;
  const collector = collectorFor(response.requestId);
  const metadata = { requestId: response.requestId, sequence: event.sequence, ...event.payload };
  if (event.kind === "thinking") {
    const index = typeof event.payload.contentIndex === "number" ? event.payload.contentIndex : 0;
    if (event.payload.phase === "start") collector.thinking.set(index, "");
    if (event.payload.phase === "delta" && typeof event.payload.delta === "string") {
      collector.thinking.set(index, `${collector.thinking.get(index) ?? ""}${event.payload.delta}`);
    }
    if (event.payload.phase === "end") {
      const content = typeof event.payload.content === "string"
        ? event.payload.content
        : collector.thinking.get(index) ?? "";
      collector.thinking.delete(index);
      if (content.trim()) collector.activities.push({
        kind: "thinking",
        title: "Thinking",
        detail: content,
        metadata: {
          requestId: response.requestId,
          sequence: event.sequence,
          contentIndex: index,
          phase: "end",
        },
      });
    }
    return;
  }
  if (event.kind === "tool_call") {
    const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : randomUUID();
    collector.tools.set(toolCallId, event.payload);
    return;
  }
  if (event.kind === "tool_update") {
    const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
    if (toolCallId) collector.tools.set(toolCallId, { ...collector.tools.get(toolCallId), ...event.payload });
    return;
  }
  if (event.kind === "tool_result") {
    const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
    const tool = collector.tools.get(toolCallId) ?? {};
    collector.tools.delete(toolCallId);
    collector.activities.push({
      kind: "tool_result",
      title: typeof event.payload.toolName === "string" ? event.payload.toolName : "Tool",
      detail: summarizeValue(event.payload.result, event.payload.isError === true),
      metadata: { ...tool, ...metadata },
    });
    return;
  }
  if (event.kind === "file_change") {
    collector.activities.push({
      kind: "file_change",
      title: "File change",
      detail: typeof event.payload.toolName === "string" ? event.payload.toolName : "",
      metadata,
    });
    return;
  }
  if (event.kind === "approval") {
    collector.activities.push({ kind: "approval", title: "Approval", detail: "", metadata });
    return;
  }
  if (event.kind === "runtime" && ["compacted", "retry_complete"].includes(String(event.payload.state))) {
    collector.activities.push({
      kind: "notice",
      title: String(event.payload.state) === "compacted" ? "Context compacted" : "Retry completed",
      detail: event.payload.errorMessage === undefined ? "" : String(event.payload.errorMessage),
      metadata,
    });
  }
}

function recordUsageEvent(response: Extract<AgentMessage, { type: "event" }>): void {
  if (response.event.kind !== "usage") return;
  const payload = response.event.payload as {
    provider?: unknown;
    model?: unknown;
    responseModel?: unknown;
    api?: unknown;
    stopReason?: unknown;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      reasoning?: number;
      totalTokens?: number;
      cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
    };
  };
  const usage = payload.usage;
  if (usage === undefined) return;
  try {
    const task = getStore().getTask(response.sessionId);
    getStore().recordModelUsage({
      taskId: response.sessionId,
      workspaceId: task?.workspaceId ?? null,
      requestId: response.requestId,
      messageId: null,
      provider: typeof payload.provider === "string" ? payload.provider : "",
      model: typeof payload.model === "string" ? payload.model : "",
      responseModel: typeof payload.responseModel === "string" ? payload.responseModel : null,
      api: typeof payload.api === "string" ? payload.api : null,
      stopReason: typeof payload.stopReason === "string" ? payload.stopReason : null,
      inputTokens: Math.max(0, Math.round(usage.input ?? 0)),
      outputTokens: Math.max(0, Math.round(usage.output ?? 0)),
      cacheReadTokens: Math.max(0, Math.round(usage.cacheRead ?? 0)),
      cacheWriteTokens: Math.max(0, Math.round(usage.cacheWrite ?? 0)),
      reasoningTokens: Math.max(0, Math.round(usage.reasoning ?? 0)),
      totalTokens: Math.max(0, Math.round(usage.totalTokens ?? 0)),
      inputCost: Math.max(0, usage.cost?.input ?? 0),
      outputCost: Math.max(0, usage.cost?.output ?? 0),
      cacheReadCost: Math.max(0, usage.cost?.cacheRead ?? 0),
      cacheWriteCost: Math.max(0, usage.cost?.cacheWrite ?? 0),
      totalCost: Math.max(0, usage.cost?.total ?? 0),
    });
  } catch {
    // A deleted session should not break usage accounting for the run.
  }
}

function flushRunActivities(requestId: string, sessionId: string, messageId: string | null): void {
  const collector = runActivities.get(requestId);
  runActivities.delete(requestId);
  if (collector === undefined) return;
  for (const activity of collector.activities) {
    if (activity.kind === "thinking" && messageId === null) continue;
    try {
      getStore().addActivity({ sessionId, messageId, ...activity });
    } catch {
      // A deleted session should not take down the agent event channel.
    }
  }
}

function persistRunError(requestId: string, sessionId: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : "Pi could not reply.";
  const collector = collectorFor(requestId);
  collector.activities.push({
    kind: "error",
    title: "Run failed",
    detail,
    metadata: { requestId },
  });
  flushRunActivities(requestId, sessionId, null);
}

function summarizeValue(value: unknown, isError: boolean): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return isError ? "Tool failed." : "Completed.";
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

function clearPendingToolApprovals(sessionId: string): void {
  for (const [approvalId, approval] of pendingToolApprovals) {
    if (approval.sessionId === sessionId) {
      pendingToolApprovals.delete(approvalId);
    }
  }
}

type AgentRequestInput = AgentRequest extends infer Request
  ? Request extends AgentRequest
    ? Omit<Request, "requestId">
    : never
  : never;

function applicationDatabasePath(): string {
  return join(app.getPath("userData"), "pi-work.db");
}

async function inspectAttachments(paths: string[]) {
  return Promise.all(paths.map(async (path) => attachmentDraftSchema.parse({
    name: basename(path),
    path,
    mimeType: mimeTypeForPath(path),
    size: (await stat(path)).size,
  })));
}

async function saveClipboardImage(input: unknown) {
  if (typeof input !== "object" || input === null) {
    throw new Error("Clipboard image is invalid.");
  }
  const { mimeType, bytes } = input as { mimeType?: unknown; bytes?: unknown };
  if (typeof mimeType !== "string" || !(mimeType in clipboardImageExtensions)) {
    throw new Error("Only PNG, JPEG, GIF, and WebP images can be pasted.");
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("Clipboard image is invalid.");
  }
  if (bytes.byteLength > maxClipboardImageSize) {
    throw new Error("Pasted images must be smaller than 20 MB.");
  }

  const directory = join(app.getPath("userData"), "clipboard-attachments");
  const name = `clipboard-${randomUUID()}${clipboardImageExtensions[mimeType]}`;
  const path = join(directory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path, bytes);
  approvedAttachmentPaths.add(path);
  return attachmentDraftSchema.parse({
    name,
    path,
    mimeType,
    size: bytes.byteLength,
  });
}

async function previewAttachment(input: unknown): Promise<string> {
  const attachment = attachmentDraftSchema.parse(input);
  if (!approvedAttachmentPaths.has(attachment.path)) {
    throw new Error("Choose or paste an attachment before previewing it.");
  }
  return imageDataUrl(attachment.path);
}

async function imageDataUrl(path: string): Promise<string> {
  const mimeType = mimeTypeForPath(path);
  if (!mimeType.startsWith("image/")) {
    throw new Error("Only image attachments can be previewed.");
  }
  const { size } = await stat(path);
  if (size > maxClipboardImageSize) {
    throw new Error("Images larger than 20 MB cannot be previewed.");
  }
  const bytes = await readFile(path);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function previewSavedAttachment(attachmentId: unknown): Promise<string> {
  const attachment = getStore().getAttachment(attachmentSchema.shape.id.parse(attachmentId));
  if (attachment === null) throw new Error("Attachment not found.");
  return imageDataUrl(attachment.path);
}

async function agentImagesForAttachments(attachments: Array<{
  name: string;
  path: string;
  mimeType: string;
}>): Promise<AgentImageAttachment[]> {
  return Promise.all(attachments
    .filter((attachment) => attachment.mimeType === "image/png"
      || attachment.mimeType === "image/jpeg"
      || attachment.mimeType === "image/gif"
      || attachment.mimeType === "image/webp")
    .map(async (attachment) => {
      const { size } = await stat(attachment.path);
      if (size > maxClipboardImageSize) {
        throw new Error(`Image attachment ${attachment.name} must be smaller than 20 MB.`);
      }
      return {
        name: attachment.name,
        mimeType: attachment.mimeType as AgentImageAttachment["mimeType"],
        data: (await readFile(attachment.path)).toString("base64"),
      };
    }));
}

function getStore(): PiWorkStore {
  if (store === undefined) {
    store = new PiWorkStore(applicationDatabasePath());
    store.migrateMcpSourcesToGlobal();
  }
  return store;
}

function getSkillManager(): SkillManager {
  skillManager ??= new SkillManager(getStore(), app.getPath("userData"));
  return skillManager;
}

function getCredentialBroker(): CredentialBroker {
  if (credentialBroker === undefined) {
    credentialBroker = new CredentialBroker(
      join(app.getPath("userData"), "pi-agent"),
      join(app.getPath("userData"), "credentials.enc"),
    );
  }
  return credentialBroker;
}

function getSecretsBroker(): SecretsBroker {
  if (secretsBroker === undefined) {
    secretsBroker = new SecretsBroker(join(app.getPath("userData"), "pi-agent"));
  }
  return secretsBroker;
}

/**
 * Resolves the effective Langfuse config. Environment variables win over stored
 * settings so operators can point a whole machine at a shared instance. Returns
 * null when disabled or incomplete, which short-circuits the exporter entirely.
 */
async function resolveLangfuseConfig(): Promise<LangfuseConfig | null> {
  const stored = getStore().getObservabilityConfig();
  const envEnabled = process.env.LANGFUSE_HOST !== undefined
    || process.env.LANGFUSE_PUBLIC_KEY !== undefined
    || process.env.LANGFUSE_SECRET_KEY !== undefined;
  if (!stored.enabled && !envEnabled) return null;
  const host = process.env.LANGFUSE_HOST?.trim() || stored.host;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim() || stored.publicKey;
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim() || (await getSecretsBroker().getLangfuseSecretKey()) || "";
  if (host === "" || publicKey === "" || secretKey === "") return null;
  return { host, publicKey, secretKey, captureContent: stored.captureContent };
}

function resolveRunContext(taskId: string, requestId: string): RunContext | null {
  try {
    const task = getStore().getTask(taskId);
    if (task === null) return null;
    const messages = getStore().listMessages(taskId);
    const userMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const workspace = getStore().getWorkspace(task.workspaceId);
    return {
      taskId,
      workspaceId: task.workspaceId,
      provider: task.providerId ?? "",
      model: task.modelId ?? "",
      thinkingLevel: task.thinkingLevel,
      permissionMode: task.permissionMode,
      cwd: task.workingDirectory ?? workspace?.rootPath ?? "",
      appVersion: app.getVersion(),
      userMessage,
    };
  } catch {
    return null;
  }
}

function getObservabilityExporter(): LangfuseExporter {
  if (observabilityExporter === null) {
    observabilityExporter = new LangfuseExporter({
      resolveConfig: resolveLangfuseConfig,
      resolveRunContext,
      outbox: {
        enqueue: (payload, nextAttemptAt) => getStore().enqueueTelemetry(payload, nextAttemptAt),
        listDue: (limit) => getStore().listDueTelemetry(limit),
        markRetry: (id, attempts, nextAttemptAt) => getStore().markTelemetryRetry(id, attempts, nextAttemptAt),
        delete: (id) => getStore().deleteTelemetry(id),
      },
      log: (message, error) => {
        console.warn(`[observability] ${message}`, error instanceof Error ? error.message : "");
      },
    });
    observabilityExporter.start();
  }
  return observabilityExporter;
}

async function observabilitySettingsView() {
  const stored = getStore().getObservabilityConfig();
  const storedSecret = await getSecretsBroker().getLangfuseSecretKey();
  const envSecret = process.env.LANGFUSE_SECRET_KEY?.trim();
  const effectiveSecret = envSecret !== undefined && envSecret.length > 0 ? envSecret : storedSecret;
  const envOverride = process.env.LANGFUSE_HOST !== undefined
    || process.env.LANGFUSE_PUBLIC_KEY !== undefined
    || process.env.LANGFUSE_SECRET_KEY !== undefined;
  return observabilitySettingsSchema.parse({
    enabled: stored.enabled,
    host: process.env.LANGFUSE_HOST?.trim() || stored.host,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY?.trim() || stored.publicKey,
    captureContent: stored.captureContent,
    secretKeyMasked: maskSecret(effectiveSecret),
    hasSecretKey: effectiveSecret !== null && effectiveSecret !== undefined && effectiveSecret.length > 0,
    envOverride,
  });
}

function getMcpOAuthManager(): McpOAuthManager {
  mcpOAuthManager ??= new McpOAuthManager(
    join(app.getPath("userData"), "mcp-oauth.json"),
    (url) => shell.openExternal(url),
  );
  return mcpOAuthManager;
}

function sendPiConsoleEvent(event: PiConsoleEvent): void {
  mainWindow?.webContents.send("pi-console:event", event);
}

function bundledPiRuntimeDirectory(): string {
  return resolveBundledPiRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDirectory: import.meta.dirname,
  });
}

function getManagedCliRuntime(): ManagedCliRuntime {
  managedCliRuntime ??= new ManagedCliRuntime({
    userData: app.getPath("userData"),
    runtimeDirectory: bundledPiRuntimeDirectory(),
    nodeExecutable: process.execPath,
  });
  managedCliRuntime.initialize();
  return managedCliRuntime;
}

function getPiConsole(): PiConsole {
  if (piConsole === null) {
    console.info(`[Pi Terminal] Starting with the ${app.isPackaged ? "packaged" : "development"} Node/npm runtime.`);
    piConsole = new PiConsole({
      managedCliRuntime: getManagedCliRuntime(),
      workingDirectory: app.getPath("home"),
      emit: sendPiConsoleEvent,
    });
  }
  return piConsole;
}

async function terminalWorkingDirectory(input: unknown): Promise<string> {
  const value = input === undefined || input === null ? {} : input;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal start request.");
  }
  const requested = (value as { cwd?: unknown }).cwd;
  if (requested !== undefined && typeof requested !== "string") {
    throw new Error("Invalid terminal working directory.");
  }
  const cwd = requested === undefined ? app.getPath("home") : resolve(requested);
  const details = await stat(cwd).catch(() => null);
  if (details === null || !details.isDirectory()) {
    throw new Error("Terminal working directory does not exist.");
  }
  return cwd;
}

function createWindow(): void {
  const statePath = join(app.getPath("userData"), "window-state.json");
  const primaryDisplay = screen.getPrimaryDisplay();
  const workAreas = [
    primaryDisplay.workArea,
    ...screen.getAllDisplays()
      .filter((display) => display.id !== primaryDisplay.id)
      .map((display) => display.workArea),
  ];
  const savedBounds = loadWindowBounds(statePath, workAreas);
  const window = new BrowserWindow({
    width: savedBounds?.width ?? 1440,
    height: savedBounds?.height ?? 960,
    ...(savedBounds === undefined ? {} : { x: savedBounds.x, y: savedBounds.y }),
    minWidth: 860,
    minHeight: 640,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin" && { trafficLightPosition: { x: 18, y: 19 } }),
    titleBarOverlay: process.platform === "darwin" ? false : {
      color: "#00000000",
      symbolColor: "#737373",
      height: 48,
    },
    backgroundColor: "#f5f5f5",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;

  const saveState = (): void => {
    if (windowStateTimer !== null) {
      clearTimeout(windowStateTimer);
      windowStateTimer = null;
    }
    if (window.isDestroyed()) return;
    try {
      saveWindowBounds(statePath, window.getNormalBounds());
    } catch (error) {
      console.warn("[Window] Unable to save window state.", error);
    }
  };
  const scheduleSave = (): void => {
    if (windowStateTimer !== null) clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(saveState, 250);
  };
  window.on("move", scheduleSave);
  window.on("resize", scheduleSave);
  window.on("close", saveState);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL === undefined) {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  } else {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  }
}

function normalizeBrowserUrl(value: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS pages can open inside Pi Work.");
  }
  return parsed.toString();
}

function getBrowserView(): WebContentsView {
  if (mainWindow === null) throw new Error("The main window is not ready.");
  if (browserView !== null) return browserView;
  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.contentView.addChildView(browserView);
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  browserView.webContents.on("will-navigate", (event, url) => {
    try {
      normalizeBrowserUrl(url);
    } catch {
      event.preventDefault();
    }
  });
  const publishState = () => mainWindow?.webContents.send("browser:state", {
    url: browserView?.webContents.getURL() ?? "",
    title: browserView?.webContents.getTitle() ?? "",
    canGoBack: browserView?.webContents.navigationHistory.canGoBack() ?? false,
    canGoForward: browserView?.webContents.navigationHistory.canGoForward() ?? false,
    loading: browserView?.webContents.isLoading() ?? false,
  });
  browserView.webContents.on("did-start-loading", publishState);
  browserView.webContents.on("did-stop-loading", publishState);
  browserView.webContents.on("page-title-updated", publishState);
  return browserView;
}

function closeBrowserView(): void {
  if (browserView === null || mainWindow === null) return;
  mainWindow.contentView.removeChildView(browserView);
  browserView.webContents.close();
  browserView = null;
}

function getAgentProcess(): UtilityProcess {
  if (agentProcess !== null) {
    return agentProcess;
  }

  const agentEntry = app.isPackaged
    ? join(process.resourcesPath, "pi-runtime", "agent-service.js")
    : join(import.meta.dirname, "agent-service.js");
  agentProcess = utilityProcess.fork(agentEntry, [], {
    env: createIsolatedPiEnvironment({
      userData: app.getPath("userData"),
      runtimeDirectory: bundledPiRuntimeDirectory(),
      nodeExecutable: app.getPath("exe"),
    }),
  });
  agentProcess.on("message", (message) => {
    const parsed = agentResponseSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }
    const response: AgentMessage = parsed.data;
    if (response.type === "tool.approval") {
      pendingToolApprovals.set(response.approvalId, response);
      mainWindow?.webContents.send("chat:tool-approval", response);
      return;
    }
    if (response.type === "event") {
      if (response.event.kind === "completed" || response.event.kind === "cancelled") {
        clearPendingToolApprovals(response.sessionId);
      }
      collectRunEvent(response);
      recordUsageEvent(response);
      try {
        getObservabilityExporter().handleEvent(response);
      } catch {
        // Telemetry must never interrupt the agent event channel.
      }
      mainWindow?.webContents.send("agent:event", response);
      return;
    }
    const pending = pendingAgentRequests.get(response.requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    pendingAgentRequests.delete(response.requestId);
    pending.resolve(response);
  });
  agentProcess.once("exit", () => {
    for (const pending of pendingAgentRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Pi agent service exited before responding."));
    }
    pendingAgentRequests.clear();
    for (const sessionId of activeAgentSessions) {
      try {
        getStore().updateSession(sessionId, { running: false });
      } catch {
        // The session may have been deleted while the utility process exited.
      }
    }
    activeAgentSessions.clear();
    pendingToolApprovals.clear();
    agentProcess = null;
  });
  return agentProcess;
}

function agentRuntime(cwd = app.getPath("userData"), sessionId?: string): AgentRuntime {
  const isolatedEnvironment = createIsolatedPiEnvironment({
    userData: app.getPath("userData"),
    runtimeDirectory: bundledPiRuntimeDirectory(),
    nodeExecutable: app.getPath("exe"),
  });
  const environment = getManagedCliRuntime().agentEnvironment(
    {
      PATH: process.env.PATH ?? isolatedEnvironment.PATH,
      HOME: isolatedEnvironment.HOME,
    },
    sessionId === undefined ? {} : sessionEnvironments.get(sessionId),
  );
  return {
    cwd,
    agentDir: join(app.getPath("userData"), "pi-agent"),
    environment: Object.fromEntries(
      Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

async function sendAgentRequest(
  request: AgentRequestInput,
  timeoutMs = 30_000,
): Promise<AgentResponse> {
  const requestId = randomUUID();
  return new Promise<AgentResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAgentRequests.delete(requestId);
      reject(new AgentRequestError("Pi agent service timed out.", requestId));
    }, timeoutMs);
    pendingAgentRequests.set(requestId, { resolve, reject, timer });
    getAgentProcess().postMessage({ ...request, requestId });
  });
}

async function generatePlan(
  task: { id: string; title: string; goal: string },
  provider: SetProviderCredentialInput | null,
  modelId: string,
  thinkingLevel: ThinkingLevel,
  runtime: AgentRuntime,
): Promise<Plan> {
  const response = await sendAgentRequest({
    type: "plan",
    task,
    provider: provider ?? undefined,
    modelId,
    thinkingLevel,
    runtime,
  }, 15 * 60_000);
  if (response.type === "error") {
    throw new Error(response.message);
  }
  if (response.type !== "plan") {
    throw new Error("Pi planning service returned an unexpected response.");
  }
  return response.plan;
}

async function generateChat(
  sessionId: string,
  messages: ChatMessage[],
  provider: SetProviderCredentialInput | null,
  modelId: string,
  thinkingLevel: ThinkingLevel,
  runtime: AgentRuntime,
  permissionMode: PermissionMode,
  images: AgentImageAttachment[],
  mcpServers: McpRuntimeServer[],
): Promise<{ content: string; cancelled: boolean; requestId: string }> {
  const response = await sendAgentRequest({
    type: "chat",
    sessionId,
    messages: messages.map(({ role, content }) => ({ role, content })),
    images,
    provider: provider ?? undefined,
    modelId,
    thinkingLevel,
    runtime,
    permissionMode,
    mcpServers,
  }, 15 * 60_000);
  if (response.type === "error") {
    throw new AgentRequestError(response.message, response.requestId);
  }
  if (response.type !== "chat") {
    throw new AgentRequestError("Pi chat service returned an unexpected response.", response.requestId);
  }
  return { content: response.content, cancelled: response.cancelled, requestId: response.requestId };
}

async function generateConversationTitle(
  prompt: string,
  response: string,
  provider: SetProviderCredentialInput | null,
  modelId: string,
  thinkingLevel: ThinkingLevel,
  runtime: AgentRuntime,
): Promise<string> {
  const result = await sendAgentRequest({
    type: "title",
    prompt,
    response,
    provider: provider ?? undefined,
    modelId,
    thinkingLevel,
    runtime,
  });
  if (result.type === "error") throw new Error(result.message);
  if (result.type !== "title") throw new Error("Pi title service returned an unexpected response.");
  return result.title;
}

async function runChatInBackground(input: {
  taskId: string;
  workspaceId: string;
  providerId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  runtime: AgentRuntime;
  permissionMode: PermissionMode;
  images: AgentImageAttachment[];
}): Promise<void> {
  try {
    activeAgentSessions.add(input.taskId);
    const response = await generateChat(
      input.taskId,
      getStore().listMessages(input.taskId),
      await providerCredential(input.providerId),
      input.modelId,
      input.thinkingLevel,
      input.runtime,
      input.permissionMode,
      input.images,
      await runtimeMcpServers(),
    );
    const assistant = response.content !== ""
      ? getStore().addMessage({ taskId: input.taskId, role: "assistant", content: response.content })
      : null;
    flushRunActivities(response.requestId, input.taskId, assistant?.id ?? null);
    const session = getStore().getTask(input.taskId);
    if (assistant !== null && !response.cancelled && session?.title === "New session") {
      void generateConversationTitle(
        getStore().listMessages(input.taskId).find((message) => message.role === "user")?.content ?? "",
        assistant.content,
        await providerCredential(input.providerId),
        input.modelId,
        input.thinkingLevel,
        input.runtime,
      ).then((title) => {
        const current = getStore().getTask(input.taskId);
        if (current?.title === "New session") getStore().updateSession(input.taskId, { title });
      }).catch(() => {
        // A title is a convenience; preserve the usable session if generation fails.
      });
    }
  } catch (error) {
    if (error instanceof AgentRequestError) {
      persistRunError(error.requestId, input.taskId, error);
    }
    getStore().addMessage({
      taskId: input.taskId,
      role: "system",
      content: error instanceof Error ? error.message : "Pi could not reply.",
    });
  } finally {
    try {
      getStore().updateSession(input.taskId, { running: false });
    } catch {
      // The session can be removed while its agent request is still completing.
    }
    activeAgentSessions.delete(input.taskId);
  }
}

function mimeTypeForPath(path: string): string {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  } as Record<string, string>)[extname(path).toLocaleLowerCase()] ?? "application/octet-stream";
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): {
  [Key in keyof T]?: Exclude<T[Key], undefined>
} {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [Key in keyof T]?: Exclude<T[Key], undefined>
  };
}

function assertManagedChatPath(rootPath: string): void {
  const chatsRoot = resolve(app.getPath("userData"), "chats");
  const candidate = resolve(rootPath);
  const difference = relative(chatsRoot, candidate);
  if (difference === "" || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new Error("Managed chat directory is outside Pi Work chat storage.");
  }
}

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const difference = relative(resolve(rootPath), resolve(candidatePath));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

async function managedCliWorkingDirectory(sessionId: string | undefined, requestedCwd: string | undefined): Promise<string> {
  if (sessionId === undefined) {
    const cwd = resolve(requestedCwd ?? app.getPath("home"));
    const details = await stat(cwd).catch(() => null);
    if (details === null || !details.isDirectory()) throw new Error("Managed CLI working directory does not exist.");
    return cwd;
  }
  const task = getStore().getTask(sessionId);
  if (task === null) throw new Error("Session not found.");
  const workspace = getStore().getWorkspace(task.workspaceId);
  if (workspace === null) throw new Error("Workspace not found.");
  const cwd = resolve(requestedCwd ?? task.workingDirectory ?? workspace.rootPath);
  if (!workspace.directories.some((directory) => pathIsInside(directory, cwd))) {
    throw new Error("Managed CLI working directory is outside this workspace.");
  }
  const details = await stat(cwd).catch(() => null);
  if (details === null || !details.isDirectory()) throw new Error("Managed CLI working directory does not exist.");
  return cwd;
}

function requireFolderTask(taskId: string) {
  const task = getStore().getTask(taskId);
  if (task === null) throw new Error("Task not found.");
  const workspace = getStore().getWorkspace(task.workspaceId);
  if (workspace === null || workspace.kind !== "folder" || task.kind !== "task") {
    throw new Error("This operation requires a work folder task.");
  }
  return { task, workspace };
}

function requireFolderWorkspace(workspaceId: string) {
  const workspace = getStore().getWorkspace(workspaceId);
  if (workspace === null || workspace.kind !== "folder") {
    throw new Error("This operation requires a work folder.");
  }
  return workspace;
}

function pathWithin(rootPath: string, candidatePath: string): boolean {
  const difference = relative(resolve(rootPath), resolve(candidatePath));
  return difference !== "" && difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
}

function stagingPath(workspaceRoot: string, taskId: string): string {
  return join(workspaceRoot, ".pi-work", "runs", taskId, "staging");
}

function saveConversationModel(
  taskId: string,
  selection: { providerId: string; modelId: string; thinkingLevel: ThinkingLevel },
): ReturnType<PiWorkStore["updateTaskModel"]> {
  const model = {
    providerId: selection.providerId,
    modelId: selection.modelId,
    thinkingLevel: selection.thinkingLevel,
  };
  const task = getStore().updateTaskModel(taskId, model);
  getStore().updateAppSettings(model);
  return task;
}

async function providerCredential(providerId: string): Promise<SetProviderCredentialInput> {
  const credential = await getCredentialBroker().get(providerId);
  if (credential === null) {
    throw new Error(`No credential is configured for ${providerId}. Open Settings to add one.`);
  }
  return credential;
}

async function runtimeMcpServers(): Promise<McpRuntimeServer[]> {
  const servers: McpRuntimeServer[] = [];
  for (const source of getStore().listGlobalMcpSources()) {
    if (!source.enabled) continue;
    if (source.type === "mcp_stdio") {
      servers.push({
        id: source.id,
        name: source.name,
        type: "mcp_stdio",
        config: mcpStdioConfigSchema.parse(source.config),
      });
      continue;
    }
    if (source.type !== "mcp_http") continue;
    const config = mcpHttpConfigSchema.parse(source.config);
    if (config.auth !== "oauth") {
      servers.push({ id: source.id, name: source.name, type: "mcp_http", config });
      continue;
    }
    const bearerToken = await getMcpOAuthManager().accessToken(source);
    if (bearerToken === null) {
      throw new Error(`MCP source "${source.name}" needs authorization. Open Sources and choose Authorize.`);
    }
    servers.push({
      id: source.id,
      name: source.name,
      type: "mcp_http",
      config: { ...config, bearerToken },
    });
  }
  return servers;
}

async function mcpRuntimeServer(sourceId: string): Promise<{ server: McpRuntimeServer; runtime: AgentRuntime }> {
  const source = findSource(sourceId);
  if (source === undefined || (source.type !== "mcp_stdio" && source.type !== "mcp_http")) {
    throw new Error("Unknown MCP source.");
  }
  if (source.type === "mcp_stdio") {
    return {
      server: {
        id: source.id,
        name: source.name,
        type: "mcp_stdio",
        config: mcpStdioConfigSchema.parse(source.config),
      },
      runtime: agentRuntime(),
    };
  }
  const config = mcpHttpConfigSchema.parse(source.config);
  const runtimeConfig = config.auth === "oauth"
    ? { ...config, bearerToken: await getMcpOAuthManager().accessToken(source) ?? undefined }
    : config;
  return {
    server: {
      id: source.id,
      name: source.name,
      type: "mcp_http",
      config: runtimeConfig,
    },
    runtime: agentRuntime(),
  };
}

function validateMcpSource(value: Pick<Source, "type" | "config">): void {
  if (value.type === "mcp_stdio") mcpStdioConfigSchema.parse(value.config);
  if (value.type === "mcp_http") mcpHttpConfigSchema.parse(value.config);
}

function mcpOAuthIdentityChanged(current: Source, next: Source): boolean {
  if (current.type !== "mcp_http") return false;
  const currentConfig = mcpHttpConfigSchema.parse(current.config);
  if (currentConfig.auth !== "oauth") return false;
  if (next.type !== "mcp_http") return true;
  const nextConfig = mcpHttpConfigSchema.parse(next.config);
  return nextConfig.auth !== "oauth"
    || nextConfig.url !== currentConfig.url
    || nextConfig.transport !== currentConfig.transport;
}

function findSource(sourceId: string): Source | undefined {
  const globalSource = getStore().listGlobalMcpSources().find((candidate) => candidate.id === sourceId);
  if (globalSource !== undefined) return globalSource;
  for (const workspace of getStore().listWorkspaces()) {
    if (workspace.kind !== "folder") continue;
    const source = getStore().listSources(workspace.id).find((candidate) => candidate.id === sourceId);
    if (source !== undefined) return source;
  }
  return undefined;
}

async function listExtensions(): Promise<ExtensionPackage[]> {
  const response = await sendAgentRequest({ type: "extension.list", runtime: agentRuntime() });
  if (response.type === "error") {
    throw new Error(response.message);
  }
  if (response.type !== "extensions") {
    throw new Error("Pi agent service returned an unexpected extension response.");
  }
  return response.packages;
}

async function listModels(): Promise<ModelCatalog> {
  const response = await sendAgentRequest({ type: "model.list", runtime: agentRuntime() });
  if (response.type === "error") {
    throw new Error(response.message);
  }
  if (response.type !== "models") {
    throw new Error("Pi agent service returned an unexpected model response.");
  }
  return {
    models: response.models,
    diagnostics: response.diagnostics,
  };
}

async function testModels(input: unknown): Promise<ModelTestResult[]> {
  const { models } = testModelsInputSchema.parse(input);
  const results: ModelTestResult[] = [];
  for (const target of models) {
    const testedAt = new Date().toISOString();
    try {
      const credential = await getCredentialBroker().get(target.providerId);
      if (credential === null) throw new Error(`No credential is configured for ${target.providerId}.`);
      const response = await sendAgentRequest({
        type: "model.test",
        provider: credential,
        modelId: target.modelId,
        runtime: agentRuntime(),
      }, 45_000);
      if (response.type === "error") throw new Error(response.message);
      if (response.type !== "model.test") throw new Error("Pi agent service returned an unexpected model test response.");
      results.push({ ...target, testedAt, success: true, message: response.message });
    } catch (cause) {
      results.push({
        ...target,
        testedAt,
        success: false,
        message: cause instanceof Error ? cause.message : "Model test failed.",
      });
    }
  }
  const current = getStore().getAppSettings();
  getStore().updateAppSettings({
    modelTestResults: {
      ...current.modelTestResults,
      ...Object.fromEntries(results.map((result) => [`${result.providerId}/${result.modelId}`, result])),
    },
  });
  return results;
}

function registerIpc(): void {
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a work folder for Pi Work",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) {
      return null;
    }

    const rootPath = result.filePaths[0];
    if (rootPath === undefined) {
      return null;
    }
    const existing = getStore().listWorkspaces().find((workspace) => (
      workspace.kind === "folder" && workspace.directories.includes(rootPath)
    ));
    if (existing !== undefined) return workspaceSchema.parse(existing);
    const workspace = createWorkspaceInputSchema.parse({
      name: basename(rootPath),
      rootPath,
    });
    const outputPath = join(rootPath, "Pi Work");
    await mkdir(outputPath, { recursive: true });
    const created = workspaceSchema.parse(getStore().createWorkspace({ ...workspace, outputPath }));
    ensureDefaultStatuses(created.id);
    return created;
  });

  ipcMain.handle("workspace:add-directory", async (_event, input: unknown) => {
    const { workspaceId } = addWorkspaceDirectoryInputSchema.parse(input);
    const workspace = requireFolderWorkspace(workspaceId);
    const result = await dialog.showOpenDialog({
      title: `Add a folder to ${workspace.name}`,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const directory = result.filePaths[0];
    if (directory === undefined) return null;
    const owner = getStore().listWorkspaces().find((candidate) => (
      candidate.kind === "folder" && candidate.directories.includes(directory)
    ));
    if (owner !== undefined && owner.id !== workspace.id) {
      throw new Error(`This folder is already associated with ${owner.name}.`);
    }
    return workspaceSchema.parse(getStore().addWorkspaceDirectory(workspace.id, directory));
  });

  ipcMain.handle("workspace:list", () => getStore().listWorkspaces().map((workspace) => workspaceSchema.parse(workspace)));
  ipcMain.handle("provider:list", () => getCredentialBroker().list());
  ipcMain.handle("provider:save", (_event, input: unknown) => {
    const parsed = setProviderCredentialInputSchema.parse(input);
    return getCredentialBroker().save(parsed);
  });
  ipcMain.handle("provider:remove", (_event, providerId: unknown) => (
    getCredentialBroker().remove(String(providerId))
  ));
  ipcMain.handle("settings:get", () => appSettingsSchema.parse(getStore().getAppSettings()));
  ipcMain.handle("settings:update", (_event, input: unknown) => (
    getStore().updateAppSettings(updateAppSettingsInputSchema.parse(input))
  ));
  ipcMain.handle("observability:get", async () => observabilitySettingsView());
  ipcMain.handle("observability:update", async (_event, input: unknown) => {
    const parsed = updateObservabilitySettingsInputSchema.parse(input);
    const { secretKey, ...stored } = parsed;
    getStore().setObservabilityConfig(withoutUndefined(stored));
    if (secretKey !== undefined) {
      await getSecretsBroker().setLangfuseSecretKey(secretKey.length === 0 ? null : secretKey);
    }
    await getObservabilityExporter().refresh();
    return observabilitySettingsView();
  });
  ipcMain.handle("usage:summary", (_event, input: unknown) => (
    getStore().usageSummary(usageQueryInputSchema.parse(input ?? {}))
  ));
  ipcMain.handle("extension:list", () => listExtensions());
  ipcMain.handle("extension:install", async (_event, source: unknown) => {
    const value = extensionSourceSchema.parse(source);
    const response = await sendAgentRequest({
      type: "extension.install",
      runtime: agentRuntime(),
      source: value,
    }, 120_000);
    if (response.type === "error") {
      throw new Error(response.message);
    }
    if (response.type !== "extensions") {
      throw new Error("Pi agent service returned an unexpected install response.");
    }
    return response.packages;
  });
  ipcMain.handle("extension:remove", async (_event, source: unknown) => {
    const value = extensionSourceSchema.parse(source);
    const response = await sendAgentRequest({
      type: "extension.remove",
      runtime: agentRuntime(),
      source: value,
    }, 120_000);
    if (response.type === "error") {
      throw new Error(response.message);
    }
    if (response.type !== "extensions") {
      throw new Error("Pi agent service returned an unexpected remove response.");
    }
    return response.packages;
  });
  ipcMain.handle("extension:choose-local", async (_event, kind: unknown) => {
    if (kind !== "file" && kind !== "directory") {
      throw new Error("Invalid local extension picker kind.");
    }
    const pickerOptions: OpenDialogOptions = {
      title: kind === "file" ? "Choose a Pi extension file" : "Choose a Pi extension folder",
      properties: [kind === "file" ? "openFile" : "openDirectory"],
    };
    const result = mainWindow === null
      ? await dialog.showOpenDialog(pickerOptions)
      : await dialog.showOpenDialog(mainWindow, pickerOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("skill:list", () => getSkillManager().list());
  ipcMain.handle("skill:list-files", (_event, input: unknown) => {
    const { id } = removeDomainEntityInputSchema.parse(input);
    return getSkillManager().listFiles(id);
  });
  ipcMain.handle("skill:read-file", (_event, input: unknown) => (
    getSkillManager().readFile(readSkillFileInputSchema.parse(input))
  ));
  ipcMain.handle("skill:scan-system", () => getSkillManager().scanSystem());
  ipcMain.handle("skill:search-marketplace", (_event, input: unknown) => (
    getSkillManager().searchMarketplace(searchSkillMarketplaceInputSchema.parse(input))
  ));
  ipcMain.handle("skill:preview-remote", (_event, input: unknown) => (
    getSkillManager().previewRemote(previewRemoteSkillInputSchema.parse(input))
  ));
  ipcMain.handle("skill:install-remote", (_event, input: unknown) => (
    getSkillManager().installRemote(installRemoteSkillsInputSchema.parse(input))
  ));
  ipcMain.handle("skill:cancel-remote-preview", async (_event, input: unknown) => {
    const { previewId } = cancelRemoteSkillPreviewInputSchema.parse(input);
    await getSkillManager().cancelRemotePreview(previewId);
  });
  ipcMain.handle("skill:create", (_event, input: unknown) => (
    getSkillManager().create(createSkillInputSchema.parse(input))
  ));
  ipcMain.handle("skill:update", (_event, input: unknown) => {
    const parsed = updateDomainEntityInputSchema.parse(input);
    return getSkillManager().update(parsed.id, updateSkillInputSchema.parse(parsed.value));
  });
  ipcMain.handle("skill:remove", async (_event, input: unknown) => {
    const { id } = removeDomainEntityInputSchema.parse(input);
    await getSkillManager().remove(id);
  });
  ipcMain.handle("skill:set-enabled", (_event, input: unknown) => {
    const parsed = setSkillEnabledInputSchema.parse(input);
    return getSkillManager().setEnabled(parsed.id, parsed.enabled);
  });
  ipcMain.handle("skill:import", (_event, input: unknown) => {
    const parsed = importSkillInputSchema.parse(input);
    return getSkillManager().import(parsed.path);
  });
  ipcMain.handle("skill:choose-import", async () => {
    const pickerOptions: OpenDialogOptions = {
      title: "Choose a Skill folder",
      properties: ["openDirectory"],
    };
    const result = mainWindow === null
      ? await dialog.showOpenDialog(pickerOptions)
      : await dialog.showOpenDialog(mainWindow, pickerOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("pi-console:start", async (_event, input: unknown) => {
    const cwd = await terminalWorkingDirectory(input);
    return getPiConsole().start(cwd);
  });
  ipcMain.handle("pi-console:write", (_event, input: unknown) => {
    if (typeof input !== "string") throw new Error("Invalid Pi Console input.");
    getPiConsole().write(input);
  });
  ipcMain.handle("pi-console:resize", (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) throw new Error("Invalid Pi Console dimensions.");
    const { cols, rows } = input as { cols?: unknown; rows?: unknown };
    if (typeof cols !== "number" || typeof rows !== "number") throw new Error("Invalid Pi Console dimensions.");
    getPiConsole().resize(cols, rows);
  });
  ipcMain.handle("pi-console:snapshot", () => getPiConsole().snapshot());
  ipcMain.handle("pi-console:execute", (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) throw new Error("Invalid terminal command.");
    const { command, cwd, env, timeoutMs } = input as {
      command?: unknown;
      cwd?: unknown;
      env?: unknown;
      timeoutMs?: unknown;
    };
    if (typeof command !== "string") throw new Error("Invalid terminal command.");
    if (cwd !== undefined && typeof cwd !== "string") throw new Error("Invalid terminal working directory.");
    if (
      env !== undefined
      && (
        typeof env !== "object"
        || env === null
        || Array.isArray(env)
        || Object.values(env).some((value) => typeof value !== "string")
      )
    ) {
      throw new Error("Invalid terminal environment.");
    }
    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs))) {
      throw new Error("Invalid terminal timeout.");
    }
    return getPiConsole().execute({
      command,
      ...(cwd === undefined ? {} : { cwd }),
      ...(env === undefined ? {} : { env: env as Record<string, string> }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  });
  ipcMain.handle("pi-console:restart", async (_event, input: unknown) => {
    const cwd = await terminalWorkingDirectory(input);
    return getPiConsole().restart(cwd);
  });
  ipcMain.handle("pi-console:close", () => {
    piConsole?.close();
    piConsole = null;
  });
  ipcMain.handle("managed-cli:list", () => (
    getManagedCliRuntime().list().map((value) => managedCliPackageSchema.parse(value))
  ));
  ipcMain.handle("managed-cli:install", async (_event, input: unknown) => {
    const { packageSpec } = installManagedCliInputSchema.parse(input);
    return (await getManagedCliRuntime().install(packageSpec))
      .map((value) => managedCliPackageSchema.parse(value));
  });
  ipcMain.handle("managed-cli:update", async (_event, input: unknown) => {
    const { name, version } = updateManagedCliInputSchema.parse(input);
    return (await getManagedCliRuntime().update(name, version))
      .map((value) => managedCliPackageSchema.parse(value));
  });
  ipcMain.handle("managed-cli:remove", async (_event, input: unknown) => {
    const { name } = removeManagedCliInputSchema.parse(input);
    return (await getManagedCliRuntime().remove(name))
      .map((value) => managedCliPackageSchema.parse(value));
  });
  ipcMain.handle("managed-cli:execute", async (_event, input: unknown) => {
    const parsed = executeManagedCliInputSchema.parse(input);
    const cwd = await managedCliWorkingDirectory(parsed.sessionId, parsed.cwd);
    const sessionEnvironment = parsed.sessionId === undefined
      ? {}
      : sessionEnvironments.get(parsed.sessionId);
    return managedCliExecutionResultSchema.parse(await getManagedCliRuntime().execute({
      command: parsed.command,
      args: parsed.args,
      cwd,
      env: {
        ...sessionEnvironment,
        ...parsed.env,
      },
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
    }));
  });
  ipcMain.handle("runtime-environment:set-session", (_event, input: unknown) => {
    const { sessionId, environment } = setSessionEnvironmentInputSchema.parse(input);
    if (getStore().getTask(sessionId) === null) throw new Error("Session not found.");
    return sessionEnvironments.set(sessionId, environment);
  });
  ipcMain.handle("runtime-environment:clear-session", (_event, input: unknown) => {
    const { sessionId } = sessionEnvironmentInputSchema.parse(input);
    sessionEnvironments.clear(sessionId);
  });
  ipcMain.handle("runtime-environment:list-session-keys", (_event, input: unknown) => {
    const { sessionId } = sessionEnvironmentInputSchema.parse(input);
    return sessionEnvironments.listKeys(sessionId);
  });
  ipcMain.handle("model:list", () => listModels());
  ipcMain.handle("model:test", (_event, input: unknown) => testModels(input));
  ipcMain.handle("conversation:list", () => getStore().listManagedConversations());
  ipcMain.handle("session:list", (_event, input: unknown) => (
    getStore().listSessions(withoutUndefined(sessionSearchInputSchema.parse(input ?? {})))
  ));
  ipcMain.handle("session:get", (_event, sessionId: unknown) => getStore().getSession(taskSchema.shape.id.parse(sessionId)));
  ipcMain.handle("session:update", (_event, input: unknown) => {
    const { sessionId, ...value } = updateSessionInputSchema.parse(input);
    return getStore().updateSession(sessionId, withoutUndefined(value));
  });
  ipcMain.handle("session:promote", async (_event, input: unknown) => {
    const parsed = promoteSessionInputSchema.parse(input);
    const session = getStore().getSession(parsed.sessionId);
    if (session === null) throw new Error("Personal session not found.");
    const sourceWorkspace = getStore().getWorkspace(session.workspaceId);
    const targetWorkspace = requireFolderWorkspace(parsed.workspaceId);
    if (sourceWorkspace === null || sourceWorkspace.kind !== "managed" || session.kind !== "chat") {
      throw new Error("Only personal sessions can move to a work folder.");
    }
    if (session.running || activeAgentSessions.has(session.id)) {
      throw new Error("Stop this personal session before moving it.");
    }
    if ([...pendingToolApprovals.values()].some(({ sessionId }) => sessionId === session.id)) {
      throw new Error("Resolve pending tool approvals before moving this session.");
    }
    assertManagedChatPath(sourceWorkspace.rootPath);

    const sourceStagingRoot = stagingPath(sourceWorkspace.rootPath, session.id);
    const targetStagingRoot = stagingPath(targetWorkspace.rootPath, session.id);
    const stagedArtifacts = getStore().listArtifacts(session.id).filter(({ publishedPath }) => publishedPath === null);
    const stagedPaths: Record<string, string> = {};
    for (const artifact of stagedArtifacts) {
      if (!pathWithin(sourceStagingRoot, artifact.stagedPath)) {
        throw new Error("A staged artifact is outside the private sandbox.");
      }
      stagedPaths[artifact.id] = join(targetStagingRoot, relative(sourceStagingRoot, artifact.stagedPath));
    }

    if (stagedArtifacts.length > 0) {
      await mkdir(join(targetWorkspace.rootPath, ".pi-work", "runs"), { recursive: true });
      await cp(sourceStagingRoot, targetStagingRoot, { recursive: true, force: false, errorOnExist: true });
    }

    let promoted;
    try {
      promoted = getStore().promoteManagedSession({
        sessionId: session.id,
        workspaceId: targetWorkspace.id,
        stagedPaths,
      });
    } catch (cause) {
      if (stagedArtifacts.length > 0) {
        await rm(targetStagingRoot, { recursive: true, force: true });
      }
      throw cause;
    }
    clearPendingToolApprovals(session.id);
    await rm(promoted.workspace.rootPath, { recursive: true, force: true });
    return taskSchema.parse(promoted.session);
  });
  ipcMain.handle("session:remove", async (_event, input: unknown) => {
    const parsed = removeConversationInputSchema.parse({ taskId: (input as { sessionId?: unknown })?.sessionId });
    const task = getStore().getTask(parsed.taskId);
    const workspace = task === null ? null : getStore().getWorkspace(task.workspaceId);
    if (workspace?.kind === "managed") assertManagedChatPath(workspace.rootPath);
    const removed = getStore().removeConversation(parsed.taskId);
    clearPendingToolApprovals(parsed.taskId);
    sessionEnvironments.clear(parsed.taskId);
    if (removed.workspace.kind === "managed") await rm(removed.workspace.rootPath, { recursive: true, force: true });
  });
  ipcMain.handle("session:messages", (_event, sessionId: unknown) => getStore().listMessages(taskSchema.shape.id.parse(sessionId)));
  ipcMain.handle("session:activities", (_event, sessionId: unknown) => getStore().listActivities(taskSchema.shape.id.parse(sessionId)));
  ipcMain.handle("session:attachments", (_event, sessionId: unknown) => getStore().listAttachments(taskSchema.shape.id.parse(sessionId)));
  ipcMain.handle("attachment:choose", async () => {
    const result = mainWindow === null
      ? await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] })
      : await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
    if (result.canceled) return [];
    const inspected = await inspectAttachments(result.filePaths);
    result.filePaths.forEach((path) => approvedAttachmentPaths.add(path));
    return inspected;
  });
  ipcMain.handle("attachment:inspect", async (_event, input: unknown) => {
    const paths = inspectAttachmentPathsSchema.parse(input);
    const inspected = await inspectAttachments(paths);
    paths.forEach((path) => approvedAttachmentPaths.add(path));
    return inspected;
  });
  ipcMain.handle("attachment:from-clipboard", (_event, input: unknown) => saveClipboardImage(input));
  ipcMain.handle("attachment:preview-draft", (_event, input: unknown) => previewAttachment(input));
  ipcMain.handle("attachment:preview", (_event, attachmentId: unknown) => previewSavedAttachment(attachmentId));
  ipcMain.handle("attachment:open", async (_event, attachmentId: unknown) => {
    const attachment = getStore().getAttachment(attachmentSchema.shape.id.parse(attachmentId));
    if (attachment === null) throw new Error("Attachment not found.");
    return shell.openPath(attachment.path);
  });
  ipcMain.handle("session:stop", async (_event, sessionId: unknown) => {
    const { taskId: id } = abortTaskInputSchema.parse({ taskId: sessionId });
    const response = await sendAgentRequest({ type: "cancel", sessionId: id });
    if (response.type === "error") throw new Error(response.message);
    getStore().updateSession(id, { running: false });
    clearPendingToolApprovals(id);
  });
  ipcMain.handle("conversation:update-model", (_event, input: unknown) => {
    const parsed = updateConversationModelInputSchema.parse(input);
    return taskSchema.parse(saveConversationModel(parsed.taskId, parsed));
  });
  ipcMain.handle("conversation:remove", async (_event, input: unknown) => {
    const parsed = removeConversationInputSchema.parse(input);
    const task = getStore().getTask(parsed.taskId);
    const workspace = task === null ? null : getStore().getWorkspace(task.workspaceId);
    if (workspace?.kind === "managed") {
      assertManagedChatPath(workspace.rootPath);
    }
    const removed = getStore().removeConversation(parsed.taskId);
    clearPendingToolApprovals(parsed.taskId);
    if (removed.workspace.kind === "managed") {
      await rm(removed.workspace.rootPath, { recursive: true, force: true });
    }
  });
  ipcMain.handle("chat:resolve-tool-approval", (_event, input: unknown) => {
    const parsed = resolveToolApprovalInputSchema.parse(input);
    getAgentProcess().postMessage({
      type: "tool.resolve",
      requestId: randomUUID(),
      ...parsed,
    });
    pendingToolApprovals.delete(parsed.approvalId);
  });
  ipcMain.handle("task:list", (_event, workspaceId: unknown) => getStore().listTasks(workspaceSchema.shape.id.parse(workspaceId)).map((task) => taskSchema.parse(task)));
  ipcMain.handle("task:create", async (_event, input: unknown) => {
    const parsed = createTaskInputSchema.parse(input);
    return taskSchema.parse(getStore().createTask(parsed));
  });
  ipcMain.handle("session:create", async (_event, input: unknown) => {
    const parsed = createPersonalSessionInputSchema.parse(input);
    const sessionId = randomUUID();
    const rootPath = join(app.getPath("userData"), "chats", sessionId);
    await mkdir(rootPath, { recursive: true });
    const workspace = getStore().createWorkspace({
      name: "New session",
      rootPath,
      outputPath: join(rootPath, "Pi Work"),
      kind: "managed",
    });
    return taskSchema.parse(getStore().createTask({
      id: sessionId,
      workspaceId: workspace.id,
      title: "New session",
      goal: "New session",
      kind: "chat",
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      thinkingLevel: parsed.thinkingLevel,
      permissionMode: "explore",
      planMode: false,
      workingDirectory: workspace.rootPath,
    }));
  });
  ipcMain.handle("task:update-brief", (_event, input: unknown) => {
    const { taskId, ...value } = updateTaskBriefInputSchema.parse(input);
    requireFolderTask(taskId);
    return taskSchema.parse(getStore().updateTaskBrief(taskId, withoutUndefined(value)));
  });
  ipcMain.handle("task:generate-plan", async (_event, input: unknown) => {
    const { taskId } = generatePlanInputSchema.parse(input);
    const { task, workspace } = requireFolderTask(taskId);
    if (task.providerId === null || task.modelId === null) {
      throw new Error("Choose a model before generating a plan.");
    }
    const plan = await generatePlan(
      task,
      await providerCredential(task.providerId),
      task.modelId,
      task.thinkingLevel,
      agentRuntime(task.workingDirectory ?? workspace.rootPath, task.id),
    );
    getStore().savePlan(plan);
    getStore().addMessage({
      taskId: task.id,
      role: "assistant",
      content: `Plan ready for review: ${plan.summary}`,
    });
    return planSchema.parse(plan);
  });
  ipcMain.handle("chat:list", (_event, taskId: unknown) => getStore().listMessages(taskSchema.shape.id.parse(taskId)));
  ipcMain.handle("chat:tool-approvals", (_event, taskId: unknown) => {
    const parsedTaskId = taskId === undefined ? null : taskSchema.shape.id.parse(taskId);
    return [...pendingToolApprovals.values()].filter((approval) => (
      parsedTaskId === null || approval.sessionId === parsedTaskId
    ));
  });
  ipcMain.handle("chat:send", async (_event, input: unknown) => {
    const parsed = sendChatInputSchema.parse(input);
    if (parsed.attachments.some(({ path }) => !approvedAttachmentPaths.has(path))) {
      throw new Error("Choose or drop attachments before sending them.");
    }
    const inspectedAttachments = await inspectAttachments(parsed.attachments.map(({ path }) => path));
    const images = await agentImagesForAttachments(inspectedAttachments);
    const command = parsed.content.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (command !== null && command[1] !== "goal" && command[1] !== "plan") {
      throw new Error(`/${command[1]} is not available in chat. Extension slash commands run in Pi Console; in chat, describe what you need.`);
    }

    let task = parsed.taskId === null ? null : getStore().getTask(parsed.taskId);
    if (parsed.taskId !== null && task === null) {
      throw new Error("Task not found.");
    }
    if (command?.[1] === "plan" && task === null) {
      throw new Error("Send a message or set /goal before requesting /plan.");
    }

    let managedSessionId: string | null = null;
    let workspace = task === null
      ? (parsed.workspaceId === null ? null : getStore().getWorkspace(parsed.workspaceId))
      : getStore().getWorkspace(task.workspaceId);
    if (parsed.workspaceId !== null && workspace?.id !== parsed.workspaceId) {
      throw new Error(task === null ? "Work folder not found." : "Task does not belong to this work folder.");
    }
    if (workspace === null) {
      if (task !== null || parsed.workspaceId !== null) {
        throw new Error("Work folder not found.");
      }
      managedSessionId = randomUUID();
      const rootPath = join(app.getPath("userData"), "chats", managedSessionId);
      await mkdir(rootPath, { recursive: true });
      workspace = getStore().createWorkspace({
        name: "New chat",
        rootPath,
        outputPath: join(rootPath, "Pi Work"),
        kind: "managed",
      });
    }
    if (task !== null && ((task.kind === "chat" && workspace.kind !== "managed") || (task.kind === "task" && workspace.kind !== "folder"))) {
      throw new Error("Session and work folder types do not match.");
    }
    if (task === null && workspace.kind !== "managed") {
      throw new Error("Create a work folder task before sending it to Pi.");
    }

    if (command?.[1] === "goal") {
      const goal = command[2]?.trim() ?? "";
      if (goal.length === 0) {
        throw new Error("Usage: /goal <what you want to accomplish>");
      }
      task ??= getStore().createTask({
        ...(managedSessionId === null ? {} : { id: managedSessionId }),
        workspaceId: workspace.id,
        title: "New session",
        goal,
        kind: "chat",
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        thinkingLevel: parsed.thinkingLevel,
      });
      task = saveConversationModel(task.id, parsed);
      getStore().addMessage({ taskId: task.id, role: "user", content: parsed.content });
      task = getStore().updateTaskGoal(task.id, goal);
      getStore().addMessage({
        taskId: task.id,
        role: "system",
        content: `Goal updated: ${goal}`,
      });
      return taskSchema.parse(task);
    }

    if (command?.[1] === "plan") {
      if (task === null) {
        throw new Error("Send a message or set /goal before requesting /plan.");
      }
      task = saveConversationModel(task.id, parsed);
      getStore().addMessage({ taskId: task.id, role: "user", content: parsed.content });
      const goal = command[2]?.trim();
      if (goal) {
        task = getStore().updateTaskGoal(task.id, goal);
      }
      const plan = await generatePlan(
        task,
        await providerCredential(parsed.providerId),
        parsed.modelId,
        parsed.thinkingLevel,
        agentRuntime(task.workingDirectory ?? workspace.rootPath, task.id),
      );
      getStore().savePlan(plan);
      getStore().addMessage({
        taskId: task.id,
        role: "assistant",
        content: `Plan ready for review: ${plan.summary}`,
      });
      return taskSchema.parse(getStore().getTask(task.id));
    }

    task ??= getStore().createTask({
      ...(managedSessionId === null ? {} : { id: managedSessionId }),
      workspaceId: workspace.id,
      title: "New session",
      goal: parsed.content,
      kind: "chat",
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      thinkingLevel: parsed.thinkingLevel,
      workingDirectory: workspace.rootPath,
      ...(parsed.permissionMode === undefined ? {} : { permissionMode: parsed.permissionMode }),
      ...(parsed.planMode === undefined ? {} : { planMode: parsed.planMode }),
    });
    task = saveConversationModel(task.id, parsed);
    task = getStore().updateSession(task.id, {
      permissionMode: parsed.permissionMode ?? task.permissionMode,
      planMode: parsed.planMode ?? task.planMode,
      running: true,
      unread: false,
    });
    const userMessage = getStore().addMessage({ taskId: task.id, role: "user", content: parsed.content });
    for (const attachment of inspectedAttachments) {
      getStore().addAttachment({
        sessionId: task.id,
        messageId: userMessage.id,
        ...attachment,
      });
      approvedAttachmentPaths.delete(attachment.path);
    }
    void runChatInBackground({
      taskId: task.id,
      workspaceId: workspace.id,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      thinkingLevel: parsed.thinkingLevel,
      runtime: agentRuntime(task.workingDirectory ?? workspace.rootPath, task.id),
      permissionMode: parsed.permissionMode ?? task.permissionMode,
      images,
    });
    return taskSchema.parse(task);
  });
  ipcMain.handle("task:plan", (_event, taskId: unknown) => {
    const { task } = requireFolderTask(taskSchema.shape.id.parse(taskId));
    const plan = getStore().getPlan(task.id);
    return plan === null ? null : planSchema.parse(plan);
  });
  ipcMain.handle("task:approve-plan", (_event, input: unknown) => {
    const parsed = approvePlanInputSchema.parse(input);
    requireFolderTask(parsed.taskId);
    return taskSchema.parse(getStore().approvePlan(parsed.taskId, parsed.approved));
  });
  ipcMain.handle("task:abort", async (_event, input: unknown) => {
    const parsed = abortTaskInputSchema.parse(input);
    requireFolderTask(parsed.taskId);
    if (activeAgentSessions.has(parsed.taskId)) {
      const response = await sendAgentRequest({ type: "cancel", sessionId: parsed.taskId });
      if (response.type === "error") throw new Error(response.message);
    }
    return taskSchema.parse(getStore().cancelTask(parsed.taskId));
  });
  ipcMain.handle("task:complete", (_event, input: unknown) => {
    const parsed = completeTaskInputSchema.parse(input);
    requireFolderTask(parsed.taskId);
    return taskSchema.parse(getStore().completeTask(parsed.taskId));
  });
  ipcMain.handle("task:resume", (_event, input: unknown) => {
    const parsed = resumeTaskInputSchema.parse(input);
    requireFolderTask(parsed.taskId);
    return taskSchema.parse(getStore().resumeTask(parsed.taskId));
  });
  ipcMain.handle("artifact:list", (_event, taskId: unknown) => getStore().listArtifacts(taskSchema.shape.id.parse(taskId)).map((artifact) => artifactSchema.parse(artifact)));
  ipcMain.handle("artifact:create", async (_event, input: unknown) => {
    const parsed = createArtifactInputSchema.parse(input);
    const task = getStore().getTask(parsed.taskId);
    if (task === null) {
      throw new Error("Task not found.");
    }
    const { workspace } = requireFolderTask(task.id);
    const stagedPath = await stageArtifact(workspace, task, parsed);
    return artifactSchema.parse(getStore().createArtifact({ ...parsed, stagedPath }));
  });
  ipcMain.handle("artifact:publish", async (_event, input: unknown) => {
    const parsed = publishArtifactInputSchema.parse(input);
    const artifact = getStore().getArtifact(parsed.artifactId);
    if (artifact === null) {
      throw new Error("Artifact not found.");
    }
    const { task, workspace } = requireFolderTask(artifact.taskId);
    const publishedPath = await publishArtifact(workspace, task, artifact);
    return artifactSchema.parse(getStore().publishArtifact(artifact.id, publishedPath));
  });
  ipcMain.handle("system:open-external", (_event, input: unknown) => {
    const { url } = externalUrlInputSchema.parse(input);
    return shell.openExternal(url);
  });
  ipcMain.handle("system:info", () => buildInfoSchema.parse({
    version: app.getVersion(),
    branch: __PI_WORK_GIT_BRANCH__,
    commit: __PI_WORK_GIT_COMMIT__,
  }));
  ipcMain.handle("browser:open", async (_event, input: unknown) => {
    const { url } = browserNavigateInputSchema.parse(input);
    const normalized = normalizeBrowserUrl(url);
    await getBrowserView().webContents.loadURL(normalized);
  });
  ipcMain.handle("browser:navigate", async (_event, input: unknown) => {
    const { url } = browserNavigateInputSchema.parse(input);
    await getBrowserView().webContents.loadURL(normalizeBrowserUrl(url));
  });
  ipcMain.handle("browser:bounds", (_event, input: unknown) => {
    const bounds = browserBoundsInputSchema.parse(input) as Rectangle;
    getBrowserView().setBounds(bounds);
  });
  ipcMain.handle("browser:back", () => {
    const history = getBrowserView().webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    const history = getBrowserView().webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  });
  ipcMain.handle("browser:reload", () => getBrowserView().webContents.reload());
  ipcMain.handle("browser:external", () => {
    const url = browserView?.webContents.getURL();
    if (url?.startsWith("http://") || url?.startsWith("https://")) return shell.openExternal(url);
  });
  ipcMain.handle("browser:close", () => closeBrowserView());

  const domain = {
    status: { schema: statusDefinitionSchema, list: (workspaceId: string) => {
      ensureDefaultStatuses(workspaceId);
      return getStore().listStatuses(workspaceId);
    } },
    label: { schema: labelSchema, list: (workspaceId: string) => getStore().listLabels(workspaceId) },
    source: { schema: sourceSchema, list: (workspaceId: string) => getStore().listSources(workspaceId) },
    automation: { schema: automationSchema, list: (workspaceId: string) => getStore().listAutomations(workspaceId) },
  } as const;
  type DomainEntity = StatusDefinition | Label | Source | Automation;
  for (const [name, definition] of Object.entries(domain)) {
    const domainName = name as keyof typeof domain;
    const schema = definition.schema as { parse(value: unknown): DomainEntity };
    ipcMain.handle(`${name}:list`, (_event, workspaceId: unknown) => {
      const id = workspaceSchema.shape.id.parse(workspaceId);
      requireFolderWorkspace(id);
      return definition.list(id);
    });
    ipcMain.handle(`${name}:create`, (_event, input: unknown) => {
      const parsed = createDomainEntityInputSchema.parse(input);
      requireFolderWorkspace(parsed.workspaceId);
      if (domainName === "source") {
        validateMcpSource(parsed.value as Pick<Source, "type" | "config">);
      }
      return getStore().createDomainEntity(domainName, schema, {
        ...parsed.value,
        workspaceId: parsed.workspaceId,
      });
    });
    ipcMain.handle(`${name}:update`, (_event, input: unknown) => {
      const parsed = updateDomainEntityInputSchema.parse(input);
      if (domainName === "source") {
        const current = findSource(parsed.id);
        if (current === undefined) throw new Error("Unknown source.");
        validateMcpSource({ ...current, ...parsed.value });
      }
      return getStore().updateDomainEntity(domainName, schema, parsed.id, parsed.value);
    });
    ipcMain.handle(`${name}:remove`, (_event, input: unknown) => {
      const { id } = removeDomainEntityInputSchema.parse(input);
      if (domainName === "status") getStore().removeStatus(id);
      else if (domainName === "label") getStore().removeLabel(id);
      else {
        getStore().removeDomainEntity(domainName, id);
        if (domainName === "source") void getMcpOAuthManager().remove(id);
      }
    });
  }

  ipcMain.handle("mcp:list", () => getStore().listGlobalMcpSources());
  ipcMain.handle("mcp:create", (_event, input: unknown) => {
    const value = sourceSchema.pick({
      name: true,
      type: true,
      enabled: true,
      config: true,
    }).parse(input);
    if (value.type !== "mcp_stdio" && value.type !== "mcp_http") {
      throw new Error("MCP sources must use stdio or HTTP.");
    }
    validateMcpSource(value);
    return getStore().createSource({ ...value, workspaceId: null });
  });
  ipcMain.handle("mcp:update", async (_event, input: unknown) => {
    const parsed = updateDomainEntityInputSchema.parse(input);
    const current = getStore().listGlobalMcpSources().find(({ id }) => id === parsed.id);
    if (current === undefined) throw new Error("Unknown MCP source.");
    const next = sourceSchema.parse({ ...current, ...parsed.value, id: current.id, workspaceId: null });
    if (next.type !== "mcp_stdio" && next.type !== "mcp_http") {
      throw new Error("MCP sources must use stdio or HTTP.");
    }
    validateMcpSource(next);
    const updated = getStore().updateDomainEntity("source", sourceSchema, current.id, {
      ...parsed.value,
      workspaceId: null,
    });
    if (mcpOAuthIdentityChanged(current, next)) await getMcpOAuthManager().remove(current.id);
    return updated;
  });
  ipcMain.handle("mcp:remove", (_event, input: unknown) => {
    const { id } = removeDomainEntityInputSchema.parse(input);
    getStore().removeDomainEntity("source", id);
    void getMcpOAuthManager().remove(id);
  });
  ipcMain.handle("mcp:inspect", async (_event, input: unknown) => {
    const { sourceId } = mcpInspectInputSchema.parse(input);
    const { server, runtime } = await mcpRuntimeServer(sourceId);
    const response = await sendAgentRequest({ type: "mcp.inspect", server, runtime }, 60_000);
    if (response.type === "error") throw new Error(response.message);
    if (response.type !== "mcp.inspect") throw new Error("Unexpected MCP inspection response.");
    return mcpInspectResultSchema.parse(response.result);
  });
  ipcMain.handle("mcp:call-tool", async (_event, input: unknown) => {
    const parsed = mcpCallToolInputSchema.parse(input);
    const { server, runtime } = await mcpRuntimeServer(parsed.sourceId);
    const response = await sendAgentRequest({
      type: "mcp.call-tool",
      server,
      runtime,
      toolName: parsed.toolName,
      arguments: parsed.arguments,
    }, 60_000);
    if (response.type === "error") throw new Error(response.message);
    if (response.type !== "mcp.call-tool") throw new Error("Unexpected MCP tool response.");
    return mcpCallToolResultSchema.parse(response.result);
  });
  ipcMain.handle("mcp:authorization-status", async (_event, input: unknown) => {
    const { sourceId } = mcpAuthorizeInputSchema.parse(input);
    const source = findSource(sourceId);
    if (source === undefined) throw new Error("Unknown MCP source.");
    const authorized = await getMcpOAuthManager().status(source);
    return mcpAuthorizationStatusSchema.parse({
      authorized,
      message: authorized ? "OAuth credentials are available." : "OAuth authorization is required.",
    });
  });
  ipcMain.handle("mcp:authorize", async (_event, input: unknown) => {
    const { sourceId } = mcpAuthorizeInputSchema.parse(input);
    const source = findSource(sourceId);
    if (source === undefined) throw new Error("Unknown MCP source.");
    await getMcpOAuthManager().authorize(source);
    return mcpAuthorizationStatusSchema.parse({
      authorized: true,
      message: "Remote MCP authorization completed.",
    });
  });
}

function ensureDefaultStatuses(workspaceId: string): void {
  if (getStore().listStatuses(workspaceId).length > 0) return;
  const english = getStore().getAppSettings().language === "en";
  [
    { name: english ? "To do" : "待处理", color: "#8a8275", position: 0 },
    { name: english ? "In progress" : "进行中", color: "#a66f2b", position: 1 },
    { name: english ? "Waiting" : "等待", color: "#967448", position: 2 },
    { name: english ? "Completed" : "已完成", color: "#58745d", position: 3 },
  ].forEach((value) => getStore().createDomainEntity("status", statusDefinitionSchema, {
    workspaceId,
    ...value,
  }));
}

app.whenReady().then(async () => {
  const settings = getStore().getAppSettings();
  const legacyDefault = await getCredentialBroker().migrateLegacyDefault();
  if (legacyDefault !== null && settings.providerId === null && settings.modelId === null) {
    getStore().updateAppSettings(legacyDefault);
  }
  registerIpc();
  getObservabilityExporter();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeBrowserView();
  void skillManager?.dispose();
  observabilityExporter?.persistPendingSync();
  store?.close();
  agentProcess?.kill();
  piConsole?.close();
  piConsole = null;
  sessionEnvironments.clearAll();
});
