import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@openwork/testkit";
import { WorkspaceBoundaryError, resolveAuthorizedPath } from "@pi-work/policy";

test("an agent cannot resolve a file outside its selected workspace", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "pi-work-boundary-"));
  await writeFile(join(rootPath, "source.md"), "# authorized", "utf8");

  await expect(resolveAuthorizedPath(rootPath, "source.md")).resolves.toMatch(/\/source\.md$/);
  await expect(resolveAuthorizedPath(rootPath, "../outside.md")).rejects.toBeInstanceOf(WorkspaceBoundaryError);
});
