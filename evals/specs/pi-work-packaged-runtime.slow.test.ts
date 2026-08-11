import { access, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@openwork/testkit";

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = resolve(repositoryRoot, "apps/desktop/build/pi-runtime");

async function symbolicLinks(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const childPath = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      return [childPath];
    }
    if (entry.isDirectory()) {
      return symbolicLinks(childPath);
    }
    return [];
  }));
  return nested.flat();
}

test("the packaged Pi runtime is built inside the application without a global Pi install", async () => {
  const options = { cwd: repositoryRoot, env: { ...process.env, CI: "true" } };
  await executeFile("pnpm", ["--filter", "@pi-work/desktop", "build"], options);
  await executeFile("pnpm", ["prepare:pi"], options);

  await expect(access(resolve(runtimeRoot, "agent-service.js"))).resolves.toBeUndefined();
  await expect(access(resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent/package.json"))).resolves.toBeUndefined();
  await expect(symbolicLinks(runtimeRoot)).resolves.toEqual([]);
}, 120_000);
