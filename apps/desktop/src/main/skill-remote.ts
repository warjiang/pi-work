import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  MarketplaceSkill,
  RemoteSkillCandidate,
  RemoteSkillPreview,
  SkillSource,
} from "@pi-work/protocol";
import {
  marketplaceSkillSchema,
  remoteSkillPreviewSchema,
  searchSkillMarketplaceInputSchema,
} from "@pi-work/protocol";
import * as tar from "tar";
import * as unzipper from "unzipper";

const executeFile = promisify(execFile);
const maximumDownloadBytes = 10 * 1024 * 1024;
const maximumExtractedBytes = 25 * 1024 * 1024;
const maximumArchiveEntries = 1_000;
const previewLifetimeMs = 10 * 60 * 1_000;
const searchCacheLifetimeMs = 5 * 60 * 1_000;
const skillFileName = "SKILL.md";

type ParsedSkill = {
  name: string;
  description: string;
};

type PreviewSession = {
  directory: string;
  expiresAt: number;
  provider: string;
  sourceUrl: string;
  repositoryUrl?: string;
  commit?: string;
  candidates: Array<RemoteSkillCandidate & { directory: string }>;
};

type SkillsShResponse = {
  skills: Array<{
    id: string;
    skillId: string;
    name: string;
    installs: number;
    source: string;
  }>;
};

export class SkillRemoteResolver {
  private readonly previews = new Map<string, PreviewSession>();
  private readonly searchCache = new Map<string, { expiresAt: number; values: MarketplaceSkill[] }>();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async searchMarketplace(input: unknown, installedNames: Set<string>): Promise<MarketplaceSkill[]> {
    const value = searchSkillMarketplaceInputSchema.parse(input);
    const cacheKey = `${value.provider}:${value.query.toLocaleLowerCase()}:${value.limit}`;
    const cached = this.searchCache.get(cacheKey);
    const values = cached !== undefined && cached.expiresAt > Date.now()
      ? cached.values
      : await this.searchSkillsSh(value.query, value.limit);
    if (cached === undefined || cached.expiresAt <= Date.now()) {
      this.searchCache.set(cacheKey, { expiresAt: Date.now() + searchCacheLifetimeMs, values });
    }
    return values.map((skill) => ({ ...skill, installed: installedNames.has(skill.skillId) || installedNames.has(skill.name) }));
  }

