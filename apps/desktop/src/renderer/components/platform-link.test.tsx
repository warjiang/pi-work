import { describe, expect, it } from "vitest";
import { knownPlatformLinks } from "./platform-link.js";

describe("knownPlatformLinks", () => {
  it("recognizes supported platform URLs and removes trailing prose punctuation", () => {
    expect(knownPlatformLinks("Read https://app.notion.com/p/example. Then check https://github.com/pi-mono/pi-work.")).toEqual([
      expect.objectContaining({ platform: expect.objectContaining({ id: "notion" }), url: "https://app.notion.com/p/example" }),
      expect.objectContaining({ platform: expect.objectContaining({ id: "github" }), url: "https://github.com/pi-mono/pi-work" }),
    ]);
  });

  it("does not turn unrelated links into platform references", () => {
    expect(knownPlatformLinks("https://example.com/reference")).toEqual([]);
  });
});
