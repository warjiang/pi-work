import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@openwork/testkit";
import { publishArtifact, stageArtifact } from "@pi-work/artifacts";
import { PiAdapter } from "@pi-work/pi-adapter";
import { PiWorkStore } from "@pi-work/storage";

test("an approved plan gates a staged artifact and explicit publication", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "pi-work-eval-"));
  const store = new PiWorkStore();
  const workspace = store.createWorkspace({
    name: "Research",
    rootPath,
    outputPath: join(rootPath, "Pi Work"),
  });
  const task = store.createTask({
    workspaceId: workspace.id,
    title: "Decision brief",
    goal: "Summarize the authorized notes.",
  });
  const plan = new PiAdapter().createPlanningFallback(task);

  store.savePlan(plan);
  expect(store.getTask(task.id)?.status).toBe("awaiting_plan_approval");
  expect(store.listArtifacts(task.id)).toHaveLength(0);

  const approvedTask = store.approvePlan(task.id, true);
  expect(approvedTask.status).toBe("running");

  const content = "# Decision brief\n\nApproved findings.";
  const stagedPath = await stageArtifact(workspace, approvedTask, {
    relativePath: "decision-brief.md",
    content,
  });
  const artifact = store.createArtifact({
    taskId: task.id,
    relativePath: "decision-brief.md",
    mimeType: "text/markdown",
    stagedPath,
    content,
  });
  expect(artifact.publishedPath).toBeNull();

  const publishedPath = await publishArtifact(workspace, approvedTask, artifact);
  const published = store.publishArtifact(artifact.id, publishedPath);
  expect(published.publishedPath).toBe(publishedPath);
  await expect(readFile(publishedPath, "utf8")).resolves.toBe(content);
  expect(store.completeTask(task.id).status).toBe("completed");
  expect(store.getLatestRun(task.id)?.completedAt).not.toBeNull();
  expect(store.listEvents(task.id).map((event) => event.type)).toEqual([
    "task.created",
    "plan.proposed",
    "plan.approved",
    "artifact.staged",
    "artifact.published",
    "task.completed",
  ]);

  store.close();
});
