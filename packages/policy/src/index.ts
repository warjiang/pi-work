import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(path: string) {
    super(`Path is outside the authorized workspace: ${path}`);
    this.name = "WorkspaceBoundaryError";
  }
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

export async function resolveAuthorizedPath(rootPath: string, requestedPath: string): Promise<string> {
  const canonicalRoot = await realpath(rootPath);
  const unresolvedCandidate = resolve(canonicalRoot, requestedPath);
  if (!isWithin(canonicalRoot, unresolvedCandidate)) {
    throw new WorkspaceBoundaryError(requestedPath);
  }
  const candidate = await realpath(unresolvedCandidate);
  if (!isWithin(canonicalRoot, candidate)) {
    throw new WorkspaceBoundaryError(requestedPath);
  }

  return candidate;
}

export function resolveArtifactPath(stagingRoot: string, relativePath: string): string {
  const candidate = resolve(stagingRoot, relativePath);
  if (!isWithin(stagingRoot, candidate)) {
    throw new WorkspaceBoundaryError(relativePath);
  }

  return candidate;
}
