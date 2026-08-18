import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  PermissionMode,
  McpCallToolResult,
  McpInspectResult,
  McpRuntimeServer,
  PlanExecutionContext,
  PlanProposal,
  PlanRevision,
  PlanStepUpdateInput,
  PlanningResult,
  Task,
  ThinkingLevel,
  WorkflowContext,
  WorkflowDraft,
  WorkflowSubmissionResult,
} from "@pi-work/protocol";
import {
  planProposalSchema,
  planStepUpdateInputSchema,
  planningResultSchema,
  workflowDraftSchema,
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

export type WorkflowSubmitter = (
  draft: WorkflowDraft,
  context: WorkflowContext,
) => Promise<WorkflowSubmissionResult>;

export type PlanStepUpdater = (input: PlanStepUpdateInput) => Promise<void> | void;

export function buildChatPrompt(
  messages: Pick<ChatMessage, "role" | "content">[],
  hasHistory: boolean,
  workflowContext: WorkflowContext | null,
): string {
  const latest = messages.at(-1)?.content ?? "";
  const requiredWorkflowInstructions = workflowContext?.required === true
    ? [
      "This task is in Orchestration mode. You MUST call the workflow tool before replying, even if the task could be completed by one agent.",
      "Create the smallest useful DAG with at least two focused nodes plus the automatic synthesis node.",
      "After workflow returns a run ID, reply only with a brief confirmation that orchestration has started; the durable workflow will publish the final result separately.",
    ]
    : [];
  if (hasHistory) {
    return [...requiredWorkflowInstructions, latest].join("\n\n");
  }
  return [
    "You are Pi Work, a concise assistant discussing work in the current local workspace.",
    "Use read/search tools directly. Editing, writing, and shell commands follow the selected permission mode.",
    ...(workflowContext === null ? [] : [
      workflowContext.required
        ? requiredWorkflowInstructions[0]!
        : "Use the workflow tool when the task has multiple modules or perspectives, benefits from parallel investigation, or explicitly asks for orchestration, parallel agents, or a workflow.",
      workflowContext.required
        ? requiredWorkflowInstructions[1]!
        : "Do not use workflow for a single-file or single-step task.",
      requiredWorkflowInstructions[2]
        ?? "After workflow returns a run ID, reply only with a brief confirmation that orchestration has started; the durable workflow will publish the final result separately.",
    ]),
    "Conversation:",
    ...messages.map((message) => `${message.role}: ${message.content}`),
    "assistant:",
  ].join("\n\n");
}

type ConnectedMcpServer = {
  client: Client;
  transport: { close(): Promise<void> };
  transportName: McpInspectResult["transport"];
  logs: string[];
  close(): Promise<void>;
};

export type PlanningTerminalResult =
  | Extract<PlanningResult, { kind: "clarification" }>
  | { kind: "proposal"; proposal: Omit<PlanProposal, "sources"> };

const planningValidationConfigSchema = z.object({
  version: z.literal(1),
  validations: z.array(z.object({
    id: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    label: z.string().trim().min(1).max(160),
    argv: z.array(z.string().min(1).max(8_192)).min(1).max(100),
    timeoutMs: z.number().int().min(1).max(600_000),
  }).strict()).max(100),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  for (const [index, validation] of config.validations.entries()) {
    if (ids.has(validation.id)) {
      context.addIssue({
        code: "custom",
        path: ["validations", index, "id"],
        message: `Duplicate validation ID: ${validation.id}`,
      });
    }
    ids.add(validation.id);
  }
});

export type PlanningInspectionToolOptions = {
  sandboxExecutable?: string;
  gitExecutable?: string;
};

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
    conversation: Array<Pick<ChatMessage, "id" | "role" | "content" | "createdAt">>,
    previousPlan: PlanRevision | null,
    feedbackMessageId: string | null,
    provider: PiProviderCredential | null,
    modelId: string,
    thinkingLevel: ThinkingLevel,
    runtime: AgentRuntime,
    onEvent?: AgentStreamListener,
  ): Promise<PlanningResult> {
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
    const sources = new Map<string, { path: string; operation: "read" | "grep" | "find" | "ls" }>();
    const terminal = { result: null as PlanningTerminalResult | null };
    const readTools: ToolDefinition<any, any, any>[] = [
      planningReadTool(createReadToolDefinition(runtime.cwd), runtime.cwd, sources),
      planningReadTool(createGrepToolDefinition(runtime.cwd), runtime.cwd, sources),
      planningReadTool(createFindToolDefinition(runtime.cwd), runtime.cwd, sources),
      planningReadTool(createLsToolDefinition(runtime.cwd), runtime.cwd, sources),
    ];
    const inspectionTools = planningInspectionTools(runtime.cwd, runtime.environment);
    const terminalTools = planningTerminalTools((result) => {
      if (terminal.result === null) terminal.result = result;
    });
    const { session } = await createAgentSessionFromServices({
      services,
      model: modelResolution.model,
      thinkingLevel,
      sessionManager: SessionManager.inMemory(),
      tools: ["read", "grep", "find", "ls"],
      customTools: [...readTools, ...inspectionTools, ...terminalTools],
    });
    const thinking = new Map<number, string>();
    const unsubscribe = session.subscribe((event) => {
      consumeSessionEvent(event, textDeltas, thinking, onEvent);
    });

    this.cancelledSessions.delete(task.id);
    this.activeSessions.set(task.id, session);
    try {
      try {
        await session.prompt([
          "You are Pi Work's read-only planning engine.",
          "Inspect the local workspace with read, grep, find, ls, and the controlled Git tools before proposing implementation work.",
          "Use run_validation only for repository-declared read-only checks when it materially improves plan confidence.",
          "Never claim you read a path you did not access. Sources are recorded by the runtime and must not be supplied to plan_complete.",
          "Ask one concise clarification only when a missing decision would materially change the implementation direction.",
          "Put minor uncertainty in proposal.assumptions instead of asking.",
          "You MUST end the planning run by calling exactly one terminal tool:",
          "- plan_question when a material product decision is missing.",
          "- plan_complete when the implementation plan is ready.",
          "Ordinary assistant text is activity narration only and is never treated as the planning result.",
          "",
          "Task:",
          JSON.stringify(task, null, 2),
          "",
          "Relevant conversation:",
          JSON.stringify(conversation, null, 2),
          "",
          "Previous plan revision:",
          JSON.stringify(previousPlan, null, 2),
          "",
          "Latest feedback message ID:",
          feedbackMessageId ?? "none",
        ].join("\n"));
        if (terminal.result === null) {
          await session.prompt([
            "The previous turn did not call a terminal planning tool.",
            "Repair this now: call exactly one of plan_question or plan_complete.",
            "Do not return the result as assistant text.",
          ].join("\n"));
        }
      } catch (error) {
        if (!this.cancelledSessions.has(task.id)) throw error;
        throw new Error("Planning was cancelled.");
      }
    } finally {
      this.activeSessions.delete(task.id);
      this.cancelledSessions.delete(task.id);
      unsubscribe();
      session.dispose();
    }

    const terminalResult = terminal.result;
    if (terminalResult === null) {
      return this.createPlanningFallback(task, {
        sources: [...sources.values()],
        assumption: "The planning model did not return structured tool output, so Pi Work generated a safe fallback plan after workspace inspection.",
      });
    }
    if (terminalResult.kind === "clarification") {
      return planningResultSchema.parse(terminalResult);
    }
    return planningResultSchema.parse({
      kind: "proposal",
      proposal: {
        ...terminalResult.proposal,
        sources: [...sources.values()],
      },
    });
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
    workflowContext: WorkflowContext | null = null,
    submitWorkflow?: WorkflowSubmitter,
    planExecution: PlanExecutionContext | null = null,
    updatePlanStep?: PlanStepUpdater,
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
      const workflowTools = workflowContext === null || submitWorkflow === undefined
        ? []
        : [workflowTool(workflowContext, submitWorkflow)];
      const progressTools = planExecution === null || updatePlanStep === undefined
        ? []
        : [planStepUpdateTool(planExecution, updatePlanStep)];
      const customTools: ToolDefinition<any, any, any>[] = [
        ...readTools,
        ...writeTools,
        ...workflowTools,
        ...progressTools,
        ...mcp.tools,
      ];
      const enabledTools = [
        ...(permissionMode === "explore"
        ? ["read", "grep", "find", "ls"]
        : ["read", "grep", "find", "ls", "edit", "write", "bash"]),
        ...extensionToolNames(services.resourceLoader.getExtensions().extensions),
        ...workflowTools.map(({ name }) => name),
        ...progressTools.map(({ name }) => name),
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
        const images: ImageContent[] = imageAttachments.map((attachment) => ({
          type: "image",
          data: attachment.data,
          mimeType: attachment.mimeType,
        }));
        await session.prompt(
          buildChatPrompt(messages, hasHistory, workflowContext),
          images.length > 0 ? { images } : undefined,
        );
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

  createPlanningFallback(
    task: Pick<Task, "id" | "title" | "goal">,
    options: {
      assumption?: string;
      sources?: PlanProposal["sources"];
    } = {},
  ): PlanningResult {
    return {
      kind: "proposal",
      proposal: {
        title: task.title,
        summary: `Prepare an implementation that satisfies: ${task.goal}`,
        steps: [
          {
            title: "Review authorized sources",
            detail: "Read only files inside the selected workspace and identify the existing implementation boundaries.",
            targets: [],
            verification: ["Confirm all referenced paths are inside the selected workspace."],
          },
          {
            title: "Implement the requested change",
            detail: `Apply the smallest coherent set of changes needed for ${task.title}.`,
            targets: [],
            verification: ["Run the relevant focused tests and type checks."],
          },
          {
            title: "Review the result",
            detail: "Summarize changed behavior, verification results, and any remaining assumptions.",
            targets: [],
            verification: ["Review the final diff for unintended changes."],
          },
        ],
        assumptions: [options.assumption ?? "A provider is not configured, so this fallback plan was generated without workspace exploration."],
        sources: options.sources ?? [],
      },
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

function workflowTool(
  context: WorkflowContext,
  submit: WorkflowSubmitter,
): ToolDefinition<any, any, any> {
  return {
    name: "workflow",
    label: "Create workflow",
    description: "Create and asynchronously start a durable DAG of specialized agents for multi-part work.",
    promptSnippet: "workflow: create a durable parallel DAG for multi-module, multi-perspective, or explicitly orchestrated work",
    promptGuidelines: [
      "Use workflow only when decomposition materially improves the result.",
      "Use readable stable keys and explicit dependencies.",
      "Mark investigation-only nodes read and any node that may edit or run commands write.",
      "Do not add a synthesis node; Pi Work appends it automatically.",
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "maxParallel", "nodes"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160 },
        summary: { type: "string", minLength: 1, maxLength: 10_000 },
        maxParallel: { type: "integer", minimum: 1, maximum: 16 },
        nodes: {
          type: "array",
          minItems: 2,
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "title", "prompt", "dependsOn", "executionClass", "maxAttempts"],
            properties: {
              key: { type: "string", minLength: 1, maxLength: 80 },
              title: { type: "string", minLength: 1, maxLength: 160 },
              prompt: { type: "string", minLength: 1, maxLength: 100_000 },
              dependsOn: {
                type: "array",
                maxItems: 24,
                items: { type: "string", minLength: 1, maxLength: 80 },
              },
              executionClass: { type: "string", enum: ["read", "write"] },
              maxAttempts: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
        },
      },
    } as any,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const draft = workflowDraftSchema.parse(params);
      const result = await submit(draft, context);
      return {
        content: [{
          type: "text",
          text: `Workflow ${result.status === "existing" ? "already exists" : "started"}: ${result.runId}`,
        }],
        details: result,
      };
    },
  };
}

function planStepUpdateTool(
  context: PlanExecutionContext,
  update: PlanStepUpdater,
): ToolDefinition<any, any, any> {
  return {
    name: "plan_step_update",
    label: "Update plan step",
    description: "Report structured progress for a step in the immutable approved plan.",
    promptSnippet: "plan_step_update: mark each approved plan step running and then completed, failed, or skipped",
    promptGuidelines: [
      "Call with running before doing work for each step.",
      "Call completed, failed, or skipped exactly once when the step reaches a terminal state.",
      "Report verification results by the zero-based index from the approved step.",
      "Do not start a later step before the current step is terminal.",
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["stepId", "status"],
      properties: {
        stepId: { type: "string", format: "uuid" },
        status: { type: "string", enum: ["running", "completed", "failed", "skipped"] },
        verificationResults: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["verificationIndex", "status", "detail"],
            properties: {
              verificationIndex: { type: "integer", minimum: 0 },
              status: { type: "string", enum: ["passed", "failed", "not_run"] },
              detail: { type: "string", minLength: 1, maxLength: 10_000 },
            },
          },
        },
        note: { type: "string", minLength: 1, maxLength: 10_000 },
      },
    } as any,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const input = planStepUpdateInputSchema.parse(params);
      if (!context.steps.some(({ id }) => id === input.stepId)) {
        throw new Error("The step is not part of the approved plan execution.");
      }
      await update(input);
      return {
        content: [{ type: "text", text: `Plan step ${input.stepId} marked ${input.status}.` }],
        details: {
          executionId: context.executionId,
          planRevisionId: context.planRevisionId,
          ...input,
        },
      };
    },
  };
}

