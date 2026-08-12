import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { CredentialBroker } from "./credential-broker.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("CredentialBroker", () => {
  it("migrates the legacy model default and keeps multiple providers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-credentials-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "credentials.enc");
    await mkdir(directory, { recursive: true });
    await writeFile(filename, Buffer.from(JSON.stringify({
      anthropic: {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
        apiKey: "secret",
      },
    })).toString("base64"));
    const broker = new CredentialBroker(join(directory, "pi-agent"), filename);

    await expect(broker.migrateLegacyDefault()).resolves.toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
    });
    await broker.save({ providerId: "openai", apiKey: "another-secret" });
    expect((await broker.list()).map(({ providerId }) => providerId).sort()).toEqual([
      "anthropic",
      "openai",
    ]);

    const stored = JSON.parse(await readFile(join(directory, "pi-agent", "auth.json"), "utf8")) as {
      anthropic: Record<string, unknown>;
    };
    expect(stored.anthropic).toEqual({ type: "api_key", key: "secret" });

    await broker.remove("anthropic");
    await expect(broker.migrateLegacyDefault()).resolves.toBeNull();
    expect((await broker.list()).map(({ providerId }) => providerId)).toEqual(["openai"]);
  });
});
