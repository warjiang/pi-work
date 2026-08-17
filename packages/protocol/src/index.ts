import { z } from "zod";

export const taskStatuses = [
  "draft",
  "planning",
  "awaiting_plan_approval",
  "ready_to_execute",
  "running",
  "awaiting_action_approval",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
] as const;

export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const workspaceKindSchema = z.enum(["managed", "folder"]);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const thinkingLevelSchema = z.enum(thinkingLevels);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const permissionModes = ["explore", "ask", "auto"] as const;
export const permissionModeSchema = z.enum(permissionModes);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const taskExecutionModes = ["direct", "plan", "orchestration"] as const;
export const taskExecutionModeSchema = z.enum(taskExecutionModes);
export type TaskExecutionMode = z.infer<typeof taskExecutionModeSchema>;

export const sessionKinds = ["chat", "task"] as const;
export const sessionKindSchema = z.enum(sessionKinds);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  directories: z.array(z.string().min(1)).min(1),
  outputPath: z.string().min(1),
  kind: workspaceKindSchema,
  version: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceDirectorySchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  path: z.string().min(1),
  canonicalPath: z.string().min(1),
  isRoot: z.boolean(),
  createdAt: z.string().datetime(),
});
export type WorkspaceDirectory = z.infer<typeof workspaceDirectorySchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  title: z.string().min(1).max(160),
  goal: z.string().min(1),
  status: taskStatusSchema,
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: thinkingLevelSchema,
  kind: sessionKindSchema.default("chat"),
  archived: z.boolean().default(false),
  flagged: z.boolean().default(false),
  unread: z.boolean().default(false),
  statusId: z.uuid().nullable().default(null),
  labelIds: z.array(z.uuid()).default([]),
  permissionMode: permissionModeSchema.default("ask"),
  planMode: z.boolean().default(false),
  executionMode: taskExecutionModeSchema.default("direct"),
  workingDirectory: z.string().nullable().default(null),
  running: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;
export const sessionSchema = taskSchema;
export type Session = Task;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const activityKinds = [
  "thinking",
  "tool_call",
  "tool_result",
  "file_change",
  "approval",
  "error",
  "notice",
] as const;
export const activityKindSchema = z.enum(activityKinds);
export const activitySchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  messageId: z.uuid().nullable(),
  kind: activityKindSchema,
  title: z.string().min(1),
  detail: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof activitySchema>;

export const attachmentSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  messageId: z.uuid().nullable(),
  name: z.string().min(1),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const attachmentDraftSchema = attachmentSchema.pick({
  name: true,
  path: true,
  mimeType: true,
  size: true,
});
export type AttachmentDraft = z.infer<typeof attachmentDraftSchema>;
export const inspectAttachmentPathsSchema = z.array(z.string().min(1)).max(20);
export const agentImageAttachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().regex(/^image\/(?:png|jpeg|gif|webp)$/),
  data: z.string().min(1).max(28_000_000),
});
export type AgentImageAttachment = z.infer<typeof agentImageAttachmentSchema>;

export const statusDefinitionSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
  position: z.number().int().nonnegative(),
  category: z.enum(["backlog", "open", "active", "review", "closed", "cancelled"]).default("open"),
});
export type StatusDefinition = z.infer<typeof statusDefinitionSchema>;

export const boardSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Board = z.infer<typeof boardSchema>;

export const boardColumnSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
  position: z.number().int().nonnegative(),
  statusIds: z.array(z.uuid()),
  dropStatusId: z.uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const taskBoardStateSchema = z.object({
  taskId: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid(),
  columnId: z.uuid(),
  rank: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type TaskBoardState = z.infer<typeof taskBoardStateSchema>;

export const boardSnapshotSchema = z.object({
  board: boardSchema,
  columns: z.array(boardColumnSchema),
  states: z.array(taskBoardStateSchema),
});
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

export const labelSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
});
export type Label = z.infer<typeof labelSchema>;

export const savedViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()),
  position: z.number().int().nonnegative(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

export const subtaskSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  completed: z.boolean(),
  position: z.number().int().nonnegative(),
});
export type Subtask = z.infer<typeof subtaskSchema>;

export const sourceTypes = ["mcp_stdio", "mcp_http", "openapi", "local", "google", "microsoft", "slack"] as const;
export const sourceTypeSchema = z.enum(sourceTypes);
export const mcpStdioConfigSchema = z.object({
  command: z.string().trim().min(1).max(4_096),
  args: z.array(z.string().max(10_000)).max(200).default([]),
  env: z.record(z.string().min(1).max(256), z.string().max(100_000)).default({}),
  cwd: z.string().trim().min(1).max(4_096).optional(),
});
export const mcpHttpConfigSchema = z.object({
  url: z.url().refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
    message: "Remote MCP URL must use HTTP or HTTPS.",
  }),
  transport: z.enum(["auto", "streamable_http", "sse"]).default("auto"),
  headers: z.record(z.string().min(1).max(256), z.string().max(100_000)).default({}),
  auth: z.enum(["none", "bearer", "oauth"]).default("none"),
  bearerToken: z.string().max(100_000).optional(),
}).superRefine((config, context) => {
  if (config.auth === "bearer" && !config.bearerToken?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["bearerToken"],
      message: "Bearer authentication requires a token.",
    });
  }
});
export const mcpSourceConfigSchema = z.union([mcpStdioConfigSchema, mcpHttpConfigSchema]);
export type McpSourceConfig = z.infer<typeof mcpSourceConfigSchema>;

export const sourceSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  type: sourceTypeSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Source = z.infer<typeof sourceSchema>;

export const mcpRuntimeServerSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(["mcp_stdio", "mcp_http"]),
  config: z.record(z.string(), z.unknown()),
});
export type McpRuntimeServer = z.infer<typeof mcpRuntimeServerSchema>;

