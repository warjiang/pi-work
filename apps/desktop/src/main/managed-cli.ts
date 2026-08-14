import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ManagedCliPackage = {
  name: string;
  version: string;
  installedPath: string;
  bins: string[];
};

export type ManagedCliExecutionInput = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type ManagedCliExecutionResult = {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ManagedCliRuntimeOptions = {
  userData: string;
  runtimeDirectory: string;
  nodeExecutable: string;
  platform?: NodeJS.Platform;
};

type PackageJson = {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
};

const manifestVersion = 1;
const maximumOutputBytes = 10 * 1024 * 1024;
const maximumTimeoutMs = 10 * 60 * 1000;

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function pathInside(rootPath: string, targetPath: string): boolean {
  const difference = relative(resolve(rootPath), resolve(targetPath));
  return difference === "" || (
    difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
  );
}

function environmentStrings(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function pathEntries(pathValue: string | undefined, platform: NodeJS.Platform): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(platform === "win32" ? ";" : delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function packageBins(packageJson: PackageJson): Record<string, string> {
  if (typeof packageJson.name !== "string") return {};
  if (typeof packageJson.bin === "string") {
    const name = packageJson.name.includes("/")
      ? packageJson.name.slice(packageJson.name.lastIndexOf("/") + 1)
      : packageJson.name;
    return { [name]: packageJson.bin };
  }
  if (typeof packageJson.bin !== "object" || packageJson.bin === null || Array.isArray(packageJson.bin)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(packageJson.bin).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function packageDirectories(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];
  const directories: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = join(nodeModules, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(entryPath).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) continue;
    if (!entry.name.startsWith("@")) {
      directories.push(entryPath);
      continue;
    }
    for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
      const scopedPath = join(entryPath, scopedEntry.name);
      let scopedDirectory = scopedEntry.isDirectory();
      if (scopedEntry.isSymbolicLink()) {
        try {
          scopedDirectory = statSync(scopedPath).isDirectory();
        } catch {
          scopedDirectory = false;
        }
      }
      if (scopedDirectory) directories.push(scopedPath);
    }
  }
  return directories;
}

export class SessionEnvironmentStore {
  private readonly environments = new Map<string, Record<string, string>>();

  set(sessionId: string, environment: Record<string, string>): string[] {
    this.environments.set(sessionId, { ...environment });
    return this.listKeys(sessionId);
  }

  get(sessionId: string): Record<string, string> {
    return { ...(this.environments.get(sessionId) ?? {}) };
  }

  listKeys(sessionId: string): string[] {
    return Object.keys(this.environments.get(sessionId) ?? {}).sort();
  }

  clear(sessionId: string): void {
    this.environments.delete(sessionId);
  }

  clearAll(): void {
    this.environments.clear();
  }
}

export class ManagedCliRuntime {
  readonly rootDirectory: string;
  readonly runtimeBinDirectory: string;
  readonly binDirectory: string;
  readonly npmPrefix: string;
  readonly npmGlobalBinDirectory: string;
  readonly homeDirectory: string;
  readonly npmCacheDirectory: string;
  readonly npmConfigPath: string;
  readonly manifestPath: string;
  readonly npmCliPath: string;
  readonly npxCliPath: string;
  readonly piAgentDirectory: string;
  readonly piPackageDirectory: string;
  readonly piCliPath: string;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: ManagedCliRuntimeOptions) {
    this.platform = options.platform ?? process.platform;
    this.rootDirectory = join(options.userData, "managed-cli");
    this.runtimeBinDirectory = join(this.rootDirectory, "runtime-bin");
    this.binDirectory = join(this.rootDirectory, "bin");
    this.npmPrefix = join(this.rootDirectory, "npm-global");
    this.npmGlobalBinDirectory = this.platform === "win32"
      ? this.npmPrefix
      : join(this.npmPrefix, "bin");
    this.homeDirectory = join(this.rootDirectory, "home");
    this.npmCacheDirectory = join(this.rootDirectory, "cache", "npm");
    this.npmConfigPath = join(this.rootDirectory, "config", "npmrc");
    this.manifestPath = join(this.rootDirectory, "manifest.json");
    this.npmCliPath = join(options.runtimeDirectory, "node_modules", "npm", "bin", "npm-cli.js");
    this.npxCliPath = join(options.runtimeDirectory, "node_modules", "npm", "bin", "npx-cli.js");
    this.piAgentDirectory = join(options.userData, "pi-agent");
    this.piPackageDirectory = join(
      options.runtimeDirectory,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    this.piCliPath = join(
      this.piPackageDirectory,
      "dist",
      "cli.js",
    );
  }

  initialize(): void {
    if (
      !existsSync(this.options.nodeExecutable)
      || !existsSync(this.npmCliPath)
      || !existsSync(this.npxCliPath)
      || !existsSync(this.piCliPath)
    ) {
      throw new Error("Pi Work bundled Node/npm/npx/Pi runtime is unavailable.");
    }
    for (const directory of [
      this.runtimeBinDirectory,
      this.binDirectory,
      this.npmPrefix,
      this.npmGlobalBinDirectory,
      this.homeDirectory,
      this.npmCacheDirectory,
      dirname(this.npmConfigPath),
      join(this.rootDirectory, "staging"),
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    writeFileSync(this.npmConfigPath, [
      `prefix=${this.npmPrefix}`,
      `cache=${this.npmCacheDirectory}`,
      "update-notifier=false",
      "fund=false",
      "",
    ].join("\n"));
    this.createRuntimeShims();
    this.reconcile();
  }

  terminalEnvironment(baseEnvironment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const environment = environmentStrings(baseEnvironment);
    const inheritedPathEntry = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH");
    const inheritedPath = inheritedPathEntry?.[1];
    for (const key of Object.keys(environment)) {
      if (key.toUpperCase() === "PATH") delete environment[key];
    }
    delete environment.ELECTRON_RUN_AS_NODE;
    return {
      ...environment,
      PATH: this.pathValue(inheritedPath),
    };
  }

  agentEnvironment(
    baseEnvironment: NodeJS.ProcessEnv,
    sessionEnvironment: Record<string, string> = {},
  ): NodeJS.ProcessEnv {
    const environment = {
      ...environmentStrings(baseEnvironment),
      ...sessionEnvironment,
    };
    for (const key of Object.keys(environment)) {
      const normalized = key.toUpperCase();
      if (
        normalized === "PATH"
        || normalized === "HOME"
        || normalized.startsWith("XDG_")
        || normalized.startsWith("NPM_CONFIG_")
        || normalized === "ELECTRON_RUN_AS_NODE"
      ) {
        delete environment[key];
      }
    }
    Object.assign(environment, Object.fromEntries(
      Object.entries(baseEnvironment).filter(([key]) => {
        const normalized = key.toUpperCase();
        return normalized === "HOME" || normalized.startsWith("XDG_");
      }),
    ));
    environment.PATH = this.pathValue(baseEnvironment.PATH);
    return environment;
  }

  managedEnvironment(
    baseEnvironment: NodeJS.ProcessEnv = process.env,
    injectedEnvironment: Record<string, string> = {},
  ): NodeJS.ProcessEnv {
    const environment = {
      ...environmentStrings(baseEnvironment),
      ...injectedEnvironment,
    };
    for (const key of Object.keys(environment)) {
      const normalized = key.toUpperCase();
      if (
        normalized === "PATH"
        || normalized === "HOME"
        || normalized.startsWith("XDG_")
        || normalized.startsWith("NPM_CONFIG_")
        || normalized === "ELECTRON_RUN_AS_NODE"
      ) {
        delete environment[key];
      }
    }
    return {
      ...environment,
      HOME: this.homeDirectory,
      XDG_CONFIG_HOME: join(this.homeDirectory, ".config"),
      XDG_DATA_HOME: join(this.homeDirectory, ".local", "share"),
      XDG_CACHE_HOME: join(this.homeDirectory, ".cache"),
      NPM_CONFIG_PREFIX: this.npmPrefix,
      NPM_CONFIG_CACHE: this.npmCacheDirectory,
      NPM_CONFIG_USERCONFIG: this.npmConfigPath,
      PATH: this.pathValue(baseEnvironment.PATH),
    };
  }

  list(): ManagedCliPackage[] {
    this.reconcile();
    return this.readManifest();
  }

  async install(packageSpec: string): Promise<ManagedCliPackage[]> {
    await this.runCommand(this.commandPath("npm"), ["install", "--global", packageSpec], {
      cwd: this.homeDirectory,
      env: this.managedEnvironment(),
    });
    return this.list();
  }

  async update(name: string, version = "latest"): Promise<ManagedCliPackage[]> {
    return this.install(`${name}@${version}`);
  }

  async remove(name: string): Promise<ManagedCliPackage[]> {
    await this.runCommand(this.commandPath("npm"), ["uninstall", "--global", name], {
      cwd: this.homeDirectory,
      env: this.managedEnvironment(),
    });
    return this.list();
  }

  async execute(input: ManagedCliExecutionInput): Promise<ManagedCliExecutionResult> {
    const cwd = resolve(input.cwd ?? this.homeDirectory);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new Error("Managed CLI working directory does not exist.");
    }
    const args = input.args ?? [];
    const executable = this.resolveManagedCommand(input.command);
    const result = await this.runCommand(executable, args, {
      cwd,
      env: this.managedEnvironment(process.env, input.env),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    return {
      ...result,
      command: input.command,
    };
  }

  reconcile(): ManagedCliPackage[] {
    const nodeModules = this.platform === "win32"
      ? join(this.npmPrefix, "node_modules")
      : join(this.npmPrefix, "lib", "node_modules");
    const packages: ManagedCliPackage[] = [];
    const facades = new Map<string, string>();
    for (const packageDirectory of packageDirectories(nodeModules)) {
      const packagePath = join(packageDirectory, "package.json");
      if (!existsSync(packagePath)) continue;
      let packageJson: PackageJson;
      try {
        packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
      } catch {
        continue;
      }
      if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") continue;
      const bins = packageBins(packageJson);
      for (const [name, binPath] of Object.entries(bins)) {
        const target = resolve(packageDirectory, binPath);
        if (pathInside(packageDirectory, target) && existsSync(target)) facades.set(name, target);
      }
      packages.push({
        name: packageJson.name,
        version: packageJson.version,
        installedPath: packageDirectory,
        bins: Object.keys(bins).sort(),
      });
    }
    packages.sort((left, right) => left.name.localeCompare(right.name));
    this.writeFacades(facades);
    writeFileSync(this.manifestPath, `${JSON.stringify({
      version: manifestVersion,
      packages,
    }, null, 2)}\n`);
    return packages;
  }

  private pathValue(inheritedPath?: string): string {
    return [
      this.runtimeBinDirectory,
      this.binDirectory,
      this.npmGlobalBinDirectory,
      join(this.options.runtimeDirectory, "node_modules", ".bin"),
      inheritedPath,
    ].filter(Boolean).join(this.platform === "win32" ? ";" : delimiter);
  }

  private commandPath(command: "node" | "npm" | "npx"): string {
    return join(this.runtimeBinDirectory, this.platform === "win32" ? `${command}.cmd` : command);
  }

  private resolveManagedCommand(command: string, inheritedPath = process.env.PATH): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(command)) {
      throw new Error("Invalid managed CLI command.");
    }
    const candidates = this.platform === "win32"
      ? [join(this.binDirectory, `${command}.cmd`), join(this.npmGlobalBinDirectory, `${command}.cmd`)]
      : [join(this.binDirectory, command), join(this.npmGlobalBinDirectory, command)];
    const pathCandidates = this.platform === "win32"
      ? pathEntries(inheritedPath, this.platform).flatMap((entry) => [join(entry, `${command}.cmd`), join(entry, command)])
      : pathEntries(inheritedPath, this.platform).map((entry) => join(entry, command));
    const executable = [...candidates, ...pathCandidates].find((candidate) => existsSync(candidate));
    if (executable === undefined) throw new Error(`Managed CLI command is not installed: ${command}`);
    return executable;
  }

  private readManifest(): ManagedCliPackage[] {
    if (!existsSync(this.manifestPath)) return [];
    try {
      const value = JSON.parse(readFileSync(this.manifestPath, "utf8")) as {
        version?: unknown;
        packages?: unknown;
      };
      if (value.version !== manifestVersion || !Array.isArray(value.packages)) return [];
      return value.packages.filter((entry): entry is ManagedCliPackage => (
        typeof entry === "object"
        && entry !== null
        && typeof (entry as ManagedCliPackage).name === "string"
        && typeof (entry as ManagedCliPackage).version === "string"
        && typeof (entry as ManagedCliPackage).installedPath === "string"
        && Array.isArray((entry as ManagedCliPackage).bins)
      ));
    } catch {
      return [];
    }
  }

  private createRuntimeShims(): void {
    const cleanupPath = join(this.runtimeBinDirectory, "cleanup-electron-node.cjs");
    const launcherPath = join(this.runtimeBinDirectory, "npm-launcher.cjs");
    const reconcilePath = join(this.runtimeBinDirectory, "reconcile-manifest.cjs");
    writeFileSync(cleanupPath, [
      "delete process.env.ELECTRON_RUN_AS_NODE;",
      "const originalNodeOptions = process.env.PI_WORK_ORIGINAL_NODE_OPTIONS;",
      "delete process.env.PI_WORK_ORIGINAL_NODE_OPTIONS;",
      "delete process.env.PI_WORK_NODE_CLEANUP;",
      "if (originalNodeOptions) process.env.NODE_OPTIONS = originalNodeOptions;",
      "else delete process.env.NODE_OPTIONS;",
      "",
    ].join("\n"));
    writeFileSync(launcherPath, [
      "delete process.env.ELECTRON_RUN_AS_NODE;",
      "for (const key of Object.keys(process.env)) {",
      "  if (key.toUpperCase().startsWith('NPM_CONFIG_')) delete process.env[key];",
      "}",
      `process.env.HOME = ${JSON.stringify(this.homeDirectory)};`,
      `process.env.XDG_CONFIG_HOME = ${JSON.stringify(join(this.homeDirectory, ".config"))};`,
      `process.env.XDG_DATA_HOME = ${JSON.stringify(join(this.homeDirectory, ".local", "share"))};`,
      `process.env.XDG_CACHE_HOME = ${JSON.stringify(join(this.homeDirectory, ".cache"))};`,
      `process.env.NPM_CONFIG_PREFIX = ${JSON.stringify(this.npmPrefix)};`,
      `process.env.NPM_CONFIG_CACHE = ${JSON.stringify(this.npmCacheDirectory)};`,
      `process.env.NPM_CONFIG_USERCONFIG = ${JSON.stringify(this.npmConfigPath)};`,
      "const cli = process.argv[2];",
      "process.argv.splice(1, 2, cli);",
      "require(cli);",
      "",
    ].join("\n"));
    writeFileSync(reconcilePath, [
      "delete process.env.ELECTRON_RUN_AS_NODE;",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `const nodeModules = ${JSON.stringify(this.platform === "win32"
        ? join(this.npmPrefix, "node_modules")
        : join(this.npmPrefix, "lib", "node_modules"))};`,
      `const manifestPath = ${JSON.stringify(this.manifestPath)};`,
      `const binDirectory = ${JSON.stringify(this.binDirectory)};`,
      `const managedHome = ${JSON.stringify(this.homeDirectory)};`,
      `const npmGlobalBin = ${JSON.stringify(this.npmGlobalBinDirectory)};`,
      `const windows = ${JSON.stringify(this.platform === "win32")};`,
      "const quote = (value) => `'${String(value).replaceAll(\"'\", \"'\\\"'\\\"'\")}'`;",
      "const packageDirectories = [];",
      "if (fs.existsSync(nodeModules)) {",
      "  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {",
      "    if (entry.name.startsWith('.')) continue;",
      "    const entryPath = path.join(nodeModules, entry.name);",
      "    let directory = entry.isDirectory();",
      "    try { if (entry.isSymbolicLink()) directory = fs.statSync(entryPath).isDirectory(); } catch {}",
      "    if (!directory) continue;",
      "    if (!entry.name.startsWith('@')) { packageDirectories.push(entryPath); continue; }",
      "    for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {",
      "      const scopedPath = path.join(entryPath, scoped.name);",
      "      let scopedDirectory = scoped.isDirectory();",
      "      try { if (scoped.isSymbolicLink()) scopedDirectory = fs.statSync(scopedPath).isDirectory(); } catch {}",
      "      if (scopedDirectory) packageDirectories.push(scopedPath);",
      "    }",
      "  }",
      "}",
      "const packages = [];",
      "const facades = new Map();",
      "for (const installedPath of packageDirectories) {",
      "  try {",
      "    const value = JSON.parse(fs.readFileSync(path.join(installedPath, 'package.json'), 'utf8'));",
      "    if (typeof value.name !== 'string' || typeof value.version !== 'string') continue;",
      "    const binEntries = typeof value.bin === 'string'",
      "      ? [[value.name.includes('/') ? value.name.slice(value.name.lastIndexOf('/') + 1) : value.name, value.bin]]",
      "      : value.bin && typeof value.bin === 'object' && !Array.isArray(value.bin)",
      "        ? Object.entries(value.bin).filter(([, target]) => typeof target === 'string')",
      "        : [];",
      "    for (const [name, relativeTarget] of binEntries) {",
      "      const target = path.resolve(installedPath, relativeTarget);",
      "      const difference = path.relative(path.resolve(installedPath), target);",
      "      if (difference !== '..' && !difference.startsWith(`..${path.sep}`) && !path.isAbsolute(difference) && fs.existsSync(target)) {",
      "        facades.set(name, target);",
      "      }",
      "    }",
      "    packages.push({ name: value.name, version: value.version, installedPath, bins: binEntries.map(([name]) => name).sort() });",
      "  } catch {}",
      "}",
      "packages.sort((left, right) => left.name.localeCompare(right.name));",
      "fs.mkdirSync(binDirectory, { recursive: true });",
      "for (const entry of fs.readdirSync(binDirectory)) fs.rmSync(path.join(binDirectory, entry), { recursive: true, force: true });",
      "for (const [name, target] of facades) {",
      "  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) continue;",
      "  if (windows) {",
      "    const globalCommand = path.join(npmGlobalBin, `${name}.cmd`);",
      "    fs.writeFileSync(path.join(binDirectory, `${name}.cmd`), [",
      "      '@echo off',",
      "      `set \"HOME=${managedHome}\"`,",
      "      `set \"XDG_CONFIG_HOME=${path.join(managedHome, '.config')}\"`,",
      "      `set \"XDG_DATA_HOME=${path.join(managedHome, '.local', 'share')}\"`,",
      "      `set \"XDG_CACHE_HOME=${path.join(managedHome, '.cache')}\"`,",
      "      `\"${fs.existsSync(globalCommand) ? globalCommand : target}\" %*`,",
      "      '',",
      "    ].join('\\r\\n'));",
      "  } else {",
      "    const launcher = path.join(binDirectory, `.${name}-launcher`);",
      "    fs.writeFileSync(launcher, [",
      "      '#!/bin/sh',",
      "      `export HOME=${quote(managedHome)}`,",
      "      `export XDG_CONFIG_HOME=${quote(path.join(managedHome, '.config'))}`,",
      "      `export XDG_DATA_HOME=${quote(path.join(managedHome, '.local', 'share'))}`,",
      "      `export XDG_CACHE_HOME=${quote(path.join(managedHome, '.cache'))}`,",
      "      `exec ${quote(target)} \"$@\"`,",
      "      '',",
      "    ].join('\\n'), { mode: 0o755 });",
      "    fs.symlinkSync(launcher, path.join(binDirectory, name));",
      "  }",
      "}",
      "fs.writeFileSync(manifestPath, `${JSON.stringify({ version: 1, packages }, null, 2)}\\n`);",
      "",
    ].join("\n"));

    if (this.platform === "win32") {
      const electronEnvironment = [
        "@echo off",
        "set \"PI_WORK_ORIGINAL_NODE_OPTIONS=%NODE_OPTIONS%\"",
        `set "PI_WORK_NODE_CLEANUP=${cleanupPath}"`,
        "set \"NODE_OPTIONS=--require \\\"%PI_WORK_NODE_CLEANUP%\\\" %NODE_OPTIONS%\"",
        "set ELECTRON_RUN_AS_NODE=1",
      ].join("\r\n");
      writeFileSync(
        join(this.runtimeBinDirectory, "node.cmd"),
        `${electronEnvironment}\r\n"${this.options.nodeExecutable}" %*\r\n`,
      );
      for (const [name, cli] of [["npm", this.npmCliPath], ["npx", this.npxCliPath]] as const) {
        writeFileSync(join(this.runtimeBinDirectory, `${name}.cmd`), [
          "@echo off",
          "set ELECTRON_RUN_AS_NODE=1",
          `"${this.options.nodeExecutable}" "${launcherPath}" "${cli}" %*`,
          "set PI_WORK_COMMAND_STATUS=%ERRORLEVEL%",
          `"${this.options.nodeExecutable}" "${reconcilePath}"`,
          "exit /b %PI_WORK_COMMAND_STATUS%",
          "",
        ].join("\r\n"));
      }
      writeFileSync(join(this.runtimeBinDirectory, "pi.cmd"), [
        "@echo off",
        "set \"PI_WORK_ORIGINAL_NODE_OPTIONS=%NODE_OPTIONS%\"",
        `set "PI_WORK_NODE_CLEANUP=${cleanupPath}"`,
        "set \"NODE_OPTIONS=--require \\\"%PI_WORK_NODE_CLEANUP%\\\" %NODE_OPTIONS%\"",
        "set ELECTRON_RUN_AS_NODE=1",
        "set \"PI_CODING_AGENT_SESSION_DIR=\"",
        "set \"PI_CONFIG_DIR=\"",
        `set "PI_CODING_AGENT_DIR=${this.piAgentDirectory}"`,
        `set "PI_PACKAGE_DIR=${this.piPackageDirectory}"`,
        `"${this.options.nodeExecutable}" "${this.piCliPath}" %*`,
        "",
      ].join("\r\n"));
      return;
    }

    const nodeEnvironment = [
      `export PI_WORK_NODE_CLEANUP=${quotePosix(cleanupPath)}`,
      "export PI_WORK_ORIGINAL_NODE_OPTIONS=\"${NODE_OPTIONS-}\"",
      "export NODE_OPTIONS=\"--require \\\"$PI_WORK_NODE_CLEANUP\\\"${NODE_OPTIONS:+ $NODE_OPTIONS}\"",
      "export ELECTRON_RUN_AS_NODE=1",
    ].join("\n");
    const piEnvironment = [
      nodeEnvironment,
      "unset PI_CODING_AGENT_SESSION_DIR",
      "unset PI_CONFIG_DIR",
      `export PI_CODING_AGENT_DIR=${quotePosix(this.piAgentDirectory)}`,
      `export PI_PACKAGE_DIR=${quotePosix(this.piPackageDirectory)}`,
    ].join("\n");
    writeFileSync(
      join(this.runtimeBinDirectory, "node"),
      `#!/bin/sh\n${nodeEnvironment}\nexec ${quotePosix(this.options.nodeExecutable)} "$@"\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(this.runtimeBinDirectory, "pi"),
      `#!/bin/sh\n${piEnvironment}\nexec ${quotePosix(this.options.nodeExecutable)} ${quotePosix(this.piCliPath)} "$@"\n`,
      { mode: 0o755 },
    );
    for (const [name, cli] of [["npm", this.npmCliPath], ["npx", this.npxCliPath]] as const) {
      writeFileSync(join(this.runtimeBinDirectory, name), [
        "#!/bin/sh",
        "export ELECTRON_RUN_AS_NODE=1",
        `${quotePosix(this.options.nodeExecutable)} ${quotePosix(launcherPath)} ${quotePosix(cli)} "$@"`,
        "status=$?",
        `${quotePosix(this.options.nodeExecutable)} ${quotePosix(reconcilePath)}`,
        "exit $status",
        "",
      ].join("\n"), { mode: 0o755 });
    }
  }

  private writeFacades(facades: Map<string, string>): void {
    for (const entry of readdirSync(this.binDirectory)) {
      rmSync(join(this.binDirectory, entry), { recursive: true, force: true });
    }
    for (const [name, target] of facades) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) continue;
      if (this.platform === "win32") {
        writeFileSync(join(this.binDirectory, `${name}.cmd`), [
          "@echo off",
          `set "HOME=${this.homeDirectory}"`,
          `set "XDG_CONFIG_HOME=${join(this.homeDirectory, ".config")}"`,
          `set "XDG_DATA_HOME=${join(this.homeDirectory, ".local", "share")}"`,
          `set "XDG_CACHE_HOME=${join(this.homeDirectory, ".cache")}"`,
          `"${target}" %*`,
          "",
        ].join("\r\n"));
      } else {
        const facadePath = join(this.binDirectory, name);
        const launcherPath = join(this.binDirectory, `.${name}-launcher`);
        rmSync(facadePath, { force: true });
        writeFileSync(launcherPath, [
          "#!/bin/sh",
          `export HOME=${quotePosix(this.homeDirectory)}`,
          `export XDG_CONFIG_HOME=${quotePosix(join(this.homeDirectory, ".config"))}`,
          `export XDG_DATA_HOME=${quotePosix(join(this.homeDirectory, ".local", "share"))}`,
          `export XDG_CACHE_HOME=${quotePosix(join(this.homeDirectory, ".cache"))}`,
          `exec ${quotePosix(target)} "$@"`,
          "",
        ].join("\n"), { mode: 0o755 });
        try {
          symlinkSync(launcherPath, facadePath);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
          rmSync(facadePath, { recursive: true, force: true });
          symlinkSync(launcherPath, facadePath);
        }
      }
    }
  }

  private runCommand(
    executable: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<ManagedCliExecutionResult> {
    const timeoutMs = options.timeoutMs === undefined
      ? 0
      : Math.max(1, Math.min(maximumTimeoutMs, Math.floor(options.timeoutMs)));
    return new Promise((resolveResult, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const append = (current: string, chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > maximumOutputBytes) {
          child.kill();
          return current;
        }
        return current + chunk.toString();
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        if (timer !== undefined) clearTimeout(timer);
        const result = {
          command: executable,
          args,
          cwd: options.cwd,
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
        };
        if (exitCode !== 0 && !timedOut) {
          reject(Object.assign(new Error(stderr.trim() || `Command failed with exit code ${exitCode}.`), { result }));
          return;
        }
        resolveResult(result);
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs);
      }
    });
  }
}
