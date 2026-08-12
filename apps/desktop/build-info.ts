import { execFileSync } from "node:child_process";

export type BuildMetadata = {
  branch: string | null;
  commit: string | null;
};

type ResolveBuildMetadataOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runGit?: (args: string[]) => string | null;
};

export function resolveBuildMetadata(options: ResolveBuildMetadataOptions = {}): BuildMetadata {
  const env = options.env ?? process.env;
  const runGit = options.runGit ?? ((args) => readGit(args, options.cwd ?? process.cwd()));
  const branch = firstValue(
    env.PI_WORK_GIT_BRANCH,
    env.GITHUB_HEAD_REF,
    env.GITHUB_REF_NAME,
  );
  const commit = firstValue(
    env.PI_WORK_GIT_COMMIT,
    env.GITHUB_SHA,
  );
  return {
    branch: branch ?? firstValue(runGit(["branch", "--show-current"])),
    commit: commit ?? firstValue(runGit(["rev-parse", "HEAD"])),
  };
}

function readGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function firstValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}
