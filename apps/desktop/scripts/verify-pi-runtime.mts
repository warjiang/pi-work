import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const releaseDirectory = resolve("release");
const entries = await readdir(releaseDirectory, {
  recursive: true,
  withFileTypes: true,
});
const runtimeEntries = entries.filter(
  (entry) =>
    entry.isFile() &&
    entry.name === "agent-service.js" &&
    entry.parentPath?.endsWith(join("Contents", "Resources", "pi-runtime")),
);

if (runtimeEntries.length === 0) {
  const topLevelEntries = await readdir(releaseDirectory);
  throw new Error(
    `No macOS application contains the Pi runtime. Release entries: ${topLevelEntries.join(", ") || "(empty)"}.`,
  );
}

const runtimeEntry = runtimeEntries[0];
if (runtimeEntry === undefined || runtimeEntry.parentPath === undefined) {
  throw new Error("Pi runtime entry is missing its path.");
}
const runtimeDirectory = runtimeEntry.parentPath;
await access(resolve(runtimeDirectory, "chunks"));
const sdkDirectory = resolve(runtimeDirectory, "node_modules", "@earendil-works", "pi-coding-agent");
await access(resolve(sdkDirectory, "package.json"));
await access(resolve(sdkDirectory, "dist", "cli.js"));
await access(resolve(runtimeDirectory, "node_modules", "npm", "bin", "npm-cli.js"));
await access(resolve(runtimeDirectory, "node_modules", "npm", "bin", "npx-cli.js"));
const sdk = await import(pathToFileURL(resolve(sdkDirectory, "dist", "index.js")).href);
if (typeof sdk.DefaultPackageManager !== "function" || typeof sdk.DefaultResourceLoader !== "function") {
  throw new Error("Packaged Pi runtime does not export extension package/resource loaders.");
}
