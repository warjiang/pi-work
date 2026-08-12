import { describe, expect, it } from "vitest";
import { isCatalogExtensionInstalled, normalizeExtensionSource } from "./extension-catalog.js";

describe("extension catalog source matching", () => {
  it.each([
    ["npm:pi-web-access", "npm:pi-web-access"],
    ["npm:pi-web-access@1.4.2", "npm:pi-web-access"],
    ["npm:@scope/package", "npm:@scope/package"],
    ["npm:@scope/package@2.0.0", "npm:@scope/package"],
    ["/absolute/local-extension", "/absolute/local-extension"],
  ])("normalizes %s", (source, expected) => {
    expect(normalizeExtensionSource(source)).toBe(expected);
  });

  it("matches an installed npm package even when its version is pinned", () => {
    expect(isCatalogExtensionInstalled("npm:@scope/package", [
      "npm:other-package",
      "npm:@scope/package@2.0.0",
    ])).toBe(true);
  });

  it("does not treat a local path as an npm package", () => {
    expect(isCatalogExtensionInstalled("npm:pi-web-access", [
      "/absolute/path/to/pi-web-access",
    ])).toBe(false);
  });
});
