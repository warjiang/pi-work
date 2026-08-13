import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage, safeMarkdownUrl } from "./components/markdown-message.js";

function render(content: string, streaming = false, compact = false): string {
  return renderToStaticMarkup(
    <MarkdownMessage
      content={content}
      copyLabel="Copy code"
      copiedLabel="Copied"
      streaming={streaming}
      compact={compact}
    />,
  );
}

describe("MarkdownMessage", () => {
  it("renders GFM and highlighted code consistently", () => {
    const html = render([
      "# Result",
      "",
      "- [x] streamed",
      "",
      "| Item | State |",
      "| --- | --- |",
      "| Markdown | ready |",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n"));

    expect(html).toContain("<h1>Result</h1>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("language-ts");
    expect(html).toContain("hljs");
    expect(html).toContain('aria-label="Copy code"');
  });

  it("renders an unfinished fenced block during streaming", () => {
    const html = render("```ts\nconst partial = true;", true);

    expect(html).toContain("markdown-message-streaming");
    expect(html).toContain("language-ts");
    expect(html).toContain("const");
  });

  it("renders compact markdown without nested interactive controls", () => {
    const html = render([
      "## Summary",
      "",
      "- First item",
      "- [docs](https://example.com/docs)",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n"), false, true);

    expect(html).toContain("markdown-message-compact");
    expect(html).toContain("<h2>Summary</h2>");
    expect(html).toContain("<li>First item</li>");
    expect(html).toContain("markdown-preview-code");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a");
  });

  it("preserves unordered, ordered, and nested list semantics", () => {
    const html = render([
      "- First",
      "  - Nested",
      "",
      "1. One",
      "2. Two",
    ].join("\n"));

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>First");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Nested</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<li>Two</li>");
  });

  it("removes raw HTML and disables unsafe or relative links", () => {
    const html = render([
      "<script>globalThis.compromised = true</script>",
      "",
      "[unsafe](javascript:alert(1))",
      "[local](/workspace/file)",
      "[safe](https://example.com/docs)",
    ].join("\n"));

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="/workspace/file"');
    expect(html).toContain('href="https://example.com/docs"');
  });

  it("accepts only absolute HTTP and HTTPS URLs", () => {
    expect(safeMarkdownUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeMarkdownUrl("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(safeMarkdownUrl("file:///tmp/a")).toBeNull();
    expect(safeMarkdownUrl("/relative")).toBeNull();
  });
});
