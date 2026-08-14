import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiWorkStore } from "@pi-work/storage";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { SkillManager } from "./skill-manager.js";
import { SkillRemoteResolver } from "./skill-remote.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

async function createFixture() {
  const userData = await mkdtemp(join(tmpdir(), "pi-work-skills-"));
  temporaryDirectories.push(userData);
  const store = new PiWorkStore();
  return {
    userData,
    store,
    manager: new SkillManager(store, userData),
  };
}

async function createRemoteArchive(userData: string, names: string[]): Promise<Buffer> {
  const source = join(userData, "remote-source");
  await mkdir(source, { recursive: true });
  for (const name of names) {
    await mkdir(join(source, name), { recursive: true });
    await writeFile(join(source, name, "SKILL.md"), [
      "---",
      `name: ${name}`,
      `description: Handles ${name}.`,
      "---",
      `# ${name}`,
      "",
    ].join("\n"), "utf8");
  }
  const archive = join(userData, "remote-skills.tgz");
  await tar.c({ cwd: source, file: archive, gzip: true }, names);
  return readFile(archive);
}

function responseBody(content: Buffer): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

describe("SkillManager", () => {
  it("writes managed SKILL.md files and preserves unrelated Pi settings", async () => {
    const { userData, manager } = await createFixture();
    const agentDir = join(userData, "pi-agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      extensions: ["extensions/keep-me.ts"],
      skills: ["+external-skill"],
      defaultModel: "keep-this-model",
    }), "utf8");

    const skill = await manager.create({
      name: "pdf-review",
      description: "Reviews PDF documents.",
      instructions: "# Instructions\nCheck every page.",
      enabled: true,
    });
    expect(skill.source).toEqual({ type: "created" });

    await expect(readFile(join(agentDir, "skills", skill.id, "SKILL.md"), "utf8")).resolves.toBe(
      "---\nname: pdf-review\ndescription: Reviews PDF documents.\n---\n# Instructions\nCheck every page.\n",
    );
    const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      extensions?: string[];
      skills?: string[];
      defaultModel?: string;
    };
    expect(settings.extensions).toEqual(["extensions/keep-me.ts"]);
    expect(settings.defaultModel).toBe("keep-this-model");
    expect(settings.skills).toEqual(["+external-skill", `+skills/${skill.id}`]);

    const loader = new DefaultResourceLoader({
      cwd: userData,
      agentDir,
      settingsManager: SettingsManager.create(userData, agentDir, { projectTrusted: false }),
    });
    await loader.reload();
    expect(loader.getSkills().skills.map(({ name }) => name)).toContain("pdf-review");

    await manager.setEnabled(skill.id, false);
    const disabledLoader = new DefaultResourceLoader({
      cwd: userData,
      agentDir,
      settingsManager: SettingsManager.create(userData, agentDir, { projectTrusted: false }),
    });
    await disabledLoader.reload();
    expect(disabledLoader.getSkills().skills.map(({ name }) => name)).not.toContain("pdf-review");
  });

  it("imports nested resources into Pi Work without changing the source folder", async () => {
    const { userData, manager } = await createFixture();
    const source = join(userData, "external-skill");
    await mkdir(join(source, "scripts"), { recursive: true });
    await mkdir(join(source, "references"), { recursive: true });
    await writeFile(join(source, "SKILL.md"), [
      "---",
      "name: pdf-review",
      "description: Reviews PDF documents.",
      "disable-model-invocation: true",
      "---",
      "# Instructions",
      "Use the nested files.",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(source, "scripts", "review.mjs"), "export default 1;\n", "utf8");
    await writeFile(join(source, "references", "guide.md"), "# Guide\n", "utf8");

    const skill = await manager.import(source);
    expect(skill.source).toEqual({ type: "local", path: source });
    const destination = join(userData, "pi-agent", "skills", skill.id);
    await expect(readFile(join(destination, "scripts", "review.mjs"), "utf8")).resolves.toBe("export default 1;\n");
    await expect(readFile(join(destination, "references", "guide.md"), "utf8")).resolves.toBe("# Guide\n");
    await expect(manager.listFiles(skill.id)).resolves.toEqual([
      { name: "references", path: "references", type: "directory" },
      { name: "guide.md", path: "references/guide.md", type: "file" },
      { name: "scripts", path: "scripts", type: "directory" },
      { name: "review.mjs", path: "scripts/review.mjs", type: "file" },
      { name: "SKILL.md", path: "SKILL.md", type: "file" },
    ]);
    await expect(manager.readFile({ id: skill.id, path: "scripts/review.mjs" })).resolves.toEqual({
      path: "scripts/review.mjs",
      content: "export default 1;\n",
      language: "JavaScript",
      size: 18,
    });
    await expect(manager.readFile({ id: skill.id, path: "../SKILL.md" })).rejects.toThrow("escapes the managed Skill folder");
    await expect(manager.readFile({ id: skill.id, path: "scripts" })).rejects.toThrow("not a readable file");
    await expect(readFile(join(source, "SKILL.md"), "utf8")).resolves.toContain("disable-model-invocation: true");
    await manager.update(skill.id, {
      name: "pdf-review",
      description: "Reviews revised PDF documents.",
      instructions: "# Updated instructions",
      enabled: true,
    });
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).resolves.toContain("disable-model-invocation: true");

    await expect(manager.import(source)).rejects.toThrow('A Skill named "pdf-review" already exists.');
    await manager.remove(skill.id);
    await expect(readFile(join(source, "SKILL.md"), "utf8")).resolves.toContain("name: pdf-review");
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await manager.list()).map(({ id }) => id)).not.toContain(skill.id);
  });

  it("migrates legacy workspace drafts into unique managed Skills", async () => {
    const { userData, store } = await createFixture();
    const first = store.createSkill({
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      name: "PDF Review",
      description: "Reviews PDF documents.",
      instructions: "# First",
      enabled: true,
    });
    const second = store.createSkill({
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      name: "PDF Review",
      description: "Reviews other PDF documents.",
      instructions: "# Second",
      enabled: false,
    });
    const manager = new SkillManager(store, userData);

    const skills = await manager.list();

    expect(skills.map(({ name }) => name)).toEqual(["pdf-review", "pdf-review-2"]);
    expect(skills.every(({ workspaceId }) => workspaceId === null)).toBe(true);
    await expect(readFile(join(userData, "pi-agent", "skills", first.id, "SKILL.md"), "utf8")).resolves.toContain("# First");
    await expect(readFile(join(userData, "pi-agent", "skills", second.id, "SKILL.md"), "utf8")).resolves.toContain("# Second");
  });

  it("scans valid system Skills without traversing malformed folders", async () => {
    const { userData, store } = await createFixture();
    const systemRoot = join(userData, "system-skills");
    await mkdir(join(systemRoot, "nested", "valid"), { recursive: true });
    await mkdir(join(systemRoot, "broken"), { recursive: true });
    await writeFile(join(systemRoot, "nested", "valid", "SKILL.md"), [
      "---",
      "name: system-review",
      "description: Reviews system files.",
      "---",
      "# Instructions",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(systemRoot, "broken", "SKILL.md"), "# Missing frontmatter\n", "utf8");
    const manager = new SkillManager(store, userData, [{ source: "codex", path: systemRoot }]);

    await expect(manager.scanSystem()).resolves.toEqual([{
      name: "system-review",
      description: "Reviews system files.",
      path: join(systemRoot, "nested", "valid"),
      source: "codex",
      imported: false,
    }]);
    await manager.import(join(systemRoot, "nested", "valid"));
    await expect(manager.list()).resolves.toMatchObject([{
      source: {
        type: "system",
        provider: "codex",
        path: join(systemRoot, "nested", "valid"),
      },
    }]);
    await expect(manager.scanSystem()).resolves.toMatchObject([{ name: "system-review", imported: true }]);
  });

  it("installs remote Skills with provenance and consumes the preview", async () => {
    const { userData, store } = await createFixture();
    const archive = await createRemoteArchive(userData, ["remote-review"]);
    const resolver = new SkillRemoteResolver(async () => new Response(responseBody(archive), {
      headers: { "content-type": "application/gzip" },
    }));
    const manager = new SkillManager(store, userData, [], resolver);
    const preview = await manager.previewRemote({
      sourceUrl: "https://example.com/remote-skills.tgz",
      provider: "url",
    });

    const [skill] = await manager.installRemote({
      previewId: preview.previewId,
      skillIds: preview.skills.map(({ id }) => id),
    });

    expect(skill?.source).toEqual({
      type: "remote",
      provider: "url",
      sourceUrl: "https://example.com/remote-skills.tgz",
      skillId: "remote-review",
      subpath: "remote-review",
    });
    await expect(readFile(join(userData, "pi-agent", "skills", skill?.id ?? "", "SKILL.md"), "utf8"))
      .resolves.toContain("# remote-review");
    expect(() => resolver.requirePreview(preview.previewId)).toThrow(/expired/i);
  });

  it("cancels a remote preview and removes its temporary session", async () => {
    const { userData, store } = await createFixture();
    const archive = await createRemoteArchive(userData, ["cancelled-review"]);
    const resolver = new SkillRemoteResolver(async () => new Response(responseBody(archive), {
      headers: { "content-type": "application/gzip" },
    }));
    const manager = new SkillManager(store, userData, [], resolver);
    const preview = await manager.previewRemote({
      sourceUrl: "https://example.com/remote-skills.tgz",
      provider: "url",
    });

    await manager.cancelRemotePreview(preview.previewId);

    expect(() => resolver.requirePreview(preview.previewId)).toThrow(/expired/i);
  });

  it("rolls back an entire remote batch if a later Skill cannot be installed", async () => {
    const { userData, store } = await createFixture();
    const archive = await createRemoteArchive(userData, ["first-remote", "second-remote"]);
    const resolver = new SkillRemoteResolver(async () => new Response(responseBody(archive), {
      headers: { "content-type": "application/gzip" },
    }));
    const manager = new SkillManager(store, userData, [], resolver);
    const preview = await manager.previewRemote({
      sourceUrl: "https://example.com/remote-skills.tgz",
      provider: "url",
    });
    const session = resolver.requirePreview(preview.previewId);
    const lastCandidate = session.candidates.at(-1);
    if (lastCandidate === undefined) throw new Error("Expected a second remote Skill.");
    await rm(lastCandidate.directory, { recursive: true, force: true });

    await expect(manager.installRemote({
      previewId: preview.previewId,
      skillIds: preview.skills.map(({ id }) => id),
    })).rejects.toThrow();

    await expect(manager.list()).resolves.toEqual([]);
    const managedRoot = join(userData, "pi-agent", "skills");
    await expect(readdir(managedRoot).catch(() => [])).resolves.toEqual([]);
  });
});
