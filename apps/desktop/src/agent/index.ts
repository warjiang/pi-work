import { PiAdapter } from "@pi-work/pi-adapter";
import { agentRequestSchema, agentResponseSchema } from "@pi-work/protocol";
import { randomUUID } from "node:crypto";

const adapter = new PiAdapter();
const pendingApprovals = new Map<string, { sessionId: string; resolve: (approved: boolean) => void }>();
const activeRuns = new Map<string, {
  requestId: string;
  nextSequence(): number;
  cancelled: boolean;
  cancellationEmitted: boolean;
}>();

function streamEvent(
  requestId: string,
  sessionId: string,
  sequence: number,
  kind: "text_delta" | "thinking" | "tool_call" | "tool_update" | "tool_result" | "file_change" | "runtime" | "approval" | "error" | "completed" | "cancelled",
  payload: Record<string, unknown>,
): void {
  process.parentPort?.postMessage(agentResponseSchema.parse({
    type: "event",
    requestId,
    sessionId,
    event: { sequence, kind, payload, timestamp: new Date().toISOString() },
  }));
}

function requestApproval(
  requestId: string,
  sessionId: string,
  nextSequence: () => number,
  tool: "edit" | "write" | "bash",
  args: Record<string, unknown>,
  cwd: string,
): Promise<boolean> {
  const approvalId = randomUUID();
  process.parentPort?.postMessage(agentResponseSchema.parse({
    type: "tool.approval",
    requestId,
    sessionId,
    approvalId,
    tool,
    arguments: args,
    cwd,
  }));
  streamEvent(requestId, sessionId, nextSequence(), "approval", { approvalId, tool, arguments: args, cwd });
  return new Promise((resolve) => pendingApprovals.set(approvalId, { sessionId, resolve }));
}

process.parentPort?.on("message", async (event) => {
  const request = agentRequestSchema.safeParse(event.data);
  if (!request.success) {
    const requestId = typeof event.data === "object"
      && event.data !== null
      && "requestId" in event.data
      && typeof event.data.requestId === "string"
      ? event.data.requestId
      : null;
    if (requestId === null) {
      return;
    }
    process.parentPort?.postMessage(agentResponseSchema.parse({
      type: "error",
      requestId,
      message: "Invalid agent request.",
    }));
    return;
  }

  try {
    const { requestId } = request.data;
    switch (request.data.type) {
      case "tool.resolve":
        pendingApprovals.get(request.data.approvalId)?.resolve(request.data.approved);
        pendingApprovals.delete(request.data.approvalId);
        break;
      case "cancel": {
        const run = activeRuns.get(request.data.sessionId);
        if (run !== undefined) {
          run.cancelled = true;
          for (const [approvalId, approval] of pendingApprovals) {
            if (approval.sessionId === request.data.sessionId) {
              approval.resolve(false);
              pendingApprovals.delete(approvalId);
            }
          }
          await adapter.cancel(request.data.sessionId);
          if (!run.cancellationEmitted) {
            streamEvent(run.requestId, request.data.sessionId, run.nextSequence(), "cancelled", {});
            run.cancellationEmitted = true;
          }
        }
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "cancelled",
          requestId,
          sessionId: request.data.sessionId,
        }));
        break;
      }
      case "health": {
        const health = adapter.health();
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "health",
          requestId,
          piSdkAvailable: health.piSdkAvailable,
        }));
        break;
      }
      case "plan": {
        const plan = await adapter.createPlan(
          request.data.task,
          request.data.provider ?? null,
          request.data.modelId,
          request.data.thinkingLevel,
          request.data.runtime,
        );
        process.parentPort?.postMessage(agentResponseSchema.parse({ type: "plan", requestId, plan }));
        break;
      }
      case "chat": {
        const sessionId = request.data.sessionId;
        let sequence = 0;
        const run = {
          requestId,
          nextSequence: () => sequence++,
          cancelled: false,
          cancellationEmitted: false,
        };
        activeRuns.set(sessionId, run);
        let result: Awaited<ReturnType<PiAdapter["chat"]>>;
        try {
          result = await adapter.chat(
            sessionId,
            request.data.messages,
            request.data.images,
            request.data.provider ?? null,
            request.data.modelId,
            request.data.thinkingLevel,
            request.data.runtime,
            (tool, args, cwd) => requestApproval(requestId, sessionId, run.nextSequence, tool, args, cwd),
            request.data.permissionMode,
            (kind, payload) => streamEvent(requestId, sessionId, run.nextSequence(), kind, payload),
          );
        } finally {
          activeRuns.delete(sessionId);
        }
        if (result.cancelled || run.cancelled) {
          if (!run.cancellationEmitted) {
            streamEvent(requestId, sessionId, run.nextSequence(), "cancelled", {});
          }
        } else {
          streamEvent(requestId, sessionId, run.nextSequence(), "completed", {});
        }
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "chat",
          requestId,
          sessionId,
          content: result.content,
          cancelled: result.cancelled || run.cancelled,
        }));
        break;
      }
      case "extension.list":
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "extensions",
          requestId,
          packages: adapter.listExtensions(request.data.runtime),
        }));
        break;
      case "extension.install":
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "extensions",
          requestId,
          packages: await adapter.installExtension(request.data.runtime, request.data.source),
        }));
        break;
      case "extension.remove":
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "extensions",
          requestId,
          packages: await adapter.removeExtension(request.data.runtime, request.data.source),
        }));
        break;
      case "model.list": {
        const result = await adapter.listModels(request.data.runtime);
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "models",
          requestId,
          ...result,
        }));
        break;
      }
    }
  } catch (error) {
    process.parentPort?.postMessage(agentResponseSchema.parse({
      type: "error",
      requestId: request.data.requestId,
      message: error instanceof Error ? error.message : "Pi planning failed.",
    }));
  }
});
