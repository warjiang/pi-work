import { chmod, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const helperPath = resolve(
    scriptDirectory,
    "..",
    "node_modules",
    "node-pty",
    "prebuilds",
    `darwin-${process.arch}`,
    "spawn-helper",
  );
  const mode = (await stat(helperPath)).mode;

  if ((mode & 0o111) === 0) {
    await chmod(helperPath, mode | 0o700);
    console.info("Restored execute permission for node-pty's spawn helper.");
  }
}
