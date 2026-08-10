import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Artifact, Task, Workspace } from "@pi-work/protocol";
import { resolveArtifactPath } from "@pi-work/policy";

export async function stageArtifact(
  workspace: Workspace,
  task: Task,
  artifact: Pick<Artifact, "relativePath" | "content">,
): Promise<string> {
  const stagingRoot = join(workspace.rootPath, ".pi-work", "runs", task.id, "staging");
  const stagedPath = resolveArtifactPath(stagingRoot, artifact.relativePath);
  await mkdir(dirname(stagedPath), { recursive: true });
  await writeFile(stagedPath, artifact.content, "utf8");
  return stagedPath;
}

export async function publishArtifact(
  workspace: Workspace,
  task: Task,
  artifact: Pick<Artifact, "relativePath" | "stagedPath">,
): Promise<string> {
  const publishRoot = join(workspace.outputPath, sanitizeTaskName(task.title));
  const destination = resolveArtifactPath(publishRoot, artifact.relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(artifact.stagedPath, destination);
  return destination;
}

function sanitizeTaskName(title: string): string {
  const compact = title.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, " ");
  return compact.length === 0 ? "untitled-task" : compact.slice(0, 80);
}
