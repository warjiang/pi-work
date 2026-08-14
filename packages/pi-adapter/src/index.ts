import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AgentRuntime,
  AgentImageAttachment,
  ChatMessage,
  ExtensionPackage,
  ModelOption,
  Plan,
  PermissionMode,
  McpCallToolResult,
  McpInspectResult,
  McpRuntimeServer,
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
  kind: "text_delta" | "thinking" | "tool_call" | "tool_update" | "tool_result" | "file_change" | "runtime" | "usage",
  payload: Record<string, unknown>,
) => void;

type ConnectedMcpServer = {
  client: Client;
  transport: { close(): Promise<void> };
  transportName: McpInspectResult["transport"];
  logs: string[];
  close(): Promise<void>;
};

const generatedPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().min(1),
  })).min(1).max(20),
  sources: z.array(z.string().min(1)).max(100),
});

class PrivateAuthCredentialStore implements CredentialStore {
  private chain = Promise.resolve();

  constructor(private readonly authPath: string) {}

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return (await this.readAll())[providerId];
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(await this.readAll()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const task = this.chain.then(async () => {
      options?.signal?.throwIfAborted();
      const records = await this.readAll();
      const next = await fn(records[providerId]);
      options?.signal?.throwIfAborted();
      if (next !== undefined) {
        records[providerId] = next;
        await this.writeAll(records);
      }
      return next ?? records[providerId];
    });
    this.chain = task.then(() => undefined, () => undefined);
    return task;
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    const task = this.chain.then(async () => {
      options?.signal?.throwIfAborted();
      const records = await this.readAll();
      delete records[providerId];
      await this.writeAll(records);
    });
    this.chain = task.then(() => undefined, () => undefined);
    return task;
  }

