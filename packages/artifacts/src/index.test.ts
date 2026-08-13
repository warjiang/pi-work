import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { publishArtifact, stageArtifact } from "./index.js";

describe("artifact lifecycle", () => {
  it("stages then publishes an artifact under the workspace output directory", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pi-work-artifact-"));
    const taskId = randomUUID();
    const workspace = {
      id: randomUUID(),
      name: "Research",
      rootPath,
      directories: [rootPath],
      outputPath: join(rootPath, "Pi Work"),
      kind: "folder" as const,
      createdAt: new Date().toISOString(),
    };
    const task = {
      id: taskId,
      workspaceId: workspace.id,
      title: "Decision brief",
      goal: "Summarize sources",
      status: "running" as const,
      providerId: null,
      modelId: null,
      thinkingLevel: "off" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const stagedPath = await stageArtifact(workspace, task, {
      relativePath: "brief.md",
      content: "# Decision",
    });
    const publishedPath = await publishArtifact(workspace, task, {
      relativePath: "brief.md",
      stagedPath,
    });

    await expect(readFile(publishedPath, "utf8")).resolves.toBe("# Decision");
  });
});
