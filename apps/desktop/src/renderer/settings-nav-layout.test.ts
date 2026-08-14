import { describe, expect, it } from "vitest";
import {
  defaultSettingsNavWidth,
  maximumSettingsNavWidth,
  minimumSettingsNavWidth,
  parseSettingsNavWidth,
} from "./settings-nav-layout.js";

describe("settings nav layout", () => {
  it("uses the default width when no valid stored value exists", () => {
    expect(parseSettingsNavWidth(null)).toBe(defaultSettingsNavWidth);
    expect(parseSettingsNavWidth("")).toBe(defaultSettingsNavWidth);
    expect(parseSettingsNavWidth("not-a-number")).toBe(defaultSettingsNavWidth);
  });

  it("clamps stored widths to the supported range", () => {
    expect(parseSettingsNavWidth("40")).toBe(minimumSettingsNavWidth);
    expect(parseSettingsNavWidth("200.6")).toBe(201);
    expect(parseSettingsNavWidth("900")).toBe(maximumSettingsNavWidth);
  });
});
