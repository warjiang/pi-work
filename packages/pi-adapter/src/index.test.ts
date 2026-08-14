import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAuthorizedFilePath,
  consumeSessionEvent,
  extensionToolNames,
  mergeAgentBashEnvironment,
  PiAdapter,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("PiAdapter", () => {
  it("merges session variables into the spawned bash environment without mutating the process environment", () => {
    const processEnvironment = { PATH: "/system/bin", SHARED: "process" };
    const merged = mergeAgentBashEnvironment(processEnvironment, {
      PATH: "/managed/bin:/system/bin",
      LARK_TOKEN: "session-secret",
      SHARED: "session",
    });

    expect(merged).toEqual({
      PATH: "/managed/bin:/system/bin",
      LARK_TOKEN: "session-secret",
      SHARED: "session",
    });
    expect(processEnvironment).toEqual({ PATH: "/system/bin", SHARED: "process" });
  });

  it("keeps installed extension tools available to chat sessions", () => {
    expect(extensionToolNames([
      { tools: new Map([["web_search", {}], ["fetch_content", {}]]) },
      { tools: new Map([["web_search", {}], ["source_check", {}]]) },
    ])).toEqual(["web_search", "fetch_content", "source_check"]);
  });

  it("keeps thinking blocks separate from streamed text and aggregates by content index", () => {
    const text: string[] = [];
    const thinking = new Map<number, string>();
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const onEvent = (kind: string, payload: Record<string, unknown>) => events.push({ kind, payload });

    consumeSessionEvent(
      { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 1 } },
      text,
      thinking,
      onEvent,
    );
    consumeSessionEvent(
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "Plan " } },
      text,
      thinking,
      onEvent,
    );
    consumeSessionEvent(
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Answer" } },
      text,
      thinking,
      onEvent,
    );
    consumeSessionEvent(
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "complete." } },
      text,
      thinking,
      onEvent,
    );
    consumeSessionEvent(
      { type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 1 } },
      text,
      thinking,
      onEvent,
    );

    expect(text).toEqual(["Answer"]);
    expect(events).toEqual([
      { kind: "thinking", payload: { phase: "start", contentIndex: 1 } },
      { kind: "thinking", payload: { phase: "delta", contentIndex: 1, delta: "Plan " } },
      { kind: "text_delta", payload: { delta: "Answer", contentIndex: 0 } },
      { kind: "thinking", payload: { phase: "delta", contentIndex: 1, delta: "complete." } },
      { kind: "thinking", payload: { phase: "end", contentIndex: 1, content: "Plan complete." } },
    ]);
    expect(thinking.size).toBe(0);
  });

  it("maps native tool and runtime lifecycle events without duplicating tool starts", () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const onEvent = (kind: string, payload: Record<string, unknown>) => events.push({ kind, payload });
    const thinking = new Map<number, string>();

    for (const event of [
      { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" } },
      { type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", args: { command: "pwd" }, partialResult: "working" },
      { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: "done", isError: false },
      { type: "queue_update", steering: ["a"], followUp: [] },
      { type: "compaction_start", reason: "context" },
      { type: "compaction_end", reason: "context", aborted: false, willRetry: false },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 2, errorMessage: "temporary" },
      { type: "auto_retry_end", success: true, attempt: 1 },
    ]) {
      consumeSessionEvent(event, [], thinking, onEvent);
    }

    expect(events).toEqual([
      { kind: "tool_call", payload: { toolCallId: "call-1", toolName: "bash", arguments: { command: "pwd" } } },
      { kind: "tool_update", payload: { toolCallId: "call-1", toolName: "bash", arguments: { command: "pwd" }, output: "working" } },
      { kind: "tool_result", payload: { toolCallId: "call-1", toolName: "bash", result: "done", isError: false } },
      { kind: "runtime", payload: { state: "queued", steering: 1, followUp: 0 } },
      { kind: "runtime", payload: { state: "compacting", reason: "context" } },
      { kind: "runtime", payload: { state: "compacted", reason: "context", aborted: false, willRetry: false, errorMessage: undefined } },
      { kind: "runtime", payload: { state: "retrying", attempt: 1, maxAttempts: 2, errorMessage: "temporary" } },
      { kind: "runtime", payload: { state: "retry_complete", success: true, attempt: 1, errorMessage: undefined } },
    ]);
  });

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

  it("inspects and calls a stdio MCP server", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-mcp-"));
    temporaryDirectories.push(root);
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test-fixtures",
      "mcp-stdio-server.mjs",
    );
    const adapter = new PiAdapter();
    const runtime = { cwd: root, agentDir: join(root, "pi-agent") };
    const server = {
      id: randomUUID(),
      name: "Fixture MCP",
      type: "mcp_stdio" as const,
      config: {
        command: process.execPath,
        args: [fixture],
        env: { PI_WORK_MCP_PREFIX: "fixture" },
      },
    };

    await expect(adapter.inspectMcp(server, runtime)).resolves.toEqual(expect.objectContaining({
      connected: true,
      transport: "stdio",
      serverName: "pi-work-test-mcp",
      tools: [expect.objectContaining({ name: "echo", title: "Echo text" })],
    }));
    await expect(adapter.callMcpTool(server, runtime, "echo", { text: "hello" })).resolves.toEqual({
      content: [{ type: "text", text: "fixture:hello" }],
      isError: false,
      structuredContent: { echoed: "fixture:hello" },
    });
  });

  it("inspects and calls a Streamable HTTP MCP server with custom headers", async () => {
    const httpServer = createServer(async (request, response) => {
      if (request.headers["x-pi-work-test"] !== "allowed") {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      const server = new McpServer({ name: "pi-work-http-mcp", version: "1.0.0" });
      server.registerTool("sum", {
        inputSchema: { left: z.number(), right: z.number() },
      }, async ({ left, right }) => ({
        content: [{ type: "text", text: String(left + right) }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as any);
      await server.connect(transport as any);
      await transport.handleRequest(request, response);
      response.once("close", () => {
        void transport.close();
        void server.close();
      });
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = httpServer.address();
      if (address === null || typeof address === "string") throw new Error("No HTTP test server address.");
      const runtime = { cwd: process.cwd(), agentDir: join(process.cwd(), ".pi-agent-test") };
      const server = {
        id: randomUUID(),
        name: "HTTP Fixture",
        type: "mcp_http" as const,
        config: {
          url: `http://127.0.0.1:${address.port}/mcp`,
          transport: "streamable_http",
          headers: { "X-Pi-Work-Test": "allowed" },
          auth: "none",
        },
      };
      const adapter = new PiAdapter();

      await expect(adapter.inspectMcp(server, runtime)).resolves.toEqual(expect.objectContaining({
        connected: true,
        transport: "streamable_http",
        serverName: "pi-work-http-mcp",
        tools: [expect.objectContaining({ name: "sum" })],
      }));
      await expect(adapter.callMcpTool(server, runtime, "sum", { left: 20, right: 22 })).resolves.toEqual({
        content: [{ type: "text", text: "42" }],
        isError: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve());
      });
    }
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

  it("loads the same persisted model catalog as the Pi console", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-adapter-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "pi-agent");
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "test-fixtures",
      "provider-extension",
    );
    const adapter = new PiAdapter();
    await adapter.installExtension({ cwd: root, agentDir }, fixture);
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "models-store.json"),
      JSON.stringify({
        "pi-work-fixture": {
          models: [{
            id: "console-model",
            name: "Console Model",
            api: "openai-completions",
            provider: "pi-work-fixture",
            baseUrl: "https://example.invalid/v1",
            reasoning: true,
            input: ["text"],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            contextWindow: 128_000,
            maxTokens: 16_384,
          }],
          checkedAt: Date.now(),
        },
      }),
    );

    const catalog = await adapter.listModels({ cwd: root, agentDir });

    expect(catalog.models).toContainEqual({
      providerId: "pi-work-fixture",
      providerName: "Pi Work Fixture",
      modelId: "console-model",
      modelName: "Console Model",
      thinkingLevels: expect.any(Array),
    });
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
