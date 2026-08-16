import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { electronNodeCleanupScript } from "./electron-node-cleanup.js";

const root = mkdtempSync(join(tmpdir(), "pi-work-cleanup-"));
const cleanupPath = join(root, "cleanup-electron-node.cjs");
writeFileSync(cleanupPath, electronNodeCleanupScript());

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Runs a snippet in a Node process that has the cleanup script preloaded via
 * `--require`, exactly like the runtime shims do. `process.execPath` is the
 * real Node here, so `ELECTRON_RUN_AS_NODE` is inert and only used as a probe:
 * if the child sees it, the child_process patch injected it.
 */
function runWithCleanup(snippet: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--require", cleanupPath, "-e", snippet], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_WORK_ORIGINAL_NODE_OPTIONS: "" },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("electronNodeCleanupScript", () => {
  it("removes ELECTRON_RUN_AS_NODE from the current process env", () => {
    const result = runWithCleanup("console.log(JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null));");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("null");
  });

  it("re-injects ELECTRON_RUN_AS_NODE for child processes spawned via process.execPath", () => {
    // A spy stands in for the real spawn so we can observe the env the patch
    // hands to the child, without the child re-running cleanup and stripping it.
    const child = [
      "const cp = require('node:child_process');",
      "let captured = 'nocall';",
      "cp.spawnSync = function (command, args, options) {",
      "  if (command === process.execPath) { captured = options && options.env ? (options.env.ELECTRON_RUN_AS_NODE || 'missing') : 'noenv'; return { status: 0 }; }",
      "  return { status: 0 };",
      "};",
      `require(${JSON.stringify(cleanupPath)});`,
      "cp.spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' });",
      "process.stdout.write(captured);",
    ].join("");
    const result = spawnSync(process.execPath, ["-e", child], {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_WORK_ORIGINAL_NODE_OPTIONS: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("1");
  });

  it("does not touch child processes that target a different executable", () => {
    const child = [
      "const cp = require('node:child_process');",
      "let captured = 'nocall';",
      "cp.spawnSync = function (command, args, options) {",
      "  captured = options && options.env && 'ELECTRON_RUN_AS_NODE' in options.env ? options.env.ELECTRON_RUN_AS_NODE : 'absent';",
      "  return { status: 0 };",
      "};",
      `require(${JSON.stringify(cleanupPath)});`,
      "cp.spawnSync('/bin/sh', ['-c', 'true'], { encoding: 'utf8', env: { PATH: process.env.PATH } });",
      "process.stdout.write(captured);",
    ].join("");
    const result = spawnSync(process.execPath, ["-e", child], {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_WORK_ORIGINAL_NODE_OPTIONS: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("absent");
  });

  it("preserves a caller-provided env while adding the flag for execPath spawns", () => {
    const child = [
      "const cp = require('node:child_process');",
      "let captured = 'nocall';",
      "cp.spawnSync = function (command, args, options) {",
      "  if (command === process.execPath) { const e = (options && options.env) || {}; captured = (e.CUSTOM || '') + ':' + (e.ELECTRON_RUN_AS_NODE || 'missing'); return { status: 0 }; }",
      "  return { status: 0 };",
      "};",
      `require(${JSON.stringify(cleanupPath)});`,
      "cp.spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8', env: { CUSTOM: 'kept', PATH: process.env.PATH } });",
      "process.stdout.write(captured);",
    ].join("");
    const result = spawnSync(process.execPath, ["-e", child], {
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_WORK_ORIGINAL_NODE_OPTIONS: "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("kept:1");
  });
});
