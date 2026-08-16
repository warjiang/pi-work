import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
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
  Board,
  BoardColumn,
  BoardSnapshot,
  BrowserTab,
  ChatMessage,
  Conversation,
  ConductorNodeState,
  ConductorRun,
  ConductorSpec,
  Label,
  ModelUsage,
  ObservabilityStoredConfig,
  Plan,
  Project,
  RecordModelUsageInput,
  Run,
  SavedView,
  Session,
  Skill,
  Source,
  StatusDefinition,
  Subtask,
  Task,
  TaskStatus,
  TaskBoardState,
  ThinkingLevel,
  UsageQueryInput,
  UsageSummary,
  WorkEvent,
  Workspace,
  WorkspaceDirectory,
  WorkspaceKind,
} from "@pi-work/protocol";
import {
  activitySchema,
  appSettingsSchema,
  artifactSchema,
  attachmentSchema,
  automationRunSchema,
  automationSchema,
  boardColumnSchema,
  boardSchema,
  boardSnapshotSchema,
  browserTabSchema,
  chatMessageSchema,
  conductorNodeStateSchema,
  conductorRunSchema,
  conductorSpecSchema,
  eventSchema,
  labelSchema,
  modelUsageSchema,
  observabilityStoredConfigSchema,
  planSchema,
  projectSchema,
  recordModelUsageInputSchema,
  runSchema,
  savedViewSchema,
  skillSchema,
  sourceSchema,
  statusDefinitionSchema,
  subtaskSchema,
  taskSchema,
  taskBoardStateSchema,
  usageSummarySchema,
  workspaceSchema,
  workspaceDirectorySchema,
} from "@pi-work/protocol";
import {
  activities,
  appSettings,
  artifacts,
  attachments,
  boardColumns,
  boards,
  commandReceipts,
  conductorNodeStates,
  conductorRuns,
  domainEntities,
  events,
  messages,
  modelUsage,
  plans,
  projects,
  runs,
  tasks,
  taskBoardState,
  telemetryOutbox,
  workspaces,
  workspaceDirectories,
  workspaceEvents,
} from "./schema.js";

function timestamp(): string {
  return new Date().toISOString();
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "1";
}

function pathInside(rootPath: string, candidatePath: string): boolean {
  const difference = relative(resolve(rootPath), resolve(candidatePath));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

const boardRankStep = 1_024;

function canonicalPath(path: string): string {
  return resolve(path);
}

function parseWorkspaceDirectory(row: typeof workspaceDirectories.$inferSelect): WorkspaceDirectory {
  return workspaceDirectorySchema.parse(row);
}

function parseProject(row: typeof projects.$inferSelect): Project {
  return projectSchema.parse(row);
}

function parseBoard(row: typeof boards.$inferSelect): Board {
  return boardSchema.parse(row);
}

function parseBoardColumn(row: typeof boardColumns.$inferSelect): BoardColumn {
  return boardColumnSchema.parse({
    ...row,
    statusIds: JSON.parse(row.statusIds) as unknown,
  });
}

function parseTaskBoardState(row: typeof taskBoardState.$inferSelect): TaskBoardState {
  return taskBoardStateSchema.parse(row);
}

function parseConductorRun(row: typeof conductorRuns.$inferSelect): ConductorRun {
  return conductorRunSchema.parse({
    ...row,
    spec: JSON.parse(row.spec) as unknown,
  });
}

function parseConductorNodeState(row: typeof conductorNodeStates.$inferSelect): ConductorNodeState {
  return conductorNodeStateSchema.parse(row);
}

function parseWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  const directories = JSON.parse(row.directories) as unknown;
  return workspaceSchema.parse({
    ...row,
    directories: Array.isArray(directories) && directories.length > 0
      ? directories
      : [row.rootPath],
    updatedAt: row.updatedAt ?? row.createdAt,
  });
}

