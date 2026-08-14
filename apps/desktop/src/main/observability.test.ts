import { describe, expect, it, vi } from "vitest";
import { LangfuseExporter, type ExporterDeps, type LangfuseConfig, type RunContext } from "./observability.js";
import { maskSecret, redactSecrets } from "./secrets-broker.js";

function makeOutbox() {
  const entries = new Map<string, { id: string; payload: string; attempts: number; nextAttemptAt: string }>();
  let counter = 0;
  return {
    entries,
    enqueue(payload: string, nextAttemptAt = new Date().toISOString()) {
      const id = `entry-${counter++}`;
      entries.set(id, { id, payload, attempts: 0, nextAttemptAt });
    },
    listDue(limit: number) {
      const now = Date.now();
      return [...entries.values()]
        .filter((entry) => Date.parse(entry.nextAttemptAt) <= now)
        .slice(0, limit)
        .map((entry) => ({ id: entry.id, payload: entry.payload, attempts: entry.attempts }));
    },
    markRetry(id: string, attempts: number, nextAttemptAt: string) {
      const entry = entries.get(id);
      if (entry !== undefined) entries.set(id, { ...entry, attempts, nextAttemptAt });
    },
    delete(id: string) {
      entries.delete(id);
    },
  };
}

function baseContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    taskId: "task-1",
    workspaceId: "ws-1",
    provider: "anthropic",
    model: "claude",
    thinkingLevel: "high",
    permissionMode: "auto",
    cwd: "/repo",
    appVersion: "1.0.0",
    userMessage: "hello",
    ...overrides,
  };
}

function makeExporter(config: LangfuseConfig | null, extra: Partial<ExporterDeps> = {}) {
  const outbox = makeOutbox();
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init: RequestInit) => Promise.resolve(new Response(null, { status: 207 })));
  const deps: ExporterDeps = {
    resolveConfig: async () => config,
    resolveRunContext: () => baseContext(),
    outbox,
    fetch: fetchMock as unknown as typeof fetch,
    log: () => {},
    batchSize: 100,
    flushIntervalMs: 10_000,
    ...extra,
  };
  const exporter = new LangfuseExporter(deps);
  return { exporter, outbox, fetchMock };
}

const enabledConfig: LangfuseConfig = {
  host: "https://lf.example.com/",
  publicKey: "pk-lf-123",
  secretKey: "sk-lf-secret4b79",
  captureContent: true,
};

function usageEvent(requestId: string, timestamp = "2024-01-01T00:00:01.000Z") {
  return {
    requestId,
    sessionId: "task-1",
    event: {
      kind: "usage",
      timestamp,
      payload: {
        provider: "anthropic",
        model: "claude",
        responseModel: "claude-3",
        api: "messages",
        stopReason: "end_turn",
        output: "the answer",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          totalTokens: 150,
          cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
        },
      },
    },
  };
}

function completedEvent(requestId: string, timestamp = "2024-01-01T00:00:02.000Z") {
  return { requestId, sessionId: "task-1", event: { kind: "completed", timestamp, payload: {} } };
}

