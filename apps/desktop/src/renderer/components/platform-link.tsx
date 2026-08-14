import { BrandIcon, Icon, type BrandIconName } from "./ui/icon.js";

export type KnownPlatform = {
  id: "notion" | "figma" | "github" | "google-docs" | "google" | "slack";
  name: string;
  icon: BrandIconName;
};

export type KnownPlatformLink = {
  platform: KnownPlatform;
  url: string;
};

const platforms: Array<KnownPlatform & { matches(hostname: string): boolean }> = [
  { id: "notion", name: "Notion", icon: "notion", matches: (hostname) => hostname === "notion.so" || hostname.endsWith(".notion.so") || hostname === "notion.site" || hostname.endsWith(".notion.site") || hostname === "notion.com" || hostname.endsWith(".notion.com") },
  { id: "figma", name: "Figma", icon: "figma", matches: (hostname) => hostname === "figma.com" || hostname.endsWith(".figma.com") },
  { id: "github", name: "GitHub", icon: "github", matches: (hostname) => hostname === "github.com" || hostname.endsWith(".github.com") },
  { id: "google-docs", name: "Google Docs", icon: "google-docs", matches: (hostname) => hostname === "docs.google.com" },
  { id: "google", name: "Google Drive", icon: "google", matches: (hostname) => hostname === "drive.google.com" },
  { id: "slack", name: "Slack", icon: "slack", matches: (hostname) => hostname.endsWith(".slack.com") },
];

const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;

function trimmedUrl(value: string): string {
  return value.replace(/[),.;:!?]+$/, "");
}

export function knownPlatformLinks(content: string): KnownPlatformLink[] {
  const links = new Map<string, KnownPlatformLink>();
  for (const match of content.matchAll(urlPattern)) {
    const url = trimmedUrl(match[0]);
    try {
      const parsed = new URL(url);
      const platform = platforms.find((candidate) => candidate.matches(parsed.hostname.toLowerCase()));
      if (platform !== undefined) links.set(url, { platform, url });
    } catch {
      // Ignore incomplete URLs while the user is typing.
    }
  }
  return [...links.values()];
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function PlatformLinkCard(props: { link: KnownPlatformLink; appearance: "composer" | "message" }) {
  const content = <>
    <span className="platform-link-mark"><BrandIcon name={props.link.platform.icon} /></span>
    <span className="platform-link-copy">
      <strong>{props.link.platform.name}</strong>
      <span title={props.link.url}>{displayUrl(props.link.url)}</span>
    </span>
    {props.appearance === "message" ? <Icon name="external" /> : null}
  </>;
  if (props.appearance === "composer") return <div className="platform-link-card platform-link-card-composer">{content}</div>;
  return (
    <a
      className="platform-link-card platform-link-card-message"
      href={props.link.url}
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void window.piWork.system.openExternal(props.link.url);
      }}
    >
      {content}
    </a>
  );
}