  async preview(input: { sourceUrl: string; provider: string; skillId?: string }, installedNames: Set<string>): Promise<RemoteSkillPreview> {
    await this.cleanupExpired();
    const previewId = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "pi-work-skill-preview-"));
    try {
      const resolved = await this.resolveSource(input.sourceUrl, directory);
      const discovered = await discoverSkills(resolved.root);
      const requestedSkillId = input.skillId;
      const filtered = requestedSkillId === undefined
        ? discovered
        : discovered.filter((candidate) => (
          candidate.name === requestedSkillId
          || basename(candidate.directory) === requestedSkillId
          || candidate.directory.split(sep).includes(requestedSkillId)
        ));
      const candidates = (filtered.length > 0 ? filtered : discovered).map((candidate) => ({
        id: relative(resolved.root, candidate.directory).split(sep).join("/") || ".",
        name: candidate.name,
        description: candidate.description,
        path: relative(resolved.root, candidate.directory).split(sep).join("/") || ".",
        files: candidate.files,
        duplicate: installedNames.has(candidate.name),
        directory: candidate.directory,
      }));
      if (candidates.length === 0) throw new Error("No valid SKILL.md files were found in this source.");
      const expiresAt = Date.now() + previewLifetimeMs;
      const session: PreviewSession = {
        directory,
        expiresAt,
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        candidates,
        ...(resolved.repositoryUrl === undefined ? {} : { repositoryUrl: resolved.repositoryUrl }),
        ...(resolved.commit === undefined ? {} : { commit: resolved.commit }),
      };
      this.previews.set(previewId, session);
      const timer = setTimeout(() => void this.removePreview(previewId), previewLifetimeMs);
      timer.unref();
      return publicPreview(previewId, session);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  requirePreview(previewId: string): PreviewSession {
    const preview = this.previews.get(previewId);
    if (preview === undefined || preview.expiresAt <= Date.now()) {
      if (preview !== undefined) void this.removePreview(previewId);
      throw new Error("This Skill preview has expired. Preview the source again.");
    }
    return preview;
  }

  sourceFor(preview: PreviewSession, candidate: PreviewSession["candidates"][number]): SkillSource {
    return {
      type: "remote",
      provider: preview.provider,
      sourceUrl: preview.sourceUrl,
      skillId: candidate.name,
      subpath: candidate.path,
      ...(preview.repositoryUrl === undefined ? {} : { repositoryUrl: preview.repositoryUrl }),
      ...(preview.commit === undefined ? {} : { commit: preview.commit }),
    };
  }

  async removePreview(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId);
    this.previews.delete(previewId);
    if (preview !== undefined) await rm(preview.directory, { recursive: true, force: true });
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((previewId) => this.removePreview(previewId)));
    this.searchCache.clear();
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    await Promise.all([...this.previews.entries()]
      .filter(([, preview]) => preview.expiresAt <= now)
      .map(([previewId]) => this.removePreview(previewId)));
  }

  private async searchSkillsSh(query: string, limit: number): Promise<MarketplaceSkill[]> {
    const url = new URL("https://www.skills.sh/api/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    const response = await fetchWithTimeout(this.fetcher, url, 10_000);
    const body = await readLimitedResponse(response, 1_000_000);
    if (!response.ok) throw new Error(`skills.sh search failed (${response.status}).`);
    const parsed = JSON.parse(body.toString("utf8")) as SkillsShResponse;
    if (!Array.isArray(parsed.skills)) throw new Error("skills.sh returned an invalid search response.");
    return parsed.skills.map((skill) => marketplaceSkillSchema.parse({
      id: skill.id,
      skillId: skill.skillId,
      name: skill.name,
      installs: skill.installs,
      source: skill.source,
      sourceUrl: `https://github.com/${skill.source}`,
      detailUrl: `https://www.skills.sh/${skill.id}`,
      installed: false,
    }));
  }

  private async resolveSource(sourceUrl: string, directory: string): Promise<{
    root: string;
    repositoryUrl?: string;
    commit?: string;
  }> {
    const normalized = normalizeSourceUrl(sourceUrl);
    const root = join(directory, "source");
    await mkdir(root, { recursive: true });
    if (normalized.kind === "skill-file") {
      const response = await fetchWithTimeout(this.fetcher, new URL(normalized.downloadUrl), 30_000);
      const body = await readLimitedResponse(response, maximumDownloadBytes);
      if (!response.ok) throw new Error(`Skill download failed (${response.status}).`);
      await writeFile(join(root, skillFileName), body);
      return { root };
    }
    if (normalized.kind === "archive") {
      const response = await fetchWithTimeout(this.fetcher, new URL(normalized.downloadUrl), 30_000);
      const body = await readLimitedResponse(response, maximumDownloadBytes);
      if (!response.ok) throw new Error(`Skill download failed (${response.status}).`);
      const format = normalized.format ?? archiveFormat(response.url, response.headers.get("content-type"));
      if (format === "zip") await extractZip(body, root);
      else if (format === "tar") await extractTar(body, root, directory);
      else throw new Error("The remote source is not a supported ZIP or TAR archive.");
      const extractedRoot = normalized.unwrap ? await unwrapSingleDirectory(root) : root;
      return {
        root: normalized.subpath === undefined ? extractedRoot : safeChild(extractedRoot, normalized.subpath),
        ...(normalized.repositoryUrl === undefined ? {} : { repositoryUrl: normalized.repositoryUrl }),
      };
    }
    const cloneRoot = join(directory, "repository");
    try {
      await executeFile("git", ["clone", "--depth=1", "--filter=blob:none", normalized.repositoryUrl, cloneRoot], {
        timeout: 120_000,
        maxBuffer: 1_000_000,
      });
    } catch (error) {
      throw new Error(`Could not clone the Skill repository: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { stdout } = await executeFile("git", ["-C", cloneRoot, "rev-parse", "HEAD"], {
      timeout: 10_000,
      maxBuffer: 1_000_000,
    });
    return {
      root: normalized.subpath === undefined ? cloneRoot : safeChild(cloneRoot, normalized.subpath),
      repositoryUrl: normalized.repositoryUrl,
      commit: stdout.trim(),
    };
  }
}

function publicPreview(previewId: string, preview: PreviewSession): RemoteSkillPreview {
  return remoteSkillPreviewSchema.parse({
    previewId,
    provider: preview.provider,
    sourceUrl: preview.sourceUrl,
    repositoryUrl: preview.repositoryUrl,
    commit: preview.commit,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    skills: preview.candidates.map(({ directory: _directory, ...candidate }) => candidate),
  });
}

function normalizeSourceUrl(sourceUrl: string):
  | { kind: "skill-file"; downloadUrl: string }
  | { kind: "archive"; downloadUrl: string; format?: "zip" | "tar"; repositoryUrl?: string; subpath?: string; unwrap?: boolean }
  | { kind: "git"; repositoryUrl: string; subpath?: string } {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Remote Skill URLs must use HTTP or HTTPS.");
  if (url.hostname === "skills.sh" || url.hostname === "www.skills.sh") {
    const [owner, repository, skillId] = url.pathname.split("/").filter(Boolean);
    if (owner === undefined || repository === undefined) throw new Error("Use a skills.sh Skill or repository URL.");
    const repositoryUrl = `https://github.com/${owner}/${repository}`;
    return {
      kind: "archive",
      downloadUrl: `https://codeload.github.com/${owner}/${repository}/zip/HEAD`,
      format: "zip",
      repositoryUrl,
      unwrap: true,
    };
  }
  const github = url.hostname === "github.com" ? url.pathname.split("/").filter(Boolean) : [];
  if (github.length >= 2) {
    const [owner, rawRepository, marker, ref, ...pathParts] = github;
    const repository = rawRepository?.replace(/\.git$/, "");
    if (owner !== undefined && repository !== undefined) {
      const repositoryUrl = `https://github.com/${owner}/${repository}`;
      const subpath = marker === "tree" && ref !== undefined && pathParts.length > 0 ? pathParts.join("/") : undefined;
      return {
        kind: "archive",
        downloadUrl: `https://codeload.github.com/${owner}/${repository}/zip/${encodeURIComponent(ref ?? "HEAD")}`,
        format: "zip",
        repositoryUrl,
        unwrap: true,
        ...(subpath === undefined ? {} : { subpath }),
      };
    }
  }
  if (url.hostname === "gitlab.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const treeMarker = parts.findIndex((part, index) => part === "tree" && parts[index - 1] === "-");
    const projectParts = treeMarker === -1 ? parts : parts.slice(0, treeMarker - 1);
    const ref = treeMarker === -1 ? undefined : parts[treeMarker + 1];
    const subpath = treeMarker === -1 ? undefined : parts.slice(treeMarker + 2).join("/") || undefined;
    const rawRepository = projectParts.at(-1);
    if (projectParts.length >= 2 && rawRepository !== undefined) {
      const repository = rawRepository.replace(/\.git$/, "");
      const namespace = projectParts.slice(0, -1).join("/");
      const repositoryUrl = `https://gitlab.com/${namespace}/${repository}`;
      if (ref !== undefined) {
        return {
          kind: "archive",
          downloadUrl: `${repositoryUrl}/-/archive/${encodeURIComponent(ref)}/${encodeURIComponent(repository)}-${encodeURIComponent(ref)}.zip`,
          format: "zip",
          repositoryUrl,
          unwrap: true,
          ...(subpath === undefined ? {} : { subpath }),
        };
      }
      return { kind: "git", repositoryUrl };
    }
  }
  const lowerPath = url.pathname.toLocaleLowerCase();
  if (lowerPath.endsWith("/skill.md")) return { kind: "skill-file", downloadUrl: url.toString() };
  if (lowerPath.endsWith(".zip")) return { kind: "archive", downloadUrl: url.toString(), format: "zip" };
  if ([".tar", ".tgz", ".tar.gz"].some((extension) => lowerPath.endsWith(extension))) {
    return { kind: "archive", downloadUrl: url.toString(), format: "tar" };
  }
  return { kind: "git", repositoryUrl: url.toString() };
}

async function unwrapSingleDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
  return entries.length === 1 && entries[0]?.isDirectory()
    ? join(root, entries[0].name)
    : root;
}

async function fetchWithTimeout(fetcher: typeof fetch, url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The remote Skill request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedResponse(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("The remote Skill download is larger than 10 MiB.");
  if (response.body === null) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    const value = Buffer.from(chunk);
    total += value.length;
    if (total > maximumBytes) throw new Error("The remote Skill download is larger than 10 MiB.");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function extractZip(content: Buffer, destination: string): Promise<void> {
  const archive = await unzipper.Open.buffer(content);
  if (archive.files.length > maximumArchiveEntries) throw new Error("The Skill archive contains more than 1000 files.");
  let total = 0;
  for (const entry of archive.files) {
    const path = safeArchivePath(entry.path);
    if (entry.type !== "File" && entry.type !== "Directory") throw new Error("Skill archives cannot contain symbolic links.");
    total += entry.uncompressedSize;
    if (total > maximumExtractedBytes) throw new Error("The extracted Skill is larger than 25 MiB.");
    const target = safeChild(destination, path);
    if (entry.type === "Directory") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, await entry.buffer());
  }
}

async function extractTar(content: Buffer, destination: string, temporaryDirectory: string): Promise<void> {
  const archivePath = join(temporaryDirectory, "source.tar");
  await writeFile(archivePath, content);
  let entries = 0;
  let total = 0;
  let validationError: Error | null = null;
  await tar.t({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      entries += 1;
      total += entry.size;
      if (validationError !== null) return;
      try {
        safeArchivePath(entry.path);
        if (entry.type !== "File" && entry.type !== "Directory") {
          validationError = new Error("Skill archives cannot contain symbolic links.");
        } else if (entries > maximumArchiveEntries) {
          validationError = new Error("The Skill archive contains more than 1000 files.");
        } else if (total > maximumExtractedBytes) {
          validationError = new Error("The extracted Skill is larger than 25 MiB.");
        }
      } catch (error) {
        validationError = error instanceof Error ? error : new Error(String(error));
      }
    },
  });
  if (validationError !== null) throw validationError;
  await tar.x({ file: archivePath, cwd: destination, strict: true, preservePaths: false });
}

function safeArchivePath(path: string): string {
  const value = normalize(path).replace(/^(\.\.(\/|\\|$))+/, "");
  if (value === "" || value === "." || isAbsolute(path) || value !== normalize(path)) {
    throw new Error("The Skill archive contains an unsafe path.");
  }
  return value;
}

function safeChild(root: string, path: string): string {
  const candidate = resolve(root, path);
  const difference = relative(resolve(root), candidate);
  if (difference === ".." || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new Error("The Skill source contains an unsafe path.");
  }
  return candidate;
}

function archiveFormat(url: string, contentType: string | null): "zip" | "tar" | null {
  const extension = extname(new URL(url).pathname).toLocaleLowerCase();
  if (extension === ".zip" || contentType?.includes("zip")) return "zip";
  if ([".tar", ".tgz", ".gz"].includes(extension) || contentType?.includes("gzip") || contentType?.includes("tar")) return "tar";
  return null;
}

async function discoverSkills(root: string): Promise<Array<ParsedSkill & { directory: string; files: number }>> {
  const rootInfo = await stat(root).catch(() => null);
  if (rootInfo === null || !rootInfo.isDirectory()) throw new Error("The selected path does not exist in the remote source.");
  const directories: string[] = [];
  const queue = [root];
  let visitedEntries = 0;
  let totalBytes = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    visitedEntries += entries.length;
    if (visitedEntries > maximumArchiveEntries) throw new Error("The Skill source contains more than 1000 files.");
    if (entries.some((entry) => entry.isFile() && entry.name === skillFileName)) {
      directories.push(current);
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("Skill sources cannot contain symbolic links.");
      if (info.isFile()) {
        totalBytes += info.size;
        if (totalBytes > maximumExtractedBytes) throw new Error("The extracted Skill is larger than 25 MiB.");
      } else if (info.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        queue.push(path);
      }
    }
  }
  return Promise.all(directories.map(async (directory) => {
    const parsed = parseSkill(await readFile(join(directory, skillFileName), "utf8"));
    return { ...parsed, directory, files: await countFiles(directory) };
  }));
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries: Dirent<string>[] = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("Skill sources cannot contain symbolic links.");
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") queue.push(join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function parseSkill(content: string): ParsedSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match?.[1] === undefined) throw new Error("SKILL.md must start with YAML frontmatter.");
  const lines = match[1].split(/\r?\n/);
  const name = unquote(lines.find((line) => line.startsWith("name:"))?.slice(5).trim() ?? "");
  const description = unquote(lines.find((line) => line.startsWith("description:"))?.slice(12).trim() ?? "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(`Remote Skill name "${name}" is invalid.`);
  }
  if (description.length < 1 || description.length > 1_024) {
    throw new Error(`Remote Skill "${name}" has an invalid description.`);
  }
  return { name, description };
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
