import { describe, expect, it } from "vitest";
import {
  agentRequestSchema,
  createArtifactInputSchema,
  extensionSourceSchema,
  sendChatInputSchema,
  taskStatusSchema,
} from "./index.js";

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

  it("requires correlated extension requests and rejects empty sources", () => {
    const requestId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    expect(agentRequestSchema.safeParse({
      type: "extension.list",
      requestId,
      runtime: { cwd: "/workspace", agentDir: "/user/pi-agent" },
    }).success).toBe(true);
    expect(extensionSourceSchema.safeParse("  ").success).toBe(false);
  });

  it("accepts chat messages without requiring a title or plan", () => {
    expect(sendChatInputSchema.safeParse({
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      taskId: null,
      content: "Help me compare these options",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "medium",
    }).success).toBe(true);
  });

  it("supports tool approval correlation and managed chat creation", () => {
    expect(sendChatInputSchema.safeParse({
      workspaceId: null,
      taskId: null,
      content: "Inspect this problem",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "high",
    }).success).toBe(true);
    expect(agentRequestSchema.safeParse({
      type: "tool.resolve",
      requestId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      approvalId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      approved: false,
    }).success).toBe(true);
  });
});
