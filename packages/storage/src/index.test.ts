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

    expect(store.getLatestRun(task.id)?.status).toBe("planning");
    expect(store.listRuns(task.id)).toHaveLength(1);
    expect(store.completeTask(task.id).status).toBe("completed");
    expect(store.getLatestRun(task.id)?.completedAt).not.toBeNull();

    store.close();
  });
});