export function planningTerminalTools(
  accept: (result: PlanningTerminalResult) => void,
): ToolDefinition<any, any, any>[] {
  return [
    {
      name: "plan_question",
      label: "Ask planning question",
      description: "Finish planning with one material clarification question and optional quick-reply choices.",
      promptSnippet: "plan_question: finish planning by requesting one material clarification",
      promptGuidelines: [
        "Use only when the answer would materially change the implementation direction.",
        "Provide either no options or 2 to 4 mutually exclusive options.",
      ],
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string", minLength: 1, maxLength: 4_000 },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 160 },
                description: { type: "string", minLength: 1, maxLength: 1_000 },
              },
            },
          },
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const result = planningResultSchema.parse({
          kind: "clarification",
          ...(params as Record<string, unknown>),
        }) as Extract<PlanningResult, { kind: "clarification" }>;
        accept(result);
        return {
          content: [{ type: "text", text: "Planning clarification recorded." }],
          details: result,
          terminate: true,
        };
      },
    },
    {
      name: "plan_complete",
      label: "Complete plan",
      description: "Finish planning with a structured implementation proposal. Sources are injected by the runtime.",
      promptSnippet: "plan_complete: finish planning with the structured implementation proposal",
      promptGuidelines: [
        "Do not include sources; the runtime records actual workspace reads.",
        "Keep steps ordered, implementation-oriented, and independently verifiable.",
      ],
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "steps"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          summary: { type: "string", minLength: 1, maxLength: 10_000 },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "detail", "targets", "verification"],
              properties: {
                title: { type: "string", minLength: 1, maxLength: 160 },
                detail: { type: "string", minLength: 1, maxLength: 10_000 },
                targets: {
                  type: "array",
                  maxItems: 100,
                  items: { type: "string", minLength: 1, maxLength: 1_024 },
                },
                verification: {
                  type: "array",
                  maxItems: 100,
                  items: { type: "string", minLength: 1, maxLength: 2_000 },
                },
              },
            },
          },
          assumptions: {
            type: "array",
            maxItems: 100,
            items: { type: "string", minLength: 1, maxLength: 2_000 },
          },
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const proposal = planProposalSchema.omit({ sources: true }).parse(params);
        const result: PlanningTerminalResult = { kind: "proposal", proposal };
        accept(result);
        return {
          content: [{ type: "text", text: "Structured plan recorded." }],
          details: result,
          terminate: true,
        };
      },
    },
  ];
}

