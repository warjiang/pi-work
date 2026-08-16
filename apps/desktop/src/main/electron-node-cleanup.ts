/**
 * Source for `cleanup-electron-node.cjs`, injected via `NODE_OPTIONS=--require`
 * into every Node process the managed CLI runtime and terminal launch.
 *
 * Pi Work runs the CLI/agent using the Electron binary as Node
 * (`ELECTRON_RUN_AS_NODE=1`). The launch shims set that flag, then this script
 * removes it from `process.env` so it never leaks into unrelated child
 * processes (e.g. git, python, a GUI Electron app).
 *
 * The downside of stripping the flag is that tools which re-spawn
 * `process.execPath` expecting real Node (a very common pattern — bytedcli's
 * self-update probe is one example) get the bare Electron binary, which then
 * boots in GUI/app mode and fails with "Unable to find Electron app" /
 * "Cannot find module". To keep the clean environment *and* support that
 * pattern, we monkey-patch `child_process` so that any spawn whose target is
 * the Electron binary (or any `fork`, which always targets it) transparently
 * gets `ELECTRON_RUN_AS_NODE=1` re-injected into *that child's* env only. The
 * cleanup `--require` is also re-added so the behaviour propagates cleanly to
 * grandchildren, mirroring the launch shims.
 */
export function electronNodeCleanupScript(): string {
  return `(() => {
  const electronBinary = process.execPath;
  const cleanupFile = __filename;
  delete process.env.ELECTRON_RUN_AS_NODE;
  const originalNodeOptions = process.env.PI_WORK_ORIGINAL_NODE_OPTIONS;
  delete process.env.PI_WORK_ORIGINAL_NODE_OPTIONS;
  delete process.env.PI_WORK_NODE_CLEANUP;
  if (originalNodeOptions) process.env.NODE_OPTIONS = originalNodeOptions;
  else delete process.env.NODE_OPTIONS;

  let childProcess;
  try {
    childProcess = require("node:child_process");
  } catch (error) {
    return;
  }
  if (!childProcess || childProcess.__piWorkElectronNodePatched) return;
  Object.defineProperty(childProcess, "__piWorkElectronNodePatched", {
    value: true,
    enumerable: false,
    configurable: true,
  });

  const requireFlag = "--require " + JSON.stringify(cleanupFile);
  const withElectronNodeEnv = (env) => {
    const base = env && typeof env === "object" ? Object.assign({}, env) : Object.assign({}, process.env);
    base.ELECTRON_RUN_AS_NODE = "1";
    const existing = typeof base.NODE_OPTIONS === "string" ? base.NODE_OPTIONS : "";
    base.NODE_OPTIONS = existing.indexOf(cleanupFile) !== -1
      ? existing
      : (existing ? requireFlag + " " + existing : requireFlag);
    return base;
  };
  const injectOptions = (args) => {
    let callbackIndex = -1;
    if (args.length > 0 && typeof args[args.length - 1] === "function") callbackIndex = args.length - 1;
    let optionsIndex = -1;
    for (let i = 1; i < args.length; i++) {
      if (i === callbackIndex) continue;
      const value = args[i];
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        optionsIndex = i;
        break;
      }
    }
    if (optionsIndex === -1) {
      const insertAt = callbackIndex === -1 ? args.length : callbackIndex;
      args.splice(insertAt, 0, { env: withElectronNodeEnv(undefined) });
    } else {
      const next = Object.assign({}, args[optionsIndex]);
      next.env = withElectronNodeEnv(next.env);
      args[optionsIndex] = next;
    }
    return args;
  };
  const patch = (name, always) => {
    const original = childProcess[name];
    if (typeof original !== "function") return;
    childProcess[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      if (always || (args.length > 0 && args[0] === electronBinary)) {
        return original.apply(this, injectOptions(args));
      }
      return original.apply(this, args);
    };
  };
  patch("spawn", false);
  patch("spawnSync", false);
  patch("execFile", false);
  patch("execFileSync", false);
  patch("fork", true);
})();
`;
}
