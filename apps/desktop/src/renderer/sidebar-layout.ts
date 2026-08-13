export const defaultSidebarWidth = 264;
export const minimumSidebarWidth = 220;
export const maximumSidebarWidth = 420;
export const sidebarWidthStorageKey = "pi-work:sidebar-width";

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return defaultSidebarWidth;
  return Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, Math.round(value)));
}

export function parseSidebarWidth(value: string | null): number {
  if (value === null || value.trim() === "") return defaultSidebarWidth;
  return clampSidebarWidth(Number(value));
}
