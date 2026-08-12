import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Skill, SystemSkill } from "@pi-work/protocol";
import {
  createSkillInputSchema,
  skillSchema,
  updateSkillInputSchema,
} from "@pi-work/protocol";
import { PiWorkStore } from "@pi-work/storage";

const skillFileName = "SKILL.md";

export class SkillManager {
  private migration: Promise<void> | null = null;

  constructor(
    private readonly store: PiWorkStore,
    private readonly userDataPath: string,
    private readonly externalSkillRoots?: SystemSkillRoot[],
  ) {}

  async list(): Promise<Skill[]> {
    await this.ensureMigrated();
    return this.store.listGlobalSkills();
  }

  async scanSystem(): Promise<SystemSkill[]> {
    await this.ensureMigrated();
    const managedNames = new Set(this.store.listGlobalSkills().map(({ name }) => name));
    const discovered: SystemSkill[] = [];
    for (const root of this.systemSkillRoots) {
      for (const directory of await findSkillDirectories(root.path)) {
        try {
          const parsed = parseSkillFile(await readFile(join(directory, skillFileName), "utf8"));
          validateImportedSkill(parsed.name, parsed.description);
          discovered.push({
            name: parsed.name,
            description: parsed.description,
            path: directory,
            source: root.source,
            imported: managedNames.has(parsed.name),
          });
        } catch {
          // Ignore malformed external Skills; they can still be imported manually after repair.
        }
      }
    }
    return discovered.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  }

  async create(input: unknown): Promise<Skill> {
    await this.ensureMigrated();
    const value = createSkillInputSchema.parse(input);
    this.assertNameAvailable(value.name);
    const skill = this.store.createDomainEntity("skill", skillSchema, {
      workspaceId: null,
      ...value,
    });
    await this.writeSkillFile(skill);
    await this.configureEnabled(skill.id, skill.enabled);
    return skill;
  }

  async update(id: string, input: unknown): Promise<Skill> {
    await this.ensureMigrated();
    const value = updateSkillInputSchema.parse(input);
    const current = this.requireSkill(id);
    this.assertNameAvailable(value.name, id);
    const skill = this.store.updateDomainEntity("skill", skillSchema, id, {
      ...value,
      workspaceId: null,
    });
    await this.writeSkillFile(skill);
    if (current.enabled !== skill.enabled) await this.configureEnabled(skill.id, skill.enabled);
    return skill;
  }

