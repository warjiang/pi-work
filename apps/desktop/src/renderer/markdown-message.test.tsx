import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage, safeMarkdownUrl } from "./components/markdown-message.js";

function render(content: string, streaming = false): string {
  return renderToStaticMarkup(
    <MarkdownMessage
      content={content}
      copyLabel="Copy code"
      copiedLabel="Copied"
      streaming={streaming}
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
