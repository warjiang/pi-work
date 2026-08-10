import { PiAdapter } from "../../../../packages/pi-adapter/src/index.js";
import { agentRequestSchema, agentResponseSchema } from "../../../../packages/protocol/src/index.js";

process.parentPort?.on("message", (event) => {
  const request = agentRequestSchema.safeParse(event.data);
  if (!request.success) {
    process.parentPort?.postMessage(agentResponseSchema.parse({
      type: "error",
      message: "Invalid agent request.",
    }));
    return;
  }

  const adapter = new PiAdapter();
  if (request.data.type === "health") {
    const health = adapter.health();
    process.parentPort?.postMessage(agentResponseSchema.parse({
      type: "health",
      piSdkAvailable: health.piSdkAvailable,
    }));
    return;
  }

  process.parentPort?.postMessage(agentResponseSchema.parse({
    type: "plan",
    plan: adapter.createPlanningFallback(request.data.task),
  }));
});
