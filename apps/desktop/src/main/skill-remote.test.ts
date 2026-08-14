import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRemoteResolver } from "./skill-remote.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

async function createTarFixture(skills: Array<{ directory: string; name: string }>, symbolicLink = false): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "pi-work-remote-fixture-"));
  temporaryDirectories.push(directory);
  for (const skill of skills) {
    const root = join(directory, skill.directory);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "SKILL.md"), [
      "---",
      `name: ${skill.name}`,
      `description: Handles ${skill.name}.`,
      "---",
      "# Instructions",
      "",
    ].join("\n"), "utf8");
  }
  if (symbolicLink) await symlink("../first/SKILL.md", join(directory, "first", "linked.md"));
  const archive = join(directory, "fixture.tgz");
  await tar.c({ cwd: directory, file: archive, gzip: true }, skills.map(({ directory: path }) => path));
  return readFile(archive);
}

function responseBody(content: Buffer): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

describe("SkillRemoteResolver", () => {
  it("maps and caches skills.sh search responses while marking installed Skills", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      skills: [{
        id: "example/repository/pdf-review",
        skillId: "pdf-review",
        name: "PDF Review",
        installs: 1250,
        source: "example/repository",
      }],
    }), { headers: { "content-type": "application/json" } }));
    const resolver = new SkillRemoteResolver(fetcher as typeof fetch);

    const first = await resolver.searchMarketplace(
      { provider: "skills.sh", query: "pdf", limit: 30 },
      new Set(["pdf-review"]),
    );
    const second = await resolver.searchMarketplace(
      { provider: "skills.sh", query: "pdf", limit: 30 },
      new Set(),
    );

    expect(first).toMatchObject([{
      skillId: "pdf-review",
      sourceUrl: "https://github.com/example/repository",
      detailUrl: "https://www.skills.sh/example/repository/pdf-review",
      installed: true,
    }]);
    expect(second[0]?.installed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolver.dispose();
  });

  it("previews multiple Skills, marks duplicates, and removes temporary sessions", async () => {
    const archive = await createTarFixture([
      { directory: "first", name: "first-skill" },
      { directory: "second", name: "second-skill" },
    ]);
    const resolver = new SkillRemoteResolver(async () => new Response(responseBody(archive), {
      headers: { "content-type": "application/gzip" },
    }));

    const preview = await resolver.preview(
      { sourceUrl: "https://example.com/skills.tgz", provider: "url" },
      new Set(["second-skill"]),
    );
    const sessionDirectory = resolver.requirePreview(preview.previewId).directory;

    expect(preview.skills).toMatchObject([
      { id: "first", name: "first-skill", duplicate: false },
      { id: "second", name: "second-skill", duplicate: true },
    ]);
    await expect(stat(sessionDirectory)).resolves.toBeDefined();
    await resolver.removePreview(preview.previewId);
    await expect(stat(sessionDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => resolver.requirePreview(preview.previewId)).toThrow(/expired/i);
  });

  it("rejects symbolic links and malformed remote Skills", async () => {
    const archive = await createTarFixture([{ directory: "first", name: "first-skill" }], true);
    const resolver = new SkillRemoteResolver(async () => new Response(responseBody(archive), {
      headers: { "content-type": "application/gzip" },
    }));
    await expect(resolver.preview(
      { sourceUrl: "https://example.com/skills.tgz", provider: "url" },
      new Set(),
    )).rejects.toThrow(/symbolic links/i);

    const invalid = new SkillRemoteResolver(async () => new Response("# Missing frontmatter\n"));
    await expect(invalid.preview(
      { sourceUrl: "https://example.com/SKILL.md", provider: "url" },
      new Set(),
    )).rejects.toThrow(/frontmatter/i);
  });

  it("surfaces marketplace network failures", async () => {
    const resolver = new SkillRemoteResolver(async () => {
      throw new Error("network unavailable");
    });
    await expect(resolver.searchMarketplace(
      { provider: "skills.sh", query: "pdf", limit: 30 },
      new Set(),
    )).rejects.toThrow("network unavailable");
  });
});
