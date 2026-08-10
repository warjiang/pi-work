import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertAuthorizedFilePath, PiAdapter } from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("PiAdapter", () => {
  it("creates a structured read-only planning fallback", () => {
    const plan = new PiAdapter().createPlanningFallback({
      id: randomUUID(),
      title: "Decision brief",
      goal: "Compare authorized sources.",
    });

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.title).toBe("Review authorized sources");
  });

  it("installs, loads, lists, and removes a local provider extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-adapter-"));
    temporaryDirectories.push(root);
    const runtime = { cwd: root, agentDir: join(root, "pi-agent") };
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test-fixtures",
      "provider-extension",
    );
    const adapter = new PiAdapter();

    const installed = await adapter.installExtension(runtime, fixture);
    expect(installed).toEqual([
      expect.objectContaining({ source: fixture }),
    ]);
    expect(adapter.listExtensions(runtime)).toHaveLength(1);

    const catalog = await adapter.listModels(runtime);
    expect(catalog.models).toContainEqual({
      providerId: "pi-work-fixture",
      providerName: "Pi Work Fixture",
      modelId: "fixture-model",
      modelName: "Fixture Model",
      thinkingLevels: expect.any(Array),
    });

    expect(await adapter.removeExtension(runtime, fixture)).toEqual([]);
    expect(adapter.listExtensions(runtime)).toEqual([]);
  });

  it("rejects relative local extension paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-adapter-"));
    temporaryDirectories.push(root);
    await expect(new PiAdapter().installExtension(
      { cwd: root, agentDir: join(root, "pi-agent") },
      "./relative-extension",
    )).rejects.toThrow("absolute path");
  });

  it("ignores workspace-level Pi extension settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-adapter-"));
    temporaryDirectories.push(root);
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test-fixtures",
      "provider-extension",
    );
    await mkdir(join(root, ".pi"), { recursive: true });
    await writeFile(
      join(root, ".pi", "settings.json"),
      JSON.stringify({ packages: [fixture] }),
    );

    const catalog = await new PiAdapter().listModels({
      cwd: root,
      agentDir: join(root, "pi-agent"),
    });

    expect(catalog.models.some((model) => model.providerId === "pi-work-fixture")).toBe(false);
    expect(catalog.models.some((model) => model.providerId === "vercel-ai-gateway")).toBe(false);
  });

  it("rejects traversal and symlink escapes while allowing new nested paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-work-outside-"));
    temporaryDirectories.push(root, outside);
    await symlink(outside, join(root, "escape"));

    await expect(assertAuthorizedFilePath(root, "../outside.txt")).rejects.toThrow("outside");
    await expect(assertAuthorizedFilePath(root, "escape/secret.txt")).rejects.toThrow("outside");
    await expect(assertAuthorizedFilePath(root, "new/nested/file.txt")).resolves.toBeUndefined();
  });
});