function workspaceValues(workspace: Workspace): typeof workspaces.$inferInsert {
  return {
    ...workspace,
    directories: JSON.stringify(workspace.directories),
  };
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

type DomainName = "status" | "label" | "view" | "subtask" | "source" | "skill" | "automation" | "automationRun" | "browserTab";
type DomainValue = StatusDefinition | Label | SavedView | Subtask | Source | Skill | Automation | AutomationRun | BrowserTab;
type FolderDomainName = "status" | "label" | "source" | "automation";

function isFolderDomain(domain: DomainName): domain is FolderDomainName {
  return domain === "status" || domain === "label" || domain === "source" || domain === "automation";
}

function isMcpSource(entity: DomainValue): entity is Source {
  return "type" in entity && (entity.type === "mcp_stdio" || entity.type === "mcp_http");
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
    directories?: string[];
    kind?: WorkspaceKind;
    id?: string;
  }): Workspace {
    const now = timestamp();
    const workspace = workspaceSchema.parse({
      id: input.id ?? randomUUID(),
      ...input,
      rootPath: canonicalPath(input.rootPath),
      outputPath: canonicalPath(input.outputPath),
      directories: (input.directories ?? [input.rootPath]).map(canonicalPath),
      kind: input.kind ?? "folder",
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    const transaction = this.sqlite.transaction(() => {
      this.db.insert(workspaces).values(workspaceValues(workspace)).run();
      for (const [index, directory] of workspace.directories.entries()) {
        this.insertWorkspaceDirectory(workspace.id, directory, index === 0, now);
      }
    });
    transaction();
    return workspace;
  }

  listWorkspaces(): Workspace[] {
    return this.db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).all().map(parseWorkspace);
  }

  getWorkspace(workspaceId: string): Workspace | null {
    const row = this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    return row === undefined ? null : parseWorkspace(row);
  }

  updateWorkspace(workspaceId: string, input: {
    name?: string;
    outputPath?: string;
    expectedVersion?: number;
  }): Workspace {
    const workspace = this.requireWorkspace(workspaceId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== workspace.version) {
      throw new Error("Workspace was changed by another command.");
    }
    const updatedAt = timestamp();
    this.db.update(workspaces).set({
      name: input.name ?? workspace.name,
      outputPath: input.outputPath === undefined ? workspace.outputPath : canonicalPath(input.outputPath),
      version: workspace.version + 1,
      updatedAt,
    }).where(eq(workspaces.id, workspaceId)).run();
    this.appendWorkspaceEvent(workspaceId, "workspace.updated", workspaceId, input);
    return this.requireWorkspace(workspaceId);
  }

  listWorkspaceDirectories(workspaceId: string): WorkspaceDirectory[] {
    this.requireWorkspace(workspaceId);
    return this.db.select().from(workspaceDirectories)
      .where(eq(workspaceDirectories.workspaceId, workspaceId))
      .orderBy(desc(workspaceDirectories.isRoot), asc(workspaceDirectories.createdAt))
      .all()
      .map(parseWorkspaceDirectory);
  }

  addWorkspaceDirectory(workspaceId: string, directory: string): Workspace {
    const workspace = this.requireFolderWorkspace(workspaceId);
    const normalized = canonicalPath(directory);
    const directories = [...new Set([...workspace.directories.map(canonicalPath), normalized])];
    if (directories.length === workspace.directories.length) return workspace;
    const now = timestamp();
    const transaction = this.sqlite.transaction(() => {
      this.insertWorkspaceDirectory(workspaceId, normalized, false, now);
      this.db.update(workspaces).set({
        directories: JSON.stringify(directories),
        version: workspace.version + 1,
        updatedAt: now,
      }).where(eq(workspaces.id, workspaceId)).run();
      this.appendWorkspaceEvent(workspaceId, "workspace.directory_added", workspaceId, { path: normalized });
    });
    transaction();
    return this.requireWorkspace(workspaceId);
  }

  removeWorkspaceDirectory(workspaceId: string, directoryId: string): Workspace {
    const workspace = this.requireFolderWorkspace(workspaceId);
    const directory = this.db.select().from(workspaceDirectories)
      .where(and(eq(workspaceDirectories.id, directoryId), eq(workspaceDirectories.workspaceId, workspaceId)))
      .get();
    if (directory === undefined) throw new Error("Workspace directory not found.");
    if (directory.isRoot) throw new Error("The root directory cannot be removed.");
    const directories = workspace.directories.filter((path) => canonicalPath(path) !== directory.canonicalPath);
    const now = timestamp();
    const transaction = this.sqlite.transaction(() => {
      this.db.delete(workspaceDirectories).where(eq(workspaceDirectories.id, directoryId)).run();
      this.db.update(workspaces).set({
        directories: JSON.stringify(directories),
        version: workspace.version + 1,
        updatedAt: now,
      }).where(eq(workspaces.id, workspaceId)).run();
      this.appendWorkspaceEvent(workspaceId, "workspace.directory_removed", workspaceId, { path: directory.path });
    });
    transaction();
    return this.requireWorkspace(workspaceId);
  }

  createTask(input: {
    workspaceId: string;
    projectId?: string | null;
    title: string;
    goal: string;
    kind?: Task["kind"];
    providerId?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel;
    permissionMode?: Task["permissionMode"];
    planMode?: boolean;
    workingDirectory?: string | null;
    id?: string;
  }): Task {
    const workspace = this.requireWorkspace(input.workspaceId);
    const kind = input.kind ?? "task";
    this.assertSessionWorkspaceKind(workspace, kind);
    this.validateWorkingDirectory(workspace, input.workingDirectory);
    const createdAt = timestamp();
    const task = taskSchema.parse({
      id: input.id ?? randomUUID(),
      ...input,
      status: "draft",
      projectId: input.projectId ?? null,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? "off",
      kind,
      archived: false,
      flagged: false,
      unread: false,
      statusId: null,
      labelIds: [],
      permissionMode: input.permissionMode ?? "ask",
      planMode: input.planMode ?? false,
      workingDirectory: input.workingDirectory ?? null,
      running: false,
      createdAt,
      updatedAt: createdAt,
    });
    this.db.insert(tasks).values(taskValues(task)).run();
    this.ensureTaskBoardStates(task);
    this.createRun(task.id, task.status);
    this.appendEvent(task.id, "task.created", { title: task.title });
    return task;
  }

  updateTaskGoal(taskId: string, goal: string): Task {
    this.requireTask(taskId);
    this.db.update(tasks).set({ goal, updatedAt: timestamp() }).where(eq(tasks.id, taskId)).run();
    return this.requireTask(taskId);
  }

  updateTaskBrief(taskId: string, input: { title?: string; goal?: string }): Task {
    this.requireTask(taskId);
    this.db.update(tasks).set({ ...input, updatedAt: timestamp() }).where(eq(tasks.id, taskId)).run();
    this.appendEvent(taskId, "session.updated", input);
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
    labelId?: string;
  } = {}): Session[] {
    const filters = [];
    if (input.workspaceId !== undefined && input.workspaceId !== null) filters.push(eq(tasks.workspaceId, input.workspaceId));
    if (input.archived !== undefined) filters.push(eq(tasks.archived, input.archived ? "1" : "0"));
    if (input.flagged !== undefined) filters.push(eq(tasks.flagged, input.flagged ? "1" : "0"));
    if (input.statusId !== undefined) filters.push(input.statusId === null ? isNull(tasks.statusId) : eq(tasks.statusId, input.statusId));
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
    "projectId" | "title" | "status" | "archived" | "flagged" | "unread" | "statusId" | "labelIds" | "permissionMode" | "planMode" | "workingDirectory" | "running"
  >>): Session {
    const current = this.requireTask(sessionId);
    const workspace = this.requireWorkspace(current.workspaceId);
    this.assertSessionWorkspaceKind(workspace, current.kind);
    this.validateSessionResources(workspace, input);
    if (input.projectId !== undefined && input.projectId !== null) {
      const project = this.getProject(workspace.id, input.projectId);
      if (project === null) throw new Error("Project belongs to a different workspace.");
    }
    this.validateWorkingDirectory(workspace, input.workingDirectory);
    const next = taskSchema.parse({ ...current, ...input, updatedAt: timestamp() });
    const transaction = this.sqlite.transaction(() => {
      this.db.update(tasks).set(taskValues(next)).where(eq(tasks.id, sessionId)).run();
      if (next.kind === "task" && input.projectId !== undefined && current.projectId !== next.projectId) {
        const oldProjectBoards = this.db.select({ id: boards.id }).from(boards).where(and(
          eq(boards.workspaceId, current.workspaceId),
          current.projectId === null ? isNull(boards.projectId) : eq(boards.projectId, current.projectId),
          eq(boards.kind, "project"),
        )).all();
        for (const board of oldProjectBoards) {
          this.db.delete(taskBoardState).where(and(
            eq(taskBoardState.taskId, sessionId),
            eq(taskBoardState.boardId, board.id),
          )).run();
        }
      }
      if (next.kind === "task" && (input.projectId !== undefined || input.statusId !== undefined)) {
        this.ensureTaskBoardStates(next);
      }
      this.appendEvent(sessionId, "session.updated", input);
    });
    transaction();
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
        workspace: parseWorkspace(workspaceRow),
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
      throw new Error(`Unknown work folder: ${task.workspaceId}`);
    }
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM activities WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM attachments WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM events WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM messages WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM plans WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM runs WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM task_board_state WHERE task_id = ?").run(taskId);
      const conductorRows = this.sqlite.prepare("SELECT id FROM conductor_runs WHERE task_id = ?").all(taskId) as Array<{ id: string }>;
      for (const run of conductorRows) {
        this.sqlite.prepare("DELETE FROM conductor_node_states WHERE run_id = ?").run(run.id);
      }
      this.sqlite.prepare("DELETE FROM conductor_runs WHERE task_id = ?").run(taskId);
      this.sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
      if (workspace.kind === "managed") {
        this.sqlite.prepare("DELETE FROM workspaces WHERE id = ?").run(workspace.id);
      }
    });
    transaction();
    return { task, workspace };
  }

  getObservabilityConfig(): ObservabilityStoredConfig {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, "observability")).get();
    const value = row === undefined ? {} : (() => {
      try {
        return JSON.parse(row.value);
      } catch {
        return {};
      }
    })();
    return observabilityStoredConfigSchema.parse(value);
  }

  setObservabilityConfig(input: Partial<ObservabilityStoredConfig>): ObservabilityStoredConfig {
    const next = observabilityStoredConfigSchema.parse({ ...this.getObservabilityConfig(), ...input });
    const value = JSON.stringify(next);
    this.db.insert(appSettings).values({ key: "observability", value }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
    }).run();
    return next;
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
      disabledModelKeys: [],
      modelTestResults: {},
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
    this.requireFolderWorkspace(workspaceId);
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId))
      .orderBy(asc(tasks.createdAt))
      .all()
      .map(parseTask);
  }

  createProject(input: {
    workspaceId: string;
    name: string;
    description?: string;
    color?: string;
  }): Project {
    this.requireFolderWorkspace(input.workspaceId);
    const now = timestamp();
    const project = projectSchema.parse({
      id: randomUUID(),
      ...input,
      description: input.description ?? "",
      color: input.color ?? "#8a8275",
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const transaction = this.sqlite.transaction(() => {
      this.db.insert(projects).values(project).run();
      this.createBoardInternal({
        workspaceId: project.workspaceId,
        projectId: project.id,
        name: project.name,
        kind: "project",
      });
      this.appendWorkspaceEvent(project.workspaceId, "project.created", project.id, project);
    });
    transaction();
    return project;
  }

  listProjects(workspaceId: string, includeArchived = false): Project[] {
    this.requireFolderWorkspace(workspaceId);
    const rows = this.db.select().from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.createdAt))
      .all()
      .map(parseProject);
    return includeArchived ? rows : rows.filter(({ archived }) => !archived);
  }

  getProject(workspaceId: string, projectId: string): Project | null {
    const row = this.db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .get();
    return row === undefined ? null : parseProject(row);
  }

  updateProject(workspaceId: string, projectId: string, input: Partial<Pick<
    Project,
    "name" | "description" | "color" | "archived"
  >>): Project {
    const current = this.getProject(workspaceId, projectId);
    if (current === null) throw new Error("Project not found.");
    const next = projectSchema.parse({ ...current, ...input, updatedAt: timestamp() });
    const transaction = this.sqlite.transaction(() => {
      this.db.update(projects).set(next).where(eq(projects.id, projectId)).run();
      if (input.name !== undefined) {
        this.db.update(boards).set({ name: next.name, updatedAt: next.updatedAt })
          .where(and(eq(boards.workspaceId, workspaceId), eq(boards.projectId, projectId)))
          .run();
      }
      this.appendWorkspaceEvent(workspaceId, "project.updated", projectId, input);
    });
    transaction();
    return next;
  }

  removeProject(workspaceId: string, projectId: string): void {
    const project = this.getProject(workspaceId, projectId);
    if (project === null) throw new Error("Project not found.");
    const boardRows = this.db.select().from(boards)
      .where(and(eq(boards.workspaceId, workspaceId), eq(boards.projectId, projectId)))
      .all();
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE tasks SET project_id = NULL, updated_at = ? WHERE workspace_id = ? AND project_id = ?")
        .run(timestamp(), workspaceId, projectId);
      for (const board of boardRows) {
        this.sqlite.prepare("DELETE FROM task_board_state WHERE board_id = ?").run(board.id);
        this.sqlite.prepare("DELETE FROM board_columns WHERE board_id = ?").run(board.id);
      }
      this.sqlite.prepare("DELETE FROM boards WHERE workspace_id = ? AND project_id = ?").run(workspaceId, projectId);
      this.sqlite.prepare("DELETE FROM projects WHERE id = ? AND workspace_id = ?").run(projectId, workspaceId);
      this.appendWorkspaceEvent(workspaceId, "project.removed", projectId, {});
    });
    transaction();
  }

  createBoard(input: { workspaceId: string; projectId?: string | null; name: string }): Board {
    this.requireFolderWorkspace(input.workspaceId);
    if (input.projectId !== undefined && input.projectId !== null && this.getProject(input.workspaceId, input.projectId) === null) {
      throw new Error("Project not found.");
    }
    return this.createBoardInternal({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name,
      kind: input.projectId === undefined || input.projectId === null ? "workspace" : "project",
    });
  }

  listBoards(workspaceId: string): Board[] {
    this.requireFolderWorkspace(workspaceId);
    this.ensureDefaultBoard(workspaceId);
    return this.db.select().from(boards)
      .where(eq(boards.workspaceId, workspaceId))
      .orderBy(asc(boards.createdAt))
      .all()
      .map(parseBoard);
  }

  getBoardSnapshot(workspaceId: string, boardId?: string): BoardSnapshot {
    this.requireFolderWorkspace(workspaceId);
    const board = boardId === undefined
      ? this.ensureDefaultBoard(workspaceId)
      : this.requireBoard(workspaceId, boardId);
    for (const task of this.listTasks(workspaceId)) {
      if (board.kind === "workspace" || task.projectId === board.projectId) {
        this.ensureBoardState(task, board);
      }
    }
    return boardSnapshotSchema.parse({
      board,
      columns: this.listBoardColumns(workspaceId, board.id),
      states: this.db.select().from(taskBoardState)
        .where(and(eq(taskBoardState.workspaceId, workspaceId), eq(taskBoardState.boardId, board.id)))
        .orderBy(asc(taskBoardState.columnId), asc(taskBoardState.rank))
        .all()
        .map(parseTaskBoardState),
    });
  }

  listBoardColumns(workspaceId: string, boardId: string): BoardColumn[] {
    this.requireBoard(workspaceId, boardId);
    return this.db.select().from(boardColumns)
      .where(and(eq(boardColumns.workspaceId, workspaceId), eq(boardColumns.boardId, boardId)))
      .orderBy(asc(boardColumns.position))
      .all()
      .map(parseBoardColumn);
  }

  createBoardColumn(input: {
    workspaceId: string;
    boardId: string;
    name: string;
    color: string;
    statusIds?: string[];
    dropStatusId?: string | null;
  }): BoardColumn {
    const board = this.requireBoard(input.workspaceId, input.boardId);
    this.validateBoardStatusIds(input.workspaceId, [...(input.statusIds ?? []), ...(input.dropStatusId ? [input.dropStatusId] : [])]);
    const now = timestamp();
    const column = boardColumnSchema.parse({
      id: randomUUID(),
      ...input,
      statusIds: input.statusIds ?? [],
      dropStatusId: input.dropStatusId ?? null,
      position: this.listBoardColumns(input.workspaceId, input.boardId).length,
      createdAt: now,
      updatedAt: now,
    });
    const transaction = this.sqlite.transaction(() => {
      this.db.insert(boardColumns).values({ ...column, statusIds: JSON.stringify(column.statusIds) }).run();
      this.bumpBoard(board);
      this.appendWorkspaceEvent(input.workspaceId, "board.column_created", column.id, column);
    });
    transaction();
    return column;
  }

  updateBoardColumn(workspaceId: string, boardId: string, columnId: string, input: Partial<Pick<
    BoardColumn,
    "name" | "color" | "position" | "statusIds" | "dropStatusId"
  >>): BoardColumn {
    const board = this.requireBoard(workspaceId, boardId);
    const current = this.requireBoardColumn(workspaceId, boardId, columnId);
    const dropStatusId = input.dropStatusId !== undefined ? input.dropStatusId : current.dropStatusId;
    this.validateBoardStatusIds(workspaceId, [
      ...(input.statusIds ?? current.statusIds),
      ...(dropStatusId === null ? [] : [dropStatusId]),
    ]);
    const next = boardColumnSchema.parse({ ...current, ...input, updatedAt: timestamp() });
    const transaction = this.sqlite.transaction(() => {
      this.db.update(boardColumns).set({ ...next, statusIds: JSON.stringify(next.statusIds) })
        .where(eq(boardColumns.id, columnId)).run();
      this.bumpBoard(board);
      this.appendWorkspaceEvent(workspaceId, "board.column_updated", columnId, input);
    });
    transaction();
    return next;
  }

  removeBoardColumn(workspaceId: string, boardId: string, columnId: string, migrateToColumnId: string): void {
    if (columnId === migrateToColumnId) throw new Error("Choose a different destination column.");
    const board = this.requireBoard(workspaceId, boardId);
    this.requireBoardColumn(workspaceId, boardId, columnId);
    this.requireBoardColumn(workspaceId, boardId, migrateToColumnId);
    if (this.listBoardColumns(workspaceId, boardId).length <= 1) throw new Error("A board must keep at least one column.");
    const transaction = this.sqlite.transaction(() => {
      const destination = this.db.select().from(taskBoardState)
        .where(and(eq(taskBoardState.boardId, boardId), eq(taskBoardState.columnId, migrateToColumnId)))
        .orderBy(asc(taskBoardState.rank)).all();
      const moving = this.db.select().from(taskBoardState)
        .where(and(eq(taskBoardState.boardId, boardId), eq(taskBoardState.columnId, columnId)))
        .orderBy(asc(taskBoardState.rank)).all();
      this.sqlite.prepare("UPDATE task_board_state SET rank = rank + 1000000000 WHERE board_id = ? AND column_id = ?")
        .run(boardId, migrateToColumnId);
      [...destination, ...moving].forEach((state, index) => {
        this.sqlite.prepare(
          "UPDATE task_board_state SET column_id = ?, rank = ?, version = version + 1, updated_at = ? WHERE task_id = ? AND board_id = ?",
        ).run(migrateToColumnId, (index + 1) * boardRankStep, timestamp(), state.taskId, boardId);
      });
      this.db.delete(boardColumns).where(eq(boardColumns.id, columnId)).run();
      this.bumpBoard(board);
      this.appendWorkspaceEvent(workspaceId, "board.column_removed", columnId, { migrateToColumnId });
    });
    transaction();
  }

  moveBoardCard(input: {
    commandId: string;
    workspaceId: string;
    boardId: string;
    taskId: string;
    toColumnId: string;
    beforeTaskId?: string | null;
    afterTaskId?: string | null;
    expectedVersion: number;
  }): BoardSnapshot {
    const receipt = this.db.select().from(commandReceipts).where(eq(commandReceipts.id, input.commandId)).get();
    if (receipt !== undefined) return boardSnapshotSchema.parse(JSON.parse(receipt.result));
    const board = this.requireBoard(input.workspaceId, input.boardId);
    const task = this.requireTask(input.taskId);
    if (task.workspaceId !== input.workspaceId) throw new Error("Task belongs to a different workspace.");
    if (board.kind === "project" && task.projectId !== board.projectId) throw new Error("Task is outside this project board.");
    const targetColumn = this.requireBoardColumn(input.workspaceId, input.boardId, input.toColumnId);
    const current = this.ensureBoardState(task, board);
    if (current.version !== input.expectedVersion) throw new Error("Card was moved by another command.");

    let snapshot!: BoardSnapshot;
    const transaction = this.sqlite.transaction(() => {
      const target = this.db.select().from(taskBoardState)
        .where(and(eq(taskBoardState.boardId, board.id), eq(taskBoardState.columnId, targetColumn.id)))
        .orderBy(asc(taskBoardState.rank))
        .all()
        .filter(({ taskId }) => taskId !== task.id);
      const beforeIndex = input.beforeTaskId === undefined || input.beforeTaskId === null
        ? -1
        : target.findIndex(({ taskId }) => taskId === input.beforeTaskId);
      const afterIndex = input.afterTaskId === undefined || input.afterTaskId === null
        ? -1
        : target.findIndex(({ taskId }) => taskId === input.afterTaskId);
      const insertAt = beforeIndex >= 0 ? beforeIndex : afterIndex >= 0 ? afterIndex + 1 : target.length;
      target.splice(insertAt, 0, {
        taskId: task.id,
        workspaceId: input.workspaceId,
        boardId: board.id,
        columnId: targetColumn.id,
        rank: 0,
        version: current.version,
        updatedAt: timestamp(),
      });
      this.sqlite.prepare("UPDATE task_board_state SET rank = rank + 1000000000 WHERE board_id = ? AND column_id = ?")
        .run(board.id, targetColumn.id);
      target.forEach((state, index) => {
        this.sqlite.prepare(
          "UPDATE task_board_state SET column_id = ?, rank = ?, version = version + 1, updated_at = ? WHERE task_id = ? AND board_id = ?",
        ).run(targetColumn.id, (index + 1) * boardRankStep, timestamp(), state.taskId, board.id);
      });
      if (targetColumn.dropStatusId !== null) {
        this.db.update(tasks).set({ statusId: targetColumn.dropStatusId, updatedAt: timestamp() })
          .where(eq(tasks.id, task.id)).run();
      }
      this.bumpBoard(board);
      this.appendWorkspaceEvent(input.workspaceId, "board.card_moved", task.id, {
        boardId: board.id,
        columnId: targetColumn.id,
      });
      snapshot = this.getBoardSnapshot(input.workspaceId, board.id);
      this.db.insert(commandReceipts).values({
        id: input.commandId,
        workspaceId: input.workspaceId,
        kind: "board.move_card",
        result: JSON.stringify(snapshot),
        createdAt: timestamp(),
      }).run();
    });
    transaction();
    return snapshot;
  }

  createConductorRun(input: { workspaceId: string; taskId: string; spec: ConductorSpec }): ConductorRun {
    const task = this.requireTask(input.taskId);
    if (task.workspaceId !== input.workspaceId) throw new Error("Task belongs to a different workspace.");
    const spec = conductorSpecSchema.parse(input.spec);
    const now = timestamp();
    const run = conductorRunSchema.parse({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      status: "pending",
      spec,
      lastEventSequence: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    const transaction = this.sqlite.transaction(() => {
      this.db.insert(conductorRuns).values({ ...run, spec: JSON.stringify(run.spec) }).run();
      for (const node of spec.nodes) {
        this.db.insert(conductorNodeStates).values({
          runId: run.id,
          nodeId: node.id,
          status: node.dependsOn.length === 0 ? "ready" : "pending",
          attempt: 0,
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        }).run();
      }
      this.appendWorkspaceEvent(input.workspaceId, "run.created", run.id, { taskId: input.taskId });
    });
    transaction();
    return run;
  }

  getConductorRun(workspaceId: string, runId: string): ConductorRun | null {
    const row = this.db.select().from(conductorRuns)
      .where(and(eq(conductorRuns.id, runId), eq(conductorRuns.workspaceId, workspaceId)))
      .get();
    return row === undefined ? null : parseConductorRun(row);
  }

  listConductorRuns(workspaceId: string, taskId?: string): ConductorRun[] {
    this.requireFolderWorkspace(workspaceId);
    const rows = taskId === undefined
      ? this.db.select().from(conductorRuns).where(eq(conductorRuns.workspaceId, workspaceId)).orderBy(desc(conductorRuns.createdAt)).all()
      : this.db.select().from(conductorRuns).where(and(
        eq(conductorRuns.workspaceId, workspaceId),
        eq(conductorRuns.taskId, taskId),
      )).orderBy(desc(conductorRuns.createdAt)).all();
    return rows.map(parseConductorRun);
  }

  listConductorNodeStates(workspaceId: string, runId: string): ConductorNodeState[] {
    const run = this.getConductorRun(workspaceId, runId);
    if (run === null) throw new Error("Run not found.");
    const states = this.db.select().from(conductorNodeStates)
      .where(eq(conductorNodeStates.runId, runId))
      .all()
      .map(parseConductorNodeState);
    const order = new Map(run.spec.nodes.map(({ id }, index) => [id, index]));
    return states.sort((left, right) => (
      (order.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  updateConductorRunStatus(
    workspaceId: string,
    runId: string,
    status: ConductorRun["status"],
  ): ConductorRun {
    const current = this.getConductorRun(workspaceId, runId);
    if (current === null) throw new Error("Run not found.");
    const now = timestamp();
    this.db.update(conductorRuns).set({
      status,
      updatedAt: now,
      completedAt: ["completed", "failed", "cancelled"].includes(status) ? now : null,
      leaseOwner: status === "running" ? current.leaseOwner : null,
      leaseExpiresAt: status === "running" ? current.leaseExpiresAt : null,
    }).where(eq(conductorRuns.id, runId)).run();
    this.appendWorkspaceEvent(workspaceId, `run.${status}`, runId, {});
    return this.getConductorRun(workspaceId, runId)!;
  }

  claimConductorRun(workspaceId: string, runId: string, owner: string, leaseMs = 30_000): ConductorRun {
    const run = this.getConductorRun(workspaceId, runId);
    if (run === null) throw new Error("Run not found.");
    const now = new Date();
    if (run.leaseExpiresAt !== null && new Date(run.leaseExpiresAt) > now && run.leaseOwner !== owner) {
      throw new Error("Run is leased by another conductor.");
    }
    this.db.update(conductorRuns).set({
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      status: "running",
      updatedAt: now.toISOString(),
    }).where(eq(conductorRuns.id, runId)).run();
    return this.getConductorRun(workspaceId, runId)!;
  }

  updateConductorNodeState(
    workspaceId: string,
    runId: string,
    nodeId: string,
    input: Partial<Pick<ConductorNodeState, "status" | "attempt" | "output" | "error" | "startedAt" | "completedAt">>,
  ): ConductorNodeState {
    const run = this.getConductorRun(workspaceId, runId);
    if (run === null) throw new Error("Run not found.");
    const currentRow = this.db.select().from(conductorNodeStates)
      .where(and(eq(conductorNodeStates.runId, runId), eq(conductorNodeStates.nodeId, nodeId)))
      .get();
    if (currentRow === undefined) throw new Error("Run node not found.");
    const next = conductorNodeStateSchema.parse({ ...parseConductorNodeState(currentRow), ...input, updatedAt: timestamp() });
    const transaction = this.sqlite.transaction(() => {
      this.db.update(conductorNodeStates).set(next).where(and(
        eq(conductorNodeStates.runId, runId),
        eq(conductorNodeStates.nodeId, nodeId),
      )).run();
      this.db.update(conductorRuns).set({
        lastEventSequence: run.lastEventSequence + 1,
        updatedAt: next.updatedAt,
      }).where(eq(conductorRuns.id, runId)).run();
      this.appendWorkspaceEvent(workspaceId, "run.node_updated", nodeId, { runId, ...input });
      if (next.status === "completed") this.releaseReadyConductorNodes(run, nodeId);
    });
    transaction();
    return next;
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
    if (isFolderDomain(domain) && !(domain === "source" && isMcpSource(entity) && entity.workspaceId === null)) {
      const workspaceId = this.workspaceIdOf(entity);
      this.requireFolderWorkspace(workspaceId);
      if (domain === "automation") this.validateAutomationReferences(entity as Automation, workspaceId);
    }
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
    if (isFolderDomain(domain) && !(domain === "source" && workspaceId === null)) {
      if (workspaceId === undefined || workspaceId === null) {
        throw new Error(`${domain} resources require a work folder.`);
      }
      this.requireFolderWorkspace(workspaceId);
    }
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
    if (isFolderDomain(domain) && !(domain === "source" && isMcpSource(current) && current.workspaceId === null)) {
      const workspaceId = this.workspaceIdOf(current);
      this.requireFolderWorkspace(workspaceId);
      if (this.workspaceIdOf(next) !== workspaceId) {
        throw new Error(`${domain} resources cannot move between work folders.`);
      }
      if (domain === "automation") this.validateAutomationReferences(next as Automation, workspaceId);
    }
    this.db.update(domainEntities).set({
      value: JSON.stringify(next),
      workspaceId: "workspaceId" in next ? (next.workspaceId ?? null) : null,
      updatedAt: timestamp(),
    }).where(eq(domainEntities.id, id)).run();
    return next;
  }

  removeDomainEntity(domain: DomainName, id: string): void {
    if (isFolderDomain(domain)) {
      const row = this.db.select().from(domainEntities).where(and(eq(domainEntities.id, id), eq(domainEntities.domain, domain))).get();
      if (row === undefined) throw new Error(`Unknown ${domain}: ${id}`);
      const entity = domain === "source" ? sourceSchema.parse(JSON.parse(row.value)) : null;
      if (!(domain === "source" && entity !== null && isMcpSource(entity) && entity.workspaceId === null)) {
        this.requireFolderDomainEntity(domain, id);
      }
    }
    this.db.delete(domainEntities).where(and(eq(domainEntities.id, id), eq(domainEntities.domain, domain))).run();
  }

  removeStatus(id: string): void {
    const status = this.requireFolderDomainEntity("status", id);
    const workspaceId = this.workspaceIdOf(status);
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE tasks SET status_id = NULL WHERE workspace_id = ? AND status_id = ?").run(workspaceId, id);
      const columns = this.db.select().from(boardColumns).where(eq(boardColumns.workspaceId, workspaceId)).all();
      for (const column of columns) {
        const statusIds = JSON.parse(column.statusIds) as string[];
        this.db.update(boardColumns).set({
          statusIds: JSON.stringify(statusIds.filter((statusId) => statusId !== id)),
          dropStatusId: column.dropStatusId === id ? null : column.dropStatusId,
          updatedAt: timestamp(),
        }).where(eq(boardColumns.id, column.id)).run();
      }
      this.sqlite.prepare("DELETE FROM domain_entities WHERE id = ? AND domain = 'status'").run(id);
    });
    transaction();
  }

  removeLabel(id: string): void {
    const label = this.requireFolderDomainEntity("label", id);
    const workspaceId = this.workspaceIdOf(label);
    const transaction = this.sqlite.transaction(() => {
      const rows = this.sqlite.prepare("SELECT id, label_ids FROM tasks WHERE workspace_id = ?").all(workspaceId) as Array<{ id: string; label_ids: string }>;
      const update = this.sqlite.prepare("UPDATE tasks SET label_ids = ?, updated_at = ? WHERE id = ?");
      for (const row of rows) {
        const current = JSON.parse(row.label_ids) as string[];
        if (!current.includes(id)) continue;
        update.run(JSON.stringify(current.filter((labelId) => labelId !== id)), timestamp(), row.id);
      }
      this.sqlite.prepare("DELETE FROM domain_entities WHERE id = ? AND domain = 'label'").run(id);
    });
    transaction();
  }

  createSource(value: Omit<Source, "id" | "createdAt" | "updatedAt">): Source {
    return this.createDomainEntity("source", sourceSchema, value);
  }
  listSources(workspaceId: string): Source[] {
    return this.listDomainEntities("source", sourceSchema, workspaceId);
  }
  listGlobalMcpSources(): Source[] {
    return this.listDomainEntities("source", sourceSchema, null).filter(isMcpSource);
  }
  migrateMcpSourcesToGlobal(): Source[] {
    const rows = this.db.select().from(domainEntities).where(eq(domainEntities.domain, "source")).orderBy(asc(domainEntities.createdAt)).all();
    const migrated: Source[] = [];
    const transaction = this.sqlite.transaction(() => {
      for (const row of rows) {
        const source = sourceSchema.parse(JSON.parse(row.value));
        if (!isMcpSource(source)) continue;
        const next = source.workspaceId === null ? source : { ...source, workspaceId: null, updatedAt: timestamp() };
        if (source.workspaceId !== null) {
          this.db.update(domainEntities).set({
            workspaceId: null,
            value: JSON.stringify(next),
            updatedAt: next.updatedAt,
          }).where(eq(domainEntities.id, source.id)).run();
        }
        migrated.push(next);
      }
    });
    transaction();
    return migrated;
  }
  createSkill(value: Omit<Skill, "id" | "createdAt" | "updatedAt">): Skill {
    return this.createDomainEntity("skill", skillSchema, value);
  }
  listSkills(workspaceId: string): Skill[] {
    return this.listDomainEntities("skill", skillSchema, workspaceId);
  }
  listGlobalSkills(): Skill[] {
    return this.listDomainEntities("skill", skillSchema, null);
  }
  migrateSkillsToGlobal(): Skill[] {
    const rows = this.db.select().from(domainEntities).where(eq(domainEntities.domain, "skill")).orderBy(asc(domainEntities.createdAt)).all();
    const migrated: Skill[] = [];
    const transaction = this.sqlite.transaction(() => {
      for (const row of rows) {
        const skill = skillSchema.parse(JSON.parse(row.value));
        if (skill.workspaceId === null) {
          migrated.push(skill);
          continue;
        }
        const next = { ...skill, workspaceId: null, updatedAt: timestamp() };
        this.db.update(domainEntities).set({
          workspaceId: null,
          value: JSON.stringify(next),
          updatedAt: next.updatedAt,
        }).where(eq(domainEntities.id, skill.id)).run();
        migrated.push(next);
      }
    });
    transaction();
    return migrated;
  }
  createAutomation(value: Omit<Automation, "id" | "createdAt" | "updatedAt">): Automation {
    return this.createDomainEntity("automation", automationSchema, value);
  }
  listAutomations(workspaceId: string): Automation[] {
    return this.listDomainEntities("automation", automationSchema, workspaceId);
  }
  createStatus(value: StatusDefinition): StatusDefinition {
    return this.createDomainEntity("status", statusDefinitionSchema, value);
  }
  listStatuses(workspaceId: string): StatusDefinition[] {
    return this.listDomainEntities("status", statusDefinitionSchema, workspaceId);
  }
  createLabel(value: Label): Label {
    return this.createDomainEntity("label", labelSchema, value);
  }
  listLabels(workspaceId: string): Label[] {
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

  recordModelUsage(input: RecordModelUsageInput): ModelUsage {
    const parsed = recordModelUsageInputSchema.parse(input);
    const usage = modelUsageSchema.parse({ ...parsed, id: randomUUID(), createdAt: timestamp() });
    this.db.insert(modelUsage).values({
      id: usage.id,
      taskId: usage.taskId,
      workspaceId: usage.workspaceId,
      requestId: usage.requestId,
      messageId: usage.messageId,
      provider: usage.provider,
      model: usage.model,
      responseModel: usage.responseModel,
      api: usage.api,
      stopReason: usage.stopReason,
      inputTokens: String(usage.inputTokens),
      outputTokens: String(usage.outputTokens),
      cacheReadTokens: String(usage.cacheReadTokens),
      cacheWriteTokens: String(usage.cacheWriteTokens),
      reasoningTokens: String(usage.reasoningTokens),
      totalTokens: String(usage.totalTokens),
      inputCost: String(usage.inputCost),
      outputCost: String(usage.outputCost),
      cacheReadCost: String(usage.cacheReadCost),
      cacheWriteCost: String(usage.cacheWriteCost),
      totalCost: String(usage.totalCost),
      createdAt: usage.createdAt,
    }).run();
    return usage;
  }

  usageSummary(input: UsageQueryInput = { since: null, until: null, workspaceId: null }): UsageSummary {
    const conditions: string[] = [];
    const params: string[] = [];
    if (input.since !== null) {
      conditions.push("created_at >= ?");
      params.push(input.since);
    }
    if (input.until !== null) {
      conditions.push("created_at <= ?");
      params.push(input.until);
    }
    if (input.workspaceId !== null) {
      conditions.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalsExpr = `
      COUNT(*) AS requests,
      COALESCE(SUM(CAST(input_tokens AS REAL)), 0) AS inputTokens,
      COALESCE(SUM(CAST(output_tokens AS REAL)), 0) AS outputTokens,
      COALESCE(SUM(CAST(cache_read_tokens AS REAL)), 0) AS cacheReadTokens,
      COALESCE(SUM(CAST(cache_write_tokens AS REAL)), 0) AS cacheWriteTokens,
      COALESCE(SUM(CAST(reasoning_tokens AS REAL)), 0) AS reasoningTokens,
      COALESCE(SUM(CAST(total_tokens AS REAL)), 0) AS totalTokens,
      COALESCE(SUM(CAST(total_cost AS REAL)), 0) AS totalCost`;
    const totalsRow = this.sqlite.prepare(
      `SELECT ${totalsExpr} FROM model_usage ${where}`,
    ).get(...params) as Record<string, number>;
    const byModel = this.sqlite.prepare(
      `SELECT provider, model, ${totalsExpr} FROM model_usage ${where} GROUP BY provider, model ORDER BY totalCost DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
    const byDay = this.sqlite.prepare(
      `SELECT substr(created_at, 1, 10) AS day, ${totalsExpr} FROM model_usage ${where} GROUP BY day ORDER BY day ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
    return usageSummarySchema.parse({
      totals: totalsRow,
      byModel,
      byDay,
    });
  }

  enqueueTelemetry(payload: string, nextAttemptAt = timestamp()): void {
    this.db.insert(telemetryOutbox).values({
      id: randomUUID(),
      payload,
      attempts: "0",
      nextAttemptAt,
      createdAt: timestamp(),
    }).run();
  }

  listDueTelemetry(limit = 20, now = timestamp()): Array<{ id: string; payload: string; attempts: number }> {
    return (this.sqlite.prepare(
      "SELECT id, payload, attempts FROM telemetry_outbox WHERE next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?",
    ).all(now, limit) as Array<{ id: string; payload: string; attempts: string }>)
      .map((row) => ({ id: row.id, payload: row.payload, attempts: Number(row.attempts) }));
  }

  markTelemetryRetry(id: string, attempts: number, nextAttemptAt: string): void {
    this.db.update(telemetryOutbox)
      .set({ attempts: String(attempts), nextAttemptAt })
      .where(eq(telemetryOutbox.id, id)).run();
  }

  deleteTelemetry(id: string): void {
    this.db.delete(telemetryOutbox).where(eq(telemetryOutbox.id, id)).run();
  }

  countTelemetryOutbox(): number {
    const row = this.sqlite.prepare("SELECT COUNT(*) AS count FROM telemetry_outbox").get() as { count: number };
    return row.count;
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

  promoteManagedSession(input: {
    sessionId: string;
    workspaceId: string;
    stagedPaths: Record<string, string>;
  }): { session: Session; workspace: Workspace } {
    const session = this.requireTask(input.sessionId);
    const sourceWorkspace = this.requireWorkspace(session.workspaceId);
    const targetWorkspace = this.requireFolderWorkspace(input.workspaceId);
    if (session.kind !== "chat" || sourceWorkspace.kind !== "managed") {
      throw new Error("Only personal sessions can move to a work folder.");
    }
    if (session.running) {
      throw new Error("Stop this personal session before moving it.");
    }
    const stagedArtifacts = this.listArtifacts(session.id).filter(({ publishedPath }) => publishedPath === null);
    for (const artifact of stagedArtifacts) {
      if (input.stagedPaths[artifact.id] === undefined) {
        throw new Error(`Missing staged artifact path: ${artifact.id}`);
      }
    }

    const promoted = taskSchema.parse({
      ...session,
      workspaceId: targetWorkspace.id,
      kind: "task",
      status: "draft",
      archived: false,
      flagged: false,
      unread: false,
      statusId: null,
      labelIds: [],
      planMode: true,
      workingDirectory: targetWorkspace.rootPath,
      running: false,
      updatedAt: timestamp(),
    });
    const transaction = this.sqlite.transaction(() => {
      this.db.update(tasks).set(taskValues(promoted)).where(eq(tasks.id, session.id)).run();
      for (const artifact of stagedArtifacts) {
        this.db.update(artifacts).set({ stagedPath: input.stagedPaths[artifact.id] }).where(eq(artifacts.id, artifact.id)).run();
      }
      const run = this.getLatestRun(session.id);
      if (run !== null) {
        this.db.update(runs).set({
          status: "draft",
          updatedAt: promoted.updatedAt,
          completedAt: null,
        }).where(eq(runs.id, run.id)).run();
      }
      this.sqlite.prepare("DELETE FROM workspaces WHERE id = ?").run(sourceWorkspace.id);
      this.appendEvent(session.id, "session.updated", {
        kind: "task",
        workspaceId: targetWorkspace.id,
        promotedFrom: "personal",
      });
    });
    transaction();
    return { session: promoted, workspace: sourceWorkspace };
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

  listWorkspaceEvents(workspaceId: string, afterSequence = -1): Array<{
    id: string;
    workspaceId: string;
    sequence: number;
    kind: string;
    entityId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }> {
    this.requireWorkspace(workspaceId);
    const rows = this.sqlite.prepare(
      "SELECT id, workspace_id, sequence, kind, entity_id, payload, created_at FROM workspace_events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence",
    ).all(workspaceId, afterSequence) as Array<{
      id: string;
      workspace_id: string;
      sequence: number;
      kind: string;
      entity_id: string | null;
      payload: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      sequence: row.sequence,
      kind: row.kind,
      entityId: row.entity_id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  private insertWorkspaceDirectory(workspaceId: string, path: string, isRoot: boolean, createdAt: string): void {
    const normalized = canonicalPath(path);
    const owner = this.db.select().from(workspaceDirectories)
      .where(eq(workspaceDirectories.canonicalPath, normalized))
      .get();
    if (owner !== undefined && owner.workspaceId !== workspaceId) {
      throw new Error("This directory is already associated with another workspace.");
    }
    if (owner !== undefined) return;
    this.db.insert(workspaceDirectories).values({
      id: randomUUID(),
      workspaceId,
      path: normalized,
      canonicalPath: normalized,
      isRoot,
      createdAt,
    }).run();
  }

  private appendWorkspaceEvent(
    workspaceId: string,
    kind: string,
    entityId: string | null,
    payload: unknown,
  ): void {
    const row = this.sqlite.prepare(
      "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM workspace_events WHERE workspace_id = ?",
    ).get(workspaceId) as { sequence: number };
    this.db.insert(workspaceEvents).values({
      id: randomUUID(),
      workspaceId,
      sequence: row.sequence,
      kind,
      entityId,
      payload: JSON.stringify(payload),
      createdAt: timestamp(),
    }).run();
  }

  private createBoardInternal(input: {
    workspaceId: string;
    projectId: string | null;
    name: string;
    kind: Board["kind"];
  }): Board {
    const now = timestamp();
    const board = boardSchema.parse({
      id: randomUUID(),
      ...input,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.db.insert(boards).values(board).run();
    const statuses = this.listStatuses(input.workspaceId);
    const templates = statuses.length > 0
      ? [...statuses].sort((a, b) => a.position - b.position).map((status) => ({
        name: status.name,
        color: status.color,
        statusIds: [status.id],
        dropStatusId: status.id,
      }))
      : [
        { name: "Inbox", color: "#8a8275", statusIds: [], dropStatusId: null },
        { name: "In progress", color: "#5b7db1", statusIds: [], dropStatusId: null },
        { name: "Done", color: "#4f8f68", statusIds: [], dropStatusId: null },
      ];
    templates.forEach((template, position) => {
      this.db.insert(boardColumns).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        boardId: board.id,
        name: template.name,
        color: template.color,
        position,
        statusIds: JSON.stringify(template.statusIds),
        dropStatusId: template.dropStatusId,
        createdAt: now,
        updatedAt: now,
      }).run();
    });
    this.appendWorkspaceEvent(input.workspaceId, "board.created", board.id, board);
    return board;
  }

  private ensureDefaultBoard(workspaceId: string): Board {
    const row = this.db.select().from(boards).where(and(
      eq(boards.workspaceId, workspaceId),
      eq(boards.kind, "workspace"),
      isNull(boards.projectId),
    )).orderBy(asc(boards.createdAt)).get();
    return row === undefined
      ? this.createBoardInternal({ workspaceId, projectId: null, name: "Workspace", kind: "workspace" })
      : parseBoard(row);
  }

  private requireBoard(workspaceId: string, boardId: string): Board {
    const row = this.db.select().from(boards).where(and(
      eq(boards.id, boardId),
      eq(boards.workspaceId, workspaceId),
    )).get();
    if (row === undefined) throw new Error("Board not found.");
    return parseBoard(row);
  }

  private requireBoardColumn(workspaceId: string, boardId: string, columnId: string): BoardColumn {
    const row = this.db.select().from(boardColumns).where(and(
      eq(boardColumns.id, columnId),
      eq(boardColumns.workspaceId, workspaceId),
      eq(boardColumns.boardId, boardId),
    )).get();
    if (row === undefined) throw new Error("Board column not found.");
    return parseBoardColumn(row);
  }

  private bumpBoard(board: Board): void {
    this.db.update(boards).set({
      version: board.version + 1,
      updatedAt: timestamp(),
    }).where(eq(boards.id, board.id)).run();
  }

  private validateBoardStatusIds(workspaceId: string, statusIds: string[]): void {
    const known = new Set(this.listStatuses(workspaceId).map(({ id }) => id));
    for (const statusId of statusIds) {
      if (!known.has(statusId)) throw new Error("Board status belongs to a different workspace.");
    }
  }

  private ensureTaskBoardStates(task: Task): void {
    if (task.kind !== "task") return;
    const workspaceBoard = this.ensureDefaultBoard(task.workspaceId);
    this.ensureBoardState(task, workspaceBoard);
    if (task.projectId === null) return;
    const projectBoardRow = this.db.select().from(boards).where(and(
      eq(boards.workspaceId, task.workspaceId),
      eq(boards.projectId, task.projectId),
    )).get();
    if (projectBoardRow !== undefined) this.ensureBoardState(task, parseBoard(projectBoardRow));
  }

  private ensureBoardState(task: Task, board: Board): TaskBoardState {
    const existing = this.db.select().from(taskBoardState).where(and(
      eq(taskBoardState.taskId, task.id),
      eq(taskBoardState.boardId, board.id),
    )).get();
    if (existing !== undefined) return parseTaskBoardState(existing);
    const columns = this.listBoardColumns(board.workspaceId, board.id);
    if (columns.length === 0) throw new Error("Board has no columns.");
    const workflowStatusId = task.statusId;
    const mapped = workflowStatusId === null
      ? null
      : columns.find(({ statusIds }) => statusIds.includes(workflowStatusId));
    const column = mapped ?? columns[0]!;
    const last = this.db.select().from(taskBoardState).where(and(
      eq(taskBoardState.boardId, board.id),
      eq(taskBoardState.columnId, column.id),
    )).orderBy(desc(taskBoardState.rank)).get();
    const state = taskBoardStateSchema.parse({
      taskId: task.id,
      workspaceId: task.workspaceId,
      boardId: board.id,
      columnId: column.id,
      rank: (last?.rank ?? 0) + boardRankStep,
      version: 0,
      updatedAt: timestamp(),
    });
    this.db.insert(taskBoardState).values(state).run();
    return state;
  }

  private releaseReadyConductorNodes(run: ConductorRun, _completedNodeId: string): void {
    const states = new Map(this.listConductorNodeStates(run.workspaceId, run.id).map((state) => [state.nodeId, state]));
    for (const node of run.spec.nodes) {
      const state = states.get(node.id);
      if (state?.status !== "pending") continue;
      if (node.dependsOn.every((dependency) => states.get(dependency)?.status === "completed")) {
        this.db.update(conductorNodeStates).set({ status: "ready", updatedAt: timestamp() }).where(and(
          eq(conductorNodeStates.runId, run.id),
          eq(conductorNodeStates.nodeId, node.id),
        )).run();
      }
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (task === null) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }

  private requireWorkspace(workspaceId: string): Workspace {
    const workspace = this.getWorkspace(workspaceId);
    if (workspace === null) throw new Error(`Unknown work folder: ${workspaceId}`);
    return workspace;
  }

  private requireFolderWorkspace(workspaceId: string): Workspace {
    const workspace = this.requireWorkspace(workspaceId);
    if (workspace.kind !== "folder") throw new Error("This operation requires a work folder.");
    return workspace;
  }

  private assertSessionWorkspaceKind(workspace: Workspace, kind: Session["kind"]): void {
    if (kind === "chat" && workspace.kind !== "managed") {
      throw new Error("Personal sessions can only use private sandboxes.");
    }
    if (kind === "task" && workspace.kind !== "folder") {
      throw new Error("Tasks can only use work folders.");
    }
  }

  private workspaceIdOf(entity: DomainValue): string {
    if (!("workspaceId" in entity) || entity.workspaceId === null) {
      throw new Error("Resources must belong to a work folder.");
    }
    return entity.workspaceId;
  }

  private requireFolderDomainEntity<T extends DomainValue>(domain: FolderDomainName, id: string): T {
    const row = this.db.select().from(domainEntities).where(and(eq(domainEntities.id, id), eq(domainEntities.domain, domain))).get();
    if (row === undefined) throw new Error(`Unknown ${domain}: ${id}`);
    const schemas = {
      status: statusDefinitionSchema,
      label: labelSchema,
      source: sourceSchema,
      skill: skillSchema,
      automation: automationSchema,
    };
    const entity = schemas[domain].parse(JSON.parse(row.value)) as T;
    this.requireFolderWorkspace(this.workspaceIdOf(entity));
    return entity;
  }

  private validateSessionResources(workspace: Workspace, input: Partial<Pick<Session, "statusId" | "labelIds">>): void {
    if (input.statusId === undefined && input.labelIds === undefined) return;
    if (workspace.kind !== "folder") {
      if (input.statusId !== undefined && input.statusId !== null) {
        throw new Error("Personal sessions cannot use work stages.");
      }
      if (input.labelIds !== undefined && input.labelIds.length > 0) {
        throw new Error("Personal sessions cannot use work labels.");
      }
      return;
    }
    if (input.statusId !== undefined && input.statusId !== null) {
      const status = this.requireFolderDomainEntity<StatusDefinition>("status", input.statusId);
      if (this.workspaceIdOf(status) !== workspace.id) {
        throw new Error("Work stage belongs to a different work folder.");
      }
    }
    for (const labelId of input.labelIds ?? []) {
      const label = this.requireFolderDomainEntity<Label>("label", labelId);
      if (this.workspaceIdOf(label) !== workspace.id) {
        throw new Error("Work label belongs to a different work folder.");
      }
    }
  }

  private validateWorkingDirectory(workspace: Workspace, workingDirectory: string | null | undefined): void {
    if (workingDirectory === undefined || workingDirectory === null) return;
    if (!workspace.directories.some((directory) => pathInside(directory, workingDirectory))) {
      throw new Error("Working directory must be inside a folder associated with this workspace.");
    }
  }

  private validateAutomationReferences(automation: Automation, workspaceId: string): void {
    if (automation.trigger.type === "status_changed" && automation.trigger.statusId !== null) {
      const status = this.requireFolderDomainEntity<StatusDefinition>("status", automation.trigger.statusId);
      if (this.workspaceIdOf(status) !== workspaceId) throw new Error("Automation stage belongs to a different work folder.");
    }
    if (automation.trigger.type === "label_changed") {
      const label = this.requireFolderDomainEntity<Label>("label", automation.trigger.labelId);
      if (this.workspaceIdOf(label) !== workspaceId) throw new Error("Automation label belongs to a different work folder.");
    }
    if (automation.action.type === "send_prompt" && automation.action.sessionId !== null) {
      const session = this.requireTask(automation.action.sessionId);
      if (session.workspaceId !== workspaceId || session.kind !== "task") {
        throw new Error("Automation task belongs to a different work folder.");
      }
    }
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
    const task = this.requireTask(taskId);
    const row = this.sqlite.prepare(
      "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM events WHERE task_id = ?",
    ).get(taskId) as { sequence: number };
    const event = eventSchema.parse({
      protocolVersion: 1,
      workspaceId: task.workspaceId,
      taskId,
      sequence: row.sequence,
      timestamp: timestamp(),
      type,
      payload,
    });
    this.db.insert(events).values({
      id: randomUUID(),
      taskId,
      sequence: event.sequence,
      value: JSON.stringify(event),
    }).run();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        directories TEXT NOT NULL DEFAULT '[]',
        output_path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'folder',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
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
        sequence INTEGER NOT NULL,
        value TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS events_task_sequence ON events(task_id, sequence);
      CREATE TABLE IF NOT EXISTS workspace_directories (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        is_root INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workspace_directories_workspace ON workspace_directories(workspace_id);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#8a8275',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id, archived);
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS boards_project ON boards(workspace_id, project_id) WHERE project_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS boards_workspace_default ON boards(workspace_id) WHERE kind = 'workspace' AND project_id IS NULL;
      CREATE TABLE IF NOT EXISTS board_columns (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        status_ids TEXT NOT NULL DEFAULT '[]',
        drop_status_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS board_columns_board ON board_columns(board_id, position);
      CREATE TABLE IF NOT EXISTS task_board_state (
        task_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (task_id, board_id),
        UNIQUE (board_id, column_id, rank)
      );
      CREATE INDEX IF NOT EXISTS task_board_state_board ON task_board_state(board_id, column_id, rank);
      CREATE TABLE IF NOT EXISTS command_receipts (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_events (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        entity_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS conductor_runs (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        spec TEXT NOT NULL,
        last_event_sequence INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS conductor_runs_workspace_status ON conductor_runs(workspace_id, status);
      CREATE TABLE IF NOT EXISTS conductor_node_states (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        output TEXT,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, node_id)
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
      CREATE TABLE IF NOT EXISTS model_usage (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        workspace_id TEXT,
        request_id TEXT NOT NULL,
        message_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        response_model TEXT,
        api TEXT,
        stop_reason TEXT,
        input_tokens TEXT NOT NULL DEFAULT '0',
        output_tokens TEXT NOT NULL DEFAULT '0',
        cache_read_tokens TEXT NOT NULL DEFAULT '0',
        cache_write_tokens TEXT NOT NULL DEFAULT '0',
        reasoning_tokens TEXT NOT NULL DEFAULT '0',
        total_tokens TEXT NOT NULL DEFAULT '0',
        input_cost TEXT NOT NULL DEFAULT '0',
        output_cost TEXT NOT NULL DEFAULT '0',
        cache_read_cost TEXT NOT NULL DEFAULT '0',
        cache_write_cost TEXT NOT NULL DEFAULT '0',
        total_cost TEXT NOT NULL DEFAULT '0',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS model_usage_created_at ON model_usage(created_at);
      CREATE INDEX IF NOT EXISTS model_usage_task ON model_usage(task_id);
      CREATE TABLE IF NOT EXISTS telemetry_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        attempts TEXT NOT NULL DEFAULT '0',
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS telemetry_outbox_next_attempt ON telemetry_outbox(next_attempt_at);
    `);
    this.addColumn("workspaces", "kind", "TEXT NOT NULL DEFAULT 'folder'");
    this.addColumn("workspaces", "directories", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("workspaces", "version", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("workspaces", "updated_at", "TEXT");
    this.sqlite.exec("UPDATE workspaces SET directories = json_array(root_path) WHERE directories = '[]'");
    this.sqlite.exec("UPDATE workspaces SET updated_at = created_at WHERE updated_at IS NULL");
    this.addColumn("tasks", "project_id", "TEXT");
    this.addColumn("tasks", "provider_id", "TEXT");
    this.addColumn("tasks", "model_id", "TEXT");
    this.addColumn("tasks", "thinking_level", "TEXT NOT NULL DEFAULT 'off'");
    this.addColumn("tasks", "kind", "TEXT NOT NULL DEFAULT 'chat'");
    this.addColumn("tasks", "archived", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "flagged", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "unread", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "status_id", "TEXT");
    this.addColumn("tasks", "label_ids", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("tasks", "permission_mode", "TEXT NOT NULL DEFAULT 'ask'");
    this.addColumn("tasks", "plan_mode", "TEXT NOT NULL DEFAULT '0'");
    this.addColumn("tasks", "working_directory", "TEXT");
    this.addColumn("tasks", "running", "TEXT NOT NULL DEFAULT '0'");
    this.backfillWorkspaceDirectories();
    this.ensureIntegerEventSequence();
  }

  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === column)) {
      this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private backfillWorkspaceDirectories(): void {
    const existing = this.sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_directories").get() as { count: number };
    if (existing.count > 0) return;
    const rows = this.db.select().from(workspaces).all();
    const transaction = this.sqlite.transaction(() => {
      for (const row of rows) {
        const workspace = parseWorkspace(row);
        workspace.directories.forEach((directory, index) => {
          this.insertWorkspaceDirectory(workspace.id, directory, index === 0, workspace.createdAt);
        });
      }
    });
    transaction();
  }

  private ensureIntegerEventSequence(): void {
    const info = this.sqlite.prepare("PRAGMA table_info(events)").all() as Array<{ name: string; type: string }>;
    const sequence = info.find(({ name }) => name === "sequence");
    if (sequence?.type.toLocaleUpperCase() === "INTEGER") return;
    this.sqlite.exec(`
      DROP INDEX IF EXISTS events_task_sequence;
      ALTER TABLE events RENAME TO events_legacy;
      CREATE TABLE events (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        value TEXT NOT NULL
      );
      INSERT INTO events (id, task_id, sequence, value)
      SELECT id, task_id, CAST(sequence AS INTEGER), value FROM events_legacy;
      DROP TABLE events_legacy;
      CREATE UNIQUE INDEX events_task_sequence ON events(task_id, sequence);
    `);
  }
}
