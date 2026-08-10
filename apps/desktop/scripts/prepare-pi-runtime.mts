import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const workspaceDirectory = resolve(packageDirectory, "..", "..");
const runtimeDirectory = resolve(packageDirectory, "build", "pi-runtime");
const agentEntry = resolve(packageDirectory, "out", "main", "agent-service.js");
const agentChunks = resolve(packageDirectory, "out", "main", "chunks");
const pnpmCli = process.env.npm_execpath;
const deployArguments = [
  "--filter",
  "@pi-work/pi-adapter",
  "deploy",
  "--prod",
  "--legacy",
];
const deployedDirectory = await mkdtemp(join(tmpdir(), "pi-work-runtime-"));

async function runPnpm(arguments_: string[], environment = process.env): Promise<void> {
  await execFileAsync(
    pnpmCli === undefined ? (process.platform === "win32" ? "pnpm.cmd" : "pnpm") : process.execPath,
    pnpmCli === undefined ? arguments_ : [pnpmCli, ...arguments_],
    { cwd: workspaceDirectory, env: environment },
  );
}

try {
  await rm(runtimeDirectory, { recursive: true, force: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await runPnpm([...deployArguments, deployedDirectory]);
  const runtimeModules = resolve(runtimeDirectory, "node_modules");
  await mkdir(runtimeModules, { recursive: true });
  const sourceDirectories = [
    {
      path: resolve(deployedDirectory, "node_modules", ".pnpm", "node_modules"),
      skip: new Set(["@pi-work"]),
    },
    {
      path: resolve(deployedDirectory, "node_modules"),
      skip: new Set<string>(),
    },
  ];
  for (const sourceDirectory of sourceDirectories) {
    for (const entry of await readdir(sourceDirectory.path)) {
      if (entry.startsWith(".") || sourceDirectory.skip.has(entry)) {
        continue;
      }
      await cp(resolve(sourceDirectory.path, entry), resolve(runtimeModules, entry), {
        recursive: true,
        dereference: true,
        force: true,
      });
    }
  }
  await cp(agentEntry, resolve(runtimeDirectory, "agent-service.js"));
  await cp(agentChunks, resolve(runtimeDirectory, "chunks"), { recursive: true });
  await writeFile(resolve(runtimeDirectory, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@earendil-works/pi-coding-agent": "0.84.1",
    },
  }, null, 2));
} finally {
  await rm(deployedDirectory, { recursive: true, force: true });
  // Legacy deploy marks the workspace modules as production-only. Restore the
  // install so the following electron-builder step still has devDependencies.
  await runPnpm(["install", "--force", "--frozen-lockfile"], {
    ...process.env,
    CI: "true",
  });
  await execFileAsync(process.execPath, [
    resolve(packageDirectory, "node_modules", "electron", "install.js"),
  ], { cwd: packageDirectory, env: process.env });
}
