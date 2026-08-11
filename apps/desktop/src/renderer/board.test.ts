import { describe, expect, it } from "vitest";
import { taskStatuses } from "@pi-work/protocol";
import { boardColumns, sessionsForBoard, workspaceHasBoard } from "./board.js";

describe("board", () => {
  it("is available only for folder workspaces", () => {
    expect(workspaceHasBoard({ kind: "folder" })).toBe(true);
    expect(workspaceHasBoard({ kind: "managed" })).toBe(false);
    expect(workspaceHasBoard(null)).toBe(false);
  });

  it("shows only unarchived sessions in the current work folder", () => {
    const sessions = [
      { id: "current", workspaceId: "first", archived: false },
      { id: "archived", workspaceId: "first", archived: true },
      { id: "other", workspaceId: "second", archived: false },
    ];

    expect(sessionsForBoard(sessions, "first").map(({ id }) => id)).toEqual(["current"]);
  });

  it("maps every session status to one lane and a stable drop status", () => {
    expect(boardColumns.flatMap(({ statuses }) => statuses).sort()).toEqual([...taskStatuses].sort());
    expect(boardColumns.map(({ targetStatus }) => targetStatus)).toEqual([
      "draft",
      "running",
      "reviewing",
      "completed",
      "cancelled",
    ]);
  });
});