export const mcpToolSummarySchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export const mcpInspectResultSchema = z.object({
  connected: z.boolean(),
  transport: z.enum(["stdio", "streamable_http", "sse"]),
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  instructions: z.string().optional(),
  tools: z.array(mcpToolSummarySchema),
  resourceCount: z.number().int().nonnegative(),
  promptCount: z.number().int().nonnegative(),
  logs: z.array(z.string()),
});
export type McpInspectResult = z.infer<typeof mcpInspectResultSchema>;
export const mcpInspectInputSchema = z.object({ sourceId: z.uuid() });
export const mcpCallToolInputSchema = z.object({
  sourceId: z.uuid(),
  toolName: z.string().trim().min(1).max(240),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export const mcpCallToolResultSchema = z.object({
  content: z.array(z.record(z.string(), z.unknown())),
  isError: z.boolean().default(false),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});
export type McpCallToolResult = z.infer<typeof mcpCallToolResultSchema>;
export const mcpAuthorizeInputSchema = z.object({ sourceId: z.uuid() });
export const mcpAuthorizationStatusSchema = z.object({
  authorized: z.boolean(),
  message: z.string(),
});
export type McpAuthorizationStatus = z.infer<typeof mcpAuthorizationStatusSchema>;

export const skillSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created") }),
  z.object({
    type: z.literal("local"),
    path: z.string().min(1).max(4_096).optional(),
  }),
  z.object({
    type: z.literal("system"),
    provider: z.enum(["pi", "agents", "codex", "claude"]),
    path: z.string().min(1).max(4_096),
  }),
  z.object({
    type: z.literal("remote"),
    provider: z.string().trim().min(1).max(120),
    sourceUrl: z.url(),
    repositoryUrl: z.url().optional(),
    skillId: z.string().trim().min(1).max(240).optional(),
    subpath: z.string().trim().min(1).max(2_048).optional(),
    commit: z.string().trim().min(1).max(160).optional(),
  }),
]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const skillSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  instructions: z.string().max(100_000),
  enabled: z.boolean(),
  source: skillSourceSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Skill = z.infer<typeof skillSchema>;

export const skillNameSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Skill names use lowercase letters, numbers, and single hyphens.");
export const skillDescriptionSchema = z.string().trim().min(1).max(1_024);
export const skillInstructionsSchema = z.string().max(100_000);
export const createSkillInputSchema = z.object({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  instructions: skillInstructionsSchema,
  enabled: z.boolean().default(true),
});
export const updateSkillInputSchema = createSkillInputSchema;
export const importSkillInputSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
});
export const readSkillFileInputSchema = z.object({
  id: z.uuid(),
  path: z.string().trim().min(1).max(2_048),
});
export const skillFileContentSchema = z.object({
  path: z.string().min(1).max(2_048),
  content: z.string(),
  language: z.string().min(1).max(80),
  size: z.number().int().nonnegative(),
});
export type SkillFileContent = z.infer<typeof skillFileContentSchema>;
export const marketplaceSkillSchema = z.object({
  id: z.string().trim().min(1).max(500),
  skillId: z.string().trim().min(1).max(240),
  name: z.string().trim().min(1).max(240),
  installs: z.number().int().nonnegative(),
  source: z.string().trim().min(1).max(240),
  sourceUrl: z.url(),
  detailUrl: z.url(),
  installed: z.boolean(),
});
export type MarketplaceSkill = z.infer<typeof marketplaceSkillSchema>;
export const searchSkillMarketplaceInputSchema = z.object({
  provider: z.literal("skills.sh").default("skills.sh"),
  query: z.string().trim().min(2).max(160),
  limit: z.number().int().min(1).max(50).default(30),
});
export const previewRemoteSkillInputSchema = z.object({
  sourceUrl: z.url().refine(
    (sourceUrl) => {
      const protocol = new URL(sourceUrl).protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "Expected an HTTP(S) URL" },
  ),
  provider: z.string().trim().min(1).max(120).default("url"),
  skillId: z.string().trim().min(1).max(240).optional(),
});
export const remoteSkillCandidateSchema = z.object({
  id: z.string().trim().min(1).max(2_048),
  name: skillNameSchema,
  description: skillDescriptionSchema,
  path: z.string().max(2_048),
  files: z.number().int().nonnegative(),
  duplicate: z.boolean(),
});
export type RemoteSkillCandidate = z.infer<typeof remoteSkillCandidateSchema>;
export const remoteSkillPreviewSchema = z.object({
  previewId: z.uuid(),
  provider: z.string().trim().min(1).max(120),
  sourceUrl: z.url(),
  repositoryUrl: z.url().optional(),
  commit: z.string().trim().min(1).max(160).optional(),
  expiresAt: z.string().datetime(),
  skills: z.array(remoteSkillCandidateSchema).min(1),
});
export type RemoteSkillPreview = z.infer<typeof remoteSkillPreviewSchema>;
export const installRemoteSkillsInputSchema = z.object({
  previewId: z.uuid(),
  skillIds: z.array(z.string().trim().min(1).max(2_048)).min(1).max(100),
});
export const cancelRemoteSkillPreviewInputSchema = z.object({
  previewId: z.uuid(),
});
export const setSkillEnabledInputSchema = z.object({
  id: z.uuid(),
  enabled: z.boolean(),
});
export const systemSkillSchema = z.object({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  path: z.string().min(1),
  source: z.enum(["pi", "agents", "codex", "claude"]),
  imported: z.boolean(),
});
export type SystemSkill = z.infer<typeof systemSkillSchema>;

export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), cron: z.string().min(1).max(120) }),
  z.object({ type: z.literal("status_changed"), statusId: z.uuid().nullable() }),
  z.object({ type: z.literal("label_changed"), labelId: z.uuid() }),
  z.object({ type: z.literal("tool_event"), tool: z.string().min(1).max(120) }),
]);
export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_session"), title: z.string().max(160), prompt: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("send_prompt"), sessionId: z.uuid().nullable(), prompt: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("webhook"), url: z.url(), method: z.enum(["POST", "PUT", "PATCH"]).default("POST") }),
]);
export const automationSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  lastRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationRunSchema = z.object({
  id: z.uuid(),
  automationId: z.uuid(),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  dedupeKey: z.string().min(1),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const browserTabSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid().nullable(),
  title: z.string(),
  url: z.string(),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BrowserTab = z.infer<typeof browserTabSchema>;

export const browserNavigateInputSchema = z.object({
  url: z.string().trim().min(1).max(8_192),
});

export const buildInfoSchema = z.object({
  version: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
});
export type BuildInfo = z.infer<typeof buildInfoSchema>;

export const externalUrlInputSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(8_192),
});

export const browserBoundsInputSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

