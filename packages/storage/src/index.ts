import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Artifact, Plan, Run, Task, TaskStatus, WorkEvent, Workspace } from "@pi-work/protocol";
import {
  artifactSchema,
  eventSchema,
  planSchema,
  runSchema,
  taskSchema,
  workspaceSchema,
} from "@pi-work/protocol";
import { artifacts, events, plans, runs, tasks, workspaces } from "./schema.js";

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

  createWorkspace(input: { name: string; rootPath: string; outputPath: string }): Workspace {
    const workspace = workspaceSchema.parse({
      id: randomUUID(),
      ...input,
      createdAt: timestamp(),
    });
    this.db.insert(workspaces).values(workspace).run();
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return this.db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).all().map((row) => workspaceSchema.parse(row));
  }

  createTask(input: { workspaceId: string; title: string; goal: string }): Task {
    const createdAt = timestamp();
    const task = taskSchema.parse({
      id: randomUUID(),
      ...input,
      status: "planning",
      createdAt,
      updatedAt: createdAt,
    });
    this.db.insert(tasks).values(task).run();
    this.createRun(task.id, task.status);
    this.appendEvent(task.id, "task.created", { title: task.title });
    return task;
  }

  getTask(taskId: string): Task | null {
    const row = this.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    return row === undefined ? null : taskSchema.parse(row);
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
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        task_id TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
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
    `);
  }
}
