const untitledSessionTitles = new Set(["new session", "new task"]);
const maxFallbackTitleLength = 48;

export function isUntitledSessionTitle(title: string): boolean {
  return untitledSessionTitles.has(title.trim().toLocaleLowerCase());
}

export function shouldGenerateFirstMessageTitle(input: {
  title: string;
  providerId: string | null;
  modelId: string | null;
}): boolean {
  return input.providerId !== null
    && input.modelId !== null
    && isUntitledSessionTitle(input.title);
}

function stripCommandPrefix(value: string): string {
  return value.trim().replace(/^\/(?:plan|goal)\b[\s:]*/i, "").trim();
}

function readableUrl(value: string): string {
  return value.replace(/https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/gi, "$1/$2")
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)(\/[^\s?#]*)?/gi, (_match, host: string, path = "") => (
      `${host}${path === "/" ? "" : path}`
    ));
}

function truncateTitle(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= maxFallbackTitleLength) return value;
  return `${characters.slice(0, maxFallbackTitleLength - 1).join("").trimEnd()}…`;
}

export function fallbackSessionTitle(
  prompt: string,
  preferredTitle?: string | null,
): string {
  const preferred = preferredTitle?.trim() ?? "";
  const source = preferred !== "" && !isUntitledSessionTitle(preferred)
    ? preferred
    : prompt;
  const normalized = readableUrl(stripCommandPrefix(source))
    .replace(/\s+/g, " ")
    .replace(/^["'`#\-\s]+|["'`#\-\s]+$/g, "")
    .trim();
  return normalized === "" ? "New session" : truncateTitle(normalized);
}
