import { describe, expect, it } from "vitest";
import {
  knownPlatformLinkMatches,
  knownPlatformLinks,
  platformLinkSegments,
} from "./platform-link.js";

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

  it("recognizes every platform supported by inline editor tokens", () => {
    const links = knownPlatformLinks([
      "https://www.figma.com/file/123",
      "https://docs.google.com/document/d/123",
      "https://drive.google.com/file/d/123",
      "https://workspace.slack.com/archives/123",
    ].join(" "));

    expect(links.map(({ platform }) => platform.id)).toEqual([
      "figma",
      "google-docs",
      "google",
      "slack",
    ]);
  });

  it("keeps surrounding prose and repeated links in source order", () => {
    const content = "调研 https://github.com/apache/ossie，再对比 https://github.com/apache/ossie";

    expect(platformLinkSegments(content)).toEqual([
      { type: "text", value: "调研 " },
      {
        type: "link",
        value: expect.objectContaining({
          platform: expect.objectContaining({ id: "github" }),
          url: "https://github.com/apache/ossie",
        }),
      },
      { type: "text", value: "，再对比 " },
      {
        type: "link",
        value: expect.objectContaining({
          platform: expect.objectContaining({ id: "github" }),
          url: "https://github.com/apache/ossie",
        }),
      },
    ]);
  });

  it("keeps the link under the caret editable until the caret leaves it", () => {
    const content = "调研 https://github.com/apache/ossie";

    expect(platformLinkSegments(content, content.length)).toEqual([
      { type: "text", value: content },
    ]);
    expect(platformLinkSegments(`${content} `, content.length + 1)).toEqual([
      { type: "text", value: "调研 " },
      {
        type: "link",
        value: expect.objectContaining({ url: "https://github.com/apache/ossie" }),
      },
      { type: "text", value: " " },
    ]);
  });

  it("keeps unsupported URLs as ordinary text between platform links", () => {
    const content = "https://example.com then https://www.figma.com/file/123";

    expect(platformLinkSegments(content)).toEqual([
      { type: "text", value: "https://example.com then " },
      {
        type: "link",
        value: expect.objectContaining({
          platform: expect.objectContaining({ id: "figma" }),
          url: "https://www.figma.com/file/123",
        }),
      },
    ]);
  });

  it("returns stable source offsets and preserves encoded paths and query strings", () => {
    const url = "https://github.com/larksuite/channel-sdk-node%E5%BB%BA%E8%AE%AE?tab=readme";
    const content = `前缀 ${url}，后缀`;

    expect(knownPlatformLinkMatches(content)).toEqual([
      expect.objectContaining({
        start: 3,
        end: 3 + url.length,
        url,
      }),
    ]);
  });
});
