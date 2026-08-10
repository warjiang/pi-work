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

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  outputPath: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const taskSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  title: z.string().min(1).max(160),
  goal: z.string().min(1),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

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

export const providerConfigSchema = z.object({
  providerId: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(160),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const setProviderCredentialInputSchema = providerConfigSchema.extend({
  apiKey: z.string().trim().min(1).max(10_000),
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
  z.object({ type: z.literal("health") }),
  z.object({
    type: z.literal("plan"),
    task: z.object({ id: z.uuid(), title: z.string(), goal: z.string() }),
    provider: setProviderCredentialInputSchema.optional(),
  }),
]);

export const agentResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("health"),
    piSdkAvailable: z.boolean(),
  }),
  z.object({
    type: z.literal("plan"),
    plan: planSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);

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
