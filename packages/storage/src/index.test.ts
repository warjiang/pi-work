import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { labelSchema, statusDefinitionSchema } from "@pi-work/protocol";
import { PiWorkStore } from "./index.js";

describe("PiWorkStore", () => {
  it("associates multiple directories with a workspace and bounds task working directories", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });

    expect(workspace.directories).toEqual(["/workspace/product"]);
    expect(store.addWorkspaceDirectory(workspace.id, "/workspace/docs").directories).toEqual([
      "/workspace/product",
      "/workspace/docs",
    ]);
    expect(store.createTask({
      workspaceId: workspace.id,
      title: "Docs",
      goal: "Update the docs",
      workingDirectory: "/workspace/docs/guides",
    }).workingDirectory).toBe("/workspace/docs/guides");
    expect(() => store.createTask({
      workspaceId: workspace.id,
      title: "Outside",
      goal: "Touch another project",
      workingDirectory: "/workspace/other",
    })).toThrow("associated with this workspace");

    store.close();
  });

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
    expect(store.getAppSettings().disabledModelKeys).toEqual([]);
    expect(store.updateAppSettings({ disabledModelKeys: ["openai/gpt-5"] }).disabledModelKeys).toEqual(["openai/gpt-5"]);
    expect(store.updateAppSettings({ modelId: "gpt-5-mini" }).disabledModelKeys).toEqual(["openai/gpt-5"]);
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

  it("stores MCP servers globally while regular sources remain folder-scoped", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const mcp = store.createSource({
      workspaceId: null,
      name: "Remote tools",
      type: "mcp_http",
      enabled: true,
      config: {
        url: "https://example.com/mcp",
        transport: "streamable_http",
        headers: {},
        auth: "none",
      },
    });

    expect(store.listGlobalMcpSources()).toEqual([mcp]);
    expect(store.listSources(workspace.id)).toEqual([]);
    expect(() => store.createSource({
      workspaceId: null,
      name: "Global files",
      type: "local",
      enabled: false,
      config: {},
    })).toThrow("work folder");

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

  it("aggregates model usage into totals, by-model and by-day summaries", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product",
      outputPath: "/workspace/product/Pi Work",
    });
    const base = {
      taskId: "task-1",
      workspaceId: workspace.id,
      requestId: "req-1",
      messageId: null,
      responseModel: null,
      api: null,
      stopReason: null,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
    };
    store.recordModelUsage({
      ...base,
      provider: "anthropic",
      model: "claude",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      totalCost: 0.3,
    });
    store.recordModelUsage({
      ...base,
      provider: "anthropic",
      model: "claude",
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      totalCost: 0.6,
    });
    store.recordModelUsage({
      ...base,
      provider: "openai",
      model: "gpt",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      totalCost: 0.05,
    });

    const summary = store.usageSummary();
    expect(summary.totals.requests).toBe(3);
    expect(summary.totals.totalTokens).toBe(465);
    expect(summary.totals.totalCost).toBeCloseTo(0.95, 5);
    // Ordered by total cost descending: claude (0.9) then gpt (0.05).
    expect(summary.byModel).toHaveLength(2);
    expect(summary.byModel[0]?.model).toBe("claude");
    expect(summary.byModel[0]?.requests).toBe(2);
    expect(summary.byModel[0]?.totalCost).toBeCloseTo(0.9, 5);
    expect(summary.byModel[1]?.model).toBe("gpt");
    expect(summary.byDay).toHaveLength(1);
    expect(summary.byDay[0]?.totalTokens).toBe(465);

    // Filtering by a different workspace yields empty aggregates.
    const empty = store.usageSummary({ since: null, until: null, workspaceId: "other" });
    expect(empty.totals.requests).toBe(0);
    expect(empty.totals.totalCost).toBe(0);
    expect(empty.byModel).toHaveLength(0);
    store.close();
  });

  it("stores and retries telemetry outbox entries and drops them when delivered", () => {
    const store = new PiWorkStore();
    const future = "2999-01-01T00:00:00.000Z";
    store.enqueueTelemetry("{\"a\":1}");
    store.enqueueTelemetry("{\"b\":2}", future);
    expect(store.countTelemetryOutbox()).toBe(2);

    // Only entries whose next attempt is due are returned.
    const due = store.listDueTelemetry();
    expect(due).toHaveLength(1);
    expect(due[0]?.payload).toBe("{\"a\":1}");
    expect(due[0]?.attempts).toBe(0);

    // Recording a retry defers it into the future so it is no longer due now.
    store.markTelemetryRetry(due[0]!.id, 1, future);
    expect(store.listDueTelemetry()).toHaveLength(0);
    expect(store.countTelemetryOutbox()).toBe(2);

    store.deleteTelemetry(due[0]!.id);
    expect(store.countTelemetryOutbox()).toBe(1);
    store.close();
  });

  it("persists observability config with defaults and partial updates", () => {
    const store = new PiWorkStore();
    expect(store.getObservabilityConfig()).toEqual({
      enabled: false,
      host: "",
      publicKey: "",
      captureContent: true,
    });
    const updated = store.setObservabilityConfig({ enabled: true, host: "https://lf.example.com" });
    expect(updated.enabled).toBe(true);
    expect(updated.host).toBe("https://lf.example.com");
    expect(updated.captureContent).toBe(true);
    // Partial update leaves prior values intact.
    store.setObservabilityConfig({ publicKey: "pk-lf-1" });
    const reloaded = store.getObservabilityConfig();
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.host).toBe("https://lf.example.com");
    expect(reloaded.publicKey).toBe("pk-lf-1");
    store.close();
  });

  it("enforces canonical workspace directory ownership and protects the root", () => {
    const store = new PiWorkStore();
    const first = store.createWorkspace({
      name: "First",
      rootPath: "/workspace/first/../shared",
      outputPath: "/workspace/shared/output",
    });
    const second = store.createWorkspace({
      name: "Second",
      rootPath: "/workspace/second",
      outputPath: "/workspace/second/output",
    });
    expect(() => store.addWorkspaceDirectory(second.id, "/workspace/shared")).toThrow("another workspace");
    const root = store.listWorkspaceDirectories(first.id).find(({ isRoot }) => isRoot);
    expect(root).toBeDefined();
    expect(() => store.removeWorkspaceDirectory(first.id, root!.id)).toThrow("root directory");
    store.close();
  });

  it("keeps workflow status separate from durable board placement and makes moves idempotent", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/product-board",
      outputPath: "/workspace/product-board/output",
    });
    const todo = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: workspace.id,
      name: "To do",
      color: "#888",
      position: 0,
      category: "open",
    });
    const done = store.createDomainEntity("status", statusDefinitionSchema, {
      workspaceId: workspace.id,
      name: "Done",
      color: "#484",
      position: 1,
      category: "closed",
    });
    const createdTask = store.createTask({ workspaceId: workspace.id, title: "Ship", goal: "Ship it" });
    const task = store.updateSession(createdTask.id, { statusId: todo.id });
    const initial = store.getBoardSnapshot(workspace.id);
    const target = initial.columns.find(({ dropStatusId }) => dropStatusId === done.id)!;
    const state = initial.states.find(({ taskId }) => taskId === task.id)!;
    const commandId = randomUUID();
    const moved = store.moveBoardCard({
      commandId,
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: target.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    });
    expect(moved.states.find(({ taskId }) => taskId === task.id)?.columnId).toBe(target.id);
    expect(store.getTask(task.id)?.statusId).toBe(done.id);
    expect(store.moveBoardCard({
      commandId,
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: target.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    })).toEqual(moved);
    expect(() => store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: task.id,
      toColumnId: initial.columns[0]!.id,
      beforeTaskId: null,
      afterTaskId: null,
      expectedVersion: state.version,
    })).toThrow("another command");
    store.close();
  });

  it("creates project boards and removes stale project placement when a task changes project", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/project-boards",
      outputPath: "/workspace/project-boards/output",
    });
    const first = store.createProject({ workspaceId: workspace.id, name: "First" });
    const second = store.createProject({ workspaceId: workspace.id, name: "Second" });
    const boards = store.listBoards(workspace.id);
    const firstBoard = boards.find(({ projectId }) => projectId === first.id)!;
    const secondBoard = boards.find(({ projectId }) => projectId === second.id)!;
    const task = store.createTask({ workspaceId: workspace.id, projectId: first.id, title: "Task", goal: "Do it" });
    expect(store.getBoardSnapshot(workspace.id, firstBoard.id).states.some(({ taskId }) => taskId === task.id)).toBe(true);
    store.updateSession(task.id, { projectId: second.id });
    expect(store.getBoardSnapshot(workspace.id, firstBoard.id).states.some(({ taskId }) => taskId === task.id)).toBe(false);
    expect(store.getBoardSnapshot(workspace.id, secondBoard.id).states.some(({ taskId }) => taskId === task.id)).toBe(true);
    store.close();
  });

  it("places board cards before and after exact neighboring tasks", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Ordered board",
      rootPath: "/workspace/ordered-board",
      outputPath: "/workspace/ordered-board/output",
    });
    const first = store.createTask({ workspaceId: workspace.id, title: "First", goal: "First" });
    const second = store.createTask({ workspaceId: workspace.id, title: "Second", goal: "Second" });
    const third = store.createTask({ workspaceId: workspace.id, title: "Third", goal: "Third" });
    const initial = store.getBoardSnapshot(workspace.id);
    const columnId = initial.columns[0]!.id;
    const thirdState = initial.states.find(({ taskId }) => taskId === third.id)!;

    const before = store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: third.id,
      toColumnId: columnId,
      beforeTaskId: first.id,
      afterTaskId: null,
      expectedVersion: thirdState.version,
    });
    expect(before.states.filter(({ columnId: id }) => id === columnId).map(({ taskId }) => taskId))
      .toEqual([third.id, first.id, second.id]);

    const firstState = before.states.find(({ taskId }) => taskId === first.id)!;
    const after = store.moveBoardCard({
      commandId: randomUUID(),
      workspaceId: workspace.id,
      boardId: initial.board.id,
      taskId: first.id,
      toColumnId: columnId,
      beforeTaskId: null,
      afterTaskId: second.id,
      expectedVersion: firstState.version,
    });
    expect(after.states.filter(({ columnId: id }) => id === columnId).map(({ taskId }) => taskId))
      .toEqual([third.id, second.id, first.id]);
    store.close();
  });

  it("persists conductor dependencies, leases, retries, and pause state", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Product",
      rootPath: "/workspace/conductor",
      outputPath: "/workspace/conductor/output",
    });
    const task = store.createTask({ workspaceId: workspace.id, title: "Research", goal: "Synthesize" });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const run = store.createConductorRun({
      workspaceId: workspace.id,
      taskId: task.id,
      spec: {
        maxParallel: 2,
        nodes: [
          { id: firstId, title: "Collect", prompt: "Collect facts", dependsOn: [], maxAttempts: 2 },
          { id: secondId, title: "Write", prompt: "Write result", dependsOn: [firstId], maxAttempts: 1 },
        ],
      },
    });
    const initialStates = new Map(store.listConductorNodeStates(workspace.id, run.id).map((state) => [state.nodeId, state.status]));
    expect(initialStates.get(firstId)).toBe("ready");
    expect(initialStates.get(secondId)).toBe("pending");
    expect(store.claimConductorRun(workspace.id, run.id, "owner-a").leaseOwner).toBe("owner-a");
    expect(() => store.claimConductorRun(workspace.id, run.id, "owner-b")).toThrow("leased");
    store.updateConductorNodeState(workspace.id, run.id, firstId, {
      status: "completed",
      attempt: 1,
      output: "facts",
      completedAt: new Date().toISOString(),
    });
    expect(store.listConductorNodeStates(workspace.id, run.id).find(({ nodeId }) => nodeId === secondId)?.status).toBe("ready");
    expect(store.updateConductorRunStatus(workspace.id, run.id, "paused").status).toBe("paused");
    store.close();
  });

  it("orders workspace and task event sequences numerically beyond ten events", () => {
    const store = new PiWorkStore();
    const workspace = store.createWorkspace({
      name: "Events",
      rootPath: "/workspace/events",
      outputPath: "/workspace/events/output",
    });
    for (let index = 0; index < 12; index += 1) {
      store.updateWorkspace(workspace.id, { name: `Events ${index}` });
    }
    const task = store.createTask({ workspaceId: workspace.id, title: "Events", goal: "Test ordering" });
    for (let index = 0; index < 12; index += 1) {
      store.updateSession(task.id, { title: `Task ${index}` });
    }
    const workspaceSequences = store.listWorkspaceEvents(workspace.id).map(({ sequence }) => sequence);
    expect(workspaceSequences).toEqual(Array.from({ length: workspaceSequences.length }, (_, index) => index));
    expect(workspaceSequences.at(-1)).toBeGreaterThan(10);
    const sequences = store.listEvents(task.id).map(({ sequence }) => sequence);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(sequences.at(-1)).toBeGreaterThan(10);
    store.close();
  });
});
