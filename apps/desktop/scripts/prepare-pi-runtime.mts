import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const runtimeDirectory = resolve(packageDirectory, "build", "pi-runtime");
const agentEntry = resolve(packageDirectory, "out", "main", "agent-service.js");
const piModules = resolve(packageDirectory, "..", "..", "packages", "pi-adapter", "node_modules", "@earendil-works");

await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
await cp(agentEntry, resolve(runtimeDirectory, "agent-service.js"));
await cp(piModules, resolve(runtimeDirectory, "node_modules", "@earendil-works"), {
  recursive: true,
  dereference: true,
});
await writeFile(resolve(runtimeDirectory, "package.json"), JSON.stringify({
  private: true,
  type: "module",
  dependencies: {
    "@earendil-works/pi-coding-agent": "0.84.1",
  },
}, null, 2));
