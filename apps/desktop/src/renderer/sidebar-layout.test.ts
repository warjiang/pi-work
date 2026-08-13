import { describe, expect, it } from "vitest";
import {
  defaultSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
  parseSidebarWidth,
} from "./sidebar-layout.js";

describe("sidebar layout", () => {
  it("uses the default width when no valid stored value exists", () => {
    expect(parseSidebarWidth(null)).toBe(defaultSidebarWidth);
    expect(parseSidebarWidth("not-a-number")).toBe(defaultSidebarWidth);
  });

  it("clamps stored widths to the supported desktop range", () => {
    expect(parseSidebarWidth("100")).toBe(minimumSidebarWidth);
    expect(parseSidebarWidth("320.4")).toBe(320);
    expect(parseSidebarWidth("900")).toBe(maximumSidebarWidth);
  });
});
