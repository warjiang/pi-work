import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedCliRuntime, SessionEnvironmentStore } from "./managed-cli.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

async function createRuntime(): Promise<{ root: string; runtime: ManagedCliRuntime }> {
  const root = await mkdtemp(join(tmpdir(), "pi-work-managed-cli-"));
  temporaryDirectories.push(root);
  const runtime = new ManagedCliRuntime({
    userData: join(root, "user-data"),
    runtimeDirectory: packageDirectory,
    nodeExecutable: process.execPath,
  });
  runtime.initialize();
  return { root, runtime };
}

describe("ManagedCliRuntime", () => {
  it("creates controlled node, npm and npx commands without replacing the terminal HOME", async () => {
    const { runtime } = await createRuntime();
    const terminalEnvironment = runtime.terminalEnvironment({
      HOME: "/Users/example",
      PATH: "/custom/bin:/usr/bin:/bin",
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(await readFile(join(runtime.runtimeBinDirectory, "node"), "utf8")).toContain(process.execPath);
    expect(await readFile(join(runtime.runtimeBinDirectory, "npm"), "utf8")).toContain("npm-launcher.cjs");
    expect(await readFile(join(runtime.runtimeBinDirectory, "npx"), "utf8")).toContain("npx-cli.js");
    expect(terminalEnvironment.HOME).toBe("/Users/example");
    expect(terminalEnvironment.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(terminalEnvironment.PATH?.split(":").slice(0, 3)).toEqual([
      runtime.runtimeBinDirectory,
      runtime.binDirectory,
      runtime.npmGlobalBinDirectory,
    ]);
  });

  it("locks runtime-owned variables while retaining session authorization variables", async () => {
    const { runtime } = await createRuntime();
    const agentEnvironment = runtime.agentEnvironment({
      HOME: "/private/pi-home",
      PATH: "/usr/bin:/bin",
    }, {
      HOME: "/untrusted/home",
      PATH: "/untrusted/bin",
      NPM_CONFIG_PREFIX: "/untrusted/npm",
      LARK_TOKEN: "session-secret",
    });
    const managedEnvironment = runtime.managedEnvironment({
      PATH: "/usr/bin:/bin",
      npm_config_manage_package_manager_versions: "true",
    }, {
      HOME: "/untrusted/home",
      LARK_TOKEN: "session-secret",
    });

    expect(agentEnvironment.HOME).toBe("/private/pi-home");
    expect(agentEnvironment.PATH).toContain(runtime.runtimeBinDirectory);
    expect(agentEnvironment.PATH).not.toContain("/untrusted/bin");
    expect(agentEnvironment.NPM_CONFIG_PREFIX).toBeUndefined();
    expect(agentEnvironment.LARK_TOKEN).toBe("session-secret");
    expect(managedEnvironment.HOME).toBe(runtime.homeDirectory);
    expect(managedEnvironment.NPM_CONFIG_PREFIX).toBe(runtime.npmPrefix);
    expect(managedEnvironment.npm_config_manage_package_manager_versions).toBeUndefined();
    expect(managedEnvironment.LARK_TOKEN).toBe("session-secret");
  });

  it("installs a local npm CLI into the private prefix, records its exact version and executes it", async () => {
    const { root, runtime } = await createRuntime();
    const fixture = join(root, "fixture");
    await mkdir(fixture, { recursive: true });
    await writeFile(join(fixture, "package.json"), JSON.stringify({
      name: "pi-work-managed-cli-fixture",
      version: "1.2.3",
      bin: {
        "pi-work-fixture": "cli.js",
      },
    }));
    await writeFile(join(fixture, "cli.js"), [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({",
      "  args: process.argv.slice(2),",
      "  home: process.env.HOME,",
      "  token: process.env.LARK_TOKEN,",
      "}));",
      "",
    ].join("\n"));
    await chmod(join(fixture, "cli.js"), 0o755);

    const packages = await runtime.install(fixture);
    expect(packages).toContainEqual({
      name: "pi-work-managed-cli-fixture",
      version: "1.2.3",
      installedPath: join(runtime.npmPrefix, "lib", "node_modules", "pi-work-managed-cli-fixture"),
      bins: ["pi-work-fixture"],
    });

    const result = await runtime.execute({
      command: "pi-work-fixture",
      args: ["hello"],
      cwd: fixture,
      env: { LARK_TOKEN: "authorized" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("pi-work-fixture");
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["hello"],
      home: runtime.homeDirectory,
      token: "authorized",
    });
    expect(JSON.parse(await readFile(runtime.manifestPath, "utf8"))).toMatchObject({
      version: 1,
      packages: [expect.objectContaining({
        name: "pi-work-managed-cli-fixture",
        version: "1.2.3",
      })],
    });
    expect(await runtime.remove("pi-work-managed-cli-fixture")).toEqual([]);
  });
});

describe("SessionEnvironmentStore", () => {
  it("isolates environments by task id and never exposes their values from listKeys", () => {
    const store = new SessionEnvironmentStore();
    store.set("task-a", { LARK_TOKEN: "secret-a" });
    store.set("task-b", { LARK_TOKEN: "secret-b", SECOND_KEY: "value" });

    expect(store.get("task-a")).toEqual({ LARK_TOKEN: "secret-a" });
    expect(store.get("task-b")).toEqual({ LARK_TOKEN: "secret-b", SECOND_KEY: "value" });
    expect(store.listKeys("task-b")).toEqual(["LARK_TOKEN", "SECOND_KEY"]);
    store.clear("task-a");
    expect(store.get("task-a")).toEqual({});
    expect(store.get("task-b")).toEqual({ LARK_TOKEN: "secret-b", SECOND_KEY: "value" });
  });
});