  private async readAll(): Promise<Record<string, Credential>> {
    try {
      const parsed = JSON.parse(await readFile(this.authPath, "utf8")) as Record<string, Credential>;
      return parsed ?? {};
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  private async writeAll(records: Record<string, Credential>): Promise<void> {
    await mkdir(dirname(this.authPath), { recursive: true });
    await writeFile(this.authPath, `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

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

    const credentials = this.credentials(runtime);
    const modelRuntime = await this.modelRuntime(runtime, credentials);
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

  async createConversationTitle(
    prompt: string,
    response: string,
    provider: PiProviderCredential | null,
    modelId: string,
    thinkingLevel: ThinkingLevel,
    runtime: AgentRuntime,
  ): Promise<string> {
    if (provider === null) throw new Error("No provider is configured.");

    const credentials = this.credentials(runtime);
    const modelRuntime = await this.modelRuntime(runtime, credentials);
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
    if (modelResolution.error !== undefined) throw new Error(modelResolution.error);
    if (modelResolution.model === undefined) throw new Error(`Pi could not resolve ${provider.providerId}/${modelId}.`);

    const chunks: string[] = [];
    const { session } = await createAgentSessionFromServices({
      services,
      model: modelResolution.model,
      thinkingLevel,
      sessionManager: SessionManager.inMemory(),
      tools: [],
    });
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        chunks.push(event.assistantMessageEvent.delta);
      }
    });
    try {
      await session.prompt([
        "Write a concise title for this conversation.",
        "Use the user's language. Return only the title, with no quotes, markdown, or punctuation decoration.",
        "Keep it under 36 characters and describe the task rather than copying a URL.",
        `User: ${prompt}`,
        `Assistant: ${response}`,
      ].join("\n\n"));
    } finally {
      unsubscribe();
      session.dispose();
    }
    const title = chunks.join("").replace(/\s+/g, " ").replace(/^["'`#\-\s]+|["'`#\-\s]+$/g, "").trim();
    if (title.length === 0) throw new Error("Pi returned an empty conversation title.");
    return title.slice(0, 160);
  }

  async testModel(
    provider: PiProviderCredential,
    modelId: string,
    runtime: AgentRuntime,
  ): Promise<string> {
    const credentials = this.credentials(runtime);
    const modelRuntime = await this.modelRuntime(runtime, credentials);
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
    if (modelResolution.error !== undefined) throw new Error(modelResolution.error);
    if (modelResolution.model === undefined) throw new Error(`Pi could not resolve ${provider.providerId}/${modelId}.`);

    const { session } = await createAgentSessionFromServices({
      services,
      model: modelResolution.model,
      thinkingLevel: "off",
      sessionManager: SessionManager.inMemory(),
      tools: [],
    });
    try {
      await session.prompt("Reply with exactly: OK");
    } finally {
      session.dispose();
    }
    return "Responded successfully.";
  }

  async chat(
    sessionId: string,
    messages: Pick<ChatMessage, "role" | "content">[],
    imageAttachments: AgentImageAttachment[],
    provider: PiProviderCredential | null,
    modelId: string,
    thinkingLevel: ThinkingLevel,
    runtime: AgentRuntime,
    requestApproval: ToolApprovalRequester,
    permissionMode: PermissionMode = "ask",
    onEvent?: AgentStreamListener,
    mcpServers: McpRuntimeServer[] = [],
  ): Promise<{ content: string; cancelled: boolean }> {
    if (provider === null) {
      return {
        content: "No provider is configured. Add one in settings, or use /goal and /plan with local fallback.",
        cancelled: false,
      };
    }

    const credentials = this.credentials(runtime);
    const modelRuntime = await this.modelRuntime(runtime, credentials);
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
        createBashToolDefinition(runtime.cwd, {
          spawnHook: (context) => ({
            ...context,
            env: mergeAgentBashEnvironment(context.env, runtime.environment),
          }),
        }),
        runtime.cwd,
        permissionMode === "auto" ? async () => true : requestApproval,
        onEvent,
      ),
    ];
    const mcp = await connectMcpTools(mcpServers, runtime);
    let session: AgentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      const customTools: ToolDefinition<any, any, any>[] = [...readTools, ...writeTools, ...mcp.tools];
      const enabledTools = [
        ...(permissionMode === "explore"
        ? ["read", "grep", "find", "ls"]
        : ["read", "grep", "find", "ls", "edit", "write", "bash"]),
        ...extensionToolNames(services.resourceLoader.getExtensions().extensions),
        ...mcp.tools.map(({ name }) => name),
      ];
      const sessionDirectory = join(runtime.agentDir, "sessions");
      const existing = (await SessionManager.list(runtime.cwd, sessionDirectory))
        .find(({ id }) => id === sessionId);
      const sessionManager = existing === undefined
        ? SessionManager.create(runtime.cwd, sessionDirectory, { id: sessionId })
        : SessionManager.open(existing.path, sessionDirectory, runtime.cwd);
      const hasHistory = sessionManager.getEntries().length > 0;
      ({ session } = await createAgentSessionFromServices({
        services,
        model: modelResolution.model,
        thinkingLevel,
        sessionManager,
        tools: enabledTools,
        customTools,
      }));
      this.cancelledSessions.delete(sessionId);
      this.activeSessions.set(sessionId, session);
      const thinking = new Map<number, string>();
      unsubscribe = session.subscribe((event) => {
        consumeSessionEvent(event, textDeltas, thinking, onEvent);
      });

      try {
        const latest = messages.at(-1)?.content ?? "";
        const images: ImageContent[] = imageAttachments.map((attachment) => ({
          type: "image",
          data: attachment.data,
          mimeType: attachment.mimeType,
        }));
        await session.prompt(hasHistory ? latest : [
          "You are Pi Work, a concise assistant discussing work in the current local workspace.",
          "Use read/search tools directly. Editing, writing, and shell commands follow the selected permission mode.",
          "Conversation:",
          ...messages.map((message) => `${message.role}: ${message.content}`),
          "assistant:",
        ].join("\n\n"), images.length > 0 ? { images } : undefined);
      } catch (error) {
        if (!this.cancelledSessions.has(sessionId)) throw error;
      }
    } finally {
      this.activeSessions.delete(sessionId);
      unsubscribe?.();
      session?.dispose();
      await mcp.close();
    }

    const content = textDeltas.join("").trim();
    const cancelled = this.cancelledSessions.delete(sessionId);
    if (content.length === 0 && !cancelled) {
      throw new Error("Pi returned an empty chat response.");
    }
    return { content, cancelled };
  }

