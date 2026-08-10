import { PiAdapter } from "../../../../packages/pi-adapter/src/index.js";
import { agentRequestSchema, agentResponseSchema } from "../../../../packages/protocol/src/index.js";
import { randomUUID } from "node:crypto";

const adapter = new PiAdapter();
const pendingApprovals = new Map<string, (approved: boolean) => void>();

function requestApproval(
  requestId: string,
  tool: "edit" | "write" | "bash",
  args: Record<string, unknown>,
  cwd: string,
): Promise<boolean> {
  const approvalId = randomUUID();
  process.parentPort?.postMessage(agentResponseSchema.parse({
    type: "tool.approval",
    requestId,
    approvalId,
    tool,
    arguments: args,
    cwd,
  }));
  return new Promise((resolve) => pendingApprovals.set(approvalId, resolve));
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
        pendingApprovals.get(request.data.approvalId)?.(request.data.approved);
        pendingApprovals.delete(request.data.approvalId);
        break;
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
        const content = await adapter.chat(
          request.data.messages,
          request.data.provider ?? null,
          request.data.modelId,
          request.data.thinkingLevel,
          request.data.runtime,
          (tool, args, cwd) => requestApproval(requestId, tool, args, cwd),
        );
        process.parentPort?.postMessage(agentResponseSchema.parse({
          type: "chat",
          requestId,
          content,
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
