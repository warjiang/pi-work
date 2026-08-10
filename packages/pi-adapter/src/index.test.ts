import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PiAdapter } from "./index.js";

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
});