  async inspectMcp(server: McpRuntimeServer, runtime: AgentRuntime): Promise<McpInspectResult> {
    const connection = await connectMcpServer(server, runtime);
    try {
      const [tools, resources, prompts] = await Promise.all([
        connection.client.listTools(),
        optionalMcpList(() => connection.client.listResources(), "resources"),
        optionalMcpList(() => connection.client.listPrompts(), "prompts"),
      ]);
      const version = connection.client.getServerVersion();
      return {
        connected: true,
        transport: connection.transportName,
        serverName: version?.name,
        serverVersion: version?.version,
        instructions: connection.client.getInstructions(),
        tools: tools.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        })),
        resourceCount: resources.length,
        promptCount: prompts.length,
        logs: connection.logs,
      };
    } finally {
      await connection.close();
    }
  }

  async callMcpTool(
    server: McpRuntimeServer,
    runtime: AgentRuntime,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    const connection = await connectMcpServer(server, runtime);
    try {
      const result = await connection.client.callTool({ name: toolName, arguments: args });
      return {
        content: result.content as Array<Record<string, unknown>>,
        isError: result.isError === true,
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent as Record<string, unknown> }),
      };
    } finally {
      await connection.close();
    }
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
    await this.withElectronNodeEnvironment(() => manager.installAndPersist(value));
    await settings.flush();
    return this.listExtensions(runtime);
  }

  async removeExtension(runtime: AgentRuntime, source: string): Promise<ExtensionPackage[]> {
    const value = source.trim();
    assertExtensionSource(value);
    const { manager, settings } = this.packageManager(runtime);
    const removed = await this.withElectronNodeEnvironment(() => manager.removeAndPersist(value));
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
    const modelRuntime = await this.modelRuntime(runtime);
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
    const settings = SettingsManager.create(runtime.cwd, runtime.agentDir, {
      projectTrusted: false,
    });
    const nodeExecutable = process.env.PI_WORK_NODE_EXECUTABLE;
    const npmCli = process.env.PI_WORK_NPM_CLI;
    if (nodeExecutable !== undefined && npmCli !== undefined) {
      settings.applyOverrides({
        npmCommand: [nodeExecutable, npmCli],
      });
    }
    return settings;
  }

  private async withElectronNodeEnvironment<T>(operation: () => Promise<T>): Promise<T> {
    if (process.env.PI_WORK_NODE_EXECUTABLE === undefined) {
      return operation();
    }
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      return await operation();
    } finally {
      if (previous === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE;
      } else {
        process.env.ELECTRON_RUN_AS_NODE = previous;
      }
    }
  }

  private credentials(runtime: AgentRuntime): PrivateAuthCredentialStore {
    return new PrivateAuthCredentialStore(join(runtime.agentDir, "auth.json"));
  }

  private modelRuntime(
    runtime: AgentRuntime,
    credentials = this.credentials(runtime),
  ): Promise<ModelRuntime> {
    return ModelRuntime.create({
      credentials,
      modelsPath: join(runtime.agentDir, "models.json"),
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
    case "message_end": {
      emitAssistantUsage(event.message, onEvent);
      onEvent?.("runtime", { state: "message_end" });
      return;
    }
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

export function mergeAgentBashEnvironment(
  contextEnvironment: NodeJS.ProcessEnv,
  runtimeEnvironment: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...contextEnvironment,
    ...runtimeEnvironment,
  };
}

export function extensionToolNames(
  extensions: Iterable<{ tools: ReadonlyMap<string, unknown> }>,
): string[] {
  return [...new Set(Array.from(extensions, ({ tools }) => [...tools.keys()]).flat())];
}

async function connectMcpTools(
  servers: McpRuntimeServer[],
  runtime: AgentRuntime,
): Promise<{ tools: ToolDefinition<any, any, any>[]; close(): Promise<void> }> {
  const connections: ConnectedMcpServer[] = [];
  const tools: ToolDefinition<any, any, any>[] = [];
  try {
    for (const server of servers) {
      const connection = await connectMcpServer(server, runtime);
      connections.push(connection);
      const listed = await connection.client.listTools();
      for (const remoteTool of listed.tools) {
        const name = mcpToolName(server, remoteTool.name);
        tools.push({
          name,
          label: `${server.name} · ${remoteTool.title ?? remoteTool.name}`,
          description: remoteTool.description ?? `Run ${remoteTool.name} on the ${server.name} MCP server.`,
          promptSnippet: `${name}: ${remoteTool.description ?? remoteTool.name}`,
          parameters: remoteTool.inputSchema as any,
          execute: async (_toolCallId, params, signal) => {
            const result = await connection.client.callTool(
              { name: remoteTool.name, arguments: params as Record<string, unknown> },
              undefined,
              signal === undefined ? undefined : { signal },
            );
            if (result.isError === true) {
              throw new Error(mcpResultText(result.content) || `${server.name}/${remoteTool.name} failed.`);
            }
            return {
              content: mcpAgentContent(result.content),
              details: {
                serverId: server.id,
                serverName: server.name,
                remoteToolName: remoteTool.name,
                structuredContent: result.structuredContent,
              },
            };
          },
        });
      }
    }
  } catch (error) {
    await Promise.allSettled(connections.map(({ close }) => close()));
    throw error;
  }
  return {
    tools,
    close: async () => {
      await Promise.allSettled(connections.map(({ close }) => close()));
    },
  };
}

async function connectMcpServer(
  server: McpRuntimeServer,
  runtime: AgentRuntime,
): Promise<ConnectedMcpServer> {
  if (server.type === "mcp_stdio") {
    const command = stringConfig(server.config, "command");
    const logs: string[] = [];
    const transport = new StdioClientTransport({
      command,
      args: stringArrayConfig(server.config, "args"),
      cwd: optionalStringConfig(server.config, "cwd") ?? runtime.cwd,
      env: {
        ...stringEnvironment(process.env),
        ...recordStringConfig(server.config, "env"),
        ...(runtime.environment ?? {}),
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) logs.push(text);
    });
    return connectTransport(server, transport, "stdio", logs);
  }

  const url = new URL(stringConfig(server.config, "url"));
  const configuredTransport = optionalStringConfig(server.config, "transport") ?? "auto";
  const headers = new Headers(recordStringConfig(server.config, "headers"));
  const bearerToken = optionalStringConfig(server.config, "bearerToken");
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  const requestInit = { headers };
  if (configuredTransport === "sse") {
    return connectTransport(server, new SSEClientTransport(url, { requestInit }), "sse", []);
  }
  if (configuredTransport === "streamable_http") {
    return connectTransport(
      server,
      new StreamableHTTPClientTransport(url, { requestInit }),
      "streamable_http",
      [],
    );
  }
  try {
    return await connectTransport(
      server,
      new StreamableHTTPClientTransport(url, { requestInit }),
      "streamable_http",
      [],
    );
  } catch (streamableError) {
    try {
      return await connectTransport(server, new SSEClientTransport(url, { requestInit }), "sse", [
        `Streamable HTTP unavailable: ${errorMessage(streamableError)}`,
      ]);
    } catch (sseError) {
      throw new Error(
        `Could not connect to MCP source "${server.name}". Streamable HTTP: ${errorMessage(streamableError)}; SSE: ${errorMessage(sseError)}`,
      );
    }
  }
}

async function connectTransport(
  server: McpRuntimeServer,
  transport: any,
  transportName: McpInspectResult["transport"],
  logs: string[],
): Promise<ConnectedMcpServer> {
  const client = new Client({ name: "pi-work", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport, { timeout: 20_000 });
  } catch (error) {
    await transport.close().catch(() => undefined);
    const hint = server.type === "mcp_http" && /401|unauthor|authorization/i.test(errorMessage(error))
      ? " Authorize the remote source or configure a bearer token."
      : "";
    throw new Error(`${errorMessage(error)}${hint}`);
  }
  return {
    client,
    transport,
    transportName,
    logs,
    close: async () => {
      await client.close();
    },
  };
}

async function optionalMcpList(
  list: () => Promise<unknown>,
  key: "resources" | "prompts",
): Promise<unknown[]> {
  try {
    const result = await list() as Record<string, unknown>;
    return Array.isArray(result[key]) ? result[key] : [];
  } catch {
    return [];
  }
}

function mcpToolName(server: McpRuntimeServer, toolName: string): string {
  const prefix = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "server";
  const tool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48) || "tool";
  return `mcp_${prefix}_${server.id.slice(0, 6)}_${tool}`;
}

function mcpAgentContent(content: unknown): Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  if (!Array.isArray(content)) return [{ type: "text", text: JSON.stringify(content) }];
  const converted: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) {
      converted.push({ type: "text", text: String(item) });
      continue;
    }
    const value = item as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") {
      converted.push({ type: "text", text: value.text });
      continue;
    }
    if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
      converted.push({ type: "image", data: value.data, mimeType: value.mimeType });
      continue;
    }
    converted.push({ type: "text", text: JSON.stringify(value) });
  }
  return converted;
}

