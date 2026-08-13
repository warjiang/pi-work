import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Rectangle } from "electron";

const minimumWindowWidth = 860;
const minimumWindowHeight = 640;

function validRectangle(value: unknown): value is Rectangle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rectangle = value as Partial<Rectangle>;
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height]
    .every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function overlapArea(first: Rectangle, second: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

function fitToWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(Math.max(Math.round(bounds.width), minimumWindowWidth), workArea.width);
  const height = Math.min(Math.max(Math.round(bounds.height), minimumWindowHeight), workArea.height);
  return {
    x: Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

export function normalizeWindowBounds(
  bounds: Rectangle,
  workAreas: Rectangle[],
): Rectangle | undefined {
  if (!validRectangle(bounds) || bounds.width <= 0 || bounds.height <= 0 || workAreas.length === 0) {
    return undefined;
  }

  const matchingWorkArea = workAreas
    .map((workArea) => ({ workArea, overlap: overlapArea(bounds, workArea) }))
    .sort((first, second) => second.overlap - first.overlap)[0];

  if (matchingWorkArea !== undefined && matchingWorkArea.overlap > 0) {
    return fitToWorkArea(bounds, matchingWorkArea.workArea);
  }

  const primaryWorkArea = workAreas[0];
  if (primaryWorkArea === undefined) return undefined;
  const fitted = fitToWorkArea(bounds, primaryWorkArea);
  return {
    ...fitted,
    x: primaryWorkArea.x + Math.round((primaryWorkArea.width - fitted.width) / 2),
    y: primaryWorkArea.y + Math.round((primaryWorkArea.height - fitted.height) / 2),
  };
}

export function loadWindowBounds(path: string, workAreas: Rectangle[]): Rectangle | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return validRectangle(value) ? normalizeWindowBounds(value, workAreas) : undefined;
  } catch {
    return undefined;
  }
}

export function saveWindowBounds(path: string, bounds: Rectangle): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(bounds, null, 2)}\n`);
  renameSync(temporaryPath, path);
}
