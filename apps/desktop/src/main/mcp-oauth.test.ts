import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Source } from "@pi-work/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { McpOAuthManager } from "./mcp-oauth.js";

const temporaryDirectories: string[] = [];

function oauthSource(): Source {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    workspaceId: null,
    name: "Remote MCP",
    type: "mcp_http",
    enabled: true,
    config: {
      url: "https://example.com/mcp",
      transport: "streamable_http",
      headers: {},
      auth: "oauth",
    },
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("McpOAuthManager authorization status", () => {
  it("reports whether an OAuth access token is stored without exposing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-mcp-oauth-"));
    temporaryDirectories.push(directory);
    const storagePath = join(directory, "oauth.json");
    const manager = new McpOAuthManager(storagePath, async () => undefined);
    const source = oauthSource();

    await expect(manager.status(source)).resolves.toBe(false);

    await writeFile(storagePath, JSON.stringify({
      [source.id]: {
        tokens: {
          access_token: "secret-token",
          token_type: "bearer",
        },
      },
    }));

    await expect(manager.status(source)).resolves.toBe(true);
  });
});