function mcpResultText(content: unknown): string {
  return mcpAgentContent(content).map((item) => item.type === "text" ? item.text : `[image ${item.mimeType}]`).join("\n");
}

function stringConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`MCP configuration requires "${key}".`);
  return value;
}

function optionalStringConfig(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function stringArrayConfig(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function recordStringConfig(config: Record<string, unknown>, key: string): Record<string, string> {
  const value = config[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, String(item)]));
}

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Forwards token/cost accounting from a completed assistant message. Pi Work's
 * observability layer relies on this because `CreateAgentSessionOptions` does not
 * expose a telemetry context, so the subscription stream is the only usage source.
 */
function emitAssistantUsage(message: unknown, onEvent?: AgentStreamListener): void {
  if (onEvent === undefined) return;
  const record = asRecord(message);
  if (record.role !== "assistant") return;
  const usage = asRecord(record.usage);
  const cost = asRecord(usage.cost);
  const outputText = Array.isArray(record.content)
    ? record.content
        .filter((part): part is { type: string; text: string } =>
          asRecord(part).type === "text" && typeof asRecord(part).text === "string")
        .map((part) => part.text)
        .join("")
    : "";
  onEvent("usage", {
    provider: typeof record.provider === "string" ? record.provider : "",
    model: typeof record.model === "string" ? record.model : "",
    responseModel: typeof record.responseModel === "string" ? record.responseModel : null,
    api: typeof record.api === "string" ? record.api : null,
    stopReason: typeof record.stopReason === "string" ? record.stopReason : null,
    output: outputText,
    usage: {
      input: numeric(usage.input),
      output: numeric(usage.output),
      cacheRead: numeric(usage.cacheRead),
      cacheWrite: numeric(usage.cacheWrite),
      reasoning: numeric(usage.reasoning),
      totalTokens: numeric(usage.totalTokens),
      cost: {
        input: numeric(cost.input),
        output: numeric(cost.output),
        cacheRead: numeric(cost.cacheRead),
        cacheWrite: numeric(cost.cacheWrite),
        total: numeric(cost.total),
      },
    },
  });
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
