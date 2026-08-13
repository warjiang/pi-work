import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiWorkStore } from "@pi-work/storage";
import { afterEach, describe, expect, it } from "vitest";
import { SkillManager } from "./skill-manager.js";

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
    await expect(manager.scanSystem()).resolves.toMatchObject([{ name: "system-review", imported: true }]);
  });
});
