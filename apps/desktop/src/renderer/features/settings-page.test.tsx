import { renderToStaticMarkup } from "react-dom/server";
import type { AppSettings, BuildInfo, ModelCatalog, ProviderConfig, Workspace } from "@pi-work/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { translator } from "@/i18n.js";
import { BrowserPage } from "./browser-page.js";
import { settingsNavigationGroups, SettingsPage } from "./settings-page.js";

const settings: AppSettings = {
  onboardingSkipped: true,
  providerId: null,
  modelId: null,
  thinkingLevel: "off",
  theme: "system",
  language: "en",
  sidebarCollapsed: false,
  focusMode: false,
  compactMode: false,
  disabledModelKeys: [],
  modelTestResults: {},
};

const buildInfo: BuildInfo = {
  version: "0.1.0",
  branch: "feat/settings-shell",
  commit: "1234567890abcdef",
};

const providers: ProviderConfig[] = [{ providerId: "kimi-coding" }];
const workspace: Workspace = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Demo workspace",
  rootPath: "/tmp/demo",
  directories: ["/tmp/demo"],
  outputPath: "/tmp/demo/output",
  kind: "folder",
  createdAt: "2026-08-13T00:00:00.000Z",
};
const models: ModelCatalog = {
  diagnostics: [],
  models: [
    {
      providerId: "kimi-coding",
      providerName: "Kimi Coding",
      modelId: "kimi-k2.5",
      modelName: "Kimi K2.5",
      thinkingLevels: ["off"],
    },
  ],
};

describe("SettingsPage", () => {
  it("uses a distinct semantic icon for every settings navigation item", () => {
    const icons = Object.fromEntries(settingsNavigationGroups.flatMap((group) => group.sections.map((section) => [section.id, section.icon])));

    expect(icons).toMatchObject({
      general: "sliders",
      modelsCredentials: "models",
      workFolders: "workspace",
      permissions: "permissions",
      skills: "skills",
      mcp: "source",
      extensions: "extensions",
      browser: "browser",
      about: "info",
    });
    expect(icons).not.toHaveProperty("appearance");
    expect(icons).not.toHaveProperty("shortcuts");
  });

  it("renders grouped navigation and full build information", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        section="about"
        settings={settings}
        buildInfo={buildInfo}
        workspaces={[]}
        providers={[]}
        models={undefined}
        t={translator("en")}
        onSectionChange={() => undefined}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onAddWorkspace={async () => null}
        onAddWorkspaceDirectory={async () => null}
        onProvidersChanged={async () => undefined}
        onModelsRefresh={async () => undefined}
        onRestartOnboarding={async () => undefined}
      />,
    );

    expect(html).toContain("Workspace");
    expect(html).toContain("About");
    expect(html).toContain("Information");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('type="button"');
    expect(html).toContain("feat/settings-shell");
    expect(html).toContain("1234567890abcdef");
    expect(html).not.toContain("Turn ");
  });

  it("does not render a browser host before the user opens it", () => {
    const html = renderToStaticMarkup(<BrowserPage t={translator("en")} />);

    expect(html).toContain("Open browser");
    expect(html).not.toContain("browser-host");
  });

  it("lists the catalog models for each saved provider", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage
          section="modelsCredentials"
          settings={settings}
          buildInfo={buildInfo}
          workspaces={[]}
          providers={providers}
          models={models}
          t={translator("en")}
          onSectionChange={() => undefined}
          onClose={() => undefined}
          onUpdate={async () => undefined}
          onAddWorkspace={async () => null}
          onAddWorkspaceDirectory={async () => null}
          onProvidersChanged={async () => undefined}
          onModelsRefresh={async () => undefined}
          onRestartOnboarding={async () => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Model");
    expect(html).toContain("Kimi K2.5");
    expect(html).toContain("Refresh models");
    expect(html).toContain("model-refresh-button");
  });

  it("uses the provider alias and gives every model a real enable switch", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage
          section="modelsCredentials"
          settings={{
            ...settings,
            providerId: "newapi",
            modelId: "gpt-5",
            disabledModelKeys: ["newapi/gpt-5-mini"],
          }}
          buildInfo={buildInfo}
          workspaces={[]}
          providers={[{ providerId: "newapi" }]}
          models={{
            diagnostics: [],
            models: [
              { providerId: "newapi", providerName: "NewAPI (ida)", modelId: "gpt-5", modelName: "GPT-5", thinkingLevels: ["off"] },
              { providerId: "newapi", providerName: "NewAPI (ida)", modelId: "gpt-5-mini", modelName: "GPT-5 mini", thinkingLevels: ["off"] },
            ],
          }}
          t={translator("en")}
          onSectionChange={() => undefined}
          onClose={() => undefined}
          onUpdate={async () => undefined}
          onAddWorkspace={async () => null}
          onAddWorkspaceDirectory={async () => null}
          onProvidersChanged={async () => undefined}
          onModelsRefresh={async () => undefined}
          onRestartOnboarding={async () => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("ida · GPT-5");
    expect(html).not.toContain("NewAPI (ida) · GPT-5");
    expect(html).toContain('aria-label="Enabled: GPT-5"');
    expect(html).toContain('aria-label="Disabled: GPT-5 mini"');
  });

  it("renders the extension catalog and keeps manual installation available", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage
          section="extensions"
          settings={settings}
          buildInfo={buildInfo}
          workspaces={[]}
          providers={[]}
          models={undefined}
          t={translator("en")}
          onSectionChange={() => undefined}
          onClose={() => undefined}
          onUpdate={async () => undefined}
          onAddWorkspace={async () => null}
          onAddWorkspaceDirectory={async () => null}
          onProvidersChanged={async () => undefined}
          onModelsRefresh={async () => undefined}
          onRestartOnboarding={async () => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("MCP adapter");
    expect(html).toContain("Search extensions");
    expect(html).toContain("Install from source");
    expect(html).toContain("pi-mcp-adapter");
  });

  it("keeps global MCP configuration in settings", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage
          section="mcp"
          settings={settings}
          buildInfo={buildInfo}
          workspaces={[workspace]}
          providers={[]}
          models={undefined}
          t={translator("en")}
          onSectionChange={() => undefined}
          onClose={() => undefined}
          onUpdate={async () => undefined}
          onAddWorkspace={async () => null}
          onAddWorkspaceDirectory={async () => null}
          onProvidersChanged={async () => undefined}
          onModelsRefresh={async () => undefined}
          onRestartOnboarding={async () => undefined}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Connect and debug MCP servers available across Pi Work.");
    expect(html).toContain("Global servers are available to every Agent run when enabled.");
    expect(html).not.toContain("Demo workspace");
    expect(html).toContain("Add server");
  });
});
