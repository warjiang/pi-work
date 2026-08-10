import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type {
  Activity,
  AppSettings,
  Artifact,
  Attachment,
  Automation,
  AutomationRun,
  BrowserTab,
  ChatMessage,
  Conversation,
  Label,
  Plan,
  Project,
  Run,
  SavedView,
  Session,
  Skill,
  Source,
  StatusDefinition,
  Subtask,
  Task,
  TaskStatus,
  ThinkingLevel,
  WorkEvent,
  Workspace,
  WorkspaceKind,
} from "@pi-work/protocol";
import {
  activitySchema,
  appSettingsSchema,
  artifactSchema,
  attachmentSchema,
  automationRunSchema,
  automationSchema,
  browserTabSchema,
  chatMessageSchema,
  eventSchema,
  labelSchema,
  planSchema,
  projectSchema,
  runSchema,
  savedViewSchema,
  skillSchema,
  sourceSchema,
  statusDefinitionSchema,
  subtaskSchema,
  taskSchema,
  workspaceSchema,
} from "@pi-work/protocol";
import {
  activities,
  appSettings,
  artifacts,
  attachments,
  domainEntities,
  events,
  messages,
  plans,
  runs,
  tasks,
  workspaces,
} from "./schema.js";

function timestamp(): string {
  return new Date().toISOString();
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "1";
}

function parseTask(row: typeof tasks.$inferSelect): Task {
  return taskSchema.parse({
    ...row,
    archived: booleanValue(row.archived),
    flagged: booleanValue(row.flagged),
    unread: booleanValue(row.unread),
    labelIds: JSON.parse(row.labelIds) as unknown,
    planMode: booleanValue(row.planMode),
    running: booleanValue(row.running),
  });
}

function taskValues(task: Task): typeof tasks.$inferInsert {
  return {
    ...task,
    archived: task.archived ? "1" : "0",
    flagged: task.flagged ? "1" : "0",
    unread: task.unread ? "1" : "0",
    labelIds: JSON.stringify(task.labelIds),
    planMode: task.planMode ? "1" : "0",
    running: task.running ? "1" : "0",
  };
}

function parseAttachment(row: typeof attachments.$inferSelect): Attachment {
  return attachmentSchema.parse({
    id: row.id,
    sessionId: row.taskId,
    messageId: row.messageId,
    name: row.name,
    path: row.path,
    mimeType: row.mimeType,
    size: Number(row.size),
    createdAt: row.createdAt,
  });
}

