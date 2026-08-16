import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as pty from "node-pty";
import { electronNodeCleanupScript } from "./electron-node-cleanup.js";
import { ManagedCliRuntime } from "./managed-cli.js";

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

export type PiConsoleExecuteInput = {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type PiConsoleExecuteResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
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

export function resolveBundledNpmCli(runtimeDirectory: string): string {
  const cliPath = resolve(runtimeDirectory, "node_modules", "npm", "bin", "npm-cli.js");
  if (!isPathInside(runtimeDirectory, cliPath)) {
    throw new Error("The bundled npm CLI path is outside the Pi runtime.");
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

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function createTerminalCommandShims({
  directory,
  nodeExecutable,
  npmCli,
  platform = process.platform,
}: {
  directory: string;
  nodeExecutable: string;
  npmCli: string;
  platform?: NodeJS.Platform;
}): void {
  mkdirSync(directory, { recursive: true });
  const cleanupPath = join(directory, "cleanup-electron-node.cjs");
  writeFileSync(cleanupPath, electronNodeCleanupScript());
  if (platform === "win32") {
    const environment = [
      "@echo off",
      "set \"PI_WORK_ORIGINAL_NODE_OPTIONS=%NODE_OPTIONS%\"",
      `set "PI_WORK_NODE_CLEANUP=${cleanupPath}"`,
      "set \"NODE_OPTIONS=--require \\\"%PI_WORK_NODE_CLEANUP%\\\" %NODE_OPTIONS%\"",
      "set ELECTRON_RUN_AS_NODE=1",
    ].join("\r\n");
    writeFileSync(join(directory, "node.cmd"), `${environment}\r\n"${nodeExecutable}" %*\r\n`);
    writeFileSync(join(directory, "npm.cmd"), `${environment}\r\n"${nodeExecutable}" "${npmCli}" %*\r\n`);
    return;
  }

  const environment = [
    `export PI_WORK_NODE_CLEANUP=${quotePosix(cleanupPath)}`,
    "export PI_WORK_ORIGINAL_NODE_OPTIONS=\"${NODE_OPTIONS-}\"",
    "export NODE_OPTIONS=\"--require \\\"$PI_WORK_NODE_CLEANUP\\\"${NODE_OPTIONS:+ $NODE_OPTIONS}\"",
    "export ELECTRON_RUN_AS_NODE=1",
  ].join("\n");
  writeFileSync(
    join(directory, "node"),
    `#!/bin/sh\n${environment}\nexec ${quotePosix(nodeExecutable)} "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(directory, "npm"),
    `#!/bin/sh\n${environment}\nexec ${quotePosix(nodeExecutable)} ${quotePosix(npmCli)} "$@"\n`,
    { mode: 0o755 },
  );
}

export function createPiConsoleEnvironment({
  runtimeDirectory,
  commandShimDirectory,
  baseEnvironment = process.env,
  platform = process.platform,
}: {
  runtimeDirectory: string;
  commandShimDirectory: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): NodeJS.ProcessEnv {
  const pathSeparator = platform === "win32" ? ";" : delimiter;
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(baseEnvironment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const inheritedPathEntry = Object.entries(inheritedEnvironment)
    .find(([key]) => key.toUpperCase() === "PATH");
  const inheritedPath = inheritedPathEntry?.[1];
  for (const key of Object.keys(inheritedEnvironment)) {
    if (key.toUpperCase() === "PATH") delete inheritedEnvironment[key];
  }
  delete inheritedEnvironment.ELECTRON_RUN_AS_NODE;

  return {
    ...inheritedEnvironment,
    PATH: [
      commandShimDirectory,
      join(runtimeDirectory, "node_modules", ".bin"),
      inheritedPath,
    ].filter(Boolean).join(pathSeparator),
  };
}

export function createTerminalShellBootstrap({
  directory,
  pathPrefix,
  baseEnvironment = process.env,
}: {
  directory: string;
  pathPrefix: string;
  baseEnvironment?: NodeJS.ProcessEnv;
}): {
  zshDirectory: string;
  bashRc: string;
} {
  const zshDirectory = join(directory, "zsh");
  const bashRc = join(directory, "bashrc");
  mkdirSync(zshDirectory, { recursive: true });

  const userZdotDir = baseEnvironment.ZDOTDIR || baseEnvironment.HOME;
  const userZshRc = userZdotDir === undefined ? null : join(userZdotDir, ".zshrc");
  const userBashRc = baseEnvironment.HOME === undefined ? null : join(baseEnvironment.HOME, ".bashrc");
  writeFileSync(join(zshDirectory, ".zshrc"), [
    ...(userZshRc === null
      ? []
      : [
          `if [ -f ${quotePosix(userZshRc)} ]; then`,
          `  export ZDOTDIR=${quotePosix(userZdotDir ?? "")}`,
          `  source ${quotePosix(userZshRc)}`,
          `  export ZDOTDIR=${quotePosix(zshDirectory)}`,
          "fi",
        ]),
    `export PATH=${quotePosix(pathPrefix)}:"$PATH"`,
    "",
  ].join("\n"));
  writeFileSync(bashRc, [
    ...(userBashRc === null
      ? []
      : [
          `if [ -f ${quotePosix(userBashRc)} ]; then`,
          `  source ${quotePosix(userBashRc)}`,
          "fi",
        ]),
    `export PATH=${quotePosix(pathPrefix)}:"$PATH"`,
    "",
  ].join("\n"));

  return { zshDirectory, bashRc };
}

export function resolvePiConsoleLaunch(
  environment: NodeJS.ProcessEnv,
  platform = process.platform,
): PiConsoleLaunch {
  if (platform === "win32") {
    return {
      executable: environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe",
      arguments_: [],
    };
  }

  const configuredShell = environment.SHELL;
  const executable = configuredShell !== undefined && isAbsolute(configuredShell)
    ? configuredShell
    : platform === "darwin"
      ? "/bin/zsh"
      : "/bin/sh";
  const shellName = basename(executable);
  if (shellName === "bash" && environment.PI_WORK_TERMINAL_BASH_RC !== undefined) {
    return {
      executable,
      arguments_: ["--rcfile", environment.PI_WORK_TERMINAL_BASH_RC, "-i"],
    };
  }
  if (shellName === "fish" && environment.PI_WORK_TERMINAL_PATH_PREFIX !== undefined) {
    return {
      executable,
      arguments_: [
        "-i",
        "-C",
        "set -gx PATH (string split ':' $PI_WORK_TERMINAL_PATH_PREFIX) $PATH",
      ],
    };
  }
  return {
    executable,
    arguments_: ["-i"],
  };
}

export class PiConsole {
  private process: pty.IPty | null = null;
  private outputBuffer = "";
  private workingDirectory: string;

  constructor(
    private readonly options: {
      managedCliRuntime: ManagedCliRuntime;
      workingDirectory: string;
      emit: (event: PiConsoleEvent) => void;
    },
  ) {
    this.workingDirectory = resolve(options.workingDirectory);
  }

  private prepareEnvironment(baseEnvironment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    this.options.managedCliRuntime.initialize();
    const environment = this.options.managedCliRuntime.terminalEnvironment(baseEnvironment);
    const pathPrefix = [
      this.options.managedCliRuntime.runtimeBinDirectory,
      this.options.managedCliRuntime.binDirectory,
      this.options.managedCliRuntime.npmGlobalBinDirectory,
    ].join(process.platform === "win32" ? ";" : delimiter);
    const bootstrap = createTerminalShellBootstrap({
      directory: join(this.options.managedCliRuntime.rootDirectory, "terminal-shell"),
      pathPrefix,
      baseEnvironment,
    });
    environment.PI_WORK_TERMINAL_PATH_PREFIX = pathPrefix;
    environment.PI_WORK_TERMINAL_BASH_RC = bootstrap.bashRc;
    environment.ZDOTDIR = bootstrap.zshDirectory;
    return environment;
  }

  start(workingDirectory = this.options.workingDirectory): PiConsoleStartResult {
    const cwd = resolve(workingDirectory);
    if (this.process !== null) {
      if (cwd !== this.workingDirectory) {
        this.close();
      } else {
        return { started: true, reused: true, output: this.outputBuffer };
      }
    }

    this.workingDirectory = cwd;

    try {
      const environment = this.prepareEnvironment();
      const launch = resolvePiConsoleLaunch(environment);
      const terminal = pty.spawn(launch.executable, launch.arguments_, {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: this.workingDirectory,
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
      const message = error instanceof Error ? error.message : "Unable to start Pi Terminal.";
      this.options.emit({
        type: "error",
        message,
      });
      return { started: false, message };
    }
  }

  execute(input: PiConsoleExecuteInput): Promise<PiConsoleExecuteResult> {
    const command = input.command.trim();
    if (command.length === 0) {
      return Promise.reject(new Error("Terminal command cannot be empty."));
    }
    const cwd = input.cwd === undefined ? this.workingDirectory : resolve(input.cwd);
    const environment = this.prepareEnvironment({
      ...process.env,
      ...input.env,
    });
    const launch = resolvePiConsoleLaunch(environment);
    const timeoutMs = input.timeoutMs === undefined
      ? 0
      : Math.max(1, Math.min(10 * 60 * 1000, Math.floor(input.timeoutMs)));

    return new Promise((resolveResult) => {
      const shellName = basename(launch.executable);
      const shellCommand = shellName === "bash" && environment.PI_WORK_TERMINAL_BASH_RC !== undefined
        ? `. ${quotePosix(environment.PI_WORK_TERMINAL_BASH_RC)}\nexport PATH=${quotePosix(environment.PATH ?? "")}\n${command}`
        : shellName === "zsh" && environment.ZDOTDIR !== undefined
          ? `source ${quotePosix(join(environment.ZDOTDIR, ".zshrc"))}\nexport PATH=${quotePosix(environment.PATH ?? "")}\n${command}`
          : command;
      const shellArguments = shellName === "fish"
        ? ["-c", command]
        : ["-c", shellCommand];
      const child = spawn(launch.executable, shellArguments, {
        cwd,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const maximumBuffer = 10 * 1024 * 1024;
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolveResult({
          command,
          cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
        });
      };
      const overflow = () => {
        timedOut = false;
        child.kill();
        stderr = `${stderr}Output exceeded 10485760 bytes.\n`;
      };
      child.stdout.on("data", (chunk: string | Buffer) => {
        const text = chunk.toString();
        stdoutBytes += Buffer.byteLength(text);
        if (stdoutBytes > maximumBuffer) overflow();
        else stdout += text;
      });
      child.stderr.on("data", (chunk: string | Buffer) => {
        const text = chunk.toString();
        stderrBytes += Buffer.byteLength(text);
        if (stderrBytes > maximumBuffer) overflow();
        else stderr += text;
      });
      child.on("error", (error) => {
        stderr = `${stderr}${error.message}\n`;
        finish(null, null);
      });
      child.on("close", (exitCode, signal) => finish(exitCode, signal));
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (settled) return;
          timedOut = true;
          child.kill();
        }, timeoutMs);
      }
    });
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

  restart(workingDirectory = this.workingDirectory): PiConsoleStartResult {
    this.close();
    return this.start(workingDirectory);
  }
}
