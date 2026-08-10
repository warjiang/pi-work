import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
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

  it("migrates existing workspaces and tasks without losing data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-storage-"));
    const filename = join(directory, "legacy.db");
    const workspaceId = randomUUID();
    const taskId = randomUUID();
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
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
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
    sqlite.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      taskId,
      workspaceId,
      "Existing task",
      "Keep this task",
      "draft",
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
    await rm(directory, { recursive: true, force: true });
  });
});
