import { describe, expect, it } from "vitest";
import {
  agentRequestSchema,
  agentMessageSchema,
  cancelRemoteSkillPreviewInputSchema,
  createDomainEntityInputSchema,
  createArtifactInputSchema,
  createSkillInputSchema,
  externalUrlInputSchema,
  extensionSourceSchema,
  importSkillInputSchema,
  inspectAttachmentPathsSchema,
  mcpCallToolInputSchema,
  mcpHttpConfigSchema,
  mcpStdioConfigSchema,
  promoteSessionInputSchema,
  sendChatInputSchema,
  sessionSearchInputSchema,
  setSkillEnabledInputSchema,
  skillSchema,
  skillSourceSchema,
  marketplaceSkillSchema,
  previewRemoteSkillInputSchema,
  installRemoteSkillsInputSchema,
  systemSkillSchema,
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

  it("validates local and remote MCP configurations", () => {
    expect(mcpStdioConfigSchema.parse({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    })).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: {},
    });
    expect(mcpHttpConfigSchema.parse({
      url: "https://mcp.notion.com/mcp",
      auth: "oauth",
    })).toEqual({
      url: "https://mcp.notion.com/mcp",
      transport: "auto",
      headers: {},
      auth: "oauth",
    });
    expect(mcpHttpConfigSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(mcpHttpConfigSchema.safeParse({ url: "file:///tmp/mcp" }).success).toBe(false);
    expect(mcpHttpConfigSchema.safeParse({
      url: "https://example.com/mcp",
      auth: "bearer",
    }).success).toBe(false);
    expect(mcpCallToolInputSchema.safeParse({
      sourceId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      toolName: "search",
      arguments: { query: "MCP" },
    }).success).toBe(true);
  });

  it("carries enabled MCP servers into chat agent requests", () => {
    expect(agentRequestSchema.safeParse({
      type: "chat",
      requestId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      sessionId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Search Notion" }],
      credential: { providerId: "anthropic", apiKey: "test" },
      thinkingLevel: "medium",
      permissionMode: "ask",
      runtime: { cwd: "/workspace", agentDir: "/user/pi-agent" },
      mcpServers: [{
        id: "018f88d1-1eb5-709a-90ef-4325747e294e",
        name: "Notion",
        type: "mcp_http",
        config: {
          url: "https://mcp.notion.com/mcp",
          transport: "auto",
          auth: "oauth",
          bearerToken: "token",
        },
      }],
    }).success).toBe(true);
  });

  it("validates model-backed conversation title requests", () => {
    expect(agentRequestSchema.safeParse({
      type: "title",
      requestId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      prompt: "https://app.notion.com/p/example 帮我读取这个文档",
      response: "我已读取文档并总结了重点。",
      provider: { providerId: "anthropic", apiKey: "test" },
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "minimal",
      runtime: { cwd: "/workspace", agentDir: "/user/pi-agent" },
    }).success).toBe(true);
    expect(agentMessageSchema.safeParse({
      type: "title",
      requestId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      title: "Notion 文档摘要",
    }).success).toBe(true);
  });

  it("allows only absolute HTTP and HTTPS external URLs", () => {
    expect(externalUrlInputSchema.safeParse({ url: "https://example.com/docs?q=pi" }).success).toBe(true);
    expect(externalUrlInputSchema.safeParse({ url: "http://localhost:3000" }).success).toBe(true);
    expect(externalUrlInputSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(externalUrlInputSchema.safeParse({ url: "file:///tmp/secret" }).success).toBe(false);
    expect(externalUrlInputSchema.safeParse({ url: "/relative/path" }).success).toBe(false);
  });

  it("validates global Skill names, imports, and enabled state changes", () => {
    const id = "018f88d1-1eb5-709a-90ef-4325747e294c";
    expect(createSkillInputSchema.safeParse({
      name: "pdf-review",
      description: "Reviews PDF documents.",
      instructions: "# Instructions",
    }).success).toBe(true);
    expect(createSkillInputSchema.safeParse({
      name: "PDF Review",
      description: "Reviews PDF documents.",
      instructions: "# Instructions",
    }).success).toBe(false);
    expect(createSkillInputSchema.safeParse({
      name: "pdf-review",
      description: " ",
      instructions: "# Instructions",
    }).success).toBe(false);
    expect(importSkillInputSchema.safeParse({ path: "" }).success).toBe(false);
    expect(importSkillInputSchema.safeParse({ path: "/tmp/pdf-review" }).success).toBe(true);
    expect(setSkillEnabledInputSchema.safeParse({ id, enabled: false }).success).toBe(true);
    expect(setSkillEnabledInputSchema.safeParse({ id: "not-a-uuid", enabled: true }).success).toBe(false);
    expect(systemSkillSchema.safeParse({
      name: "pdf-review",
      description: "Reviews PDF documents.",
      path: "/Users/example/.codex/skills/pdf-review",
      source: "codex",
      imported: false,
    }).success).toBe(true);
  });

  it("validates Skill provenance and remains compatible with legacy Skills", () => {
    const legacy = {
      id: "018f88d1-1eb5-709a-90ef-4325747e294c",
      workspaceId: null,
      name: "pdf-review",
      description: "Reviews PDF documents.",
      instructions: "# Instructions",
      enabled: true,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    expect(skillSchema.parse(legacy)).not.toHaveProperty("source");
    expect(skillSourceSchema.safeParse({
      type: "remote",
      provider: "skills.sh",
      sourceUrl: "https://www.skills.sh/example/repository/pdf-review",
      repositoryUrl: "https://github.com/example/repository",
      skillId: "pdf-review",
      subpath: "skills/pdf-review",
      commit: "abc123",
    }).success).toBe(true);
    expect(skillSourceSchema.safeParse({
      type: "system",
      provider: "unknown",
      path: "/tmp/pdf-review",
    }).success).toBe(false);
  });

  it("validates marketplace search, preview, and batch installation inputs", () => {
    expect(marketplaceSkillSchema.safeParse({
      id: "example/repository/pdf-review",
      skillId: "pdf-review",
      name: "pdf-review",
      installs: 42,
      source: "example/repository",
      sourceUrl: "https://github.com/example/repository",
      detailUrl: "https://www.skills.sh/example/repository/pdf-review",
      installed: false,
    }).success).toBe(true);
    expect(previewRemoteSkillInputSchema.safeParse({
      sourceUrl: "file:///tmp/skill",
      provider: "url",
    }).success).toBe(false);
    expect(installRemoteSkillsInputSchema.safeParse({
      previewId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      skillIds: [".", "skills/pdf-review"],
    }).success).toBe(true);
    expect(installRemoteSkillsInputSchema.safeParse({
      previewId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      skillIds: [],
    }).success).toBe(false);
    expect(cancelRemoteSkillPreviewInputSchema.safeParse({
      previewId: "018f88d1-1eb5-709a-90ef-4325747e294c",
    }).success).toBe(true);
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