export const runSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const conductorRunStatuses = ["pending", "running", "paused", "completed", "failed", "cancelled"] as const;
export const conductorNodeStatuses = ["pending", "ready", "running", "completed", "failed", "skipped", "cancelled"] as const;
export const conductorNodeAttemptStatuses = ["running", "completed", "failed", "cancelled"] as const;
export const conductorExecutionClasses = ["read", "write"] as const;
export const conductorRunOrigins = ["conversation", "approved_plan", "legacy"] as const;
export const conductorFinalizationStatuses = ["pending", "publishing", "published", "failed"] as const;
export const workflowDraftNodeSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(100_000),
  dependsOn: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
  executionClass: z.enum(conductorExecutionClasses),
  maxAttempts: z.number().int().min(1).max(10).default(1),
});
export type WorkflowDraftNode = z.infer<typeof workflowDraftNodeSchema>;
export const workflowDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(10_000),
  maxParallel: z.number().int().min(1).max(16).default(4),
  nodes: z.array(workflowDraftNodeSchema).min(2).max(24),
}).superRefine((draft, context) => {
  const keys = new Set<string>();
  for (const [index, node] of draft.nodes.entries()) {
    if (keys.has(node.key)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "key"], message: `Duplicate workflow key: ${node.key}` });
    }
    keys.add(node.key);
  }
  for (const [index, node] of draft.nodes.entries()) {
    if (node.dependsOn.includes(node.key)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "dependsOn"], message: "A workflow node cannot depend on itself." });
    }
    for (const dependency of node.dependsOn) {
      if (!keys.has(dependency)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "dependsOn"], message: `Unknown workflow dependency: ${dependency}` });
      }
    }
  }
  const nodesByKey = new Map(draft.nodes.map((node) => [node.key, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = nodesByKey.get(key)?.dependsOn.some(hasCycle) ?? false;
    visiting.delete(key);
    visited.add(key);
    return cyclic;
  };
  if (draft.nodes.some(({ key }) => hasCycle(key))) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "Workflow dependencies must form an acyclic graph." });
  }
});
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export const conductorNodeSchema = z.object({
  id: z.uuid(),
  key: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(100_000),
  dependsOn: z.array(z.uuid()).default([]),
  executionClass: z.enum(conductorExecutionClasses).optional(),
  maxAttempts: z.number().int().min(1).max(10).default(1),
});
export type ConductorNode = z.infer<typeof conductorNodeSchema>;
export const conductorSpecSchema = z.object({
  nodes: z.array(conductorNodeSchema).min(1).max(100),
  maxParallel: z.number().int().min(1).max(16).default(4),
}).superRefine((spec, context) => {
  const ids = new Set(spec.nodes.map(({ id }) => id));
  for (const [index, node] of spec.nodes.entries()) {
    if (node.dependsOn.includes(node.id)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "dependsOn"], message: "A node cannot depend on itself." });
    }
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "dependsOn"], message: `Unknown dependency: ${dependency}` });
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const nodesById = new Map(spec.nodes.map((node) => [node.id, node]));
  const hasCycle = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    const cyclic = nodesById.get(nodeId)?.dependsOn.some(hasCycle) ?? false;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cyclic;
  };
  if (spec.nodes.some(({ id }) => hasCycle(id))) {
    context.addIssue({
      code: "custom",
      path: ["nodes"],
      message: "Conductor dependencies must form an acyclic graph.",
    });
  }
});
export type ConductorSpec = z.infer<typeof conductorSpecSchema>;
export const conductorRunSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(conductorRunStatuses),
  origin: z.enum(conductorRunOrigins).default("legacy"),
  title: z.string().trim().min(1).max(160).default("Workflow"),
  summary: z.string().max(10_000).default(""),
  dedupeKey: z.string().min(1).max(500).nullable().default(null),
  sourceRequestId: z.uuid().nullable().default(null),
  sourceMessageId: z.uuid().nullable().default(null),
  planRevisionId: z.uuid().nullable().default(null),
  parentRunId: z.uuid().nullable().default(null),
  synthesisNodeId: z.uuid().nullable().default(null),
  finalizationStatus: z.enum(conductorFinalizationStatuses).default("pending"),
  finalMessageId: z.uuid().nullable().default(null),
  spec: conductorSpecSchema,
  lastEventSequence: z.number().int().nonnegative(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ConductorRun = z.infer<typeof conductorRunSchema>;
export const conductorNodeStateSchema = z.object({
  runId: z.uuid(),
  nodeId: z.uuid(),
  status: z.enum(conductorNodeStatuses),
  attempt: z.number().int().nonnegative(),
  executionId: z.uuid().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type ConductorNodeState = z.infer<typeof conductorNodeStateSchema>;

export const conductorNodeEventSchema = z.object({
  executionId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type ConductorNodeEvent = z.infer<typeof conductorNodeEventSchema>;

export const conductorNodeAttemptSchema = z.object({
  runId: z.uuid(),
  nodeId: z.uuid(),
  attempt: z.number().int().positive(),
  executionId: z.uuid(),
  status: z.enum(conductorNodeAttemptStatuses),
  output: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ConductorNodeAttempt = z.infer<typeof conductorNodeAttemptSchema>;

export const conductorNodeAttemptDetailSchema = conductorNodeAttemptSchema.extend({
  events: z.array(conductorNodeEventSchema),
});
export type ConductorNodeAttemptDetail = z.infer<typeof conductorNodeAttemptDetailSchema>;

export const planStepSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  detail: z.string().min(1),
});

export const planSchema = z.object({
  taskId: z.uuid(),
  summary: z.string().min(1),
  steps: z.array(planStepSchema).min(1).max(20),
  sources: z.array(z.string().min(1)).max(100),
});
export type Plan = z.infer<typeof planSchema>;

export const planRevisionStatusSchema = z.enum(["proposed", "superseded", "approved"]);
export type PlanRevisionStatus = z.infer<typeof planRevisionStatusSchema>;

export const planRevisionStepSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(10_000),
  targets: z.array(z.string().trim().min(1).max(1_024)).max(100),
  verification: z.array(z.string().trim().min(1).max(2_000)).max(100),
});
export type PlanRevisionStep = z.infer<typeof planRevisionStepSchema>;

export const planSourceSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
  operation: z.enum(["read", "grep", "find", "ls"]).optional(),
});
export type PlanSource = z.infer<typeof planSourceSchema>;

export const planRevisionSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  revision: z.number().int().positive(),
  status: planRevisionStatusSchema,
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(10_000),
  steps: z.array(planRevisionStepSchema).min(1).max(20),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100),
  sources: z.array(planSourceSchema).max(200),
  parentRevisionId: z.uuid().nullable(),
  createdFromMessageId: z.uuid().nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
});
export type PlanRevision = z.infer<typeof planRevisionSchema>;

