import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererRoot = new URL(".", import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(tsx|ts)$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

describe("renderer icon system", () => {
  it("keeps SVG implementation and Lucide imports centralized", async () => {
    const files = await sourceFiles(rendererRoot);
    const iconFile = files.find((file) => file.pathname.endsWith("/components/ui/icon.tsx"));
    expect(iconFile).toBeDefined();

    for (const file of files) {
      if (file === iconFile) continue;
      const source = await readFile(file, "utf8");
      expect(source, file.pathname).not.toMatch(/<svg[\s>]/);
      expect(source, file.pathname).not.toMatch(/from ["']lucide-react["']/);
    }
  });

  it("uses only the compact and standard icon sizes in product UI", async () => {
    const files = (await sourceFiles(rendererRoot)).filter((file) => (
      !file.pathname.endsWith("/components/ui/icon.tsx")
      && !file.pathname.endsWith(".test.ts")
    ));
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const sizes = sources.flatMap((source) => (
      [...source.matchAll(/<Icon\b[^>]*\bsize=\{(\d+)\}/g)].map((match) => Number(match[1]))
    ));
    expect(new Set(sizes)).toEqual(new Set([14]));
  });
});
