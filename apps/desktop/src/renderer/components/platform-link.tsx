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

export type KnownPlatformLinkMatch = KnownPlatformLink & {
  start: number;
  end: number;
};

export type PlatformLinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: KnownPlatformLink };

const platforms: Array<KnownPlatform & { matches(hostname: string): boolean }> = [
  { id: "notion", name: "Notion", icon: "notion", matches: (hostname) => hostname === "notion.so" || hostname.endsWith(".notion.so") || hostname === "notion.site" || hostname.endsWith(".notion.site") || hostname === "notion.com" || hostname.endsWith(".notion.com") },
  { id: "figma", name: "Figma", icon: "figma", matches: (hostname) => hostname === "figma.com" || hostname.endsWith(".figma.com") },
  { id: "github", name: "GitHub", icon: "github", matches: (hostname) => hostname === "github.com" || hostname.endsWith(".github.com") },
  { id: "google-docs", name: "Google Docs", icon: "google-docs", matches: (hostname) => hostname === "docs.google.com" },
  { id: "google", name: "Google Drive", icon: "google", matches: (hostname) => hostname === "drive.google.com" },
  { id: "slack", name: "Slack", icon: "slack", matches: (hostname) => hostname.endsWith(".slack.com") },
];

const urlPattern = /https?:\/\/[^\s<>"'`，。！？；：、（）【】《》]+/gi;

function trimmedUrl(value: string): string {
  return value.replace(/[),.;:!?]+$/, "");
}

export function knownPlatformLinkMatches(content: string): KnownPlatformLinkMatch[] {
  const links: KnownPlatformLinkMatch[] = [];
  for (const match of content.matchAll(urlPattern)) {
    const url = trimmedUrl(match[0]);
    try {
      const parsed = new URL(url);
      const platform = platforms.find((candidate) => candidate.matches(parsed.hostname.toLowerCase()));
      if (platform !== undefined && match.index !== undefined) {
        links.push({
          platform,
          url,
          start: match.index,
          end: match.index + url.length,
        });
      }
    } catch {
      // Ignore incomplete URLs while the user is typing.
    }
  }
  return links;
}

export function knownPlatformById(id: KnownPlatform["id"]): KnownPlatform | undefined {
  return platforms.find((platform) => platform.id === id);
}

export function knownPlatformLinks(content: string): KnownPlatformLink[] {
  const links = new Map<string, KnownPlatformLink>();
  for (const { platform, url } of knownPlatformLinkMatches(content)) {
    links.set(url, { platform, url });
  }
  return [...links.values()];
}

export function platformLinkSegments(content: string, editableOffset?: number): PlatformLinkSegment[] {
  const segments: PlatformLinkSegment[] = [];
  let cursor = 0;
  const pushText = (value: string) => {
    if (value === "") return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.value += value;
    else segments.push({ type: "text", value });
  };

  for (const { platform, url, start, end } of knownPlatformLinkMatches(content)) {
    if (start > cursor) pushText(content.slice(cursor, start));
    if (editableOffset !== undefined && editableOffset >= start && editableOffset <= end) {
      pushText(content.slice(start, end));
    } else {
      segments.push({ type: "link", value: { platform, url } });
    }
    cursor = end;
  }
  if (cursor < content.length) pushText(content.slice(cursor));
  return segments;
}

export function displayPlatformUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function PlatformLinkCard(props: { link: KnownPlatformLink; appearance: "editor" | "message" }) {
  const content = <>
    <span className="platform-link-mark"><BrandIcon name={props.link.platform.icon} /></span>
    <span className="platform-link-copy">
      <strong>{props.link.platform.name}</strong>
      <span title={props.link.url}>{displayPlatformUrl(props.link.url)}</span>
    </span>
    {props.appearance === "message" ? <Icon name="external" /> : null}
  </>;
  if (props.appearance === "editor") {
    return (
      <span
        className="platform-link-card platform-link-card-editor"
        contentEditable={false}
        data-platform-url={props.link.url}
      >
        {content}
      </span>
    );
  }
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
