import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
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
