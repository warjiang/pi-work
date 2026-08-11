import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { labelSchema, statusDefinitionSchema } from "@pi-work/protocol";
import { PiWorkStore } from "./index.js";

describe("PiWorkStore", () => {
  it("requires plan approval before recording an artifact", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Decision brief",
      goal: "Compare supplied documents.",
    });

    expect(() => store.createArtifact({
      taskId: task.id,
      relativePath: "brief.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/brief.md",
      content: "# Brief",
    })).toThrow("approved plan");

    store.close();
  });

  it("persists a run alongside the task lifecycle", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Decision brief",
      goal: "Compare supplied documents.",
    });

    expect(store.getLatestRun(task.id)?.status).toBe("draft");
    expect(store.listRuns(task.id)).toHaveLength(1);
    expect(store.completeTask(task.id).status).toBe("completed");
    expect(store.getLatestRun(task.id)?.completedAt).not.toBeNull();

    store.close();
  });

  it("stores chat messages and updates a slash-command goal", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Compare the options",
      goal: "Compare the options",
    });

    store.addMessage({ taskId: task.id, role: "user", content: "Compare the options" });
    store.addMessage({ taskId: task.id, role: "assistant", content: "Which constraints matter?" });

    expect(store.listMessages(task.id).map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(store.updateTaskGoal(task.id, "Choose the safest option").goal).toBe("Choose the safest option");
    store.close();
  });

  it("stores managed conversations, model selection, and app defaults", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Chat",
      rootPath: "/tmp/pi-work-chat",
      outputPath: "/tmp/pi-work-chat/Pi Work",
      kind: "managed",
    });
    const task = store.createTask({
      workspaceId: workspace.id,
      title: "Hello",
      goal: "Hello",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "high",
      kind: "chat",
    });

    expect(store.listManagedConversations()[0]?.task.id).toBe(task.id);
    const chatSelection = {
      providerId: "openai",
      modelId: "gpt-5",
      thinkingLevel: "medium" as const,
      workspaceId: null,
    };

    expect(store.updateTaskModel(task.id, chatSelection).modelId).toBe("gpt-5");
    expect(store.getTask(task.id)?.workspaceId).toBe(workspace.id);
    expect(store.updateAppSettings({ onboardingSkipped: true }).onboardingSkipped).toBe(true);
    expect(store.removeConversation(task.id).workspace.kind).toBe("managed");
    expect(store.getWorkspace(workspace.id)).toBeNull();
    store.close();
  });

  it("enforces the personal-session and work-folder-task matrix", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });

    expect(() => store.createTask({ workspaceId: folder.id, title: "Chat", goal: "Chat", kind: "chat" })).toThrow("private sandboxes");
    expect(() => store.createTask({ workspaceId: managed.id, title: "Task", goal: "Task", kind: "task" })).toThrow("work folders");
    expect(store.createTask({ workspaceId: folder.id, title: "Task", goal: "Task", kind: "task" }).kind).toBe("task");
    expect(store.createTask({ workspaceId: managed.id, title: "Chat", goal: "Chat", kind: "chat" }).kind).toBe("chat");
    store.close();
  });

  it("keeps workflow resources within their work folder and ignores legacy global resources", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first",
      outputPath: "/workspace/first/Pi Work",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const firstTask = store.createTask({ workspaceId: first.id, title: "First", goal: "First" });
    const secondTask = store.createTask({ workspaceId: second.id, title: "Second", goal: "Second" });
    const status = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: first.id,
      name: "Review",
      color: "#786",
      position: 0,
    });
    const label = store.createDomainEntity("label", labelSchema, {
      workspaceId: first.id,
      parentId: null,
      name: "Important",
      color: "#786",
    });
    const legacyId = randomUUID();
    const now = new Date().toISOString();
    const sqlite = (store as unknown as { sqlite: Database.Database }).sqlite;
    sqlite.prepare("INSERT INTO domain_entities (id, domain, workspace_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      legacyId,
      "source",
      null,
      JSON.stringify({
        id: legacyId,
        workspaceId: null,
        name: "Legacy source",
        type: "local",
        enabled: false,
        config: {},
        createdAt: now,
        updatedAt: now,
      }),
      now,
      now,
    );

    expect(() => store.createSource({ workspaceId: managed.id, name: "Private", type: "local", enabled: false, config: {} })).toThrow("work folder");
    expect(() => store.listSources(managed.id)).toThrow("work folder");
    expect(store.listSources(first.id)).toEqual([]);
    expect(() => store.updateSession(secondTask.id, { statusId: status.id })).toThrow("different work folder");
    expect(() => store.updateSession(secondTask.id, { labelIds: [label.id] })).toThrow("different work folder");
    expect(store.updateSession(firstTask.id, { statusId: status.id, labelIds: [label.id] })).toMatchObject({
      statusId: status.id,
      labelIds: [label.id],
    });
    store.close();
  });

  it("promotes a personal session into a folder task without losing its history", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const personal = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const session = store.createTask({
      workspaceId: personal.id,
      title: "Research options",
      goal: "Compare the available approaches.",
      kind: "chat",
      workingDirectory: personal.rootPath,
    });
    store.addMessage({ taskId: session.id, role: "user", content: "Compare the available approaches." });
    store.addMessage({ taskId: session.id, role: "assistant", content: "I found three viable options." });
    store.addActivity({
      sessionId: session.id,
      messageId: null,
      kind: "notice",
      title: "Research complete",
      detail: "The comparison is ready.",
      metadata: {},
    });
    const attachment = store.addAttachment({
      sessionId: session.id,
      messageId: null,
      name: "notes.pdf",
      path: "/tmp/pi-work-personal/notes.pdf",
      mimeType: "application/pdf",
      size: 42,
    });
    store.savePlan({
      taskId: session.id,
      summary: "Write up the options.",
      steps: [{ id: randomUUID(), title: "Compare", detail: "Compare the candidates." }],
      sources: [],
    });
    store.approvePlan(session.id, true);
    const staged = store.createArtifact({
      taskId: session.id,
      relativePath: "comparison.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/pi-work-personal/.pi-work/runs/session/staging/comparison.md",
      content: "# Comparison",
    });
    const published = store.createArtifact({
      taskId: session.id,
      relativePath: "published.md",
      mimeType: "text/markdown",
      stagedPath: "/tmp/pi-work-personal/.pi-work/runs/session/staging/published.md",
      content: "# Published",
    });
    store.publishArtifact(published.id, "/tmp/pi-work-personal/published.md");
    store.updateSession(session.id, {
      archived: true,
      flagged: true,
      unread: true,
      planMode: false,
      workingDirectory: personal.rootPath,
    });

    const targetStagedPath = "/workspace/product/.pi-work/runs/session/staging/comparison.md";
    const result = store.promoteManagedSession({
      sessionId: session.id,
      workspaceId: folder.id,
      stagedPaths: { [staged.id]: targetStagedPath },
    });

    expect(result.session).toEqual(expect.objectContaining({
      id: session.id,
      workspaceId: folder.id,
      kind: "task",
      status: "draft",
      archived: false,
      flagged: false,
      unread: false,
      statusId: null,
      labelIds: [],
      planMode: true,
      workingDirectory: folder.rootPath,
      running: false,
    }));
    expect(store.getWorkspace(personal.id)).toBeNull();
    expect(store.listMessages(session.id)).toHaveLength(2);
    expect(store.getPlan(session.id)).toEqual(expect.objectContaining({ summary: "Write up the options." }));
    expect(store.listActivities(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Research complete" }),
    ]));
    expect(store.getAttachment(attachment.id)?.path).toBe("/tmp/pi-work-personal/notes.pdf");
    expect(store.getArtifact(staged.id)?.stagedPath).toBe(targetStagedPath);
    expect(store.getArtifact(published.id)?.publishedPath).toBe("/tmp/pi-work-personal/published.md");
    expect(store.getLatestRun(session.id)).toEqual(expect.objectContaining({ status: "draft", completedAt: null }));
    store.close();
  });

  it("rejects invalid personal-session promotions without changing data", () => {
    const store = new PiWorkStore();
    const folder = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const managed = store.createWorkspace({
      name: "Personal",
      rootPath: "/tmp/pi-work-personal",
      outputPath: "/tmp/pi-work-personal/Pi Work",
      kind: "managed",
    });
    const personal = store.createTask({ workspaceId: managed.id, title: "Research", goal: "Research", kind: "chat" });
    const folderTask = store.createTask({ workspaceId: folder.id, title: "Implement", goal: "Implement" });
    const running = store.updateSession(personal.id, { running: true });

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: folder.id,
      stagedPaths: {},
    })).toThrow("Stop this personal session");
    expect(store.getTask(personal.id)).toEqual(running);

    expect(() => store.promoteManagedSession({
      sessionId: folderTask.id,
      workspaceId: folder.id,
      stagedPaths: {},
    })).toThrow("Only personal sessions");
    expect(store.getTask(folderTask.id)).toEqual(folderTask);

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: managed.id,
      stagedPaths: {},
    })).toThrow("requires a work folder");
    expect(store.getTask(personal.id)).toEqual(running);

    expect(() => store.promoteManagedSession({
      sessionId: personal.id,
      workspaceId: randomUUID(),
      stagedPaths: {},
    })).toThrow("Unknown work folder");
    expect(store.getWorkspace(managed.id)?.kind).toBe("managed");
    store.close();
  });

  it("never removes a folder workspace with its conversation", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Research",
      rootPath: "/workspace/research",
      outputPath: "/workspace/research/Pi Work",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Chat", goal: "Chat" });

    store.removeConversation(task.id);
    expect(store.getWorkspace(workspace.id)?.kind).toBe("folder");
    store.close();
  });

  it("keeps legacy project data without reading or deleting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-storage-"));
    const filename = join(directory, "legacy.db");
    const workspaceId = randomUUID();
    const taskId = randomUUID();
    const projectId = randomUUID();
    const createdAt = new Date().toISOString();
    const sqlite = new Database(filename);
    sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE domain_entities (
        id TEXT PRIMARY KEY NOT NULL,
        domain TEXT NOT NULL,
        workspace_id TEXT,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqlite.prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)").run(
      workspaceId,
      "Legacy",
      "/workspace/legacy",
      "/workspace/legacy/Pi Work",
      createdAt,
    );
    sqlite.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      taskId,
      workspaceId,
      projectId,
      "Existing task",
      "Keep this task",
      "draft",
      createdAt,
      createdAt,
    );
    sqlite.prepare("INSERT INTO domain_entities VALUES (?, ?, ?, ?, ?, ?)").run(
      projectId,
      "project",
      workspaceId,
      JSON.stringify({ name: "Legacy project" }),
      createdAt,
      createdAt,
    );
    sqlite.close();

    const store = new PiWorkStore(filename);
    expect(store.getWorkspace(workspaceId)?.kind).toBe("folder");
    expect(store.getTask(taskId)).toEqual(expect.objectContaining({
      title: "Existing task",
      providerId: null,
      modelId: null,
      thinkingLevel: "off",
    }));
    store.close();

    const migrated = new Database(filename);
    const taskColumns = migrated.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(taskColumns.map(({ name }) => name)).toContain("project_id");
    expect(migrated.prepare("SELECT project_id FROM tasks WHERE id = ?").get(taskId)).toEqual({ project_id: projectId });
    expect(migrated.prepare("SELECT domain FROM domain_entities WHERE id = ?").get(projectId)).toEqual({ domain: "project" });
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("searches session metadata and message content while preserving session controls", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const session = store.createTask({
      workspaceId: workspace.id,
      title: "Desktop parity",
      goal: "Implement the application shell",
      permissionMode: "explore",
    });
    store.addMessage({ taskId: session.id, role: "user", content: "Build a searchable kanban board" });
    const updated = store.updateSession(session.id, { status: "reviewing", flagged: true, archived: true, permissionMode: "auto" });

    expect(updated).toEqual(expect.objectContaining({ status: "reviewing", flagged: true, archived: true, permissionMode: "auto" }));
    expect(store.listSessions({ query: "kanban" }).map(({ id }) => id)).toEqual([session.id]);
    expect(store.listSessions({ archived: true }).map(({ id }) => id)).toEqual([session.id]);
    store.close();
  });

  it("keeps session search scoped to a work folder", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first",
      outputPath: "/workspace/first/Pi Work",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/Pi Work",
    });
    const matching = store.createTask({ workspaceId: first.id, title: "First", goal: "First" });
    const excluded = store.createTask({ workspaceId: second.id, title: "Second", goal: "Second" });
    store.addMessage({ taskId: matching.id, role: "user", content: "shared search phrase" });
    store.addMessage({ taskId: excluded.id, role: "user", content: "shared search phrase" });

    expect(store.listSessions({ workspaceId: first.id, query: "shared" }).map(({ id }) => id)).toEqual([matching.id]);
    store.close();
  });

  it("stores sources, skills, automations, activities, and attachments", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const session = store.createTask({ workspaceId: workspace.id, title: "Ship", goal: "Ship" });
    expect(store.createSource({
      workspaceId: workspace.id,
      name: "Repository",
      type: "local",
      enabled: true,
      config: { path: workspace.rootPath },
    }).type).toBe("local");
    expect(store.createSkill({
      workspaceId: workspace.id,
      name: "Reviewer",
      description: "",
      instructions: "Review changes.",
      enabled: true,
    }).enabled).toBe(true);
    expect(store.createAutomation({
      workspaceId: workspace.id,
      name: "Daily review",
      enabled: false,
      trigger: { type: "schedule", cron: "0 9 * * 1-5" },
      action: { type: "send_prompt", sessionId: session.id, prompt: "Review progress" },
      lastRunAt: null,
    }).trigger.type).toBe("schedule");
    store.addActivity({
      sessionId: session.id,
      messageId: null,
      kind: "tool_call",
      title: "read",
      detail: "Read package.json",
      metadata: {},
    });
    const attachment = store.addAttachment({
      sessionId: session.id,
      messageId: null,
      name: "brief.pdf",
      path: "/workspace/product/brief.pdf",
      mimeType: "application/pdf",
      size: 42,
    });

    expect(store.listSources(workspace.id)).toHaveLength(1);
    expect(store.listSkills(workspace.id)).toHaveLength(1);
    expect(store.listAutomations(workspace.id)).toHaveLength(1);
    expect(store.listActivities(session.id)).toHaveLength(1);
    expect(store.listAttachments(session.id)).toHaveLength(1);
    expect(store.getAttachment(attachment.id)?.path).toBe("/workspace/product/brief.pdf");
    store.removeConversation(session.id);
    expect(store.getAttachment(attachment.id)).toBeNull();
    store.close();
  });
});
