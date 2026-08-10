import { describe, expect, it } from "vitest";
import { createArtifactInputSchema, taskStatusSchema } from "./index.js";

describe("protocol schemas", () => {
  it("allows only declared task statuses and safe artifact paths", () => {
    expect(taskStatusSchema.safeParse("running").success).toBe(true);
    expect(taskStatusSchema.safeParse("unbounded_shell").success).toBe(false);
    expect(createArtifactInputSchema.safeParse({
      taskId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      relativePath: "decision-brief.md",
      content: "# Brief",
    }).success).toBe(true);
  });
});
