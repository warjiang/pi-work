import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getSupportedThinkingLevels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createAgentSessionFromServices,
  createAgentSessionServices,
  DefaultPackageManager,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  AgentRuntime,
  ChatMessage,
  ExtensionPackage,
  ModelOption,
  Plan,
  PermissionMode,
  Task,
  ThinkingLevel,
} from "@pi-work/protocol";
import { z } from "zod";

export type PiRuntimeHealth = {
  piSdkAvailable: boolean;
  exportedSymbols: number;
};

export type PiProviderCredential = {
  providerId: string;
  apiKey: string;
};

export type ToolApprovalRequester = (
  tool: "edit" | "write" | "bash",
  args: Record<string, unknown>,
  cwd: string,
) => Promise<boolean>;

export type AgentStreamListener = (
  kind: "text_delta" | "thinking" | "tool_call" | "tool_update" | "tool_result" | "file_change" | "runtime",
  payload: Record<string, unknown>,
) => void;

const generatedPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().min(1),
  })).min(1).max(20),
  sources: z.array(z.string().min(1)).max(100),
});

export class PiAdapter {
  private readonly activeSessions = new Map<string, AgentSession>();
  private readonly cancelledSessions = new Set<string>();

  health(): PiRuntimeHealth {
    return {
      piSdkAvailable: true,
      exportedSymbols: 4,
    };
  }