function planningReadTool(
  tool: ToolDefinition<any, any, any>,
  cwd: string,
  sources: Map<string, { path: string; operation: "read" | "grep" | "find" | "ls" }>,
): ToolDefinition<any, any, any> {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, context) => {
      const values = params as unknown as Record<string, unknown>;
      const requestedPath = String(values.path ?? ".");
      await assertAuthorizedFilePath(cwd, requestedPath);
      const result = await execute(toolCallId, params, signal, onUpdate, context);
      const root = await realpath(cwd);
      const resolved = await realpath(resolve(root, requestedPath));
      const sourcePath = relative(root, resolved) || ".";
      const operation = tool.name as "read" | "grep" | "find" | "ls";
      sources.set(`${operation}:${sourcePath}`, { path: sourcePath, operation });
      return result;
    },
  };
}

export function planningInspectionTools(
  cwd: string,
  runtimeEnvironment?: Record<string, string>,
  options: PlanningInspectionToolOptions = {},
): ToolDefinition<any, any, any>[] {
  const gitExecutable = options.gitExecutable ?? "/usr/bin/git";
  return [
    {
      name: "git_status",
      label: "Git status",
      description: "Inspect the repository status with a fixed read-only Git command.",
      promptSnippet: "git_status: inspect tracked and untracked workspace changes",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paths: planningGitPathsJsonSchema(),
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        const input = z.object({
          paths: z.array(z.string().min(1).max(4_096)).max(100).optional(),
        }).strict().parse(params);
        const paths = await normalizePlanningGitPaths(cwd, input.paths ?? []);
        const result = await runPlanningProcess({
          executable: gitExecutable,
          args: [
            "--no-pager",
            "--literal-pathspecs",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "status",
            "--short",
            "--branch",
            "--untracked-files=all",
            "--ignore-submodules=all",
            ...gitPathArguments(paths),
          ],
          cwd,
          environment: planningGitEnvironment(runtimeEnvironment),
          timeoutMs: 60_000,
          signal,
        });
        return planningGitResult("Git status", result);
      },
    },
    {
      name: "git_diff",
      label: "Git diff",
      description: "Inspect working, staged, or HEAD changes with external diff and text conversion disabled.",
      promptSnippet: "git_diff: inspect a controlled working, staged, or HEAD diff",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["scope"],
        properties: {
          scope: { type: "string", enum: ["working", "staged", "HEAD"] },
          paths: planningGitPathsJsonSchema(),
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        const input = z.object({
          scope: z.enum(["working", "staged", "HEAD"]),
          paths: z.array(z.string().min(1).max(4_096)).max(100).optional(),
        }).strict().parse(params);
        const paths = await normalizePlanningGitPaths(cwd, input.paths ?? []);
        const scopeArgs = input.scope === "staged"
          ? ["--cached"]
          : input.scope === "HEAD"
            ? ["HEAD"]
            : [];
        const result = await runPlanningProcess({
          executable: gitExecutable,
          args: [
            "--no-pager",
            "--literal-pathspecs",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--ignore-submodules=all",
            ...scopeArgs,
            ...gitPathArguments(paths),
          ],
          cwd,
          environment: planningGitEnvironment(runtimeEnvironment),
          timeoutMs: 60_000,
          signal,
        });
        return planningGitResult(`Git diff (${input.scope})`, result);
      },
    },
    {
      name: "git_log",
      label: "Git log",
      description: "Inspect up to 50 commits with a fixed non-interactive format.",
      promptSnippet: "git_log: inspect recent commit history",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          paths: planningGitPathsJsonSchema(),
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        const input = z.object({
          limit: z.number().int().min(1).max(50).default(20),
          paths: z.array(z.string().min(1).max(4_096)).max(100).optional(),
        }).strict().parse(params);
        const paths = await normalizePlanningGitPaths(cwd, input.paths ?? []);
        const result = await runPlanningProcess({
          executable: gitExecutable,
          args: [
            "--no-pager",
            "--literal-pathspecs",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "log",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--date=iso-strict",
            "--format=%H%x09%ad%x09%an%x09%s",
            "-n",
            String(input.limit),
            "--ignore-submodules=all",
            ...gitPathArguments(paths),
          ],
          cwd,
          environment: planningGitEnvironment(runtimeEnvironment),
          timeoutMs: 60_000,
          signal,
        });
        return planningGitResult("Git log", result);
      },
    },
    {
      name: "run_validation",
      label: "Run validation",
      description: "Run one repository-declared validation in a read-only, network-disabled platform sandbox.",
      promptSnippet: "run_validation: run a declared read-only repository validation by ID",
      promptGuidelines: [
        "Only validation IDs declared in .pi-work/validations.json are accepted.",
        "The workspace is read-only, network access is disabled, and only an isolated temporary directory is writable.",
      ],
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
        },
      } as any,
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        const input = z.object({
          id: z.string().trim().min(1).max(120),
        }).strict().parse(params);
        const config = await readPlanningValidationConfig(cwd);
        const validation = config.validations.find(({ id }) => id === input.id);
        if (validation === undefined) {
          throw new Error(`Unknown planning validation: ${input.id}`);
        }
        const sandboxExecutable = options.sandboxExecutable ?? "/usr/bin/sandbox-exec";
        await requireExecutable(sandboxExecutable, "The platform validation sandbox is unavailable.");
        const createdTemporaryDirectory = await mkdtemp(join(tmpdir(), "pi-work-validation-"));
        const temporaryDirectory = await realpath(createdTemporaryDirectory);
        try {
          const profile = planningValidationSandboxProfile(temporaryDirectory);
          const result = await runPlanningProcess({
            executable: sandboxExecutable,
            args: ["-p", profile, "--", ...validation.argv],
            cwd,
            environment: planningValidationEnvironment(temporaryDirectory, runtimeEnvironment),
            timeoutMs: validation.timeoutMs,
            signal,
          });
          const status = result.timedOut
            ? "timed out"
            : result.exitCode === 0
              ? "passed"
              : `failed with exit code ${result.exitCode ?? "unknown"}`;
          return {
            content: [{
              type: "text",
              text: `${validation.label}: ${status}\n${result.output || "(no output)"}`,
            }],
            details: {
              validationId: validation.id,
              label: validation.label,
              exitCode: result.exitCode,
              signal: result.signal,
              timedOut: result.timedOut,
              truncated: result.truncated,
            },
          };
        } finally {
          await rm(createdTemporaryDirectory, { recursive: true, force: true });
        }
      },
    },
  ];
}

