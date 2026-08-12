import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button } from "./ui/button.js";
import { Icon } from "./ui/icon.js";

type MarkdownMessageProps = {
  content: string;
  copyLabel: string;
  copiedLabel: string;
  streaming?: boolean;
  compact?: boolean;
};

export function safeMarkdownUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MarkdownMessage({
  content,
  copyLabel,
  copiedLabel,
  streaming = false,
  compact = false,
}: MarkdownMessageProps) {
  const classes = [
    "markdown-message",
    streaming ? "markdown-message-streaming" : "",
    compact ? "markdown-message-compact" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <ReactMarkdown
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => safeMarkdownUrl(url) ?? ""}
        components={{
          a: ({ href, children, ...props }) => {
            if (compact) return <span>{children}</span>;
            const externalUrl = safeMarkdownUrl(href);
            if (externalUrl === null) return <span>{children}</span>;
            return (
              <a
                {...props}
                href={externalUrl}
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void window.piWork.system.openExternal(externalUrl);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span>{alt ?? ""}</span>,
          pre: ({ children }) => compact
            ? <pre className="markdown-preview-code">{children}</pre>
            : (
                <CodeBlock copyLabel={copyLabel} copiedLabel={copiedLabel}>
                  {children}
                </CodeBlock>
              ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  children,
  copyLabel,
  copiedLabel,
}: {
  children: ReactNode;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const code = textContent(children).replace(/\n$/, "");
  const language = codeLanguage(children);

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span>{language ?? "text"}</span>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={copied ? copiedLabel : copyLabel}
          title={copied ? copiedLabel : copyLabel}
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_500);
            });
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </Button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function codeLanguage(children: ReactNode): string | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string }>(child)) return null;
  return child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? null;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}
