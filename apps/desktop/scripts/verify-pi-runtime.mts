import { access, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const releaseDirectory = resolve("release");
const candidates = await readdir(releaseDirectory, { withFileTypes: true });
const unpacked = candidates.find((candidate) => candidate.isDirectory() && candidate.name.includes("mac"));

if (unpacked === undefined) {
  throw new Error("No macOS unpacked application was found in the release directory.");
}

const runtimeDirectory = resolve(
  releaseDirectory,
  unpacked.name,
  "Pi Work.app",
  "Contents",
  "Resources",
  "pi-runtime",
);

await access(resolve(runtimeDirectory, "agent-service.js"));
await access(resolve(runtimeDirectory, "chunks"));
const sdkDirectory = resolve(runtimeDirectory, "node_modules", "@earendil-works", "pi-coding-agent");
await access(resolve(sdkDirectory, "package.json"));
const sdk = await import(pathToFileURL(resolve(sdkDirectory, "dist", "index.js")).href);
if (typeof sdk.DefaultPackageManager !== "function" || typeof sdk.DefaultResourceLoader !== "function") {
  throw new Error("Packaged Pi runtime does not export extension package/resource loaders.");
}
