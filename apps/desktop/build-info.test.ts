import { describe, expect, it, vi } from "vitest";
import { resolveBuildMetadata } from "./build-info.js";

describe("resolveBuildMetadata", () => {
  it("prefers explicit build variables", () => {
    const runGit = vi.fn(() => "git-value");

    expect(resolveBuildMetadata({
      env: {
        PI_WORK_GIT_BRANCH: "release/desktop",
        PI_WORK_GIT_COMMIT: "explicit-commit",
        GITHUB_HEAD_REF: "pull-request",
        GITHUB_SHA: "actions-commit",
      },
      runGit,
    })).toEqual({
      branch: "release/desktop",
      commit: "explicit-commit",
    });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("uses GitHub Actions variables before local Git", () => {
    const runGit = vi.fn(() => "git-value");

    expect(resolveBuildMetadata({
      env: {
        GITHUB_HEAD_REF: "feature/settings",
        GITHUB_REF_NAME: "ignored-ref",
        GITHUB_SHA: "actions-commit",
      },
      runGit,
    })).toEqual({
      branch: "feature/settings",
      commit: "actions-commit",
    });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("falls back to local Git and handles missing values", () => {
    expect(resolveBuildMetadata({
      env: {},
      runGit: (args) => args[0] === "branch" ? "feat/local\n" : "abc123\n",
    })).toEqual({
      branch: "feat/local",
      commit: "abc123",
    });

    expect(resolveBuildMetadata({
      env: {},
      runGit: () => null,
    })).toEqual({
      branch: null,
      commit: null,
    });
  });
});