function planningGitPathsJsonSchema(): Record<string, unknown> {
  return {
    type: "array",
    maxItems: 100,
    items: { type: "string", minLength: 1, maxLength: 4_096 },
  };
}

async function normalizePlanningGitPaths(cwd: string, paths: string[]): Promise<string[]> {
  const root = await realpath(cwd);
  return Promise.all(paths.map(async (requestedPath) => {
    if (requestedPath.startsWith("-")) {
      throw new Error(`Git paths cannot begin with an option prefix: ${requestedPath}`);
    }
    if (/[\0\r\n]/.test(requestedPath)) {
      throw new Error("Git paths cannot contain control characters.");
    }
    await assertAuthorizedFilePath(root, requestedPath);
    const normalized = relative(root, resolve(root, requestedPath));
    return normalized === "" ? "." : normalized;
  }));
}

function gitPathArguments(paths: string[]): string[] {
  return paths.length === 0 ? [] : ["--", ...paths];
}

type PlanningProcessResult = {
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
};

function planningGitResult(label: string, result: PlanningProcessResult): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  if (result.timedOut) throw new Error(`${label} timed out.`);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode ?? "unknown"}: ${result.output || "(no output)"}`);
  }
  return {
    content: [{ type: "text", text: result.output || "(no output)" }],
    details: {
      exitCode: result.exitCode,
      signal: result.signal,
      truncated: result.truncated,
    },
  };
}

async function readPlanningValidationConfig(cwd: string): Promise<z.infer<typeof planningValidationConfigSchema>> {
  const relativePath = join(".pi-work", "validations.json");
  await assertAuthorizedFilePath(cwd, relativePath);
  let content: string;
  try {
    content = await readFile(join(cwd, relativePath), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("No planning validations are declared in .pi-work/validations.json.");
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The planning validation configuration is not valid JSON.");
  }
  return planningValidationConfigSchema.parse(value);
}

function planningGitEnvironment(runtimeEnvironment?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: runtimeEnvironment?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    LANG: runtimeEnvironment?.LANG ?? process.env.LANG ?? "C",
    LC_ALL: runtimeEnvironment?.LC_ALL ?? process.env.LC_ALL ?? "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    NO_COLOR: "1",
  };
}

function planningValidationEnvironment(
  temporaryDirectory: string,
  runtimeEnvironment?: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    PATH: runtimeEnvironment?.PATH ?? process.env.PATH ?? "/usr/bin:/bin",
    LANG: runtimeEnvironment?.LANG ?? process.env.LANG ?? "C",
    LC_ALL: runtimeEnvironment?.LC_ALL ?? process.env.LC_ALL ?? "C",
    HOME: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    XDG_CACHE_HOME: temporaryDirectory,
    XDG_CONFIG_HOME: temporaryDirectory,
    XDG_DATA_HOME: temporaryDirectory,
    COREPACK_HOME: temporaryDirectory,
    NPM_CONFIG_CACHE: temporaryDirectory,
    CI: "1",
    NO_COLOR: "1",
  };
}

function planningValidationSandboxProfile(temporaryDirectory: string): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-write* (require-not (subpath ${JSON.stringify(temporaryDirectory)})))`,
  ].join("\n");
}

