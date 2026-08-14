import { randomUUID } from "node:crypto";
import { redactSecrets } from "./secrets-broker.js";

export type LangfuseConfig = {
  host: string;
  publicKey: string;
  secretKey: string;
  captureContent: boolean;
};

export type RunContext = {
  taskId: string;
  workspaceId: string | null;
  provider: string;
  model: string;
  thinkingLevel: string;
  permissionMode: string;
  cwd: string;
  appVersion: string;
  userMessage: string;
};

export type UsageEventPayload = {
  provider: string;
  model: string;
  responseModel: string | null;
  api: string | null;
  stopReason: string | null;
  output: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
};

type IngestionItem = { id: string; type: string; timestamp: string; body: Record<string, unknown> };

export type ExporterDeps = {
  resolveConfig(): Promise<LangfuseConfig | null>;
  resolveRunContext(taskId: string, requestId: string): RunContext | null;
  outbox: {
    enqueue(payload: string, nextAttemptAt?: string): void;
    listDue(limit: number): Array<{ id: string; payload: string; attempts: number }>;
    markRetry(id: string, attempts: number, nextAttemptAt: string): void;
    delete(id: string): void;
  };
  fetch?: typeof fetch;
  log?: (message: string, error?: unknown) => void;
  flushIntervalMs?: number;
  batchSize?: number;
};

const MAX_FIELD_LENGTH = 20_000;
const MAX_ATTEMPTS = 8;

/**
 * Streams Pi Work agent runs into a self-hosted Langfuse v3 instance through the
 * batch `/api/public/ingestion` endpoint (no OpenTelemetry dependency). Every
 * public method is failure-isolated: exporter problems must never disrupt an
 * agent run, so callers `void` the promises and all network work is wrapped.
 */
export class LangfuseExporter {
  private readonly deps: ExporterDeps;
  private readonly runs = new Map<string, RunState>();
  private buffer: IngestionItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  constructor(deps: ExporterDeps) {
    this.deps = deps;
    this.batchSize = deps.batchSize ?? 20;
    this.flushIntervalMs = deps.flushIntervalMs ?? 5_000;
  }

  /** Starts the periodic outbox drain. Safe to call once during app startup. */
  start(): void {
    void this.safeConfig();
    if (this.retryTimer !== null) return;
    this.retryTimer = setInterval(() => {
      void this.drainOutbox();
    }, this.flushIntervalMs);
    if (typeof this.retryTimer.unref === "function") this.retryTimer.unref();
  }

  /** Re-reads config so a settings change (e.g. captureContent) takes effect. */
  async refresh(): Promise<void> {
    await this.safeConfig();
  }

  /** Handles one agent event response coming from the utility process. */
  handleEvent(response: {
    requestId: string;
    sessionId: string;
    event: { kind: string; payload: Record<string, unknown>; timestamp: string };
  }): void {
    try {
      this.consume(response);
    } catch (error) {
      this.log("Failed to record telemetry event.", error);
    }
  }

  private consume(response: {
    requestId: string;
    sessionId: string;
    event: { kind: string; payload: Record<string, unknown>; timestamp: string };
  }): void {
    const { requestId, sessionId, event } = response;
    const kind = event.kind;
    if (kind === "completed" || kind === "cancelled") {
      this.finishRun(requestId, sessionId, kind, event.timestamp);
      return;
    }
    if (kind === "text_delta") {
      const state = this.runs.get(requestId);
      if (state !== undefined && typeof event.payload.delta === "string") {
        state.output += event.payload.delta;
      }
      return;
    }
    if (kind === "usage") {
      this.recordGeneration(requestId, sessionId, event.payload as unknown as UsageEventPayload, event.timestamp);
      return;
    }
    if (kind === "tool_call") {
      const state = this.ensureRun(requestId, sessionId);
      if (state === null) return;
      const toolCallId = String(event.payload.toolCallId ?? randomUUID());
      state.tools.set(toolCallId, {
        toolName: typeof event.payload.toolName === "string" ? event.payload.toolName : "tool",
        args: event.payload.arguments,
        startTime: event.timestamp,
      });
      return;
    }
    if (kind === "tool_result") {
      this.recordSpan(requestId, sessionId, event.payload, event.timestamp);
      return;
    }
    if (kind === "runtime") {
      const state = this.runs.get(requestId);
      const notice = String(event.payload.state ?? "");
      if (state !== undefined && ["compacted", "retry_complete", "retrying", "compacting"].includes(notice)) {
        this.enqueue({
          id: randomUUID(),
          type: "event-create",
          timestamp: event.timestamp,
          body: {
            traceId: state.traceId,
            name: `runtime.${notice}`,
            startTime: event.timestamp,
            metadata: this.sanitizeMetadata(event.payload),
          },
        });
      }
      return;
    }
    if (kind === "approval") {
      const state = this.runs.get(requestId);
      if (state !== undefined) {
        this.enqueue({
          id: randomUUID(),
          type: "event-create",
          timestamp: event.timestamp,
          body: {
            traceId: state.traceId,
            name: "approval.requested",
            startTime: event.timestamp,
            metadata: this.sanitizeMetadata(event.payload),
          },
        });
      }
      return;
    }
  }

