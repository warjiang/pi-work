export const defaultSettingsNavWidth = 184;
export const minimumSettingsNavWidth = 168;
export const maximumSettingsNavWidth = 340;
export const settingsNavWidthStorageKey = "pi-work:settings-nav-width";

export function clampSettingsNavWidth(value: number): number {
  if (!Number.isFinite(value)) return defaultSettingsNavWidth;
  return Math.min(maximumSettingsNavWidth, Math.max(minimumSettingsNavWidth, Math.round(value)));
}

export function parseSettingsNavWidth(value: string | null): number {
  if (value === null || value.trim() === "") return defaultSettingsNavWidth;
  return clampSettingsNavWidth(Number(value));
}
