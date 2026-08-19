import type { AppSettings, ModelCatalog, ModelOption, ProviderConfig, Session } from "@pi-work/protocol";
import { describe, expect, it } from "vitest";
import {
  commandSettingItems,
  createNewFolderTaskInput,
  createNewSessionInput,
  mergeSessionSnapshot,
  recentSessions,
  resolveDefaultModel,
  resolveDefaultThinkingLevel,
  workspaceSidebarIcons,
} from "./app-shell.js";

const providers: ProviderConfig[] = [
  { providerId: "anthropic" },
  { providerId: "openai" },
];

const claude: ModelOption = {
  providerId: "anthropic",
  providerName: "Anthropic",
  modelId: "claude-sonnet",
  modelName: "Claude Sonnet",
  thinkingLevels: ["off", "low", "high"],
};

const gpt: ModelOption = {
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5",
  modelName: "GPT-5",
  thinkingLevels: ["off", "medium"],
};

const models: ModelCatalog = {
  models: [claude, gpt],
  diagnostics: [],
};

const settings: AppSettings = {
  onboardingSkipped: true,
  providerId: "openai",
  modelId: "gpt-5",
  thinkingLevel: "medium",
  theme: "system",
  language: "en",
  sidebarCollapsed: false,
  focusMode: false,
  compactMode: false,
  disabledModelKeys: [],
  modelTestResults: {},
};

describe("new session defaults", () => {
  it("uses the configured default model and its compatible thinking level", () => {
    const model = resolveDefaultModel(providers, models, settings);

    expect(model).toEqual(gpt);
    expect(resolveDefaultThinkingLevel(model, settings)).toBe("medium");
  });

  it("falls back to the first available configured-provider model", () => {
    const unavailableSettings = {
      ...settings,
      providerId: "missing",
      modelId: "not-configured",
      thinkingLevel: "max" as const,
    };
    const model = resolveDefaultModel(providers, { ...models, models: [gpt, claude] }, unavailableSettings);

    expect(model).toEqual(claude);
    expect(resolveDefaultThinkingLevel(model, unavailableSettings)).toBe("off");
  });

  it("returns no model when there are no configured-provider models", () => {
    expect(resolveDefaultModel([], models, settings)).toBeUndefined();
    expect(resolveDefaultModel(providers, undefined, settings)).toBeUndefined();
  });

  it("excludes disabled models from default selection", () => {
    const model = resolveDefaultModel(providers, models, {
      ...settings,
      disabledModelKeys: ["openai/gpt-5"],
    });

    expect(model).toEqual(claude);
  });

  it("creates a personal session with the resolved model configuration", () => {
    expect(createNewSessionInput(gpt, "medium")).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      thinkingLevel: "medium",
    });
  });

  it("creates a blank folder session directly in Plan mode", () => {
    const workspace = {
      id: "018f88d1-1eb5-709a-90ef-4325747e294c",
      name: "Product",
      rootPath: "/workspace/product",
    } as Parameters<typeof createNewFolderTaskInput>[0];

    expect(createNewFolderTaskInput(workspace, gpt, "medium")).toEqual({
      workspaceId: workspace.id,
      title: "New session",
      goal: "New session",
      kind: "task",
      providerId: "openai",
      modelId: "gpt-5",
      thinkingLevel: "medium",
      permissionMode: "ask",
      planMode: true,
      executionMode: "plan",
      workingDirectory: "/workspace/product",
    });
  });

  it("merges a completed session snapshot into the cached session list", () => {
    const running = {
      id: "task-a",
      running: true,
      title: "Running",
    } as Session;
    const completed = {
      ...running,
      running: false,
      title: "Completed",
    };

    expect(mergeSessionSnapshot([running], completed)).toEqual([completed]);
  });
});

describe("command settings", () => {
  it("links each search result to its exact settings section", () => {
    expect(commandSettingItems.map(({ section }) => section)).toEqual([
      "general",
      "preferences",
      "modelsCredentials",
      "permissions",
      "skills",
      "mcp",
      "extensions",
      "browser",
      "about",
    ]);
  });
});

describe("workspace sidebar icons", () => {
  it("uses distinct semantic icons for workspace navigation", () => {
    expect(workspaceSidebarIcons).toMatchObject({
      board: "folder-kanban",
      sources: "source",
      automations: "automation",
      settings: "settings",
    });
    expect(workspaceSidebarIcons).not.toHaveProperty("inbox");
    expect(workspaceSidebarIcons).not.toHaveProperty("attention");
    expect(workspaceSidebarIcons).not.toHaveProperty("completed");
  });

  it("keeps at most eight unique unarchived recent sessions", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      id: `task-${index}`,
      archived: index === 8,
    })) as unknown as Session[];
    sessions.splice(2, 0, sessions[0]!);

    expect(recentSessions(sessions).map(({ id }) => id)).toEqual([
      "task-0",
      "task-1",
      "task-2",
      "task-3",
      "task-4",
      "task-5",
      "task-6",
      "task-7",
    ]);
  });
});
