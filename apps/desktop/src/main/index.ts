import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, WebContentsView } from "electron";
import type { OpenDialogOptions, Rectangle, UtilityProcess } from "electron";
import type {
  AgentRequest,
  AgentResponse,
  AgentMessage,
  AgentRuntime,
  ChatMessage,
  ExtensionPackage,
  ModelCatalog,
  Plan,
  SetProviderCredentialInput,
  StatusDefinition,
  Label,
  Skill,
  Source,
  ThinkingLevel,
  ToolApproval,
  Automation,
  PermissionMode,
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
  createTaskInputSchema,
  createWorkspaceInputSchema,
  automationSchema,
  browserBoundsInputSchema,
  browserNavigateInputSchema,
  createDomainEntityInputSchema,
  generatePlanInputSchema,
  completeTaskInputSchema,
  externalUrlInputSchema,
  extensionSourceSchema,
  inspectAttachmentPathsSchema,
  planSchema,
  promoteSessionInputSchema,
  publishArtifactInputSchema,
  resumeTaskInputSchema,
  sendChatInputSchema,
  setProviderCredentialInputSchema,
  taskSchema,
  statusDefinitionSchema,
  labelSchema,
  updateAppSettingsInputSchema,
  updateConversationModelInputSchema,
  removeConversationInputSchema,
  removeDomainEntityInputSchema,
  resolveToolApprovalInputSchema,
  sessionSearchInputSchema,
  skillSchema,
  sourceSchema,
  workspaceSchema,
  updateDomainEntityInputSchema,
  updateSessionInputSchema,
  updateTaskBriefInputSchema,
} from "@pi-work/protocol";
import { stageArtifact, publishArtifact } from "@pi-work/artifacts";
import { PiWorkStore } from "@pi-work/storage";
import { CredentialBroker } from "./credential-broker.js";

