import { describe, expect, it } from "vitest";
import { fallbackSessionTitle, isUntitledSessionTitle, shouldGenerateFirstMessageTitle } from "./session-title.js";

describe("session title helpers", () => {
  it("recognizes current and legacy untitled names", () => {
    expect(isUntitledSessionTitle("New session")).toBe(true);
    expect(isUntitledSessionTitle(" new TASK ")).toBe(true);
    expect(isUntitledSessionTitle("Research session")).toBe(false);
  });

  it("uses a preferred result title when available", () => {
    expect(fallbackSessionTitle("research this repository", "Apache OSSIE 快速入门")).toBe(
      "Apache OSSIE 快速入门",
    );
  });

  it("removes conversation commands and normalizes whitespace", () => {
    expect(fallbackSessionTitle(" /plan   调研   Apache OSSIE\n并生成入门文档 ")).toBe(
      "调研 Apache OSSIE 并生成入门文档",
    );
  });

  it("makes GitHub URLs readable", () => {
    expect(fallbackSessionTitle("调研 https://github.com/apache/ossie")).toBe(
      "调研 apache/ossie",
    );
  });

  it("truncates long fallback titles without splitting unicode characters", () => {
    const title = fallbackSessionTitle("😀".repeat(60));
    expect(Array.from(title)).toHaveLength(48);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to the default placeholder for empty input", () => {
    expect(fallbackSessionTitle("   ")).toBe("New session");
  });

  it("generates a first-message title only for untitled, model-ready sessions", () => {
    expect(shouldGenerateFirstMessageTitle({
      title: "New session",
      providerId: "openai",
      modelId: "gpt-4o",
    })).toBe(true);
    // Already named — leave the user's/model's title alone.
    expect(shouldGenerateFirstMessageTitle({
      title: "Apache OSSIE 快速入门",
      providerId: "openai",
      modelId: "gpt-4o",
    })).toBe(false);
    // No model configured yet — nothing to call.
    expect(shouldGenerateFirstMessageTitle({
      title: "New session",
      providerId: null,
      modelId: "gpt-4o",
    })).toBe(false);
    expect(shouldGenerateFirstMessageTitle({
      title: "New session",
      providerId: "openai",
      modelId: null,
    })).toBe(false);
  });
});