export const planProposalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(10_000),
  steps: z.array(planRevisionStepSchema.omit({ id: true })).min(1).max(20),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  sources: z.array(planSourceSchema).max(200).default([]),
});
export type PlanProposal = z.infer<typeof planProposalSchema>;

export const planRevisionEditStepSchema = planRevisionStepSchema.extend({
  id: z.uuid().optional(),
});
export type PlanRevisionEditStep = z.infer<typeof planRevisionEditStepSchema>;

export const planRevisionEditInputSchema = z.object({
  taskId: z.uuid(),
  parentRevisionId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(10_000),
  steps: z.array(planRevisionEditStepSchema).min(1).max(20),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(100),
});
export type PlanRevisionEditInput = z.infer<typeof planRevisionEditInputSchema>;

export const planRevisionDiffInputSchema = z.object({
  taskId: z.uuid(),
  revisionId: z.uuid(),
  compareToRevisionId: z.uuid().optional(),
});
export type PlanRevisionDiffInput = z.infer<typeof planRevisionDiffInputSchema>;

export const planRevisionFieldChangeSchema = z.object({
  field: z.enum(["title", "summary", "assumptions"]),
  before: z.string(),
  after: z.string(),
});
export type PlanRevisionFieldChange = z.infer<typeof planRevisionFieldChangeSchema>;

export const planRevisionStepChangeSchema = z.object({
  stepId: z.uuid(),
  changes: z.array(z.enum(["added", "removed", "moved", "changed"])).min(1),
  beforeIndex: z.number().int().nonnegative().nullable(),
  afterIndex: z.number().int().nonnegative().nullable(),
  fields: z.array(z.enum(["title", "detail", "targets", "verification"])),
});
export type PlanRevisionStepChange = z.infer<typeof planRevisionStepChangeSchema>;

export const planRevisionDiffSchema = z.object({
  baseRevisionId: z.uuid(),
  revisionId: z.uuid(),
  fieldChanges: z.array(planRevisionFieldChangeSchema),
  stepChanges: z.array(planRevisionStepChangeSchema),
  markdownDiff: z.string(),
});
export type PlanRevisionDiff = z.infer<typeof planRevisionDiffSchema>;

