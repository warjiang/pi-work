import { z } from "zod";

export const taskStatuses = [
  "draft",
  "planning",
  "awaiting_plan_approval",
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
  createdAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

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
});
export type StatusDefinition = z.infer<typeof statusDefinitionSchema>;

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

export const skillSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  instructions: z.string().max(100_000),
  enabled: z.boolean(),
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

export const generatePlanInputSchema = z.object({
  taskId: z.uuid(),
});

export const sendChatInputSchema = z.object({
  workspaceId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  content: z.string().trim().min(1).max(100_000),
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  thinkingLevel: thinkingLevelSchema,
  permissionMode: permissionModeSchema.optional(),
  planMode: z.boolean().optional(),
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
  id: z.uuid(),
  value: z.record(z.string(), z.unknown()),
});

export const removeDomainEntityInputSchema = z.object({ id: z.uuid() });

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
});
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;

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
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsInputSchema = appSettingsSchema.partial();

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
  approved: z.boolean(),
});

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
    plan: planSchema,
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
    type: z.literal("extensions"),
    requestId: z.uuid(),
    packages: z.array(extensionPackageSchema),
  }),
  z.object({
    type: z.literal("models"),
    requestId: z.uuid(),
  }).extend(modelCatalogSchema.shape),
  z.object({
    type: z.literal("error"),
    requestId: z.uuid(),
    message: z.string(),
  }),
  toolApprovalSchema.extend({ type: z.literal("tool.approval") }),
  z.object({
    type: z.literal("event"),
    requestId: z.uuid(),
    sessionId: z.uuid(),
    event: z.object({
      sequence: z.number().int().nonnegative(),
      kind: z.enum(["text_delta", "thinking", "tool_call", "tool_update", "tool_result", "file_change", "runtime", "approval", "error", "completed", "cancelled"]),
      payload: z.record(z.string(), z.unknown()),
      timestamp: z.string().datetime(),
    }),
  }),
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentResponse = Exclude<AgentMessage, { type: "tool.approval" | "event" }>;
export const agentResponseSchema = agentMessageSchema;

export const eventSchema = z.object({
  protocolVersion: z.literal(1),
  taskId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: z.enum([
    "task.created",
    "session.updated",
    "plan.proposed",
    "plan.approved",
    "plan.rejected",
    "artifact.staged",
    "artifact.published",
    "task.completed",
    "task.cancelled",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
export type WorkEvent = z.infer<typeof eventSchema>;