let mainWindow: BrowserWindow | null = null;
let store: PiWorkStore;
let agentProcess: UtilityProcess | null = null;
let credentialBroker: CredentialBroker;
let browserView: WebContentsView | null = null;
const pendingAgentRequests = new Map<string, {
  resolve: (response: AgentResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const activeAgentSessions = new Set<string>();
const approvedAttachmentPaths = new Set<string>();
const pendingToolApprovals = new Map<string, ToolApproval>();

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

function getStore(): PiWorkStore {
  if (store === undefined) {
    store = new PiWorkStore(applicationDatabasePath());
  }
  return store;
}

function getCredentialBroker(): CredentialBroker {
  if (credentialBroker === undefined) {
    credentialBroker = new CredentialBroker(join(app.getPath("userData"), "credentials.enc"));
  }
  return credentialBroker;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 860,
    minHeight: 640,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "darwin" && { trafficLightPosition: { x: 18, y: 16 } }),
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

  if (process.env.ELECTRON_RENDERER_URL === undefined) {
    void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  } else {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
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
  agentProcess = utilityProcess.fork(agentEntry);
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
      if (response.event.kind !== "text_delta" && response.event.kind !== "completed" && response.event.kind !== "cancelled") {
        const kind = response.event.kind === "thinking"
          ? "thinking"
          : response.event.kind === "tool_call"
            ? "tool_call"
            : response.event.kind === "tool_result"
              ? "tool_result"
              : response.event.kind === "file_change"
                ? "file_change"
                : response.event.kind === "approval"
                  ? "approval"
                  : "error";
        try {
          getStore().addActivity({
            sessionId: response.sessionId,
            messageId: null,
            kind,
            title: response.event.kind.replaceAll("_", " "),
            detail: JSON.stringify(response.event.payload),
            metadata: {
              requestId: response.requestId,
              sequence: response.event.sequence,
              ...response.event.payload,
            },
          });
        } catch {
          // A deleted session should not take down the agent event channel.
        }
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

function agentRuntime(cwd = app.getPath("userData")): AgentRuntime {
  return {
    cwd,
    agentDir: join(app.getPath("userData"), "pi-agent"),
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
      reject(new Error("Pi agent service timed out."));
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
): Promise<{ content: string; cancelled: boolean }> {
  const response = await sendAgentRequest({
    type: "chat",
    sessionId,
    messages: messages.map(({ role, content }) => ({ role, content })),
    provider: provider ?? undefined,
    modelId,
    thinkingLevel,
    runtime,
    permissionMode,
  }, 15 * 60_000);
  if (response.type === "error") {
    throw new Error(response.message);
  }
  if (response.type !== "chat") {
    throw new Error("Pi chat service returned an unexpected response.");
  }
  return { content: response.content, cancelled: response.cancelled };
}

function taskTitle(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0]?.replace(/^#+\s*/, "").trim() ?? "";
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
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
  ipcMain.handle("model:list", () => listModels());
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
      agentRuntime(workspace.rootPath),
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
    const command = parsed.content.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (command !== null && command[1] !== "goal" && command[1] !== "plan") {
      throw new Error(`Unknown command: /${command[1]}`);
    }

    let task = parsed.taskId === null ? null : getStore().getTask(parsed.taskId);
    if (parsed.taskId !== null && task === null) {
      throw new Error("Task not found.");
    }
    if (command?.[1] === "plan" && task === null) {
      throw new Error("Send a message or set /goal before requesting /plan.");
    }

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
      const conversationId = randomUUID();
      const rootPath = join(app.getPath("userData"), "chats", conversationId);
      await mkdir(rootPath, { recursive: true });
      workspace = getStore().createWorkspace({
        id: conversationId,
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
        workspaceId: workspace.id,
        title: taskTitle(goal),
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
      const plan = await generatePlan(
        task,
        await providerCredential(parsed.providerId),
        parsed.modelId,
        parsed.thinkingLevel,
        agentRuntime(workspace.rootPath),
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
      workspaceId: workspace.id,
      title: taskTitle(parsed.content),
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
    if (inspectedAttachments.length > 0) {
      getStore().addMessage({
        taskId: task.id,
        role: "system",
        content: `Attached files:\n${inspectedAttachments.map(({ path }) => `- ${path}`).join("\n")}`,
      });
    }
    try {
      activeAgentSessions.add(task.id);
      const response = await generateChat(
        task.id,
        getStore().listMessages(task.id),
        await providerCredential(parsed.providerId),
        parsed.modelId,
        parsed.thinkingLevel,
        agentRuntime(workspace.rootPath),
        parsed.permissionMode ?? task.permissionMode,
      );
      if (response.content !== "") {
        getStore().addMessage({ taskId: task.id, role: "assistant", content: response.content });
      }
      task = getStore().updateSession(task.id, { running: false });
    } catch (error) {
      getStore().addMessage({
        taskId: task.id,
        role: "system",
        content: error instanceof Error ? error.message : "Pi could not reply.",
      });
      task = getStore().updateSession(task.id, { running: false });
    } finally {
      activeAgentSessions.delete(task.id);
    }
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
    skill: { schema: skillSchema, list: (workspaceId: string) => getStore().listSkills(workspaceId) },
    automation: { schema: automationSchema, list: (workspaceId: string) => getStore().listAutomations(workspaceId) },
  } as const;
  type DomainEntity = StatusDefinition | Label | Source | Skill | Automation;
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
      return getStore().createDomainEntity(domainName, schema, {
        ...parsed.value,
        workspaceId: parsed.workspaceId,
      });
    });
    ipcMain.handle(`${name}:update`, (_event, input: unknown) => {
      const parsed = updateDomainEntityInputSchema.parse(input);
      return getStore().updateDomainEntity(domainName, schema, parsed.id, parsed.value);
    });
    ipcMain.handle(`${name}:remove`, (_event, input: unknown) => {
      const { id } = removeDomainEntityInputSchema.parse(input);
      if (domainName === "status") getStore().removeStatus(id);
      else if (domainName === "label") getStore().removeLabel(id);
      else getStore().removeDomainEntity(domainName, id);
    });
  }
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
  store?.close();
  agentProcess?.kill();
});