type DomainName = "status" | "label" | "view" | "project" | "subtask" | "source" | "skill" | "automation" | "automationRun" | "browserTab";
type DomainValue = StatusDefinition | Label | SavedView | Project | Subtask | Source | Skill | Automation | AutomationRun | BrowserTab;

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
    permissionMode?: Task["permissionMode"];
    planMode?: boolean;
    projectId?: string | null;
    workingDirectory?: string | null;
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
      kind: "chat",
      archived: false,
      flagged: false,
      unread: false,
      statusId: null,
      labelIds: [],
      projectId: input.projectId ?? null,
      permissionMode: input.permissionMode ?? "ask",
      planMode: input.planMode ?? false,
      workingDirectory: input.workingDirectory ?? null,
      running: false,
      createdAt,
      updatedAt: createdAt,
    });
    this.db.insert(tasks).values(taskValues(task)).run();
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
    return row === undefined ? null : parseTask(row);
  }

  getSession(sessionId: string): Session | null {
    return this.getTask(sessionId);
  }

  listSessions(input: {
    query?: string;
    workspaceId?: string | null;
    archived?: boolean;
    flagged?: boolean;
    statusId?: string | null;
    projectId?: string | null;
    labelId?: string;
  } = {}): Session[] {
    const filters = [];
    if (input.workspaceId !== undefined && input.workspaceId !== null) filters.push(eq(tasks.workspaceId, input.workspaceId));
    if (input.archived !== undefined) filters.push(eq(tasks.archived, input.archived ? "1" : "0"));
    if (input.flagged !== undefined) filters.push(eq(tasks.flagged, input.flagged ? "1" : "0"));
    if (input.statusId !== undefined) filters.push(input.statusId === null ? isNull(tasks.statusId) : eq(tasks.statusId, input.statusId));
    if (input.projectId !== undefined) filters.push(input.projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, input.projectId));
    const query = input.query?.trim();
    const rows = filters.length === 0
      ? this.db.select().from(tasks).orderBy(desc(tasks.updatedAt)).all()
      : this.db.select().from(tasks).where(and(...filters)).orderBy(desc(tasks.updatedAt)).all();
    let sessions = rows.map(parseTask);
    if (input.labelId !== undefined) sessions = sessions.filter(({ labelIds }) => labelIds.includes(input.labelId!));
    if (query) {
      const pattern = `%${query}%`;
      const matchingTaskIds = this.sqlite.prepare(
        "SELECT DISTINCT task_id FROM messages WHERE content LIKE ?",
      ).all(pattern) as Array<{ task_id: string }>;
      const ids = new Set(matchingTaskIds.map(({ task_id }) => task_id));
      const lowered = query.toLocaleLowerCase();
      sessions = sessions.filter((session) => (
        session.title.toLocaleLowerCase().includes(lowered)
        || session.goal.toLocaleLowerCase().includes(lowered)
        || ids.has(session.id)
      ));
    }
    return sessions;
  }

  updateSession(sessionId: string, input: Partial<Pick<
    Session,
    "title" | "status" | "archived" | "flagged" | "unread" | "statusId" | "labelIds" | "projectId" | "permissionMode" | "planMode" | "workingDirectory" | "running"
  >>): Session {
    const current = this.requireTask(sessionId);
    const next = taskSchema.parse({ ...current, ...input, updatedAt: timestamp() });
    this.db.update(tasks).set(taskValues(next)).where(eq(tasks.id, sessionId)).run();
    this.appendEvent(sessionId, "session.updated", input);
    return next;
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
        task: parseTask(taskRow),
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
      this.sqlite.prepare("DELETE FROM activities WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM attachments WHERE task_id = ?").run(taskId);
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
      .map(parseTask);
  }

  createDomainEntity<T extends DomainValue>(
    domain: DomainName,
    schema: { parse(value: unknown): T },
    value: unknown,
  ): T {
    const now = timestamp();
    const entity = schema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...(value as Record<string, unknown>),
    });
    this.db.insert(domainEntities).values({
      id: entity.id,
      domain,
      workspaceId: "workspaceId" in entity ? (entity.workspaceId ?? null) : null,
      value: JSON.stringify(entity),
      createdAt: "createdAt" in entity ? String(entity.createdAt) : now,
      updatedAt: "updatedAt" in entity ? String(entity.updatedAt) : now,
    }).run();
    return entity;
  }

  listDomainEntities<T extends DomainValue>(
    domain: DomainName,
    schema: { parse(value: unknown): T },
    workspaceId?: string | null,
  ): T[] {
    const rows = workspaceId === undefined
      ? this.db.select().from(domainEntities).where(eq(domainEntities.domain, domain)).orderBy(asc(domainEntities.createdAt)).all()
      : this.db.select().from(domainEntities).where(and(
        eq(domainEntities.domain, domain),
        workspaceId === null ? isNull(domainEntities.workspaceId) : eq(domainEntities.workspaceId, workspaceId),
      )).orderBy(asc(domainEntities.createdAt)).all();
    return rows.map(({ value }) => schema.parse(JSON.parse(value)));
  }

  updateDomainEntity<T extends DomainValue>(
    domain: DomainName,
    schema: { parse(value: unknown): T },
    id: string,
    input: Partial<T>,
  ): T {
    const row = this.db.select().from(domainEntities).where(and(eq(domainEntities.id, id), eq(domainEntities.domain, domain))).get();
    if (row === undefined) throw new Error(`Unknown ${domain}: ${id}`);
    const current = schema.parse(JSON.parse(row.value));
    const next = schema.parse({ ...current, ...input, id, ...("updatedAt" in current ? { updatedAt: timestamp() } : {}) });
    this.db.update(domainEntities).set({
      value: JSON.stringify(next),
      workspaceId: "workspaceId" in next ? (next.workspaceId ?? null) : null,
      updatedAt: timestamp(),
    }).where(eq(domainEntities.id, id)).run();
    return next;
  }

  removeDomainEntity(domain: DomainName, id: string): void {
    this.db.delete(domainEntities).where(and(eq(domainEntities.id, id), eq(domainEntities.domain, domain))).run();
  }

  createProject(value: Omit<Project, "id" | "createdAt" | "updatedAt">): Project {
    return this.createDomainEntity("project", projectSchema, value);
  }
  listProjects(workspaceId?: string | null): Project[] {
    return this.listDomainEntities("project", projectSchema, workspaceId);
  }
  createSource(value: Omit<Source, "id" | "createdAt" | "updatedAt">): Source {
    return this.createDomainEntity("source", sourceSchema, value);
  }
  listSources(workspaceId?: string | null): Source[] {
    return this.listDomainEntities("source", sourceSchema, workspaceId);
  }
  createSkill(value: Omit<Skill, "id" | "createdAt" | "updatedAt">): Skill {
    return this.createDomainEntity("skill", skillSchema, value);
  }
  listSkills(workspaceId?: string | null): Skill[] {
    return this.listDomainEntities("skill", skillSchema, workspaceId);
  }
  createAutomation(value: Omit<Automation, "id" | "createdAt" | "updatedAt">): Automation {
    return this.createDomainEntity("automation", automationSchema, value);
  }
  listAutomations(workspaceId?: string | null): Automation[] {
    return this.listDomainEntities("automation", automationSchema, workspaceId);
  }
  createStatus(value: StatusDefinition): StatusDefinition {
    return this.createDomainEntity("status", statusDefinitionSchema, value);
  }
  listStatuses(workspaceId?: string | null): StatusDefinition[] {
    return this.listDomainEntities("status", statusDefinitionSchema, workspaceId);
  }
  createLabel(value: Label): Label {
    return this.createDomainEntity("label", labelSchema, value);
  }
  listLabels(workspaceId?: string | null): Label[] {
    return this.listDomainEntities("label", labelSchema, workspaceId);
  }
  createSubtask(value: Subtask): Subtask {
    return this.createDomainEntity("subtask", subtaskSchema, value);
  }
  listSubtasks(sessionId: string): Subtask[] {
    return this.listDomainEntities("subtask", subtaskSchema).filter((item) => item.sessionId === sessionId);
  }

  addActivity(input: Omit<Activity, "id" | "createdAt">): Activity {
    this.requireTask(input.sessionId);
    const activity = activitySchema.parse({ ...input, id: randomUUID(), createdAt: timestamp() });
    this.db.insert(activities).values({
      id: activity.id,
      taskId: activity.sessionId,
      messageId: activity.messageId,
      kind: activity.kind,
      title: activity.title,
      detail: activity.detail,
      metadata: JSON.stringify(activity.metadata),
      createdAt: activity.createdAt,
    }).run();
    return activity;
  }

  listActivities(sessionId: string): Activity[] {
    return this.db.select().from(activities).where(eq(activities.taskId, sessionId)).orderBy(asc(activities.createdAt)).all()
      .map((row) => activitySchema.parse({
        id: row.id,
        sessionId: row.taskId,
        messageId: row.messageId,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        metadata: JSON.parse(row.metadata),
        createdAt: row.createdAt,
      }));
  }

  addAttachment(input: Omit<Attachment, "id" | "createdAt">): Attachment {
    this.requireTask(input.sessionId);
    const attachment = attachmentSchema.parse({ ...input, id: randomUUID(), createdAt: timestamp() });
    this.db.insert(attachments).values({
      id: attachment.id,
      taskId: attachment.sessionId,
      messageId: attachment.messageId,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: String(attachment.size),
      createdAt: attachment.createdAt,
    }).run();
    return attachment;
  }

  listAttachments(sessionId: string): Attachment[] {
    return this.db.select().from(attachments).where(eq(attachments.taskId, sessionId)).orderBy(asc(attachments.createdAt)).all()
      .map(parseAttachment);
  }

  getAttachment(attachmentId: string): Attachment | null {
    const row = this.db.select().from(attachments).where(eq(attachments.id, attachmentId)).get();
    return row === undefined ? null : parseAttachment(row);
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
        kind TEXT NOT NULL DEFAULT 'chat',
        archived TEXT NOT NULL DEFAULT '0',
        flagged TEXT NOT NULL DEFAULT '0',
        unread TEXT NOT NULL DEFAULT '0',
        status_id TEXT,
        label_ids TEXT NOT NULL DEFAULT '[]',
        project_id TEXT,
        permission_mode TEXT NOT NULL DEFAULT 'ask',
        plan_mode TEXT NOT NULL DEFAULT '0',
        working_directory TEXT,
        running TEXT NOT NULL DEFAULT '0',
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
      CREATE TABLE IF NOT EXISTS domain_entities (
        id TEXT PRIMARY KEY NOT NULL,
        domain TEXT NOT NULL,
        workspace_id TEXT,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS domain_entities_domain_workspace ON domain_entities(domain, workspace_id);
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        message_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        message_id TEXT,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.addColumn("workspaces", "kind", "TEXT NOT NULL DEFAULT 'folder'");
    this.addColumn("tasks", "provider_id", "TEXT");
    this.addColumn("tasks", "model_id", "TEXT");
    this.addColumn("tasks", "thinking_level", "TEXT NOT NULL DEFAULT 'off'");
    this.addColumn("tasks", "kind", "TEXT NOT NULL DEFAULT 'chat'");
    this.addColumn("tasks", "archived", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "flagged", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "unread", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "status_id", "TEXT");
    this.addColumn("tasks", "label_ids", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("tasks", "project_id", "TEXT");
    this.addColumn("tasks", "permission_mode", "TEXT NOT NULL DEFAULT 'ask'");
    this.addColumn("tasks", "plan_mode", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "working_directory", "TEXT");
    this.addColumn("tasks", "running", "TEXT NOT NULL DEFAULT '0'");
  }

  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === column)) {
      this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