  private ensureRun(requestId: string, taskId: string): RunState | null {
    const existing = this.runs.get(requestId);
    if (existing !== undefined) return existing;
    const context = this.deps.resolveRunContext(taskId, requestId);
    if (context === null) return null;
    const traceId = requestId;
    const startTime = new Date().toISOString();
    const state: RunState = {
      traceId,
      context,
      startTime,
      output: "",
      tools: new Map(),
      captureContent: this.captureContent,
    };
    this.runs.set(requestId, state);
    this.enqueue({
      id: randomUUID(),
      type: "trace-create",
      timestamp: startTime,
      body: {
        id: traceId,
        name: "pi-work.chat",
        sessionId: context.taskId,
        timestamp: startTime,
        ...(this.captureContent ? { input: this.cap(context.userMessage) } : {}),
        metadata: {
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          requestId,
          provider: context.provider,
          model: context.model,
          thinkingLevel: context.thinkingLevel,
          permissionMode: context.permissionMode,
          cwd: context.cwd,
          appVersion: context.appVersion,
        },
      },
    });
    return state;
  }

  private recordGeneration(requestId: string, taskId: string, payload: UsageEventPayload, timestamp: string): void {
    const state = this.ensureRun(requestId, taskId);
    if (state === null || payload.usage === undefined) return;
    const usage = payload.usage;
    this.enqueue({
      id: randomUUID(),
      type: "generation-create",
      timestamp,
      body: {
        traceId: state.traceId,
        name: "assistant-message",
        startTime: state.startTime,
        endTime: timestamp,
        model: payload.model,
        ...(this.captureContent ? { input: this.cap(state.context.userMessage) } : {}),
        ...(this.captureContent ? { output: this.cap(payload.output) } : {}),
        usageDetails: {
          input: usage.input,
          output: usage.output,
          cache_read: usage.cacheRead,
          cache_write: usage.cacheWrite,
          ...(usage.reasoning > 0 ? { reasoning: usage.reasoning } : {}),
          total: usage.totalTokens,
        },
        costDetails: {
          input: usage.cost.input,
          output: usage.cost.output,
          cache_read: usage.cost.cacheRead,
          cache_write: usage.cost.cacheWrite,
          total: usage.cost.total,
        },
        metadata: {
          provider: payload.provider,
          responseModel: payload.responseModel,
          api: payload.api,
          stopReason: payload.stopReason,
        },
      },
    });
  }

  private recordSpan(requestId: string, taskId: string, payload: Record<string, unknown>, timestamp: string): void {
    const state = this.ensureRun(requestId, taskId);
    if (state === null) return;
    const toolCallId = String(payload.toolCallId ?? "");
    const pending = state.tools.get(toolCallId);
    state.tools.delete(toolCallId);
    const isError = payload.isError === true;
    this.enqueue({
      id: randomUUID(),
      type: "span-create",
      timestamp,
      body: {
        traceId: state.traceId,
        name: typeof payload.toolName === "string" ? payload.toolName : pending?.toolName ?? "tool",
        startTime: pending?.startTime ?? timestamp,
        endTime: timestamp,
        ...(this.captureContent ? { input: this.capValue(pending?.args) } : {}),
        ...(this.captureContent ? { output: this.capValue(payload.result) } : {}),
        level: isError ? "ERROR" : "DEFAULT",
        ...(isError ? { statusMessage: this.cap(String(payload.result ?? "Tool failed.")) } : {}),
      },
    });
  }

  private finishRun(requestId: string, taskId: string, kind: string, timestamp: string): void {
    const state = this.runs.get(requestId);
    this.runs.delete(requestId);
    if (state === undefined) return;
    this.enqueue({
      id: randomUUID(),
      type: "trace-create",
      timestamp,
      body: {
        id: state.traceId,
        name: "pi-work.chat",
        sessionId: state.context.taskId,
        ...(this.captureContent ? { output: this.cap(state.output) } : {}),
        metadata: {
          workspaceId: state.context.workspaceId,
          taskId: state.context.taskId,
          requestId,
          provider: state.context.provider,
          model: state.context.model,
          status: kind,
        },
      },
    });
    void this.flush();
  }

