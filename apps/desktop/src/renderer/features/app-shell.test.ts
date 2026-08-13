import type { AppSettings, ModelCatalog, ModelOption, ProviderConfig } from "@pi-work/protocol";
import { describe, expect, it } from "vitest";
import {
  commandSettingItems,
  createNewSessionInput,
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

  it("creates a personal session with the resolved model configuration", () => {
    expect(createNewSessionInput(gpt, "medium")).toEqual({
      providerId: "openai",
      modelId: "gpt-5",
      thinkingLevel: "medium",
    });
  });
});

describe("command settings", () => {
  it("links each search result to its exact settings section", () => {
    expect(commandSettingItems.map(({ section }) => section)).toEqual([
      "general",
      "modelsCredentials",
      "workFolders",
      "permissions",
      "skills",
      "extensions",
      "browser",
      "about",
    ]);
  });
});

describe("workspace sidebar icons", () => {
  it("uses distinct semantic icons for workspace navigation", () => {
    expect(workspaceSidebarIcons).toMatchObject({
      inbox: "inbox",
      attention: "attention",
      completed: "check-circle",
      board: "folder-kanban",
      sources: "source",
      automations: "automation",
      folderSettings: "folder-settings",
      settings: "settings",
    });
  });
});
