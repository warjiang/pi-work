import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as pty from "node-pty";

export type PiConsoleEvent =
  | { type: "started" }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; message: string };

export type PiRuntimeLocation = {
  isPackaged: boolean;
  resourcesPath: string;
  mainDirectory: string;
};

export type IsolatedPiEnvironmentOptions = {
  userData: string;
  runtimeDirectory: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  platform?: NodeJS.Platform;
};

export type PiConsoleLaunch = {
  executable: string;
  arguments_: string[];
};

export type PiConsoleStartResult =
  | { started: true; reused: boolean; output: string }
  | { started: false; message: string };

export type PiConsoleSnapshot = {
  running: boolean;
  output: string;
};

export function isPathInside(rootPath: string, targetPath: string): boolean {
  const difference = relative(resolve(rootPath), resolve(targetPath));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

export function resolveBundledPiRuntime(location: PiRuntimeLocation): string {
  return location.isPackaged
    ? join(location.resourcesPath, "pi-runtime")
    : resolve(location.mainDirectory, "..", "..");
}

export function resolveBundledPiCli(runtimeDirectory: string): string {
  const cliPath = resolve(
    runtimeDirectory,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  if (!isPathInside(runtimeDirectory, cliPath)) {
    throw new Error("The bundled Pi CLI path is outside the Pi runtime.");
  }
  return cliPath;
}

export function createIsolatedPiEnvironment({
  userData,
  runtimeDirectory,
  baseEnvironment = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
}: IsolatedPiEnvironmentOptions): NodeJS.ProcessEnv {
  const agentDir = join(userData, "pi-agent");
  const homeDir = join(userData, "pi-home");
  const pathSeparator = platform === "win32" ? ";" : delimiter;
  const systemTools = platform === "win32"
    ? [join(baseEnvironment.SystemRoot ?? "C:\\Windows", "System32")]
    : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const environment = { ...baseEnvironment };

  delete environment.PI_CODING_AGENT_DIR;
  delete environment.PI_PACKAGE_DIR;
  delete environment.PI_CODING_AGENT_SESSION_DIR;
  delete environment.PI_CONFIG_DIR;
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("PI_")
      || key === "NODE_OPTIONS"
      || key === "NODE_PATH"
      || key === "NPM_CONFIG_PREFIX"
      || key === "NPM_CONFIG_USERCONFIG"
      || key === "NPM_CONFIG_GLOBALCONFIG"
      || key === "npm_config_prefix"
      || key === "npm_config_userconfig"
      || key === "npm_config_globalconfig"
    ) {
      delete environment[key];
    }
  }
  delete environment.PNPM_HOME;

  const inheritedEnvironment = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  return {
    ...inheritedEnvironment,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_DATA_HOME: join(homeDir, ".local", "share"),
    XDG_CACHE_HOME: join(homeDir, ".cache"),
    PI_CODING_AGENT_DIR: agentDir,
    PI_PACKAGE_DIR: join(runtimeDirectory, "node_modules", "@earendil-works", "pi-coding-agent"),
    PI_WORK_NODE_EXECUTABLE: nodeExecutable,
    PI_WORK_NPM_CLI: join(runtimeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    PATH: [join(runtimeDirectory, "node_modules", ".bin"), ...systemTools].join(pathSeparator),
  };
}

/**
 * node-pty's direct macOS spawn path cannot reliably launch an Electron .app
 * executable with ELECTRON_RUN_AS_NODE. The fixed shell wrapper immediately
 * execs the already-validated bundled CLI, so it never exposes a shell
 * session or accepts renderer-controlled arguments.
 */
export function resolvePiConsoleLaunch(
  nodePath: string,
  cliPath: string,
  platform = process.platform,
): PiConsoleLaunch {
  if (platform !== "darwin") {
    return { executable: nodePath, arguments_: [cliPath] };
  }
  return {
    executable: "/bin/sh",
    arguments_: ["-c", "exec \"$@\"", "pi-work-bundled-pi", nodePath, cliPath],
  };
}

export class PiConsole {
  private process: pty.IPty | null = null;
  private outputBuffer = "";

  constructor(
    private readonly options: {
      runtimeDirectory: string;
      cliPath: string;
      userData: string;
      nodePath: string;
      emit: (event: PiConsoleEvent) => void;
    },
  ) {}

  start(): PiConsoleStartResult {
    if (this.process !== null) {
      return { started: true, reused: true, output: this.outputBuffer };
    }

    try {
      if (!isPathInside(this.options.runtimeDirectory, this.options.cliPath) || !existsSync(this.options.cliPath)) {
        throw new Error("Pi Work bundled Pi runtime is unavailable.");
      }
      const environment = createIsolatedPiEnvironment({
        userData: this.options.userData,
        runtimeDirectory: this.options.runtimeDirectory,
        nodeExecutable: this.options.nodePath,
      });
      environment.ELECTRON_RUN_AS_NODE = "1";
      const launch = resolvePiConsoleLaunch(this.options.nodePath, this.options.cliPath);
      const terminal = pty.spawn(launch.executable, launch.arguments_, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: this.options.userData,
        env: environment as Record<string, string>,
      });
      this.process = terminal;
      terminal.onData((data) => {
        this.outputBuffer = `${this.outputBuffer}${data}`.slice(-128 * 1024);
        this.options.emit({ type: "data", data });
      });
      terminal.onExit(({ exitCode, signal }) => {
        if (this.process === terminal) this.process = null;
        this.options.emit(signal === undefined
          ? { type: "exit", exitCode }
          : { type: "exit", exitCode, signal });
      });
      this.options.emit({ type: "started" });
      return { started: true, reused: false, output: "" };
    } catch (error) {
      this.process = null;
      const message = error instanceof Error ? error.message : "Unable to start Pi Console.";
      this.options.emit({
        type: "error",
        message,
      });
      return { started: false, message };
    }
  }

  write(data: string): void {
    if (this.process === null || data.length === 0 || data.length > 64 * 1024) return;
    this.process.write(data);
  }

  resize(columns: number, rows: number): void {
    if (this.process === null) return;
    this.process.resize(
      Math.max(20, Math.min(300, Math.floor(columns))),
      Math.max(8, Math.min(120, Math.floor(rows))),
    );
  }

  snapshot(): PiConsoleSnapshot {
    return {
      running: this.process !== null,
      output: this.outputBuffer,
    };
  }

  close(): void {
    const terminal = this.process;
    this.process = null;
    this.outputBuffer = "";
    if (terminal !== null) terminal.kill();
  }

  restart(): PiConsoleStartResult {
    this.close();
    return this.start();
  }
}
