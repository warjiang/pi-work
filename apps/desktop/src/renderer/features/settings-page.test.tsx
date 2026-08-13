import { renderToStaticMarkup } from "react-dom/server";
import type { AppSettings, BuildInfo, ModelCatalog, ProviderConfig } from "@pi-work/protocol";
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
};

const buildInfo: BuildInfo = {
  version: "0.1.0",
  branch: "feat/settings-shell",
  commit: "1234567890abcdef",
};

const providers: ProviderConfig[] = [{ providerId: "kimi-coding" }];
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

    expect(html).toContain("Available models");
    expect(html).toContain("Kimi K2.5");
    expect(html).toContain("Refresh models");
    expect(html).toContain("model-refresh-button");
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
});
