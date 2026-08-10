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

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

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

export const createTaskInputSchema = z.object({
  workspaceId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(10_000),
});

export const sendChatInputSchema = z.object({
  workspaceId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  content: z.string().trim().min(1).max(100_000),
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
  thinkingLevel: thinkingLevelSchema,
});

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
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const updateAppSettingsInputSchema = appSettingsSchema.partial();

export const toolApprovalSchema = z.object({
  requestId: z.uuid(),
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
    messages: z.array(chatMessageSchema.pick({ role: true, content: true })).min(1),
    provider: setProviderCredentialInputSchema.optional(),
    modelId: z.string().min(1),
    thinkingLevel: thinkingLevelSchema,
    runtime: agentRuntimeSchema,
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
    content: z.string().min(1),
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
]);
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentResponse = Exclude<AgentMessage, { type: "tool.approval" }>;
export const agentResponseSchema = agentMessageSchema;

export const eventSchema = z.object({
  protocolVersion: z.literal(1),
  taskId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  type: z.enum([
    "task.created",
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
