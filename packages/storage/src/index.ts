import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type {
  AppSettings,
  Artifact,
  ChatMessage,
  Conversation,
  Plan,
  Run,
  Task,
  TaskStatus,
  ThinkingLevel,
  WorkEvent,
  Workspace,
  WorkspaceKind,
} from "@pi-work/protocol";
import {
  appSettingsSchema,
  artifactSchema,
  chatMessageSchema,
  eventSchema,
  planSchema,
  runSchema,
  taskSchema,
  workspaceSchema,
} from "@pi-work/protocol";
import { appSettings, artifacts, events, messages, plans, runs, tasks, workspaces } from "./schema.js";

function timestamp(): string {
  return new Date().toISOString();
}

export class PiWorkStore {
  private readonly sqlite: Database.Database;
  private readonly db;

  constructor(filename = ":memory:") {
    this.sqlite = new Database(filename);
    this.db = drizzle(this.sqlite);
    this.migrate();
  }

  close(): void {
    this.sqlite.close();
  }

  createWorkspace(input: {
    name: string;
    rootPath: string;
    outputPath: string;
    kind?: WorkspaceKind;
    id?: string;
  }): Workspace {
    const workspace = workspaceSchema.parse({
      id: input.id ?? randomUUID(),
      ...input,
      kind: input.kind ?? "folder",
      createdAt: timestamp(),
    });
    this.db.insert(workspaces).values(workspace).run();
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return this.db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).all().map((row) => workspaceSchema.parse(row));
  }

  getWorkspace(workspaceId: string): Workspace | null {
    const row = this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    return row === undefined ? null : workspaceSchema.parse(row);
  }

  createTask(input: {
    workspaceId: string;
    title: string;
    goal: string;
    providerId?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel;
    id?: string;
  }): Task {
    const createdAt = timestamp();
    const task = taskSchema.parse({
      id: input.id ?? randomUUID(),
      ...input,
      status: "draft",
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? "off",
      createdAt,
      updatedAt: createdAt,
    });
    this.db.insert(tasks).values(task).run();
    this.createRun(task.id, task.status);
    this.appendEvent(task.id, "task.created", { title: task.title });
    return task;
  }

  updateTaskGoal(taskId: string, goal: string): Task {
    this.requireTask(taskId);
    this.db.update(tasks).set({ goal, updatedAt: timestamp() }).where(eq(tasks.id, taskId)).run();
    return this.requireTask(taskId);
  }

  addMessage(input: Pick<ChatMessage, "taskId" | "role" | "content">): ChatMessage {
    this.requireTask(input.taskId);
    const message = chatMessageSchema.parse({
      id: randomUUID(),
      ...input,
      createdAt: timestamp(),
    });
    this.db.insert(messages).values(message).run();
    return message;
  }

  listMessages(taskId: string): ChatMessage[] {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.taskId, taskId))
      .orderBy(asc(messages.createdAt))
      .all()
      .map((row) => chatMessageSchema.parse(row));
  }

  getTask(taskId: string): Task | null {
    const row = this.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    return row === undefined ? null : taskSchema.parse(row);
  }

  listManagedConversations(): Conversation[] {
    const managed = this.db.select().from(workspaces)
      .where(eq(workspaces.kind, "managed"))
      .orderBy(desc(workspaces.createdAt))
      .all();
    return managed.flatMap((workspaceRow) => {
      const taskRow = this.db.select().from(tasks)
        .where(eq(tasks.workspaceId, workspaceRow.id))
        .orderBy(asc(tasks.createdAt))
        .get();
      return taskRow === undefined ? [] : [{
        workspace: workspaceSchema.parse(workspaceRow),
        task: taskSchema.parse(taskRow),
      }];
    });
  }

  updateTaskModel(
    taskId: string,
    input: { providerId: string; modelId: string; thinkingLevel: ThinkingLevel },
  ): Task {
    this.requireTask(taskId);
    this.db.update(tasks).set({
      providerId: input.providerId,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      updatedAt: timestamp(),
    }).where(eq(tasks.id, taskId)).run();
    return this.requireTask(taskId);
  }

  removeConversation(taskId: string): { task: Task; workspace: Workspace } {
    const task = this.requireTask(taskId);
    const workspace = this.getWorkspace(task.workspaceId);
    if (workspace === null) {
      throw new Error(`Unknown workspace: ${task.workspaceId}`);
    }
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM events WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM messages WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM plans WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM runs WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
      if (workspace.kind === "managed") {
        this.sqlite.prepare("DELETE FROM workspaces WHERE id = ?").run(workspace.id);
      }
    });
    transaction();
    return { task, workspace };
  }

  getAppSettings(): AppSettings {
    const values = Object.fromEntries(
      this.db.select().from(appSettings).all().map(({ key, value }) => [key, JSON.parse(value)]),
    );
    return appSettingsSchema.parse({
      onboardingSkipped: false,
      providerId: null,
      modelId: null,
      thinkingLevel: "off",
      ...values,
    });
  }

  updateAppSettings(input: { [Key in keyof AppSettings]?: AppSettings[Key] | undefined }): AppSettings {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      this.db.insert(appSettings).values({ key, value: JSON.stringify(value) }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(value) },
      }).run();
    }
    return this.getAppSettings();
  }

  listTasks(workspaceId: string): Task[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
      .orderBy(asc(tasks.createdAt))
      .all()
      .map((row) => taskSchema.parse(row));
  }

  getLatestRun(taskId: string): Run | null {
    const row = this.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(asc(runs.createdAt))
      .all()
      .at(-1);
    return row === undefined ? null : runSchema.parse(row);
  }

  listRuns(taskId: string): Run[] {
    return this.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(asc(runs.createdAt))
      .all()
      .map((row) => runSchema.parse(row));
  }

  savePlan(plan: Plan): Plan {
    const parsed = planSchema.parse(plan);
    this.db.insert(plans).values({ taskId: parsed.taskId, value: JSON.stringify(parsed) }).onConflictDoUpdate({
      target: plans.taskId,
      set: { value: JSON.stringify(parsed) },
    }).run();
    this.updateTaskStatus(parsed.taskId, "awaiting_plan_approval");
    this.appendEvent(parsed.taskId, "plan.proposed", { summary: parsed.summary });
    return parsed;
  }

  getPlan(taskId: string): Plan | null {
    const row = this.db.select().from(plans).where(eq(plans.taskId, taskId)).get();
    return row === undefined ? null : planSchema.parse(JSON.parse(row.value));
  }

  approvePlan(taskId: string, approved: boolean): Task {
    const nextStatus: TaskStatus = approved ? "running" : "planning";
    const task = this.updateTaskStatus(taskId, nextStatus);
    this.appendEvent(taskId, approved ? "plan.approved" : "plan.rejected", {});
    return task;
  }

  createArtifact(input: Omit<Artifact, "id" | "publishedPath" | "createdAt">): Artifact {
    const task = this.requireTask(input.taskId);
    if (task.status !== "running") {
      throw new Error("Artifacts can only be created after an approved plan.");
    }
    const artifact = artifactSchema.parse({
      ...input,
      id: randomUUID(),
      publishedPath: null,
      createdAt: timestamp(),
    });
    this.db.insert(artifacts).values(artifact).run();
    this.appendEvent(artifact.taskId, "artifact.staged", { artifactId: artifact.id, relativePath: artifact.relativePath });
    return artifact;
  }

  getArtifact(artifactId: string): Artifact | null {
    const row = this.db.select().from(artifacts).where(eq(artifacts.id, artifactId)).get();
    return row === undefined ? null : artifactSchema.parse(row);
  }

  listArtifacts(taskId: string): Artifact[] {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .orderBy(asc(artifacts.createdAt))
      .all()
      .map((row) => artifactSchema.parse(row));
  }

  publishArtifact(artifactId: string, publishedPath: string): Artifact {
    const artifact = this.getArtifact(artifactId);
    if (artifact === null) {
      throw new Error(`Unknown artifact: ${artifactId}`);
    }
    this.db.update(artifacts).set({ publishedPath }).where(eq(artifacts.id, artifactId)).run();
    const published = artifactSchema.parse({ ...artifact, publishedPath });
    this.appendEvent(artifact.taskId, "artifact.published", { artifactId, publishedPath });
    return published;
  }

  cancelTask(taskId: string): Task {
    const task = this.updateTaskStatus(taskId, "cancelled");
    this.appendEvent(taskId, "task.cancelled", {});
    return task;
  }

  completeTask(taskId: string): Task {
    const task = this.updateTaskStatus(taskId, "completed");
    this.appendEvent(taskId, "task.completed", {});
    return task;
  }

  resumeTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.status === "completed" || task.status === "cancelled" || task.status === "failed") {
      throw new Error(`Task cannot be resumed from ${task.status}.`);
    }
    return this.updateTaskStatus(taskId, task.status);
  }

  listEvents(taskId: string): WorkEvent[] {
    return this.db
      .select()
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(asc(events.sequence))
      .all()
      .map((row) => eventSchema.parse(JSON.parse(row.value)));
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (task === null) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }

  private updateTaskStatus(taskId: string, status: TaskStatus): Task {
    this.requireTask(taskId);
    const updatedAt = timestamp();
    this.db.update(tasks).set({ status, updatedAt }).where(eq(tasks.id, taskId)).run();
    const run = this.getLatestRun(taskId);
    if (run === null) {
      throw new Error(`Task ${taskId} has no run.`);
    }
    this.db.update(runs).set({
      status,
      updatedAt,
      completedAt: status === "completed" || status === "cancelled" || status === "failed" ? updatedAt : null,
    }).where(eq(runs.id, run.id)).run();
    const task = this.getTask(taskId);
    if (task === null) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }

  private createRun(taskId: string, status: TaskStatus): Run {
    const createdAt = timestamp();
    const run = runSchema.parse({
      id: randomUUID(),
      taskId,
      status,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    });
    this.db.insert(runs).values(run).run();
    return run;
  }

  private appendEvent(taskId: string, type: WorkEvent["type"], payload: Record<string, unknown>): void {
    const nextSequence = this.db.select().from(events).where(eq(events.taskId, taskId)).all().length;
    const event = eventSchema.parse({
      protocolVersion: 1,
      taskId,
      sequence: nextSequence,
      timestamp: timestamp(),
      type,
      payload,
    });
    this.db.insert(events).values({
      id: randomUUID(),
      taskId,
      sequence: String(event.sequence),
      value: JSON.stringify(event),
    }).run();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'folder',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        thinking_level TEXT NOT NULL DEFAULT 'off',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        task_id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        staged_path TEXT NOT NULL,
        published_path TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        sequence TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    this.addColumn("workspaces", "kind", "TEXT NOT NULL DEFAULT 'folder'");
    this.addColumn("tasks", "provider_id", "TEXT");
    this.addColumn("tasks", "model_id", "TEXT");
    this.addColumn("tasks", "thinking_level", "TEXT NOT NULL DEFAULT 'off'");
  }

  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === column)) {
      this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