export function planRevisionMarkdown(plan: PlanRevision): string {
  const lines = [
    `# ${plan.title}`,
    "",
    plan.summary,
    "",
    "## Steps",
    "",
  ];
  plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}**`, `   ${step.detail}`);
    if (step.targets.length > 0) {
      lines.push("   - Targets:", ...step.targets.map((target) => `     - ${target}`));
    }
    if (step.verification.length > 0) {
      lines.push("   - Verification:", ...step.verification.map((item) => `     - ${item}`));
    }
  });
  if (plan.assumptions.length > 0) {
    lines.push("", "## Assumptions", "", ...plan.assumptions.map((item) => `- ${item}`));
  }
  if (plan.sources.length > 0) {
    lines.push(
      "",
      "## Sources",
      "",
      ...plan.sources.map(({ path, operation }) => `- \`${path}\`${operation === undefined ? "" : ` (${operation})`}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function diffPlanRevisions(base: PlanRevision, revision: PlanRevision): PlanRevisionDiff {
  if (base.taskId !== revision.taskId) throw new Error("Plan revisions belong to different tasks.");
  const fieldChanges: PlanRevisionFieldChange[] = [];
  const fieldValues = [
    ["title", base.title, revision.title],
    ["summary", base.summary, revision.summary],
    ["assumptions", base.assumptions.join("\n"), revision.assumptions.join("\n")],
  ] as const;
  for (const [field, before, after] of fieldValues) {
    if (before !== after) fieldChanges.push({ field, before, after });
  }

  const beforeById = new Map(base.steps.map((step, index) => [step.id, { step, index }]));
  const afterById = new Map(revision.steps.map((step, index) => [step.id, { step, index }]));
  const stepIds = [...new Set([...base.steps.map(({ id }) => id), ...revision.steps.map(({ id }) => id)])];
  const stepChanges: PlanRevisionStepChange[] = [];
  for (const stepId of stepIds) {
    const before = beforeById.get(stepId);
    const after = afterById.get(stepId);
    if (before === undefined && after !== undefined) {
      stepChanges.push({
        stepId,
        changes: ["added"],
        beforeIndex: null,
        afterIndex: after.index,
        fields: [],
      });
      continue;
    }
    if (before !== undefined && after === undefined) {
      stepChanges.push({
        stepId,
        changes: ["removed"],
        beforeIndex: before.index,
        afterIndex: null,
        fields: [],
      });
      continue;
    }
    if (before === undefined || after === undefined) continue;
    const fields = (["title", "detail", "targets", "verification"] as const).filter((field) => (
      JSON.stringify(before.step[field]) !== JSON.stringify(after.step[field])
    ));
    const changes: Array<"moved" | "changed"> = [];
    if (before.index !== after.index) changes.push("moved");
    if (fields.length > 0) changes.push("changed");
    if (changes.length > 0) {
      stepChanges.push({
        stepId,
        changes,
        beforeIndex: before.index,
        afterIndex: after.index,
        fields: [...fields],
      });
    }
  }

  return planRevisionDiffSchema.parse({
    baseRevisionId: base.id,
    revisionId: revision.id,
    fieldChanges,
    stepChanges,
    markdownDiff: unifiedMarkdownDiff(
      planRevisionMarkdown(base),
      planRevisionMarkdown(revision),
      `plan-v${base.revision}.md`,
      `plan-v${revision.revision}.md`,
    ),
  });
}

function unifiedMarkdownDiff(before: string, after: string, beforeName: string, afterName: string): string {
  const beforeLines = before.replace(/\n$/, "").split("\n");
  const afterLines = after.replace(/\n$/, "").split("\n");
  const table = Array.from({ length: beforeLines.length + 1 }, () => (
    Array<number>(afterLines.length + 1).fill(0)
  ));
  for (let left = beforeLines.length - 1; left >= 0; left -= 1) {
    for (let right = afterLines.length - 1; right >= 0; right -= 1) {
      table[left]![right] = beforeLines[left] === afterLines[right]
        ? table[left + 1]![right + 1]! + 1
        : Math.max(table[left + 1]![right]!, table[left]![right + 1]!);
    }
  }
  const lines = [`--- ${beforeName}`, `+++ ${afterName}`, `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`];
  let left = 0;
  let right = 0;
  while (left < beforeLines.length || right < afterLines.length) {
    if (left < beforeLines.length && right < afterLines.length && beforeLines[left] === afterLines[right]) {
      lines.push(` ${beforeLines[left]}`);
      left += 1;
      right += 1;
    } else if (right < afterLines.length && (left === beforeLines.length || table[left]![right + 1]! >= table[left + 1]![right]!)) {
      lines.push(`+${afterLines[right]}`);
      right += 1;
    } else {
      lines.push(`-${beforeLines[left]}`);
      left += 1;
    }
  }
  return `${lines.join("\n")}\n`;
}

export const planClarificationOptionSchema = z.object({
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000),
});
export type PlanClarificationOption = z.infer<typeof planClarificationOptionSchema>;

export const planningResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clarification"),
    question: z.string().trim().min(1).max(4_000),
    options: z.array(planClarificationOptionSchema).min(2).max(4).optional(),
  }),
  z.object({
    kind: z.literal("proposal"),
    proposal: planProposalSchema,
  }),
]);
export type PlanningResult = z.infer<typeof planningResultSchema>;

export const planApprovalActions = [
  "approve_and_execute",
  "approve_only",
  "approve_and_execute_fresh",
  "approve_and_orchestrate",
] as const;
export const planApprovalActionSchema = z.enum(planApprovalActions);
export type PlanApprovalAction = z.infer<typeof planApprovalActionSchema>;

export const planExecutionModes = ["current_session", "fresh_session", "orchestration"] as const;
export const planExecutionModeSchema = z.enum(planExecutionModes);
export type PlanExecutionMode = z.infer<typeof planExecutionModeSchema>;

export const planExecutionStatuses = ["pending", "running", "completed", "failed", "cancelled"] as const;
export const planExecutionStatusSchema = z.enum(planExecutionStatuses);
export type PlanExecutionStatus = z.infer<typeof planExecutionStatusSchema>;

export const planExecutionStepStatuses = ["pending", "running", "completed", "failed", "skipped"] as const;
export const planExecutionStepStatusSchema = z.enum(planExecutionStepStatuses);
export type PlanExecutionStepStatus = z.infer<typeof planExecutionStepStatusSchema>;

export const planVerificationResultSchema = z.object({
  verificationIndex: z.number().int().nonnegative(),
  status: z.enum(["passed", "failed", "not_run"]),
  detail: z.string().trim().min(1).max(10_000),
});
export type PlanVerificationResult = z.infer<typeof planVerificationResultSchema>;

export const planExecutionSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  planRevisionId: z.uuid(),
  mode: planExecutionModeSchema,
  status: planExecutionStatusSchema,
  agentSessionId: z.uuid().nullable(),
  conductorRunId: z.uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type PlanExecution = z.infer<typeof planExecutionSchema>;

export const planExecutionStepSchema = z.object({
  executionId: z.uuid(),
  planRevisionId: z.uuid(),
  stepId: z.uuid(),
  ordinal: z.number().int().nonnegative(),
  status: planExecutionStepStatusSchema,
  verificationResults: z.array(planVerificationResultSchema),
  note: z.string().nullable(),
  error: z.string().nullable(),
  conductorNodeId: z.uuid().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type PlanExecutionStep = z.infer<typeof planExecutionStepSchema>;

export const planExecutionDetailSchema = z.object({
  execution: planExecutionSchema,
  steps: z.array(planExecutionStepSchema),
});
export type PlanExecutionDetail = z.infer<typeof planExecutionDetailSchema>;

export const artifactSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  relativePath: z.string().min(1),
  mimeType: z.string().min(1),
  stagedPath: z.string().min(1),
  publishedPath: z.string().nullable(),
  content: z.string(),
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rootPath: z.string().min(1),
});

export const addWorkspaceDirectoryInputSchema = z.object({
  workspaceId: z.uuid(),
});

export const removeWorkspaceDirectoryInputSchema = z.object({
  workspaceId: z.uuid(),
  directoryId: z.uuid(),
});

export const updateWorkspaceInputSchema = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  outputPath: z.string().min(1).optional(),
  directories: z.array(z.string().min(1)).min(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).refine(({ name, outputPath, directories }) => (
  name !== undefined || outputPath !== undefined || directories !== undefined
), {
  message: "Update at least one workspace field.",
});

export const createTaskInputSchema = z.object({
  workspaceId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(10_000),
  kind: sessionKindSchema.default("task"),
  providerId: z.string().trim().min(1).max(80).nullable().default(null),
  modelId: z.string().trim().min(1).max(160).nullable().default(null),
  thinkingLevel: thinkingLevelSchema.default("off"),
  permissionMode: permissionModeSchema.default("ask"),
  planMode: z.boolean().default(true),
  executionMode: taskExecutionModeSchema.default("plan"),
  workingDirectory: z.string().min(1).nullable().default(null),
});

export const createPersonalSessionInputSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  thinkingLevel: thinkingLevelSchema,
});

export const updateTaskBriefInputSchema = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  goal: z.string().trim().min(1).max(10_000).optional(),
}).refine(({ title, goal }) => title !== undefined || goal !== undefined, {
  message: "Update at least one task brief field.",
});

export const requestPlanInputSchema = z.object({
  taskId: z.uuid(),
  feedbackMessageId: z.uuid().optional(),
});
export const generatePlanInputSchema = requestPlanInputSchema;

export const sendChatInputSchema = z.object({
  workspaceId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  content: z.string().trim().min(1).max(100_000),
  editMessageId: z.uuid().optional(),
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  thinkingLevel: thinkingLevelSchema,
  permissionMode: permissionModeSchema.optional(),
  planMode: z.boolean().optional(),
  executionMode: taskExecutionModeSchema.optional(),
  attachments: z.array(attachmentDraftSchema).max(20).default([]),
});

export const sessionSearchInputSchema = z.object({
  query: z.string().trim().max(500).default(""),
  workspaceId: z.uuid().nullable().optional(),
  archived: z.boolean().optional(),
  flagged: z.boolean().optional(),
  statusId: z.uuid().nullable().optional(),
  labelId: z.uuid().optional(),
});

export const updateSessionInputSchema = z.object({
  sessionId: z.uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  status: taskStatusSchema.optional(),
  archived: z.boolean().optional(),
  flagged: z.boolean().optional(),
  unread: z.boolean().optional(),
  statusId: z.uuid().nullable().optional(),
  labelIds: z.array(z.uuid()).optional(),
  permissionMode: permissionModeSchema.optional(),
  planMode: z.boolean().optional(),
  executionMode: taskExecutionModeSchema.optional(),
  workingDirectory: z.string().nullable().optional(),
});

export const promoteSessionInputSchema = z.object({
  sessionId: z.uuid(),
  workspaceId: z.uuid(),
});

export const createDomainEntityInputSchema = z.object({
  workspaceId: z.uuid(),
  value: z.record(z.string(), z.unknown()),
});

export const updateDomainEntityInputSchema = z.object({
  workspaceId: z.uuid().optional(),
  id: z.uuid(),
  value: z.record(z.string(), z.unknown()),
});

export const removeDomainEntityInputSchema = z.object({ workspaceId: z.uuid().optional(), id: z.uuid() });

export const createBoardColumnInputSchema = z.object({
  workspaceId: z.uuid(),
  boardId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32),
  statusIds: z.array(z.uuid()).default([]),
  dropStatusId: z.uuid().nullable().default(null),
});
export const updateBoardColumnInputSchema = createBoardColumnInputSchema.partial({
  name: true,
  color: true,
  statusIds: true,
  dropStatusId: true,
}).extend({
  columnId: z.uuid(),
  position: z.number().int().nonnegative().optional(),
});
export const removeBoardColumnInputSchema = z.object({
  workspaceId: z.uuid(),
  boardId: z.uuid(),
  columnId: z.uuid(),
  migrateToColumnId: z.uuid(),
});
export const moveBoardCardInputSchema = z.object({
  commandId: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid(),
  taskId: z.uuid(),
  toColumnId: z.uuid(),
  beforeTaskId: z.uuid().nullable().default(null),
  afterTaskId: z.uuid().nullable().default(null),
  expectedVersion: z.number().int().nonnegative(),
}).refine(({ beforeTaskId, afterTaskId }) => beforeTaskId === null || afterTaskId === null, {
  message: "Specify at most one neighboring task.",
});

export const createConductorRunInputSchema = z.object({
  workspaceId: z.uuid(),
  taskId: z.uuid(),
  spec: conductorSpecSchema,
});
export const conductorRunCommandInputSchema = z.object({
  workspaceId: z.uuid(),
  runId: z.uuid(),
});
export const retryConductorRunInputSchema = conductorRunCommandInputSchema;

export const workflowContextSchema = z.object({
  workspaceId: z.uuid(),
  taskId: z.uuid(),
  origin: z.enum(["conversation", "approved_plan"]),
  sourceMessageId: z.uuid().nullable().default(null),
  planRevisionId: z.uuid().nullable().default(null),
  dedupeKey: z.string().trim().min(1).max(500),
  required: z.boolean().default(false),
});
export type WorkflowContext = z.infer<typeof workflowContextSchema>;

export const workflowSubmissionResultSchema = z.object({
  runId: z.uuid(),
  status: z.enum(["running", "existing"]),
});
export type WorkflowSubmissionResult = z.infer<typeof workflowSubmissionResultSchema>;

export const providerConfigSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const setProviderCredentialInputSchema = providerConfigSchema.extend({
  apiKey: z.string().trim().min(1).max(10_000),
});
export type SetProviderCredentialInput = z.infer<typeof setProviderCredentialInputSchema>;

export const agentRuntimeSchema = z.object({
  cwd: z.string().min(1),
  agentDir: z.string().min(1),
  environment: z.record(z.string().min(1), z.string()).optional(),
});
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;

export const managedCliPackageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  installedPath: z.string().min(1),
  bins: z.array(z.string().min(1)),
});
export type ManagedCliPackage = z.infer<typeof managedCliPackageSchema>;

export const installManagedCliInputSchema = z.object({
  packageSpec: z.string().trim().min(1).max(1_024),
});

export const updateManagedCliInputSchema = z.object({
  name: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(240).optional(),
});

export const removeManagedCliInputSchema = z.object({
  name: z.string().trim().min(1).max(240),
});

const runtimeEnvironmentSchema = z.record(z.string().min(1).max(256), z.string().max(100_000))
  .refine((environment) => Object.keys(environment).length <= 200, "Too many environment variables.");

export const executeManagedCliInputSchema = z.object({
  command: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  args: z.array(z.string().max(100_000)).max(1_000).default([]),
  cwd: z.string().min(1).optional(),
  sessionId: z.uuid().optional(),
  env: runtimeEnvironmentSchema.optional(),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1_000).optional(),
});

export const managedCliExecutionResultSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
});
export type ManagedCliExecutionResult = z.infer<typeof managedCliExecutionResultSchema>;

export const setSessionEnvironmentInputSchema = z.object({
  sessionId: z.uuid(),
  environment: runtimeEnvironmentSchema,
});

export const sessionEnvironmentInputSchema = z.object({
  sessionId: z.uuid(),
});

export const extensionPackageSchema = z.object({
  source: z.string().min(1),
  installedPath: z.string().nullable(),
});
export type ExtensionPackage = z.infer<typeof extensionPackageSchema>;

export const extensionSourceSchema = z.string().trim().min(1).max(4_096);

export const modelOptionSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  modelId: z.string().min(1),
  modelName: z.string().min(1),
  thinkingLevels: z.array(thinkingLevelSchema),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const modelCatalogSchema = z.object({
  models: z.array(modelOptionSchema),
  diagnostics: z.array(z.string()),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

export const modelTestTargetSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
});
export type ModelTestTarget = z.infer<typeof modelTestTargetSchema>;

export const modelTestResultSchema = modelTestTargetSchema.extend({
  testedAt: z.string().datetime(),
  success: z.boolean(),
  message: z.string().min(1).max(500),
});
export type ModelTestResult = z.infer<typeof modelTestResultSchema>;

export const testModelsInputSchema = z.object({
  models: z.array(modelTestTargetSchema).min(1).max(50),
});

export const conversationSchema = z.object({
  workspace: workspaceSchema,
  task: taskSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const updateConversationModelInputSchema = z.object({
  taskId: z.uuid(),
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  thinkingLevel: thinkingLevelSchema,
});

export const removeConversationInputSchema = z.object({
  taskId: z.uuid(),
});

export const appSettingsSchema = z.object({
  onboardingSkipped: z.boolean(),
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: thinkingLevelSchema,
  theme: z.enum(["system", "light", "dark"]).default("system"),
  language: z.enum(["en", "zh-CN"]).default("en"),
  sidebarCollapsed: z.boolean().default(false),
  focusMode: z.boolean().default(false),
  compactMode: z.boolean().default(false),
  disabledModelKeys: z.array(z.string().trim().min(1).max(260)).default([]),
  modelTestResults: z.record(z.string().min(1).max(260), modelTestResultSchema).default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsInputSchema = z.object({
  onboardingSkipped: z.boolean().optional(),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  language: z.enum(["en", "zh-CN"]).optional(),
  sidebarCollapsed: z.boolean().optional(),
  focusMode: z.boolean().optional(),
  compactMode: z.boolean().optional(),
  disabledModelKeys: z.array(z.string().trim().min(1).max(260)).optional(),
  modelTestResults: z.record(z.string().min(1).max(260), modelTestResultSchema).optional(),
});

export const toolApprovalSchema = z.object({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  approvalId: z.uuid(),
  tool: z.enum(["edit", "write", "bash"]),
  arguments: z.record(z.string(), z.unknown()),
  cwd: z.string().min(1),
});
export type ToolApproval = z.infer<typeof toolApprovalSchema>;

export const resolveToolApprovalInputSchema = z.object({
  approvalId: z.uuid(),
  approved: z.boolean(),
});

export const approvePlanInputSchema = z.object({
  taskId: z.uuid(),
  planRevisionId: z.uuid(),
  action: planApprovalActionSchema.default("approve_and_execute"),
});

export const retryApprovedPlanInputSchema = z.object({
  taskId: z.uuid(),
  planRevisionId: z.uuid(),
});

export const executeApprovedPlanInputSchema = z.object({
  taskId: z.uuid(),
  planRevisionId: z.uuid(),
  mode: planExecutionModeSchema,
});

export const planStepUpdateInputSchema = z.object({
  stepId: z.uuid(),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  verificationResults: z.array(planVerificationResultSchema).optional(),
  note: z.string().trim().min(1).max(10_000).optional(),
});
export type PlanStepUpdateInput = z.infer<typeof planStepUpdateInputSchema>;

export const planExecutionContextSchema = z.object({
  executionId: z.uuid(),
  planRevisionId: z.uuid(),
  steps: z.array(planRevisionStepSchema),
});
export type PlanExecutionContext = z.infer<typeof planExecutionContextSchema>;

export const createArtifactInputSchema = z.object({
  taskId: z.uuid(),
  relativePath: z.string().min(1).max(240),
  content: z.string().max(2_000_000),
  mimeType: z.string().default("text/markdown"),
});

export const publishArtifactInputSchema = z.object({
  artifactId: z.uuid(),
});

export const abortTaskInputSchema = z.object({
  taskId: z.uuid(),
});

export const completeTaskInputSchema = z.object({
  taskId: z.uuid(),
});

export const resumeTaskInputSchema = z.object({
  taskId: z.uuid(),
});

export const agentRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("health"), requestId: z.uuid() }),
  z.object({
    type: z.literal("plan"),
    requestId: z.uuid(),
    task: z.object({ id: z.uuid(), title: z.string(), goal: z.string() }),
    conversation: z.array(z.object({
      id: z.uuid(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      createdAt: z.string().datetime(),
    })).max(200),
    previousPlan: planRevisionSchema.nullable(),
    feedbackMessageId: z.uuid().nullable(),
    provider: setProviderCredentialInputSchema.optional(),
    modelId: z.string().min(1),
    thinkingLevel: thinkingLevelSchema,
    runtime: agentRuntimeSchema,
  }),
  z.object({
    type: z.literal("title"),
    requestId: z.uuid(),
    prompt: z.string().min(1).max(100_000),
    response: z.string().min(1).max(100_000),
    provider: setProviderCredentialInputSchema.optional(),
    modelId: z.string().min(1),
    thinkingLevel: thinkingLevelSchema,
    runtime: agentRuntimeSchema,
  }),
  z.object({
    type: z.literal("chat"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
    messages: z.array(chatMessageSchema.pick({ role: true, content: true })).min(1),
    images: z.array(agentImageAttachmentSchema).max(20).default([]),
    provider: setProviderCredentialInputSchema.optional(),
    modelId: z.string().min(1),
    thinkingLevel: thinkingLevelSchema,
    permissionMode: permissionModeSchema.default("ask"),
    runtime: agentRuntimeSchema,
    mcpServers: z.array(mcpRuntimeServerSchema).default([]),
    workflowContext: workflowContextSchema.nullable().default(null),
    planExecution: planExecutionContextSchema.nullable().default(null),
  }),
  z.object({
    type: z.literal("cancel"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({
    type: z.literal("tool.resolve"),
    requestId: z.uuid(),
    approvalId: z.uuid(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("workflow.resolve"),
    requestId: z.uuid(),
    workflowRequestId: z.uuid(),
    result: workflowSubmissionResultSchema.optional(),
    error: z.string().optional(),
  }).refine(({ result, error }) => (result === undefined) !== (error === undefined), {
    message: "Provide either a workflow result or an error.",
  }),
  z.object({ type: z.literal("extension.list"), requestId: z.uuid(), runtime: agentRuntimeSchema }),
  z.object({
    type: z.literal("extension.install"),
    requestId: z.uuid(),
    runtime: agentRuntimeSchema,
    source: extensionSourceSchema,
  }),
  z.object({
    type: z.literal("extension.remove"),
    requestId: z.uuid(),
    runtime: agentRuntimeSchema,
    source: extensionSourceSchema,
  }),
  z.object({ type: z.literal("model.list"), requestId: z.uuid(), runtime: agentRuntimeSchema }),
  z.object({
    type: z.literal("model.test"),
    requestId: z.uuid(),
    provider: setProviderCredentialInputSchema,
    modelId: z.string().min(1),
    runtime: agentRuntimeSchema,
  }),
  z.object({
    type: z.literal("mcp.inspect"),
    requestId: z.uuid(),
    server: mcpRuntimeServerSchema,
    runtime: agentRuntimeSchema,
  }),
  z.object({
    type: z.literal("mcp.call-tool"),
    requestId: z.uuid(),
    server: mcpRuntimeServerSchema,
    runtime: agentRuntimeSchema,
    toolName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
]);
export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const agentMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("health"),
    requestId: z.uuid(),
    piSdkAvailable: z.boolean(),
  }),
  z.object({
    type: z.literal("plan"),
    requestId: z.uuid(),
    result: planningResultSchema,
  }),
  z.object({
    type: z.literal("title"),
    requestId: z.uuid(),
    title: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal("chat"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
    content: z.string(),
    cancelled: z.boolean(),
  }),
  z.object({
    type: z.literal("cancelled"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
  }),
  z.object({
    type: z.literal("mcp.inspect"),
    requestId: z.uuid(),
    result: mcpInspectResultSchema,
  }),
  z.object({
    type: z.literal("mcp.call-tool"),
    requestId: z.uuid(),
    result: mcpCallToolResultSchema,
  }),
  z.object({
    type: z.literal("extensions"),
    requestId: z.uuid(),
    packages: z.array(extensionPackageSchema),
  }),
  z.object({
    type: z.literal("models"),
    requestId: z.uuid(),
  }).extend(modelCatalogSchema.shape),
  z.object({
    type: z.literal("model.test"),
    requestId: z.uuid(),
    message: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("error"),
    requestId: z.uuid(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("workflow.submit"),
    requestId: z.uuid(),
    workflowRequestId: z.uuid(),
    sessionId: z.uuid(),
    context: workflowContextSchema,
    draft: workflowDraftSchema,
  }),
  toolApprovalSchema.extend({ type: z.literal("tool.approval") }),
  z.object({
    type: z.literal("event"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
    event: z.object({
      sequence: z.number().int().nonnegative(),
      kind: z.enum(["text_delta", "thinking", "tool_call", "tool_update", "tool_result", "file_change", "runtime", "approval", "usage", "error", "completed", "cancelled"]),
      payload: z.record(z.string(), z.unknown()),
      timestamp: z.string().datetime(),
    }),
  }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentResponse = Exclude<AgentMessage, { type: "tool.approval" | "event" | "workflow.submit" }>;
export const agentResponseSchema = agentMessageSchema;

export const eventSchema = z.object({
  protocolVersion: z.literal(1),
  workspaceId: z.uuid().nullable().default(null),
  taskId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: z.enum([
    "task.created",
    "session.updated",
    "plan.proposed",
    "plan.superseded",
    "plan.approved",
    "plan.rejected",
    "plan.execution_started",
    "plan.execution_retried",
    "plan.step_updated",
    "plan.execution_completed",
    "plan.execution_failed",
    "plan.execution_cancelled",
    "artifact.staged",
    "artifact.published",
    "task.completed",
    "task.cancelled",
    "board.card_moved",
    "run.created",
    "run.started",
    "run.paused",
    "run.resumed",
    "run.cancelled",
    "run.completed",
    "run.failed",
    "run.node_updated",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
export type WorkEvent = z.infer<typeof eventSchema>;

// --- Observability (Langfuse) ---------------------------------------------

export const observabilitySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().max(500).default(""),
  publicKey: z.string().trim().max(200).default(""),
  captureContent: z.boolean().default(true),
  // Never carries the real secret to the renderer: masked (e.g. "sk-lf-••••4b79")
  // when a secret is stored, empty string otherwise.
  secretKeyMasked: z.string().max(200).default(""),
  hasSecretKey: z.boolean().default(false),
  // True when any field is overridden by a LANGFUSE_* environment variable.
  envOverride: z.boolean().default(false),
});
export type ObservabilitySettings = z.infer<typeof observabilitySettingsSchema>;

export const updateObservabilitySettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().trim().max(500).optional(),
  publicKey: z.string().trim().max(200).optional(),
  captureContent: z.boolean().optional(),
  // Presence means "replace"; empty string clears the stored secret; omitted keeps it.
  secretKey: z.string().max(200).optional(),
});
export type UpdateObservabilitySettingsInput = z.infer<typeof updateObservabilitySettingsInputSchema>;

export const modelUsageSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workspaceId: z.string().nullable(),
  requestId: z.string(),
  messageId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  responseModel: z.string().nullable(),
  api: z.string().nullable(),
  stopReason: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  inputCost: z.number().nonnegative(),
  outputCost: z.number().nonnegative(),
  cacheReadCost: z.number().nonnegative(),
  cacheWriteCost: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
  createdAt: z.string(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;

export const recordModelUsageInputSchema = modelUsageSchema.omit({ id: true, createdAt: true }).extend({
  workspaceId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  responseModel: z.string().nullable().default(null),
  api: z.string().nullable().default(null),
  stopReason: z.string().nullable().default(null),
});
export type RecordModelUsageInput = z.infer<typeof recordModelUsageInputSchema>;

export const usageQueryInputSchema = z.object({
  // ISO date/time lower bound (inclusive), or null for all-time.
  since: z.string().nullable().default(null),
  until: z.string().nullable().default(null),
  workspaceId: z.string().nullable().default(null),
});
export type UsageQueryInput = z.infer<typeof usageQueryInputSchema>;

export const usageTotalsSchema = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  reasoningTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const usageByModelSchema = usageTotalsSchema.extend({
  provider: z.string(),
  model: z.string(),
});
export type UsageByModel = z.infer<typeof usageByModelSchema>;

export const usageByDaySchema = usageTotalsSchema.extend({
  day: z.string(),
});
export type UsageByDay = z.infer<typeof usageByDaySchema>;

export const usageByModelDaySchema = usageTotalsSchema.extend({
  day: z.string(),
  provider: z.string(),
  model: z.string(),
});
export type UsageByModelDay = z.infer<typeof usageByModelDaySchema>;

export const usageByHourSchema = usageTotalsSchema.extend({
  hour: z.string(),
});
export type UsageByHour = z.infer<typeof usageByHourSchema>;

export const usageByModelHourSchema = usageTotalsSchema.extend({
  hour: z.string(),
  provider: z.string(),
  model: z.string(),
});
export type UsageByModelHour = z.infer<typeof usageByModelHourSchema>;

export const usageSummarySchema = z.object({
  totals: usageTotalsSchema,
  byModel: z.array(usageByModelSchema),
  byDay: z.array(usageByDaySchema),
  byModelDay: z.array(usageByModelDaySchema),
  byHour: z.array(usageByHourSchema),
  byModelHour: z.array(usageByModelHourSchema),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const observabilityStoredConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().max(500).default(""),
  publicKey: z.string().trim().max(200).default(""),
  captureContent: z.boolean().default(true),
});
export type ObservabilityStoredConfig = z.infer<typeof observabilityStoredConfigSchema>;
