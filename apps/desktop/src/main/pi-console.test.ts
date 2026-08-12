import { describe, expect, it } from "vitest";
import {
  createIsolatedPiEnvironment,
  isPathInside,
  PiConsole,
  resolvePiConsoleLaunch,
  resolveBundledPiCli,
  resolveBundledPiRuntime,
} from "./pi-console.js";

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

  it("uses a fixed macOS exec wrapper without exposing a shell session", () => {
    expect(resolvePiConsoleLaunch("/Applications/Pi Work.app/Contents/MacOS/Pi Work", "/runtime/cli.js", "darwin")).toEqual({
      executable: "/bin/sh",
      arguments_: [
        "-c",
        "exec \"$@\"",
        "pi-work-bundled-pi",
        "/Applications/Pi Work.app/Contents/MacOS/Pi Work",
        "/runtime/cli.js",
      ],
    });
    expect(resolvePiConsoleLaunch("/usr/bin/node", "/runtime/cli.js", "linux")).toEqual({
      executable: "/usr/bin/node",
      arguments_: ["/runtime/cli.js"],
    });
  });

  it("creates a private agent, home and package environment", () => {
    const environment = createIsolatedPiEnvironment({
      userData: "/Users/example/Library/Application Support/@pi-work/desktop",
      runtimeDirectory: "/Applications/Pi Work.app/Contents/Resources/pi-runtime",
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
      runtimeDirectory: "/runtime",
      cliPath: "/runtime/cli.js",
      userData: "/user-data",
      nodePath: "/node",
      emit: () => {},
    });

    expect(consoleInstance.snapshot()).toEqual({
      running: false,
      output: "",
    });
  });
});