  async createPlan(
    task: Pick<Task, "id" | "title" | "goal">,
    provider: PiProviderCredential | null,
    modelId: string,
    thinkingLevel: ThinkingLevel,
    runtime: AgentRuntime,
  ): Promise<Plan> {
    if (provider === null) {
      return this.createPlanningFallback(task);
    }

    const credentials = new InMemoryCredentialStore();
    const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null });
    const services = await createAgentSessionServices({
      cwd: runtime.cwd,
      agentDir: runtime.agentDir,
      modelRuntime,
      settingsManager: this.settingsManager(runtime),
    });
    await modelRuntime.setRuntimeApiKey(provider.providerId, provider.apiKey);
    const modelResolution = resolveCliModel({
      cliModel: `${provider.providerId}/${modelId}`,
      modelRuntime,
    });
    if (modelResolution.error !== undefined) {
      throw new Error(modelResolution.error);
    }
    if (modelResolution.model === undefined) {
      throw new Error(`Pi could not resolve ${provider.providerId}/${modelId}.`);
    }

    const textDeltas: string[] = [];
    const { session } = await createAgentSessionFromServices({
      services,
      model: modelResolution.model,
      thinkingLevel,
      sessionManager: SessionManager.inMemory(),
      tools: [],
    });
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        textDeltas.push(event.assistantMessageEvent.delta);
      }
    });

    try {
      await session.prompt([
        "Create a read-only execution plan for this Pi Work task.",
        "Return JSON only, with keys summary, steps, and sources.",
        "Each step needs title and detail. Do not call tools or write files.",
        `Task title: ${task.title}`,
        `Task goal: ${task.goal}`,
      ].join("\n"));
    } finally {
      unsubscribe();
      session.dispose();
    }

    const generated = generatedPlanSchema.parse(JSON.parse(extractJson(textDeltas.join(""))));
    return {
      taskId: task.id,
      summary: generated.summary,
      steps: generated.steps.map((step) => ({
        id: randomUUID(),
        title: step.title,
        detail: step.detail,
      })),
      sources: generated.sources,
    };
  }

  async chat(
    sessionId: string,
    messages: Pick<ChatMessage, "role" | "content">[],
    provider: PiProviderCredential | null,
    modelId: string,
    thinkingLevel: ThinkingLevel,
    runtime: AgentRuntime,
    requestApproval: ToolApprovalRequester,
    permissionMode: PermissionMode = "ask",
    onEvent?: AgentStreamListener,
  ): Promise<{ content: string; cancelled: boolean }> {
    if (provider === null) {
      return {
        content: "No provider is configured. Add one in settings, or use /goal and /plan with local fallback.",
        cancelled: false,
      };
    }

    const credentials = new InMemoryCredentialStore();
    const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null });
    const services = await createAgentSessionServices({
      cwd: runtime.cwd,
      agentDir: runtime.agentDir,
      modelRuntime,
      settingsManager: this.settingsManager(runtime),
    });
    await modelRuntime.setRuntimeApiKey(provider.providerId, provider.apiKey);
    const modelResolution = resolveCliModel({
      cliModel: `${provider.providerId}/${modelId}`,
      modelRuntime,
    });
    if (modelResolution.error !== undefined) {
      throw new Error(modelResolution.error);
    }
    if (modelResolution.model === undefined) {
      throw new Error(`Pi could not resolve ${provider.providerId}/${modelId}.`);
    }

    const textDeltas: string[] = [];
    const readTools: ToolDefinition<any, any, any>[] = [
      boundaryTool(createReadToolDefinition(runtime.cwd), runtime.cwd),
      boundaryTool(createGrepToolDefinition(runtime.cwd), runtime.cwd),
      boundaryTool(createFindToolDefinition(runtime.cwd), runtime.cwd),
      boundaryTool(createLsToolDefinition(runtime.cwd), runtime.cwd),
    ];
    const writeTools = permissionMode === "explore" ? [] : [
      approvalTool(
        createEditToolDefinition(runtime.cwd),
        runtime.cwd,
        permissionMode === "auto" ? async () => true : requestApproval,
        onEvent,
      ),
      approvalTool(
        createWriteToolDefinition(runtime.cwd),
        runtime.cwd,
        permissionMode === "auto" ? async () => true : requestApproval,
        onEvent,
      ),
      approvalTool(
        createBashToolDefinition(runtime.cwd),
        runtime.cwd,
        permissionMode === "auto" ? async () => true : requestApproval,
        onEvent,
      ),
    ];
    const customTools: ToolDefinition<any, any, any>[] = [...readTools, ...writeTools];
    const enabledTools = permissionMode === "explore"
      ? ["read", "grep", "find", "ls"]
      : ["read", "grep", "find", "ls", "edit", "write", "bash"];
    const sessionDirectory = join(runtime.agentDir, "sessions");
    const existing = (await SessionManager.list(runtime.cwd, sessionDirectory))
      .find(({ id }) => id === sessionId);
    const sessionManager = existing === undefined
      ? SessionManager.create(runtime.cwd, sessionDirectory, { id: sessionId })
      : SessionManager.open(existing.path, sessionDirectory, runtime.cwd);
    const hasHistory = sessionManager.getEntries().length > 0;
    const { session } = await createAgentSessionFromServices({
      services,
      model: modelResolution.model,
      thinkingLevel,
      sessionManager,
      tools: enabledTools,
      customTools,
    });
    this.cancelledSessions.delete(sessionId);
    this.activeSessions.set(sessionId, session);
    const thinking = new Map<number, string>();
    const unsubscribe = session.subscribe((event) => {
      consumeSessionEvent(event, textDeltas, thinking, onEvent);
    });

    try {
      const latest = messages.at(-1)?.content ?? "";
      await session.prompt(hasHistory ? latest : [
        "You are Pi Work, a concise assistant discussing work in the current local workspace.",
        "Use read/search tools directly. Editing, writing, and shell commands follow the selected permission mode.",
        "Conversation:",
        ...messages.map((message) => `${message.role}: ${message.content}`),
        "assistant:",
      ].join("\n\n"));
    } catch (error) {
      if (!this.cancelledSessions.has(sessionId)) throw error;
    } finally {
      this.activeSessions.delete(sessionId);
      unsubscribe();
      session.dispose();
    }

    const content = textDeltas.join("").trim();
    const cancelled = this.cancelledSessions.delete(sessionId);
    if (content.length === 0 && !cancelled) {
      throw new Error("Pi returned an empty chat response.");
    }
    return { content, cancelled };
  }

  async cancel(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) return false;
    this.cancelledSessions.add(sessionId);
    await session.abort();
    return true;
  }

  listExtensions(runtime: AgentRuntime): ExtensionPackage[] {
    return this.packageManager(runtime).manager.listConfiguredPackages()
      .filter((item) => item.scope === "user")
      .map((item) => ({
        source: !isRemoteExtensionSource(item.source) && item.installedPath !== undefined
          ? item.installedPath
          : item.source,
        installedPath: item.installedPath ?? null,
      }));
  }

  async installExtension(runtime: AgentRuntime, source: string): Promise<ExtensionPackage[]> {
    const value = source.trim();
    assertExtensionSource(value);
    const { manager, settings } = this.packageManager(runtime);
    await manager.installAndPersist(value);
    await settings.flush();
    return this.listExtensions(runtime);
  }

  async removeExtension(runtime: AgentRuntime, source: string): Promise<ExtensionPackage[]> {
    const value = source.trim();
    assertExtensionSource(value);
    const { manager, settings } = this.packageManager(runtime);
    const removed = await manager.removeAndPersist(value);
    await settings.flush();
    if (!removed) {
      throw new Error(`Pi extension is not installed: ${value}`);
    }
    return this.listExtensions(runtime);
  }

  async listModels(runtime: AgentRuntime): Promise<{
    models: ModelOption[];
    diagnostics: string[];
  }> {
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
    });
    const services = await createAgentSessionServices({
      cwd: runtime.cwd,
      agentDir: runtime.agentDir,
      modelRuntime,
      settingsManager: this.settingsManager(runtime),
    });
    const providerNames = new Map(
      services.modelRuntime.getProviders().map((provider) => [provider.id, provider.name]),
    );
    return {
      models: services.modelRuntime.getModels()
        .filter((model) => model.provider !== "vercel-ai-gateway")
        .map((model) => ({
          providerId: model.provider,
          providerName: providerNames.get(model.provider) ?? model.provider,
          modelId: model.id,
          modelName: model.name,
          thinkingLevels: getSupportedThinkingLevels(model),
        })),
      diagnostics: services.diagnostics.map((diagnostic) => diagnostic.message),
    };
  }

  createPlanningFallback(task: Pick<Task, "id" | "title" | "goal">): Plan {
    return {
      taskId: task.id,
      summary: `Prepare approved research deliverables for ${task.title}.`,
      steps: [
        {
          id: randomUUID(),
          title: "Review authorized sources",
          detail: "Read only files inside the selected workspace and record cited source paths.",
        },
        {
          id: randomUUID(),
          title: "Draft the decision brief",
          detail: `Create a staged Markdown brief addressing: ${task.goal}`,
        },
        {
          id: randomUUID(),
          title: "Review before publication",
          detail: "Present staged artifacts for user review before publishing to the workspace output folder.",
        },
      ],
      sources: [],
    };
  }

  private packageManager(runtime: AgentRuntime): {
    manager: DefaultPackageManager;
    settings: SettingsManager;
  } {
    const settings = this.settingsManager(runtime);
    return {
      manager: new DefaultPackageManager({
        cwd: runtime.cwd,
        agentDir: runtime.agentDir,
        settingsManager: settings,
      }),
      settings,
    };
  }

  private settingsManager(runtime: AgentRuntime): SettingsManager {
    return SettingsManager.create(runtime.cwd, runtime.agentDir, {
      projectTrusted: false,
    });
  }
}

