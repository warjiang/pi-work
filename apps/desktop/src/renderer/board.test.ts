import { describe, expect, it } from "vitest";
import { sessionsByStage, sessionsForBoard, workspaceHasBoard } from "./board.js";

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

  it("groups tasks by user stage without reading lifecycle status", () => {
    const sessions = [
      { id: "first", statusId: "doing", status: "awaiting_plan_approval" },
      { id: "second", statusId: null, status: "completed" },
      { id: "legacy", statusId: "removed", status: "running" },
    ];
    const statuses = [{ id: "doing" }];
    expect(sessionsByStage(sessions, statuses[0]!, statuses).map(({ id }) => id)).toEqual(["first"]);
    expect(sessionsByStage(sessions, null, statuses).map(({ id }) => id)).toEqual(["second", "legacy"]);
  });
});
