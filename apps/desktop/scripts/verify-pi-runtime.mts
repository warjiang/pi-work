import { access, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const releaseDirectory = resolve("release");
const candidates = await readdir(releaseDirectory, { withFileTypes: true });
const unpackedCandidates = candidates.filter(
  (candidate) => candidate.isDirectory() && candidate.name.includes("mac"),
);

if (unpackedCandidates.length === 0) {
  throw new Error("No macOS unpacked application was found in the release directory.");
}

let runtimeDirectory: string | undefined;
for (const unpacked of unpackedCandidates) {
  const candidateRuntimeDirectory = resolve(
    releaseDirectory,
    unpacked.name,
    "Pi Work.app",
    "Contents",
    "Resources",
    "pi-runtime",
  );
  try {
    await access(resolve(candidateRuntimeDirectory, "agent-service.js"));
    runtimeDirectory = candidateRuntimeDirectory;
    break;
  } catch {
    // Ignore stale unpacked outputs from a different target architecture.
  }
}

if (runtimeDirectory === undefined) {
  throw new Error("No macOS unpacked application contains the Pi runtime.");
}

await access(resolve(runtimeDirectory, "chunks"));
const sdkDirectory = resolve(runtimeDirectory, "node_modules", "@earendil-works", "pi-coding-agent");
await access(resolve(sdkDirectory, "package.json"));
const sdk = await import(pathToFileURL(resolve(sdkDirectory, "dist", "index.js")).href);
if (typeof sdk.DefaultPackageManager !== "function" || typeof sdk.DefaultResourceLoader !== "function") {
  throw new Error("Packaged Pi runtime does not export extension package/resource loaders.");
}