function approvalTool(
  tool: ToolDefinition<any, any, any>,
  cwd: string,
  requestApproval: ToolApprovalRequester,
  onEvent?: AgentStreamListener,
): ToolDefinition<any, any, any> {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      const values = params as unknown as Record<string, unknown>;
      const name = tool.name as "edit" | "write" | "bash";
      if (name !== "bash") {
        await assertAuthorizedFilePath(cwd, String(values.path ?? ""));
      }
      if (!await requestApproval(name, values, cwd)) {
        throw new Error(`User denied ${name} tool execution.`);
      }
      const result = await execute(toolCallId, params, signal, onUpdate, context);
      if (name === "edit" || name === "write") {
        onEvent?.("file_change", { toolCallId, toolName: name, arguments: values });
      }
      return result;
    },
  };
}

export function consumeSessionEvent(
  event: any,
  textDeltas: string[],
  thinking: Map<number, string>,
  onEvent?: AgentStreamListener,
): void {
  switch (event.type) {
    case "message_start":
      onEvent?.("runtime", { state: "message_start" });
      return;
    case "message_end":
      onEvent?.("runtime", { state: "message_end" });
      return;
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        textDeltas.push(update.delta);
        onEvent?.("text_delta", { delta: update.delta, contentIndex: update.contentIndex });
        return;
      }
      if (update.type === "thinking_start") {
        const contentIndex = Number(update.contentIndex ?? 0);
        thinking.set(contentIndex, "");
        onEvent?.("thinking", { phase: "start", contentIndex });
        return;
      }
      if (update.type === "thinking_delta") {
        const contentIndex = Number(update.contentIndex ?? 0);
        const content = `${thinking.get(contentIndex) ?? ""}${update.delta ?? ""}`;
        thinking.set(contentIndex, content);
        onEvent?.("thinking", { phase: "delta", contentIndex, delta: update.delta ?? "" });
        return;
      }
      if (update.type === "thinking_end") {
        const contentIndex = Number(update.contentIndex ?? 0);
        const content = thinking.get(contentIndex) ?? "";
        thinking.delete(contentIndex);
        onEvent?.("thinking", { phase: "end", contentIndex, content });
      }
      return;
    }
    case "tool_execution_start":
      onEvent?.("tool_call", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        arguments: asRecord(event.args),
      });
      return;
    case "tool_execution_update":
      onEvent?.("tool_update", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        arguments: asRecord(event.args),
        output: event.partialResult,
      });
      return;
    case "tool_execution_end":
      onEvent?.("tool_result", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      });
      return;
    case "queue_update":
      onEvent?.("runtime", {
        state: event.steering.length + event.followUp.length > 0 ? "queued" : "queue_clear",
        steering: event.steering.length,
        followUp: event.followUp.length,
      });
      return;
    case "compaction_start":
      onEvent?.("runtime", { state: "compacting", reason: event.reason });
      return;
    case "compaction_end":
      onEvent?.("runtime", {
        state: "compacted",
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
      });
      return;
    case "auto_retry_start":
      onEvent?.("runtime", { state: "retrying", attempt: event.attempt, maxAttempts: event.maxAttempts, errorMessage: event.errorMessage });
      return;
    case "auto_retry_end":
      onEvent?.("runtime", { state: "retry_complete", success: event.success, attempt: event.attempt, errorMessage: event.finalError });
      return;
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
      onEvent?.("runtime", { state: "summarization_retry", phase: event.type, attempt: event.attempt });
      return;
    default:
      return;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundaryTool(
  tool: ToolDefinition<any, any, any>,
  cwd: string,
): ToolDefinition<any, any, any> {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      const values = params as unknown as Record<string, unknown>;
      await assertAuthorizedFilePath(cwd, String(values.path ?? "."));
      return execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}

export async function assertAuthorizedFilePath(rootPath: string, requestedPath: string): Promise<void> {
  const root = await realpath(rootPath);
  const candidate = resolve(root, requestedPath);
  if (!isWithin(root, candidate)) {
    throw new Error(`Path is outside the authorized workspace: ${requestedPath}`);
  }
  let existing = candidate;
  while (true) {
    try {
      existing = await realpath(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  if (!isWithin(root, existing)) {
    throw new Error(`Path is outside the authorized workspace: ${requestedPath}`);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === ""
    || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

function assertExtensionSource(source: string): void {
  const value = source.trim();
  if (!isRemoteExtensionSource(value) && !isAbsolute(value)) {
    throw new Error("Local Pi extension sources must use an absolute path.");
  }
}

function isRemoteExtensionSource(source: string): boolean {
  return source.startsWith("npm:")
    || source.startsWith("git:")
    || source.startsWith("https://")
    || source.startsWith("http://")
    || source.startsWith("ssh://")
    || source.startsWith("git@");
}

function extractJson(response: string): string {
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Pi did not return a JSON plan.");
  }
  return response.slice(start, end + 1);
}