describe("LangfuseExporter", () => {
  it("sends trace and generation for a run with content", async () => {
    const { exporter, fetchMock } = makeExporter(enabledConfig);
    exporter.handleEvent(usageEvent("req-1"));
    await exporter.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://lf.example.com/api/public/ingestion");
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth.authorization).toBe(`Basic ${Buffer.from("pk-lf-123:sk-lf-secret4b79").toString("base64")}`);
    const body = JSON.parse((init as RequestInit).body as string) as { batch: Array<{ type: string; body: Record<string, unknown> }> };
    const types = body.batch.map((item) => item.type);
    expect(types).toContain("trace-create");
    expect(types).toContain("generation-create");

    const generation = body.batch.find((item) => item.type === "generation-create")!;
    expect(generation.body.model).toBe("claude");
    expect(generation.body.usageDetails).toMatchObject({ input: 100, output: 50, total: 150 });
    expect(generation.body.costDetails).toMatchObject({ input: 0.1, output: 0.2, total: 0.3 });
    expect(generation.body.output).toBe("the answer");
  });

  it("emits a final trace output when the run completes", async () => {
    const { exporter, fetchMock } = makeExporter(enabledConfig);
    // The run is established on the first usage event; deltas after that accumulate.
    exporter.handleEvent(usageEvent("req-1b"));
    exporter.handleEvent({
      requestId: "req-1b",
      sessionId: "task-1",
      event: { kind: "text_delta", timestamp: "2024-01-01T00:00:01.500Z", payload: { delta: "streamed reply" } },
    });
    exporter.handleEvent(completedEvent("req-1b"));
    await exporter.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await exporter.flush();

    const traces = fetchMock.mock.calls
      .flatMap((call) => (JSON.parse((call[1] as RequestInit).body as string) as { batch: Array<{ type: string; body: Record<string, unknown> }> }).batch)
      .filter((item) => item.type === "trace-create");
    const finished = traces.find((item) => (item.body.metadata as Record<string, unknown>)?.status === "completed");
    expect(finished).toBeDefined();
    expect(finished!.body.output).toBe("streamed reply");
  });

  it("omits content fields when captureContent is disabled", async () => {
    const { exporter, fetchMock } = makeExporter({ ...enabledConfig, captureContent: false });
    await exporter.refresh();
    exporter.handleEvent(usageEvent("req-2"));
    await exporter.flush();

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { batch: Array<{ type: string; body: Record<string, unknown> }> };
    const generation = body.batch.find((item) => item.type === "generation-create")!;
    expect(generation.body.output).toBeUndefined();
    expect(generation.body.input).toBeUndefined();
    // Usage numbers are still reported even without content.
    expect(generation.body.usageDetails).toMatchObject({ total: 150 });
  });

  it("records a tool span with ERROR level when the tool fails", async () => {
    const { exporter, fetchMock } = makeExporter(enabledConfig);
    exporter.handleEvent({
      requestId: "req-3",
      sessionId: "task-1",
      event: { kind: "tool_call", timestamp: "2024-01-01T00:00:00.500Z", payload: { toolCallId: "t1", toolName: "shell", arguments: { cmd: "ls" } } },
    });
    exporter.handleEvent({
      requestId: "req-3",
      sessionId: "task-1",
      event: { kind: "tool_result", timestamp: "2024-01-01T00:00:01.000Z", payload: { toolCallId: "t1", toolName: "shell", result: "boom", isError: true } },
    });
    await exporter.flush();

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { batch: Array<{ type: string; body: Record<string, unknown> }> };
    const span = body.batch.find((item) => item.type === "span-create")!;
    expect(span.body.name).toBe("shell");
    expect(span.body.level).toBe("ERROR");
    expect(span.body.statusMessage).toBe("boom");
  });

  it("persists to the outbox when delivery fails and drains it on the next flush", async () => {
    const failing = vi.fn(async () => new Response(null, { status: 500 }));
    const { exporter, outbox } = makeExporter(enabledConfig, { fetch: failing as unknown as typeof fetch });
    exporter.handleEvent(usageEvent("req-4"));
    await exporter.flush();

    expect(failing).toHaveBeenCalled();
    expect(outbox.entries.size).toBe(1);

    // Next flush succeeds and the outbox entry is delivered + removed.
    failing.mockResolvedValue(new Response(null, { status: 207 }));
    for (const entry of outbox.entries.values()) entry.nextAttemptAt = "2000-01-01T00:00:00.000Z";
    await exporter.flush();
    expect(outbox.entries.size).toBe(0);
  });

  it("drops the batch when the exporter is disabled without leaking content", async () => {
    const { exporter, outbox, fetchMock } = makeExporter(null);
    exporter.handleEvent(usageEvent("req-5"));
    await exporter.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outbox.entries.size).toBe(0);
  });

  it("treats permanent 4xx rejections as delivered and does not retry", async () => {
    const rejecting = vi.fn(async () => new Response(null, { status: 400 }));
    const { exporter, outbox } = makeExporter(enabledConfig, { fetch: rejecting as unknown as typeof fetch });
    exporter.handleEvent(usageEvent("req-6"));
    await exporter.flush();

    expect(rejecting).toHaveBeenCalled();
    expect(outbox.entries.size).toBe(0);
  });
});

describe("secret helpers", () => {
  it("masks Langfuse keys down to shape and tail", () => {
    expect(maskSecret("sk-lf-abcdef4b79")).toBe("sk-lf-••••4b79");
    expect(maskSecret("pk-lf-longpublickey")).toBe("pk-lf-••••ckey");
    expect(maskSecret(null)).toBe("");
    expect(maskSecret("   ")).toBe("");
  });

  it("redacts keys embedded in arbitrary text", () => {
    const text = "auth failed for sk-lf-topsecret1234 and pk-lf-public9999";
    const redacted = redactSecrets(text);
    expect(redacted).toContain("sk-lf-••••1234");
    expect(redacted).toContain("pk-lf-••••9999");
    expect(redacted).not.toContain("topsecret");
  });
});
