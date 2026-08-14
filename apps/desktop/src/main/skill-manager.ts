import type { Dirent } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { MarketplaceSkill, RemoteSkillPreview, Skill, SkillFileContent, SkillSource, SystemSkill } from "@pi-work/protocol";
import {
  createSkillInputSchema,
  installRemoteSkillsInputSchema,
  previewRemoteSkillInputSchema,
  readSkillFileInputSchema,
  searchSkillMarketplaceInputSchema,
  skillSchema,
  updateSkillInputSchema,
} from "@pi-work/protocol";
import { PiWorkStore } from "@pi-work/storage";
import { SkillRemoteResolver } from "./skill-remote.js";

const skillFileName = "SKILL.md";
const maxSkillFileEntries = 200;
const maxSkillFileDepth = 6;
const maxReadableSkillFileBytes = 1_048_576;

export type SkillFolderEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export class SkillManager {
  private migration: Promise<void> | null = null;
  private readonly remote: SkillRemoteResolver;

  constructor(
    private readonly store: PiWorkStore,
    private readonly userDataPath: string,
    private readonly externalSkillRoots?: SystemSkillRoot[],
    remoteResolver?: SkillRemoteResolver,
  ) {
    this.remote = remoteResolver ?? new SkillRemoteResolver();
  }

  async list(): Promise<Skill[]> {
    await this.ensureMigrated();
    return this.store.listGlobalSkills();
  }

  async listFiles(id: string): Promise<SkillFolderEntry[]> {
    await this.ensureMigrated();
    this.requireSkill(id);
    return collectSkillFolderEntries(this.directoryFor(id));
  }

  async readFile(input: unknown): Promise<SkillFileContent> {
    await this.ensureMigrated();
    const value = readSkillFileInputSchema.parse(input);
    this.requireSkill(value.id);
    if (isAbsolute(value.path)) throw new Error("Skill file paths must be relative.");
    const root = await realpath(this.directoryFor(value.id));
    const target = resolve(root, value.path);
    assertPathInside(root, target);
    const file = await lstat(target);
    if (file.isSymbolicLink() || !file.isFile()) throw new Error("The selected Skill path is not a readable file.");
    if (file.size > maxReadableSkillFileBytes) throw new Error("This Skill file is larger than the 1 MiB viewing limit.");
    const resolvedTarget = await realpath(target);
    assertPathInside(root, resolvedTarget);
    const contents = await readFile(resolvedTarget);
    if (contents.includes(0)) throw new Error("Binary Skill files cannot be previewed.");
    return {
      path: value.path,
      content: contents.toString("utf8"),
      language: skillFileLanguage(value.path),
      size: file.size,
    };
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

  async searchMarketplace(input: unknown): Promise<MarketplaceSkill[]> {
    await this.ensureMigrated();
    const value = searchSkillMarketplaceInputSchema.parse(input);
    return this.remote.searchMarketplace(value, new Set(this.store.listGlobalSkills().map(({ name }) => name)));
  }

  async previewRemote(input: unknown): Promise<RemoteSkillPreview> {
    await this.ensureMigrated();
    const value = previewRemoteSkillInputSchema.parse(input);
    return this.remote.preview({
      sourceUrl: value.sourceUrl,
      provider: value.provider,
      ...(value.skillId === undefined ? {} : { skillId: value.skillId }),
    }, new Set(this.store.listGlobalSkills().map(({ name }) => name)));
  }

  async installRemote(input: unknown): Promise<Skill[]> {
    await this.ensureMigrated();
    const value = installRemoteSkillsInputSchema.parse(input);
    const preview = this.remote.requirePreview(value.previewId);
    const requested = new Set(value.skillIds);
    const candidates = preview.candidates.filter(({ id }) => requested.has(id));
    if (candidates.length !== requested.size) throw new Error("One or more selected Skills are no longer available.");
    const names = new Set<string>();
    for (const candidate of candidates) {
      this.assertNameAvailable(candidate.name);
      if (names.has(candidate.name)) throw new Error(`The source contains more than one Skill named "${candidate.name}".`);
      names.add(candidate.name);
    }
    const installed: Skill[] = [];
    try {
      for (const candidate of candidates) {
        const skill = this.store.createDomainEntity("skill", skillSchema, {
          workspaceId: null,
          name: candidate.name,
          description: candidate.description,
          instructions: parseSkillFile(await readFile(join(candidate.directory, skillFileName), "utf8")).instructions,
          enabled: true,
          source: this.remote.sourceFor(preview, candidate),
        });
        installed.push(skill);
        await cp(candidate.directory, this.directoryFor(skill.id), {
          recursive: true,
          errorOnExist: true,
          verbatimSymlinks: false,
          filter: async (source) => {
            if (source !== candidate.directory && [".git", "node_modules"].includes(source.split(sep).at(-1) ?? "")) return false;
            if ((await lstat(source)).isSymbolicLink()) throw new Error("Skill sources cannot contain symbolic links.");
            return true;
          },
        });
        await this.configureEnabled(skill.id, true);
      }
      await this.remote.removePreview(value.previewId);
      return installed;
    } catch (error) {
      await Promise.all(installed.map(async (skill) => {
        this.store.removeDomainEntity("skill", skill.id);
        await this.removeConfiguredSkill(skill.id).catch(() => undefined);
        await rm(this.directoryFor(skill.id), { recursive: true, force: true });
      }));
      throw error;
    }
  }

  async cancelRemotePreview(previewId: string): Promise<void> {
    await this.remote.removePreview(previewId);
  }

  async create(input: unknown): Promise<Skill> {
    await this.ensureMigrated();
    const value = createSkillInputSchema.parse(input);
    this.assertNameAvailable(value.name);
    const skill = this.store.createDomainEntity("skill", skillSchema, {
      workspaceId: null,
      ...value,
      source: { type: "created" },
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
      source: this.sourceForImportedDirectory(sourceRoot),
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

  async dispose(): Promise<void> {
    await this.remote.dispose();
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

  private sourceForImportedDirectory(sourceRoot: string): SkillSource {
    const systemRoot = this.systemSkillRoots.find((root) => {
      const difference = relative(resolve(root.path), sourceRoot);
      return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
    });
    return systemRoot === undefined
      ? { type: "local", path: sourceRoot }
      : { type: "system", provider: systemRoot.source, path: sourceRoot };
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

async function collectSkillFolderEntries(root: string): Promise<SkillFolderEntry[]> {
  const entries: SkillFolderEntry[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxSkillFileDepth || entries.length >= maxSkillFileEntries) return;
    let children: Dirent<string>[];
    try {
      children = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    const visibleChildren = children
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules" && !entry.isSymbolicLink())
      .sort((left, right) => {
        const type = Number(right.isDirectory()) - Number(left.isDirectory());
        return type || left.name.localeCompare(right.name);
      });
    for (const child of visibleChildren) {
      if (entries.length >= maxSkillFileEntries) return;
      const absolutePath = join(directory, child.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (child.isDirectory()) {
        entries.push({ name: child.name, path: relativePath, type: "directory" });
        await visit(absolutePath, depth + 1);
      } else if (child.isFile()) {
        entries.push({ name: child.name, path: relativePath, type: "file" });
      }
    }
  };
  await visit(root, 0);
  return entries;
}

function assertPathInside(root: string, target: string): void {
  const nested = relative(root, target);
  if (nested === "" || nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
    throw new Error("Skill file path escapes the managed Skill folder.");
  }
}

function skillFileLanguage(path: string): string {
  const extension = extname(path).toLowerCase();
  const languages: Record<string, string> = {
    ".css": "CSS",
    ".html": "HTML",
    ".js": "JavaScript",
    ".json": "JSON",
    ".jsx": "JSX",
    ".md": "Markdown",
    ".mjs": "JavaScript",
    ".py": "Python",
    ".sh": "Shell",
    ".svg": "SVG",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "TSX",
    ".txt": "Text",
    ".yaml": "YAML",
    ".yml": "YAML",
  };
  return languages[extension] ?? (extension ? extension.slice(1).toUpperCase() : "Text");
}

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
  const lines = rawFrontmatter.split(/\r?\n/);
  const nameField = extractFrontmatterField(lines, "name");
  const descriptionField = extractFrontmatterField(lines, "description");
  const name = nameField.value;
  const description = descriptionField.value;
  if (name === "" || description === "") throw new Error("SKILL.md frontmatter requires name and description.");
  const consumed = new Set<number>([...nameField.consumed, ...descriptionField.consumed]);
  const frontmatter = lines.filter((_, index) => !consumed.has(index));
  return { name: unquote(name), description: unquote(description), instructions, frontmatter };
}

function extractFrontmatterField(lines: string[], key: string): { value: string; consumed: Set<number> } {
  const consumed = new Set<number>();
  const prefix = `${key}:`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) return { value: "", consumed };
  const header = lines[index] ?? "";
  consumed.add(index);
  const inline = header.slice(prefix.length).trim();
  const blockMatch = inline.match(/^([|>])[+-]?\d*\s*$/);
  if (blockMatch === null) {
    return { value: inline, consumed };
  }
  const folded = blockMatch[1] === ">";
  const keyIndent = (header.match(/^\s*/)?.[0].length) ?? 0;
  const collected: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (line.trim() === "") {
      collected.push("");
      consumed.add(cursor);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= keyIndent) break;
    collected.push(line);
    consumed.add(cursor);
  }
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  const contentIndent = collected
    .filter((line) => line !== "")
    .reduce((min, line) => Math.min(min, line.match(/^\s*/)?.[0].length ?? 0), Number.POSITIVE_INFINITY);
  const dedent = Number.isFinite(contentIndent) ? contentIndent : 0;
  const dedented = collected.map((line) => (line === "" ? "" : line.slice(dedent)));
  let value: string;
  if (folded) {
    const paragraphs: string[] = [];
    let buffer: string[] = [];
    for (const line of dedented) {
      if (line === "") {
        paragraphs.push(buffer.join(" "));
        buffer = [];
      } else {
        buffer.push(line);
      }
    }
    paragraphs.push(buffer.join(" "));
    value = paragraphs.join("\n");
  } else {
    value = dedented.join("\n");
  }
  return { value: value.trim(), consumed };
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
