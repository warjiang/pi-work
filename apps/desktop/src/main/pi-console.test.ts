import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createPiConsoleEnvironment,
  createTerminalCommandShims,
  createTerminalShellBootstrap,
  createIsolatedPiEnvironment,
  isPathInside,
  PiConsole,
  resolvePiConsoleLaunch,
  resolveBundledPiCli,
  resolveBundledPiRuntime,
} from "./pi-console.js";
import { ManagedCliRuntime } from "./managed-cli.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("bundled Pi Console runtime", () => {
  it("resolves only the packaged runtime or Pi Work's local development runtime", () => {
    const packagedRuntime = resolveBundledPiRuntime({
      isPackaged: true,
      resourcesPath: "/Applications/Pi Work.app/Contents/Resources",
      mainDirectory: "/unused",
    });
    const developmentRuntime = resolveBundledPiRuntime({
      isPackaged: false,
      resourcesPath: "/unused",
      mainDirectory: "/workspace/apps/desktop/out/main",
    });
    const cli = resolveBundledPiCli(packagedRuntime);
    expect(packagedRuntime).toBe("/Applications/Pi Work.app/Contents/Resources/pi-runtime");
    expect(developmentRuntime).toBe("/workspace/apps/desktop");
    expect(cli).toBe(`${packagedRuntime}/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`);
    expect(isPathInside(packagedRuntime, cli)).toBe(true);
    expect(isPathInside(packagedRuntime, "/usr/local/bin/pi")).toBe(false);
  });

  it("starts an interactive user shell instead of Pi", () => {
    expect(resolvePiConsoleLaunch({
      SHELL: "/bin/fish",
      PI_WORK_TERMINAL_PATH_PREFIX: "/runtime/bin:/usr/bin",
    }, "darwin")).toEqual({
      executable: "/bin/fish",
      arguments_: [
        "-i",
        "-C",
        "set -gx PATH (string split ':' $PI_WORK_TERMINAL_PATH_PREFIX) $PATH",
      ],
    });
    expect(resolvePiConsoleLaunch({}, "darwin")).toEqual({
      executable: "/bin/zsh",
      arguments_: ["-i"],
    });
    expect(resolvePiConsoleLaunch({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32")).toEqual({
      executable: "C:\\Windows\\System32\\cmd.exe",
      arguments_: [],
    });
    expect(resolvePiConsoleLaunch({
      SHELL: "/bin/bash",
      PI_WORK_TERMINAL_BASH_RC: "/terminal/bashrc",
    }, "linux")).toEqual({
      executable: "/bin/bash",
      arguments_: ["--rcfile", "/terminal/bashrc", "-i"],
    });
  });

  it("prepends bundled command shims while retaining the user's PATH", () => {
    const environment = createPiConsoleEnvironment({
      runtimeDirectory: "/runtime",
      commandShimDirectory: "/user-data/pi-terminal/bin",
      baseEnvironment: {
        PATH: "/Users/example/.local/bin:/usr/bin:/bin",
        HOME: "/Users/example",
        ELECTRON_RUN_AS_NODE: "1",
      },
      platform: "darwin",
    });
    expect(environment.PATH).toBe(
      "/user-data/pi-terminal/bin:/runtime/node_modules/.bin:/Users/example/.local/bin:/usr/bin:/bin",
    );
    expect(environment.HOME).toBe("/Users/example");
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("creates node and npm commands backed by Electron", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-terminal-shims-"));
    try {
      createTerminalCommandShims({
        directory,
        nodeExecutable: "/Applications/Pi Work.app/Contents/MacOS/Pi Work",
        npmCli: "/Applications/Pi Work.app/Contents/Resources/pi-runtime/node_modules/npm/bin/npm-cli.js",
        platform: "darwin",
      });
      expect(await readFile(join(directory, "node"), "utf8")).toContain(
        "exec '/Applications/Pi Work.app/Contents/MacOS/Pi Work'",
      );
      expect(await readFile(join(directory, "npm"), "utf8")).toContain(
        "'/Applications/Pi Work.app/Contents/Resources/pi-runtime/node_modules/npm/bin/npm-cli.js'",
      );
      expect(await readFile(join(directory, "cleanup-electron-node.cjs"), "utf8")).toContain(
        "delete process.env.ELECTRON_RUN_AS_NODE",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reapplies the bundled PATH after user shell startup files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-terminal-shell-"));
    try {
      const bootstrap = createTerminalShellBootstrap({
        directory,
        pathPrefix: "/terminal/bin:/runtime/node_modules/.bin",
        baseEnvironment: {
          HOME: "/Users/example",
          ZDOTDIR: "/Users/example/.config/zsh",
        },
      });
      const zshRc = await readFile(join(bootstrap.zshDirectory, ".zshrc"), "utf8");
      const bashRc = await readFile(bootstrap.bashRc, "utf8");
      expect(zshRc.indexOf("source '/Users/example/.config/zsh/.zshrc'")).toBeLessThan(
        zshRc.indexOf("export PATH='/terminal/bin:/runtime/node_modules/.bin'"),
      );
      expect(bashRc.indexOf("source '/Users/example/.bashrc'")).toBeLessThan(
        bashRc.indexOf("export PATH='/terminal/bin:/runtime/node_modules/.bin'"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates a private agent, home and package environment", () => {
    const environment = createIsolatedPiEnvironment({
      userData: "/Users/example/Library/Application Support/@pi-work/desktop",
      runtimeDirectory: "/Applications/Pi Work.app/Contents/Resources/pi-runtime",
      nodeExecutable: "/Applications/Pi Work.app/Contents/MacOS/Pi Work",
      baseEnvironment: {
        PATH: "/Users/example/.local/bin:/usr/bin:/bin",
        PI_CODING_AGENT_DIR: "/Users/example/.pi/agent",
        PI_PACKAGE_DIR: "/global/pi",
        PI_MODEL: "global-provider/global-model",
        NODE_PATH: "/Users/example/.npm/global/node_modules",
        NODE_OPTIONS: "--require /Users/example/global-hook.cjs",
        NPM_CONFIG_USERCONFIG: "/Users/example/.npmrc",
        npm_config_globalconfig: "/etc/npmrc",
      },
      platform: "darwin",
    });
    expect(environment.PI_CODING_AGENT_DIR).toContain("/desktop/pi-agent");
    expect(environment.PI_PACKAGE_DIR).toContain("/pi-runtime/node_modules/@earendil-works/pi-coding-agent");
    expect(environment.PI_WORK_NODE_EXECUTABLE).toBe("/Applications/Pi Work.app/Contents/MacOS/Pi Work");
    expect(environment.PI_WORK_NPM_CLI).toContain("/pi-runtime/node_modules/npm/bin/npm-cli.js");
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(environment.HOME).toContain("/desktop/pi-home");
    expect(environment.XDG_CONFIG_HOME).toContain("/desktop/pi-home/.config");
    expect(environment.PATH).toContain("/pi-runtime/node_modules/.bin");
    expect(environment.PATH).not.toContain("/Users/example/.local/bin");
    expect(environment.PATH).toContain("/usr/bin:/bin");
    expect(environment.PI_MODEL).toBeUndefined();
    expect(environment.NODE_PATH).toBeUndefined();
    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(environment.NPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(environment.npm_config_globalconfig).toBeUndefined();
  });

  it("exposes buffered output and process state for renderer recovery", () => {
    const consoleInstance = new PiConsole({
      managedCliRuntime: new ManagedCliRuntime({
        runtimeDirectory: packageDirectory,
        userData: "/user-data",
        nodeExecutable: process.execPath,
      }),
      workingDirectory: "/working-directory",
      emit: () => {},
    });

    expect(consoleInstance.snapshot()).toEqual({
      running: false,
      output: "",
    });
  });

  it("executes commands programmatically and returns their output", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pi-terminal-api-"));
    try {
      const consoleInstance = new PiConsole({
        managedCliRuntime: new ManagedCliRuntime({
          runtimeDirectory: packageDirectory,
          userData,
          nodeExecutable: process.execPath,
        }),
        workingDirectory: packageDirectory,
        emit: () => {},
      });
      const result = await consoleInstance.execute({
        command: "node -p \"[process.execPath, process.env.ELECTRON_RUN_AS_NODE || 'clean'].join('\\\\n')\" && npm --version && npx --version",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("node");
      expect(result.stdout).toContain("clean");
      expect(result.stdout.match(/\d+\.\d+\.\d+/g)?.length).toBeGreaterThanOrEqual(2);
      expect(result.cwd).toBe(packageDirectory);
      expect(result.timedOut).toBe(false);
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
