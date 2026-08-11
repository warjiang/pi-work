import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const appSource = new URL("./app.tsx", import.meta.url);

describe("renderer component primitives", () => {
  it("keeps native interactive elements behind shadcn components", async () => {
    const source = await readFile(appSource, "utf8");

    expect(source).not.toMatch(/<(button|input|select|textarea|dialog|details|summary|progress)(\s|>|\/)/);
    expect(source).not.toMatch(/window\.(alert|confirm|prompt)\s*\(/);
    expect(source).not.toMatch(/role="(button|dialog|menu|menuitem|switch|checkbox|radio|tab|combobox|listbox)"/);
  });
});
