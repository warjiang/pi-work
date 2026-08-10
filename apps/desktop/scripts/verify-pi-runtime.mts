import { access, readdir } from "node:fs/promises";
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
await access(resolve(runtimeDirectory, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
