import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererRoot = new URL(".", import.meta.url);

async function rendererSource(path: string): Promise<string> {
  return readFile(new URL(path, rendererRoot), "utf8");
}

describe("DESIGN.md visual system", () => {
  it("ships Inter locally and applies the documented light-theme tokens", async () => {
    const styles = await rendererSource("styles.css");

    expect(styles).toContain('url("./assets/InterVariable.woff2")');
    expect(styles).toContain("--bg: #ffffff;");
    expect(styles).toContain("--accent: #111111;");
    expect(styles).toContain("--panel-muted: #f5f5f5;");
    expect(styles).toContain("--radius-control: 0.5rem;");
    expect(styles).toContain("--radius-surface: 0.75rem;");
  });

  it("keeps dark and system theme tokens while suppressing focus chrome", async () => {
    const styles = await rendererSource("styles.css");

    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain(":root[data-theme=\"system\"]");
    expect(styles).toMatch(/:focus-visible\s*\{[\s\S]*outline:\s*none/);
    expect(styles).not.toMatch(/outline:\s*2px solid var\(--ring\)/);
  });

  it("uses the shared primitives for the Cal-style control sizing", async () => {
    const [button, input, select, tabs] = await Promise.all([
      rendererSource("components/ui/button.tsx"),
      rendererSource("components/ui/input.tsx"),
      rendererSource("components/ui/select.tsx"),
      rendererSource("components/ui/tabs.tsx"),
    ]);

    expect(button).toContain('default: "h-10 px-5"');
    expect(input).toContain("h-10 w-full");
    expect(select).toContain("flex h-10");
    expect(tabs).toContain("rounded-full bg-secondary p-1");
  });
});
