import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererRoot = new URL(".", import.meta.url);

async function rendererSource(path: string): Promise<string> {
  return readFile(new URL(path, rendererRoot), "utf8");
}

describe("DESIGN.md visual system", () => {
  it("ships the documented Inter fallback and Vercel-inspired light-theme tokens", async () => {
    const styles = await rendererSource("styles.css");

    expect(styles).toContain('url("./assets/InterVariable.woff2")');
    expect(styles).toContain("--primary: #171717;");
    expect(styles).toContain("--ink: #171717;");
    expect(styles).toContain("--body: #4d4d4d;");
    expect(styles).toContain("--background: #fafafa;");
    expect(styles).toContain("--surface: #ffffff;");
    expect(styles).toContain("--link: #0070f3;");
    expect(styles).toContain("--border: #ebebeb;");
    expect(styles).toContain("--accent: var(--primary);");
    expect(styles).toContain("--radius-control: 0.375rem;");
    expect(styles).toContain("--radius-surface: 0.75rem;");
  });

  it("keeps dark and system theme tokens with visible Vercel Blue focus chrome", async () => {
    const styles = await rendererSource("styles.css");

    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain(":root[data-theme=\"system\"]");
    expect(styles).toContain("--link: #3291ff;");
    expect(styles).toContain("--ring: var(--link);");
    expect(styles).toMatch(/:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--ring\)/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("uses the shared primitives for compact desktop control sizing", async () => {
    const [styles, button, input, select, tabs, toggle, switchControl] = await Promise.all([
      rendererSource("styles.css"),
      rendererSource("components/ui/button.tsx"),
      rendererSource("components/ui/input.tsx"),
      rendererSource("components/ui/select.tsx"),
      rendererSource("components/ui/tabs.tsx"),
      rendererSource("components/ui/toggle.tsx"),
      rendererSource("components/ui/switch.tsx"),
    ]);

    expect(button).toContain('compact: "h-8 px-2.5"');
    expect(button).toContain('default: "h-8 px-3"');
    expect(button).toContain('prominent: "h-9 px-4 text-sm"');
    expect(input).toContain("h-8 w-full");
    expect(select).toContain("flex h-8");
    expect(tabs).toContain("rounded-[var(--radius-control)] border border-border");
    expect(tabs).not.toContain("rounded-full");
    expect(toggle).toContain("inline-flex h-8");
    expect(switchControl).toContain("inline-flex h-8 w-10");
    expect(styles).toContain("--density-control: 32px;");
    expect(styles).toContain("--density-bar: 44px;");
    expect(styles).toMatch(/\.composer \.composer-input \{[\s\S]*min-height:\s*36px;/);
    expect(styles).toMatch(/\.settings-content-inner \{[\s\S]*padding:\s*14px clamp\(16px, 3vw, 36px\) 24px;/);
  });

  it("gives composite editors one focus owner and keeps them in the tab order", async () => {
    const [styles, editor, workbench] = await Promise.all([
      rendererSource("styles.css"),
      rendererSource("components/composer-editor.tsx"),
      rendererSource("features/task-workbench.tsx"),
    ]);

    expect(editor.match(/tabIndex=\{0\}/g)).toHaveLength(2);
    expect(styles).toContain(".composer .composer-editor-content:focus-visible");
    expect(styles).toContain(".message-editor .composer-editor-content:focus-visible");
    expect(styles).toContain(".composer:has(.composer-editor-content:focus)");
    expect(styles).toContain(".message-editor:has(.composer-editor-content:focus)");
    expect(styles).not.toMatch(/\.composer:focus-within\s*\{[\s\S]*var\(--process-blue\)/);
    expect(styles).toContain(".skill-manager-page .library-search input:focus-visible");
    expect(styles).toMatch(/\.message\.user > \.message-user-content \{[\s\S]*text-align:\s*start;/);
    expect(workbench).toContain('aria-label={t("editMessage")}');
  });

  it("avoids decorative gradient text and continuous pulsing status dots", async () => {
    const styles = await rendererSource("styles.css");

    expect(styles).not.toMatch(/background-clip:\s*text/);
    expect(styles).not.toMatch(/animation:\s*pulse-dot[^;]*infinite/);
  });
});