  private get captureContent(): boolean {
    return this.lastCaptureContent;
  }

  private lastCaptureContent = true;

  private enqueue(item: IngestionItem): void {
    this.buffer.push(item);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushIntervalMs);
      if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
    }
  }

  /** Flushes buffered items and drains the persisted outbox. Never throws. */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const items = this.buffer;
    this.buffer = [];
    if (items.length > 0) {
      const config = await this.safeConfig();
      if (config === null) {
        // Disabled or incomplete: drop rather than persist private content.
        return;
      }
      this.lastCaptureContent = config.captureContent;
      const sent = await this.send(config, items);
      if (!sent) {
        this.persist(items);
      }
    }
    await this.drainOutbox();
  }

  private async drainOutbox(): Promise<void> {
    try {
      const due = this.deps.outbox.listDue(this.batchSize);
      if (due.length === 0) return;
      const config = await this.safeConfig();
      if (config === null) return;
      for (const entry of due) {
        let items: IngestionItem[];
        try {
          items = JSON.parse(entry.payload) as IngestionItem[];
        } catch {
          this.deps.outbox.delete(entry.id);
          continue;
        }
        const sent = await this.send(config, items);
        if (sent) {
          this.deps.outbox.delete(entry.id);
        } else {
          const attempts = entry.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            this.deps.outbox.delete(entry.id);
          } else {
            const backoff = Math.min(2 ** attempts, 300) * 1_000;
            this.deps.outbox.markRetry(entry.id, attempts, new Date(Date.now() + backoff).toISOString());
          }
        }
      }
    } catch (error) {
      this.log("Failed to drain telemetry outbox.", error);
    }
  }

  private persist(items: IngestionItem[]): void {
    try {
      this.deps.outbox.enqueue(JSON.stringify(items), new Date(Date.now() + 5_000).toISOString());
    } catch (error) {
      this.log("Failed to persist telemetry outbox entry.", error);
    }
  }

  private async send(config: LangfuseConfig, items: IngestionItem[]): Promise<boolean> {
    const doFetch = this.deps.fetch ?? globalThis.fetch;
    if (typeof doFetch !== "function") return false;
    try {
      const url = `${config.host.replace(/\/$/, "")}/api/public/ingestion`;
      const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ batch: items }),
      });
      // 207 multi-status is the normal success code for the ingestion endpoint.
      if (response.status === 207 || (response.status >= 200 && response.status < 300)) {
        return true;
      }
      // 4xx (except 429) are permanent: dropping avoids poisoning the outbox.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        this.log(`Telemetry rejected (${response.status}); dropping batch.`);
        return true;
      }
      return false;
    } catch (error) {
      this.log("Telemetry request failed.", error);
      return false;
    }
  }

  private async safeConfig(): Promise<LangfuseConfig | null> {
    try {
      const config = await this.deps.resolveConfig();
      if (config === null) return null;
      if (config.host.trim() === "" || config.publicKey.trim() === "" || config.secretKey.trim() === "") {
        return null;
      }
      this.lastCaptureContent = config.captureContent;
      return config;
    } catch (error) {
      this.log("Failed to resolve telemetry config.", error);
      return null;
    }
  }

  private cap(value: string): string {
    const redacted = redactSecrets(value ?? "");
    return redacted.length > MAX_FIELD_LENGTH ? `${redacted.slice(0, MAX_FIELD_LENGTH)}…[truncated]` : redacted;
  }

  private capValue(value: unknown): unknown {
    if (value === undefined || value === null) return value;
    if (typeof value === "string") return this.cap(value);
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_FIELD_LENGTH) {
        return `${redactSecrets(serialized).slice(0, MAX_FIELD_LENGTH)}…[truncated]`;
      }
      return JSON.parse(redactSecrets(serialized));
    } catch {
      return undefined;
    }
  }

  private sanitizeMetadata(payload: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string") {
        result[key] = this.cap(value);
      } else if (typeof value === "number" || typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  }

  private log(message: string, error?: unknown): void {
    this.deps.log?.(message, error);
  }

  /**
   * Synchronously moves buffered items into the durable outbox. Used on
   * `before-quit`, where async flushing cannot complete before the DB closes.
   */
  persistPendingSync(): void {
    if (this.buffer.length === 0) return;
    const items = this.buffer;
    this.buffer = [];
    this.persist(items);
  }

  /** Cancels timers and flushes remaining items; call before the app quits. */
  async dispose(): Promise<void> {
    if (this.retryTimer !== null) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    await this.flush();
  }
}

type RunState = {
  traceId: string;
  context: RunContext;
  startTime: string;
  output: string;
  tools: Map<string, { toolName: string; args: unknown; startTime: string }>;
  captureContent: boolean;
};
