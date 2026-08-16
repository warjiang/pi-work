import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  directories: text("directories").notNull(),
  outputPath: text("output_path").notNull(),
  kind: text("kind").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const workspaceDirectories = sqliteTable("workspace_directories", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  path: text("path").notNull(),
  canonicalPath: text("canonical_path").notNull(),
  isRoot: integer("is_root", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("workspace_directories_canonical").on(table.canonicalPath),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: text("project_id"),
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
  sequence: integer("sequence").notNull(),
  value: text("value").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#8a8275"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  projectId: text("project_id"),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const boardColumns = sqliteTable("board_columns", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  boardId: text("board_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  position: integer("position").notNull(),
  statusIds: text("status_ids").notNull().default("[]"),
  dropStatusId: text("drop_status_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const taskBoardState = sqliteTable("task_board_state", {
  taskId: text("task_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  boardId: text("board_id").notNull(),
  columnId: text("column_id").notNull(),
  rank: integer("rank").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.boardId] }),
  uniqueIndex("task_board_state_rank").on(table.boardId, table.columnId, table.rank),
]);

export const commandReceipts = sqliteTable("command_receipts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  kind: text("kind").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
});

export const workspaceEvents = sqliteTable("workspace_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  entityId: text("entity_id"),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("workspace_events_sequence").on(table.workspaceId, table.sequence),
]);

export const conductorRuns = sqliteTable("conductor_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id").notNull(),
  status: text("status").notNull(),
  spec: text("spec").notNull(),
  lastEventSequence: integer("last_event_sequence").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

export const conductorNodeStates = sqliteTable("conductor_node_states", {
  runId: text("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  output: text("output"),
  error: text("error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.nodeId] }),
]);

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
