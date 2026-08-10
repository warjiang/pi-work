import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceBoundaryError, resolveArtifactPath, resolveAuthorizedPath } from "./index.js";

describe("workspace boundaries", () => {
  it("rejects traversal outside staging", () => {
    expect(() => resolveArtifactPath("/tmp/staging", "../../secret.txt")).toThrow(WorkspaceBoundaryError);
  });

  it("rejects a symlink path that resolves outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-policy-"));
    const inside = join(root, "inside");
    await mkdir(inside);
    await symlink(tmpdir(), join(inside, "outside"));

    await expect(resolveAuthorizedPath(root, "inside/outside")).rejects.toThrow(WorkspaceBoundaryError);
  });
});
