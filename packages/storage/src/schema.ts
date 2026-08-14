import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  directories: text("directories").notNull(),
  outputPath: text("output_path").notNull(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  thinkingLevel: text("thinking_level").notNull(),
  kind: text("kind").notNull(),
  archived: text("archived").notNull(),
  flagged: text("flagged").notNull(),
  unread: text("unread").notNull(),
  statusId: text("status_id"),
  labelIds: text("label_ids").notNull(),
  permissionMode: text("permission_mode").notNull(),
  planMode: text("plan_mode").notNull(),
  workingDirectory: text("working_directory"),
  running: text("running").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const plans = sqliteTable("plans", {
  taskId: text("task_id").primaryKey(),
  value: text("value").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  relativePath: text("relative_path").notNull(),
  mimeType: text("mime_type").notNull(),
  stagedPath: text("staged_path").notNull(),
  publishedPath: text("published_path"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  sequence: text("sequence").notNull(),
  value: text("value").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const domainEntities = sqliteTable("domain_entities", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull(),
  workspaceId: text("workspace_id"),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  messageId: text("message_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  metadata: text("metadata").notNull(),
  createdAt: text("created_at").notNull(),
});

export const modelUsage = sqliteTable("model_usage", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  workspaceId: text("workspace_id"),
  requestId: text("request_id").notNull(),
  messageId: text("message_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  responseModel: text("response_model"),
  api: text("api"),
  stopReason: text("stop_reason"),
  inputTokens: text("input_tokens").notNull(),
  outputTokens: text("output_tokens").notNull(),
  cacheReadTokens: text("cache_read_tokens").notNull(),
  cacheWriteTokens: text("cache_write_tokens").notNull(),
  reasoningTokens: text("reasoning_tokens").notNull(),
  totalTokens: text("total_tokens").notNull(),
  inputCost: text("input_cost").notNull(),
  outputCost: text("output_cost").notNull(),
  cacheReadCost: text("cache_read_cost").notNull(),
  cacheWriteCost: text("cache_write_cost").notNull(),
  totalCost: text("total_cost").notNull(),
  createdAt: text("created_at").notNull(),
});

export const telemetryOutbox = sqliteTable("telemetry_outbox", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  attempts: text("attempts").notNull(),
  nextAttemptAt: text("next_attempt_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  messageId: text("message_id"),
  name: text("name").notNull(),
  path: text("path").notNull(),
  mimeType: text("mime_type").notNull(),
  size: text("size").notNull(),
  createdAt: text("created_at").notNull(),
});
