import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWindowBounds, normalizeWindowBounds, saveWindowBounds } from "./window-state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("window state", () => {
  it("persists and restores window bounds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-window-state-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "window-state.json");
    const bounds = { x: 120, y: 80, width: 1280, height: 800 };

    saveWindowBounds(path, bounds);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(bounds);
    expect(loadWindowBounds(path, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toEqual(bounds);
  });

  it("ignores missing or malformed state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-work-window-state-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "window-state.json");
    expect(loadWindowBounds(path, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toBeUndefined();

    await writeFile(path, "{\"width\":\"large\"}");

    expect(loadWindowBounds(path, [{ x: 0, y: 0, width: 1920, height: 1080 }])).toBeUndefined();
  });

  it("moves an off-screen window onto the primary display", () => {
    expect(normalizeWindowBounds(
      { x: 3000, y: 2000, width: 1200, height: 800 },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
    )).toEqual({ x: 360, y: 140, width: 1200, height: 800 });
  });

  it("keeps the window fully inside its current display", () => {
    expect(normalizeWindowBounds(
      { x: 1700, y: 900, width: 1200, height: 800 },
      [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 2560, height: 1440 },
      ],
    )).toEqual({ x: 1920, y: 640, width: 1200, height: 800 });
  });
});
