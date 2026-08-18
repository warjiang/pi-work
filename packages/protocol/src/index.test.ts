import { describe, expect, it } from "vitest";
import {
  agentRequestSchema,
  agentMessageSchema,
  cancelRemoteSkillPreviewInputSchema,
  conductorSpecSchema,
  createTaskInputSchema,
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
  approvePlanInputSchema,
  diffPlanRevisions,
  planRevisionMarkdown,
  planningResultSchema,
  promoteSessionInputSchema,
  requestPlanInputSchema,
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
  updateWorkspaceInputSchema,
  updateSessionInputSchema,
  updateAppSettingsInputSchema,
  workflowDraftSchema,
  workflowContextSchema,
} from "./index.js";
import type { PlanRevision } from "./index.js";

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

  it("keeps tasks scoped directly to workspaces without accepting identity mutations", () => {
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

  it("defaults newly created tasks to Plan while preserving direct legacy tasks", () => {
    const workspaceId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    expect(createTaskInputSchema.parse({
      workspaceId,
      title: "New task",
      goal: "New task",
    })).toEqual(expect.objectContaining({
      planMode: true,
      executionMode: "plan",
    }));
    expect(taskSchema.parse({
      id: "018f88d1-1eb5-709a-90ef-4325747e294d",
      workspaceId,
      title: "Legacy task",
      goal: "Continue existing behavior.",
      status: "draft",
      providerId: null,
      modelId: null,
      thinkingLevel: "off",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    }).executionMode).toBe("direct");
  });

  it("defaults workflow orchestration to optional unless explicitly required", () => {
    const base = {
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      taskId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      origin: "conversation" as const,
      dedupeKey: "conversation:task:message",
    };
    expect(workflowContextSchema.parse(base).required).toBe(false);
    expect(workflowContextSchema.parse({ ...base, required: true }).required).toBe(true);
  });

  it("accepts workspace folder edits as one update", () => {
    expect(updateWorkspaceInputSchema.parse({
      workspaceId: "018f88d1-1eb5-709a-90ef-4325747e294c",
      directories: ["/workspace/product", "/workspace/docs"],
    }).directories).toEqual(["/workspace/product", "/workspace/docs"]);
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

  it("rejects cyclic conductor graphs", () => {
    const first = "018f88d1-1eb5-709a-90ef-4325747e294c";
    const second = "018f88d1-1eb5-709a-90ef-4325747e294d";
    expect(conductorSpecSchema.safeParse({
      nodes: [
        { id: first, title: "First", prompt: "First", dependsOn: [second] },
        { id: second, title: "Second", prompt: "Second", dependsOn: [first] },
      ],
    }).success).toBe(false);
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

  it("does not expand defaults when applying a partial app-settings update", () => {
    expect(updateAppSettingsInputSchema.parse({
      providerId: "ida",
      modelId: "gpt-5.6-luna",
    })).toEqual({
      providerId: "ida",
      modelId: "gpt-5.6-luna",
    });
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

  it("validates clarification and proposal planning results", () => {
    expect(planningResultSchema.parse({
      kind: "clarification",
      question: "Should the migration preserve the legacy table?",
      options: [
        { label: "Preserve", description: "Keep legacy data readable." },
        { label: "Replace", description: "Use only the new revision table." },
      ],
    })).toEqual({
      kind: "clarification",
      question: "Should the migration preserve the legacy table?",
      options: [
        { label: "Preserve", description: "Keep legacy data readable." },
        { label: "Replace", description: "Use only the new revision table." },
      ],
    });
    expect(planningResultSchema.safeParse({
      kind: "proposal",
      proposal: {
        title: "Version plans",
        summary: "Store every proposed plan as an immutable revision.",
        steps: [{
          title: "Add storage",
          detail: "Create the append-only plan revision table.",
          targets: ["packages/storage/src/schema.ts"],
          verification: ["Run storage tests"],
        }],
        assumptions: ["The legacy plans table remains readable during migration."],
        sources: [{ path: "packages/storage/src/schema.ts", operation: "read" }],
      },
    }).success).toBe(true);
  });

  it("validates workflow keys, dependency bounds, and acyclic graphs", () => {
    const node = (key: string, dependsOn: string[] = []) => ({
      key,
      title: key,
      prompt: `Run ${key}`,
      dependsOn,
      executionClass: "read" as const,
      maxAttempts: 1,
    });
    const draft = {
      title: "Parallel research",
      summary: "Inspect two modules and synthesize the findings.",
      maxParallel: 2,
      nodes: [node("runtime"), node("storage", ["runtime"])],
    };

    expect(workflowDraftSchema.safeParse(draft).success).toBe(true);
    expect(workflowDraftSchema.safeParse({ ...draft, nodes: [node("same"), node("same")] }).success).toBe(false);
    expect(workflowDraftSchema.safeParse({ ...draft, nodes: [node("one"), node("two", ["missing"])] }).success).toBe(false);
    expect(workflowDraftSchema.safeParse({ ...draft, nodes: [node("one", ["two"]), node("two", ["one"])] }).success).toBe(false);
    expect(workflowDraftSchema.safeParse({ ...draft, nodes: [node("only")] }).success).toBe(false);
    expect(workflowDraftSchema.safeParse({
      ...draft,
      nodes: Array.from({ length: 25 }, (_, index) => node(`node-${index}`)),
    }).success).toBe(false);
  });

  it("requires exact revision IDs for approval and carries structured plan context", () => {
    const taskId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    const planRevisionId = "018f88d1-1eb5-709a-90ef-4325747e294d";
    const messageId = "018f88d1-1eb5-709a-90ef-4325747e294e";
    expect(approvePlanInputSchema.safeParse({ taskId }).success).toBe(false);
    expect(approvePlanInputSchema.parse({ taskId, planRevisionId })).toEqual({
      taskId,
      planRevisionId,
      action: "approve_and_execute",
    });
    expect(requestPlanInputSchema.parse({ taskId, feedbackMessageId: messageId })).toEqual({
      taskId,
      feedbackMessageId: messageId,
    });
    expect(agentRequestSchema.safeParse({
      type: "plan",
      requestId: "018f88d1-1eb5-709a-90ef-4325747e294f",
      task: { id: taskId, title: "Plan mode", goal: "Implement versioned plans." },
      conversation: [{
        id: messageId,
        role: "user",
        content: "Keep plans inline.",
        createdAt: "2026-08-16T00:00:00.000Z",
      }],
      previousPlan: {
        id: planRevisionId,
        taskId,
        revision: 1,
        status: "proposed",
        title: "Initial plan",
        summary: "Implement the first version.",
        steps: [{
          id: "018f88d1-1eb5-709a-90ef-4325747e2950",
          title: "Inspect",
          detail: "Read the current implementation.",
          targets: ["apps/desktop/src"],
          verification: ["Run typecheck"],
        }],
        assumptions: [],
        sources: [{ path: "apps/desktop/src/main/index.ts", operation: "read" }],
        parentRevisionId: null,
        createdFromMessageId: messageId,
        createdAt: "2026-08-16T00:00:01.000Z",
        approvedAt: null,
      },
      feedbackMessageId: messageId,
      provider: { providerId: "anthropic", apiKey: "test" },
      modelId: "claude-sonnet-4-5",
      thinkingLevel: "medium",
      runtime: { cwd: "/workspace", agentDir: "/user/pi-agent" },
    }).success).toBe(true);
  });

  it("projects plan revisions into canonical Markdown", () => {
    const plan = {
      id: "018f88d1-1eb5-709a-90ef-4325747e294c",
      taskId: "018f88d1-1eb5-709a-90ef-4325747e294d",
      revision: 1,
      status: "proposed",
      title: "Upgrade plan mode",
      summary: "Add revision editing and structured execution.",
      steps: [{
        id: "018f88d1-1eb5-709a-90ef-4325747e294e",
        title: "Persist revisions",
        detail: "Store a new immutable revision.",
        targets: ["packages/storage"],
        verification: ["Run storage tests"],
      }],
      assumptions: ["Approved revisions remain immutable."],
      sources: [{ path: "packages/storage/src/index.ts", operation: "read" }],
      parentRevisionId: null,
      createdFromMessageId: null,
      createdAt: "2026-08-17T00:00:00.000Z",
      approvedAt: null,
    } satisfies PlanRevision;

    expect(planRevisionMarkdown(plan)).toBe([
      "# Upgrade plan mode",
      "",
      "Add revision editing and structured execution.",
      "",
      "## Steps",
      "",
      "1. **Persist revisions**",
      "   Store a new immutable revision.",
      "   - Targets:",
      "     - packages/storage",
      "   - Verification:",
      "     - Run storage tests",
      "",
      "## Assumptions",
      "",
      "- Approved revisions remain immutable.",
      "",
      "## Sources",
      "",
      "- `packages/storage/src/index.ts` (read)",
      "",
    ].join("\n"));
  });

  it("reports field and step-level revision changes with a unified Markdown diff", () => {
    const taskId = "018f88d1-1eb5-709a-90ef-4325747e294c";
    const firstStepId = "018f88d1-1eb5-709a-90ef-4325747e294d";
    const removedStepId = "018f88d1-1eb5-709a-90ef-4325747e294e";
    const addedStepId = "018f88d1-1eb5-709a-90ef-4325747e294f";
    const base = {
      id: "018f88d1-1eb5-709a-90ef-4325747e2950",
      taskId,
      revision: 1,
      status: "superseded",
      title: "Initial plan",
      summary: "Initial summary.",
      steps: [
        {
          id: firstStepId,
          title: "Inspect",
          detail: "Inspect storage.",
          targets: ["packages/storage"],
          verification: ["Run tests"],
        },
        {
          id: removedStepId,
          title: "Remove me",
          detail: "This step will be removed.",
          targets: [],
          verification: [],
        },
      ],
      assumptions: ["One"],
      sources: [],
      parentRevisionId: null,
      createdFromMessageId: null,
      createdAt: "2026-08-17T00:00:00.000Z",
      approvedAt: null,
    } satisfies PlanRevision;
    const revision = {
      ...base,
      id: "018f88d1-1eb5-709a-90ef-4325747e2951",
      revision: 2,
      status: "proposed",
      title: "Revised plan",
      summary: "Revised summary.",
      assumptions: ["One", "Two"],
      parentRevisionId: base.id,
      steps: [
        {
          id: addedStepId,
          title: "Prepare",
          detail: "Prepare the migration.",
          targets: [],
          verification: [],
        },
        {
          ...base.steps[0]!,
          detail: "Inspect storage and protocol.",
          targets: ["packages/storage", "packages/protocol"],
          verification: ["Run tests", "Run typecheck"],
        },
      ],
    } satisfies PlanRevision;

    const diff = diffPlanRevisions(base, revision);
    expect(diff.fieldChanges.map(({ field }) => field)).toEqual(["title", "summary", "assumptions"]);
    expect(diff.stepChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: firstStepId,
        changes: ["moved", "changed"],
        fields: ["detail", "targets", "verification"],
      }),
      expect.objectContaining({ stepId: removedStepId, changes: ["removed"] }),
      expect.objectContaining({ stepId: addedStepId, changes: ["added"] }),
    ]));
    expect(diff.markdownDiff).toContain("--- plan-v1.md");
    expect(diff.markdownDiff).toContain("+++ plan-v2.md");
    expect(diff.markdownDiff).toContain("-# Initial plan");
    expect(diff.markdownDiff).toContain("+# Revised plan");
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
