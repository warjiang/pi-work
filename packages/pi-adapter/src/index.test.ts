import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAuthorizedFilePath,
  buildChatPrompt,
  consumeSessionEvent,
  extensionToolNames,
  mergeAgentBashEnvironment,
  PiAdapter,
  planningInspectionTools,
  planningTerminalTools,
} from "./index.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe("PiAdapter", () => {
  it("records the first terminal planning tool result and terminates the tool batch", async () => {
    const results: unknown[] = [];
    const [question, complete] = planningTerminalTools((result) => results.push(result));
    const signal = new AbortController().signal;

    const questionResult = await question!.execute("question", {
      question: "Which compatibility target should be used?",
      options: [
        { label: "Current", description: "Target the current protocol." },
        { label: "Legacy", description: "Preserve the legacy protocol." },
      ],
    }, signal, undefined, {} as never);
    const completeResult = await complete!.execute("complete", {
      title: "Upgrade planning",
      summary: "Use terminal tools.",
      steps: [{
        title: "Register tools",
        detail: "Expose structured terminal tools.",
        targets: ["packages/pi-adapter/src/index.ts"],
        verification: ["Run adapter tests"],
      }],
      assumptions: [],
    }, signal, undefined, {} as never);

    expect(questionResult.terminate).toBe(true);
    expect(completeResult.terminate).toBe(true);
    expect(results).toEqual([
      {
        kind: "clarification",
        question: "Which compatibility target should be used?",
        options: [
          { label: "Current", description: "Target the current protocol." },
          { label: "Legacy", description: "Preserve the legacy protocol." },
        ],
      },
      {
        kind: "proposal",
        proposal: {
          title: "Upgrade planning",
          summary: "Use terminal tools.",
          steps: [{
            title: "Register tools",
            detail: "Expose structured terminal tools.",
            targets: ["packages/pi-adapter/src/index.ts"],
            verification: ["Run adapter tests"],
          }],
          assumptions: [],
        },
      },
    ]);
  });

  it("requires the workflow tool for a new orchestration session", () => {
    const prompt = buildChatPrompt(
      [{ role: "user", content: "Analyze the repository in parallel." }],
      false,
      {
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        origin: "conversation",
        sourceMessageId: randomUUID(),
        planRevisionId: null,
        dedupeKey: "chat:test",
        required: true,
      },
    );

    expect(prompt).toContain("MUST call the workflow tool");
    expect(prompt).toContain("Analyze the repository in parallel.");
  });

  it("keeps required workflow instructions when resuming an existing agent session", () => {
    const prompt = buildChatPrompt(
      [
        { role: "user", content: "Earlier request" },
        { role: "user", content: "Run this as an orchestration." },
      ],
      true,
      {
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        origin: "conversation",
        sourceMessageId: randomUUID(),
        planRevisionId: null,
        dedupeKey: "chat:resume",
        required: true,
      },
    );

    expect(prompt).toContain("MUST call the workflow tool");
    expect(prompt).toContain("Run this as an orchestration.");
    expect(prompt).not.toContain("Earlier request");
  });

  it("does not force workflow instructions for an optional existing session", () => {
    const prompt = buildChatPrompt(
      [{ role: "user", content: "Update the typo." }],
      true,
      {
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        origin: "conversation",
        sourceMessageId: randomUUID(),
        planRevisionId: null,
        dedupeKey: "chat:optional",
        required: false,
      },
    );

    expect(prompt).toBe("Update the typo.");
    expect(prompt).not.toContain("MUST call the workflow tool");
  });

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

  it("emits a usage event from an assistant message_end with tokens, cost and text output", () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const onEvent = (kind: string, payload: Record<string, unknown>) => events.push({ kind, payload });

    consumeSessionEvent(
      {
        type: "message_end",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet",
          responseModel: "claude-sonnet-20240229",
          api: "messages",
          stopReason: "end_turn",
          content: [
            { type: "thinking", text: "ignored" },
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
          usage: {
            input: 120,
            output: 34,
            cacheRead: 8,
            cacheWrite: 2,
            reasoning: 5,
            totalTokens: 169,
            cost: { input: 0.12, output: 0.34, cacheRead: 0.01, cacheWrite: 0.02, total: 0.49 },
          },
        },
      },
      [],
      new Map<number, string>(),
      onEvent,
    );

    expect(events).toEqual([
      {
        kind: "usage",
        payload: {
          provider: "anthropic",
          model: "claude-sonnet",
          responseModel: "claude-sonnet-20240229",
          api: "messages",
          stopReason: "end_turn",
          output: "Hello world",
          usage: {
            input: 120,
            output: 34,
            cacheRead: 8,
            cacheWrite: 2,
            reasoning: 5,
            totalTokens: 169,
            cost: { input: 0.12, output: 0.34, cacheRead: 0.01, cacheWrite: 0.02, total: 0.49 },
          },
        },
      },
      { kind: "runtime", payload: { state: "message_end" } },
    ]);
  });

  it("does not emit usage for a non-assistant message_end", () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const onEvent = (kind: string, payload: Record<string, unknown>) => events.push({ kind, payload });

    consumeSessionEvent(
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      [],
      new Map<number, string>(),
      onEvent,
    );

    expect(events).toEqual([{ kind: "runtime", payload: { state: "message_end" } }]);
  });

  it("creates a structured read-only planning fallback", () => {
    const result = new PiAdapter().createPlanningFallback({
      id: randomUUID(),
      title: "Decision brief",
      goal: "Compare authorized sources.",
    });

    expect(result.kind).toBe("proposal");
    if (result.kind !== "proposal") throw new Error("Expected a proposal fallback.");
    expect(result.proposal.steps).toHaveLength(3);
    expect(result.proposal.steps[0]?.title).toBe("Review authorized sources");
  });

  it("preserves inspected sources when recovering from unstructured planning output", () => {
    const result = new PiAdapter().createPlanningFallback({
      id: randomUUID(),
      title: "Decision brief",
      goal: "Compare authorized sources.",
    }, {
      assumption: "The planning model did not return structured tool output.",
      sources: [{ path: "packages/pi-adapter/src/index.ts", operation: "read" }],
    });

    expect(result.kind).toBe("proposal");
    if (result.kind !== "proposal") throw new Error("Expected a proposal fallback.");
    expect(result.proposal.assumptions).toEqual(["The planning model did not return structured tool output."]);
    expect(result.proposal.sources).toEqual([{ path: "packages/pi-adapter/src/index.ts", operation: "read" }]);
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

  it("runs only fixed read-only Git inspections and rejects path argument escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-planning-git-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-work-planning-git-outside-"));
    temporaryDirectories.push(root, outside);
    await execFileAsync("/usr/bin/git", ["init"], { cwd: root });
    await execFileAsync("/usr/bin/git", ["config", "user.name", "Pi Work Test"], { cwd: root });
    await execFileAsync("/usr/bin/git", ["config", "user.email", "pi-work@example.test"], { cwd: root });
    await writeFile(join(root, "tracked.txt"), "before\n");
    await execFileAsync("/usr/bin/git", ["add", "tracked.txt"], { cwd: root });
    await execFileAsync("/usr/bin/git", ["commit", "-m", "Initial commit"], { cwd: root });
    await writeFile(join(root, "tracked.txt"), "after\n");
    await symlink(outside, join(root, "escape"));

    const tools = planningInspectionTools(root);
    expect(tools.map(({ name }) => name)).toEqual([
      "git_status",
      "git_diff",
      "git_log",
      "run_validation",
    ]);
    const status = requiredTool(tools, "git_status");
    const diff = requiredTool(tools, "git_diff");
    const log = requiredTool(tools, "git_log");

    const statusResult = await executeTool(status, {});
    expect(toolText(statusResult)).toContain("tracked.txt");
    const diffResult = await executeTool(diff, { scope: "working", paths: ["tracked.txt"] });
    expect(toolText(diffResult)).toContain("-before");
    expect(toolText(diffResult)).toContain("+after");
    const logResult = await executeTool(log, { limit: 1 });
    expect(toolText(logResult)).toContain("Initial commit");

    await expect(executeTool(diff, { scope: "working", paths: ["--output=/tmp/leak"] }))
      .rejects.toThrow("option prefix");
    await expect(executeTool(diff, { scope: "working", paths: ["../outside.txt"] }))
      .rejects.toThrow("outside");
    await expect(executeTool(diff, { scope: "working", paths: ["escape/secret.txt"] }))
      .rejects.toThrow("outside");
    await expect(executeTool(diff, { scope: "everything" }))
      .rejects.toThrow();
  });

  it.runIf(process.platform === "darwin")("runs declared validations with literal argv in a read-only, network-disabled sandbox", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-planning-validation-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, ".pi-work"), { recursive: true });
    const forbiddenPath = join(root, "forbidden.txt");
    const shellMarkerPath = join(root, "shell-marker.txt");
    await writeFile(join(root, ".pi-work", "validations.json"), JSON.stringify({
      version: 1,
      validations: [
        {
          id: "literal-argv",
          label: "Literal argv",
          argv: [
            process.execPath,
            "-e",
            "console.log(process.argv[1])",
            `literal; touch ${shellMarkerPath}`,
          ],
          timeoutMs: 5_000,
        },
        {
          id: "temporary-write",
          label: "Temporary write",
          argv: [
            process.execPath,
            "-e",
            "const fs=require('node:fs');const p=require('node:path').join(process.env.TMPDIR,'ok.txt');fs.writeFileSync(p,'ok');console.log(fs.readFileSync(p,'utf8'))",
          ],
          timeoutMs: 5_000,
        },
        {
          id: "workspace-write",
          label: "Workspace write",
          argv: [
            process.execPath,
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(forbiddenPath)},'blocked')`,
          ],
          timeoutMs: 5_000,
        },
      ],
    }));
    const validation = requiredTool(planningInspectionTools(root), "run_validation");

    const literal = await executeTool(validation, { id: "literal-argv" });
    expect(toolText(literal)).toContain(`literal; touch ${shellMarkerPath}`);
    await expect(readFile(shellMarkerPath, "utf8")).rejects.toThrow();

    const temporaryWrite = await executeTool(validation, { id: "temporary-write" });
    expect(toolText(temporaryWrite)).toContain("Temporary write: passed");

    const workspaceWrite = await executeTool(validation, { id: "workspace-write" });
    expect(toolText(workspaceWrite)).toContain("failed with exit code");
    await expect(readFile(forbiddenPath, "utf8")).rejects.toThrow();

    await expect(executeTool(validation, { id: "undeclared" }))
      .rejects.toThrow("Unknown planning validation");
  });

  it("fails closed without a validation sandbox and rejects malformed declarations", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-planning-validation-config-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, ".pi-work"), { recursive: true });
    await writeFile(join(root, ".pi-work", "validations.json"), JSON.stringify({
      version: 1,
      validations: [{
        id: "check",
        label: "Check",
        argv: [process.execPath, "-e", "console.log('ok')"],
        timeoutMs: 5_000,
      }],
    }));
    const unavailable = requiredTool(planningInspectionTools(root, undefined, {
      sandboxExecutable: join(root, "missing-sandbox"),
    }), "run_validation");
    await expect(executeTool(unavailable, { id: "check" }))
      .rejects.toThrow("sandbox is unavailable");

    await writeFile(join(root, ".pi-work", "validations.json"), JSON.stringify({
      version: 1,
      validations: [{
        id: "check",
        label: "Check",
        argv: [process.execPath],
        timeoutMs: 5_000,
        environment: { SECRET: "not allowed" },
      }],
    }));
    const validation = requiredTool(planningInspectionTools(root), "run_validation");
    await expect(executeTool(validation, { id: "check" })).rejects.toThrow();
  });

  it("caps validation output, reports timeouts, and supports cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-work-planning-validation-limits-"));
    temporaryDirectories.push(root);
    const sandboxExecutable = await createPassthroughSandbox(root);
    await mkdir(join(root, ".pi-work"), { recursive: true });
    await writeFile(join(root, ".pi-work", "validations.json"), JSON.stringify({
      version: 1,
      validations: [
        {
          id: "large-output",
          label: "Large output",
          argv: [process.execPath, "-e", "process.stdout.write('x'.repeat(120*1024))"],
          timeoutMs: 5_000,
        },
        {
          id: "timeout",
          label: "Timeout",
          argv: [process.execPath, "-e", "setTimeout(()=>{},5000)"],
          timeoutMs: 50,
        },
        {
          id: "cancel",
          label: "Cancel",
          argv: [process.execPath, "-e", "setTimeout(()=>{},5000)"],
          timeoutMs: 5_000,
        },
      ],
    }));
    const validation = requiredTool(planningInspectionTools(root, undefined, {
      sandboxExecutable,
    }), "run_validation");

    const largeOutput = await executeTool(validation, { id: "large-output" });
    expect(toolText(largeOutput)).toContain("[output truncated at 100 KB]");
    expect((largeOutput as any).details.truncated).toBe(true);

    const timeout = await executeTool(validation, { id: "timeout" });
    expect(toolText(timeout)).toContain("timed out");
    expect((timeout as any).details.timedOut).toBe(true);

    const controller = new AbortController();
    const cancelled = executeTool(validation, { id: "cancel" }, controller.signal);
    setTimeout(() => controller.abort(new DOMException("Cancelled", "AbortError")), 50);
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  });
});

async function createPassthroughSandbox(root: string): Promise<string> {
  const executable = join(root, "sandbox-exec-test-stub");
  await writeFile(executable, [
    "#!/bin/sh",
    "while [ \"$#\" -gt 0 ] && [ \"$1\" != \"--\" ]; do",
    "  shift",
    "done",
    "if [ \"$#\" -eq 0 ]; then",
    "  exit 64",
    "fi",
    "shift",
    "exec \"$@\"",
    "",
  ].join("\n"));
  await chmod(executable, 0o755);
  return executable;
}

function requiredTool(
  tools: ReturnType<typeof planningInspectionTools>,
  name: string,
): ReturnType<typeof planningInspectionTools>[number] {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function executeTool(
  tool: ReturnType<typeof planningInspectionTools>[number],
  params: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<unknown> {
  return tool.execute("test-call", params, signal, undefined, {} as never);
}

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content.filter(({ type }) => type === "text").map(({ text }) => text ?? "").join("\n");
}
