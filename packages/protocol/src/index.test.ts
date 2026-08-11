import { describe, expect, it } from "vitest";
import {
  agentRequestSchema,
  agentMessageSchema,
  createDomainEntityInputSchema,
  createArtifactInputSchema,
  externalUrlInputSchema,
  extensionSourceSchema,
  inspectAttachmentPathsSchema,
  promoteSessionInputSchema,
  sendChatInputSchema,
  sessionSearchInputSchema,
  taskSchema,
  taskStatusSchema,
  updateSessionInputSchema,
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

  it("does not expose legacy project IDs in session schemas", () => {
    expect(taskSchema.shape).not.toHaveProperty("projectId");
    expect(sessionSearchInputSchema.parse({ projectId: null })).not.toHaveProperty("projectId");
    expect(updateSessionInputSchema.parse({
      sessionId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      projectId: "018f88d1-1eb5-709a-90ef-4325747e294d",
    })).not.toHaveProperty("projectId");
    expect(updateSessionInputSchema.parse({
      sessionId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      kind: "task",
    })).not.toHaveProperty("workspaceId");
    expect(updateSessionInputSchema.parse({
      sessionId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      kind: "task",
    })).not.toHaveProperty("kind");
  });

  it("requires a work folder for resources and validates session promotion", () => {
    const sessionId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    const workspaceId = "018f88d1-1eb5-709a-90ef-4325747e294d";
    expect(createDomainEntityInputSchema.safeParse({
      value: { name: "Source" },
    }).success).toBe(false);
    expect(createDomainEntityInputSchema.safeParse({
      workspaceId: null,
      value: { name: "Source" },
    }).success).toBe(false);
    expect(promoteSessionInputSchema.parse({ sessionId, workspaceId })).toEqual({ sessionId, workspaceId });
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

  it("allows only absolute HTTP and HTTPS external URLs", () => {
    expect(externalUrlInputSchema.safeParse({ url: "https://example.com/docs?q=pi" }).success).toBe(true);
    expect(externalUrlInputSchema.safeParse({ url: "http://localhost:3000" }).success).toBe(true);
    expect(externalUrlInputSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(externalUrlInputSchema.safeParse({ url: "file:///tmp/secret" }).success).toBe(false);
    expect(externalUrlInputSchema.safeParse({ url: "/relative/path" }).success).toBe(false);
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

  it("correlates chat lifecycle events and validates attachment drafts", () => {
    const requestId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    const sessionId = "018f88d1-1eb5-709a-90ef-4325747e294d";
    expect(agentRequestSchema.safeParse({
      type: "cancel",
      requestId,
      sessionId,
    }).success).toBe(true);
    expect(agentMessageSchema.safeParse({
      type: "event",
      requestId,
      sessionId,
      event: {
        sequence: 2,
        kind: "cancelled",
        payload: {},
        timestamp: new Date().toISOString(),
      },
    }).success).toBe(true);
    expect(inspectAttachmentPathsSchema.safeParse(["/workspace/reference.pdf"]).success).toBe(true);
    expect(sendChatInputSchema.safeParse({
      workspaceId: sessionId,
      taskId: null,
      content: "Review this file",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "medium",
      attachments: [{
        name: "reference.pdf",
        path: "/workspace/reference.pdf",
        mimeType: "application/pdf",
        size: 42,
      }],
    }).success).toBe(true);
  });
});