async function requireExecutable(executable: string, unavailableMessage: string): Promise<void> {
  try {
    await access(executable, fsConstants.X_OK);
  } catch {
    throw new Error(unavailableMessage);
  }
}

async function runPlanningProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}): Promise<PlanningProcessResult> {
  input.signal?.throwIfAborted();
  await requireExecutable(input.executable, `Required executable is unavailable: ${input.executable}`);
  return new Promise<PlanningProcessResult>((resolvePromise, rejectPromise) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: input.environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const append = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = 100 * 1_024 - capturedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (buffer.length > remaining) {
        chunks.push(buffer.subarray(0, remaining));
        capturedBytes += remaining;
        truncated = true;
        return;
      }
      chunks.push(buffer);
      capturedBytes += buffer.length;
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const forceKill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const terminate = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const escalation = setTimeout(forceKill, 2_000);
        escalation.unref();
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref();
    const abort = () => terminate();
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      rejectPromise(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
      if (input.signal?.aborted === true) {
        rejectPromise(input.signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const output = Buffer.concat(chunks).toString("utf8").trimEnd();
      resolvePromise({
        output: truncated ? `${output}\n[output truncated at 100 KB]` : output,
        exitCode,
        signal,
        timedOut,
        truncated,
      });
    });
  });
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