  async import(source: string): Promise<Skill> {
    await this.ensureMigrated();
    if (!isAbsolute(source)) throw new Error("Import a Skill using an absolute folder path.");
    const sourceRoot = resolve(source);
    const sourceInfo = await stat(sourceRoot);
    if (!sourceInfo.isDirectory()) throw new Error("Choose a Skill folder containing SKILL.md.");
    const sourceFile = join(sourceRoot, skillFileName);
    const parsed = parseSkillFile(await readFile(sourceFile, "utf8"));
    validateImportedSkill(parsed.name, parsed.description);
    this.assertNameAvailable(parsed.name);
    const skill = this.store.createDomainEntity("skill", skillSchema, {
      workspaceId: null,
      name: parsed.name,
      description: parsed.description,
      instructions: parsed.instructions,
      enabled: true,
    });
    const destination = this.directoryFor(skill.id);
    try {
      await cp(sourceRoot, destination, { recursive: true, errorOnExist: true });
      await this.configureEnabled(skill.id, true);
      return skill;
    } catch (error) {
      this.store.removeDomainEntity("skill", skill.id);
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.ensureMigrated();
    this.requireSkill(id);
    const destination = this.directoryFor(id);
    this.store.removeDomainEntity("skill", id);
    await this.removeConfiguredSkill(id);
    await rm(destination, { recursive: true, force: true });
  }

  async setEnabled(id: string, enabled: boolean): Promise<Skill> {
    await this.ensureMigrated();
    const current = this.requireSkill(id);
    const skill = current.enabled === enabled
      ? current
      : this.store.updateDomainEntity("skill", skillSchema, id, { enabled, workspaceId: null });
    await this.configureEnabled(id, enabled);
    return skill;
  }

  private async configureEnabled(id: string, enabled: boolean): Promise<void> {
    const settings = SettingsManager.create(this.userDataPath, this.agentDir, { projectTrusted: false });
    const pattern = `skills/${id}`;
    const skills = ((settings.getGlobalSettings().skills ?? []) as string[])
      .filter((entry) => stripPatternPrefix(entry) !== pattern);
    skills.push(`${enabled ? "+" : "-"}${pattern}`);
    settings.setSkillPaths(skills);
    await settings.flush();
  }

  private async removeConfiguredSkill(id: string): Promise<void> {
    const settings = SettingsManager.create(this.userDataPath, this.agentDir, { projectTrusted: false });
    const pattern = `skills/${id}`;
    const skills = ((settings.getGlobalSettings().skills ?? []) as string[])
      .filter((entry) => stripPatternPrefix(entry) !== pattern);
    settings.setSkillPaths(skills);
    await settings.flush();
  }

  private get agentDir(): string {
    return join(this.userDataPath, "pi-agent");
  }

  private get skillsRoot(): string {
    return join(this.agentDir, "skills");
  }

  private get systemSkillRoots(): SystemSkillRoot[] {
    if (this.externalSkillRoots !== undefined) return this.externalSkillRoots;
    const roots: SystemSkillRoot[] = [
      { source: "pi", path: join(homedir(), ".pi", "agent", "skills") },
      { source: "agents", path: join(homedir(), ".agents", "skills") },
      { source: "codex", path: join(homedir(), ".codex", "skills") },
      { source: "claude", path: join(homedir(), ".claude", "skills") },
    ];
    return roots.filter((root) => resolve(root.path) !== resolve(this.skillsRoot));
  }

  private directoryFor(id: string): string {
    const candidate = resolve(this.skillsRoot, id);
    const difference = relative(resolve(this.skillsRoot), candidate);
    if (difference === "" || difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
      throw new Error("Invalid managed Skill path.");
    }
    return candidate;
  }

  private requireSkill(id: string): Skill {
    const skill = this.store.listGlobalSkills().find((candidate) => candidate.id === id);
    if (skill === undefined) throw new Error(`Unknown Skill: ${id}`);
    return skill;
  }

  private assertNameAvailable(name: string, exceptId?: string): void {
    const duplicate = this.store.listGlobalSkills().find((skill) => skill.name === name && skill.id !== exceptId);
    if (duplicate !== undefined) throw new Error(`A Skill named "${name}" already exists.`);
  }

  private async writeSkillFile(skill: Skill): Promise<void> {
    const directory = this.directoryFor(skill.id);
    const path = join(directory, skillFileName);
    await mkdir(directory, { recursive: true });
    let current: ParsedSkillFile | null = null;
    try {
      current = parseSkillFile(await readFile(path, "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await writeFile(path, serializeSkillFile(skill, current?.frontmatter ?? []), "utf8");
  }

  private async ensureMigrated(): Promise<void> {
    this.migration ??= this.migrateLegacySkills();
    await this.migration;
  }

  private async migrateLegacySkills(): Promise<void> {
    const skills = this.store.migrateSkillsToGlobal();
    const names = new Set<string>();
    for (const legacy of skills) {
      const name = uniqueSkillName(normalizeSkillName(legacy.name), names);
      names.add(name);
      const skill = name === legacy.name
        ? legacy
        : this.store.updateDomainEntity("skill", skillSchema, legacy.id, { name, workspaceId: null });
      const path = join(this.directoryFor(skill.id), skillFileName);
      try {
        await stat(path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        await this.writeSkillFile(skill);
      }
      await this.configureEnabled(skill.id, skill.enabled);
    }
  }
}

type ParsedSkillFile = {
  name: string;
  description: string;
  instructions: string;
  frontmatter: string[];
};

type SystemSkillRoot = {
  source: SystemSkill["source"];
  path: string;
};

async function findSkillDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  const queue = [root];
  while (queue.length > 0 && directories.length < 500) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries: Dirent<string>[];
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === skillFileName)) {
      directories.push(current);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(join(current, entry.name));
    }
  }
  return directories;
}

function parseSkillFile(content: string): ParsedSkillFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match === null) throw new Error("SKILL.md must start with YAML frontmatter.");
  const rawFrontmatter = match[1];
  const instructions = match[2];
  if (rawFrontmatter === undefined || instructions === undefined) {
    throw new Error("SKILL.md frontmatter could not be parsed.");
  }
  const frontmatter = rawFrontmatter.split(/\r?\n/);
  const name = frontmatter.find((line) => line.startsWith("name:"))?.slice("name:".length).trim() ?? "";
  const description = frontmatter.find((line) => line.startsWith("description:"))?.slice("description:".length).trim() ?? "";
  if (name === "" || description === "") throw new Error("SKILL.md frontmatter requires name and description.");
  return { name: unquote(name), description: unquote(description), instructions, frontmatter };
}

function serializeSkillFile(skill: Skill, previous: string[]): string {
  const extra = previous.filter((line) => !line.startsWith("name:") && !line.startsWith("description:"));
  const lines = [
    "---",
    `name: ${skill.name}`,
    `description: ${yamlValue(skill.description)}`,
    ...extra,
    "---",
    skill.instructions,
  ];
  return `${lines.join("\n").replace(/\n*$/, "\n")}`;
}

function validateImportedSkill(name: string, description: string): void {
  createSkillInputSchema.parse({ name, description, instructions: "", enabled: true });
}

function normalizeSkillName(value: string): string {
  const normalized = value.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return normalized || "skill";
}

function uniqueSkillName(base: string, names: Set<string>): string {
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const postfix = `-${suffix}`;
    const candidate = `${base.slice(0, 64 - postfix.length)}${postfix}`;
    if (!names.has(candidate)) return candidate;
  }
}

function stripPatternPrefix(value: string): string {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
}

function yamlValue(value: string): string {
  return /^[A-Za-z0-9 .,:;!?()[\]@/+_=-]+$/.test(value) ? value : JSON.stringify(value);
}

function unquote(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return value;
}
