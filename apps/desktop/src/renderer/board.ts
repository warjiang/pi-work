import type { Session, TaskStatus, Workspace } from "@pi-work/protocol";
import type { MessageKey } from "./i18n.js";

export const boardColumns: ReadonlyArray<{
  label: MessageKey;
  statuses: readonly TaskStatus[];
  targetStatus: TaskStatus;
}> = [
  { label: "backlog", statuses: ["draft", "planning", "awaiting_plan_approval"], targetStatus: "draft" },
  { label: "inProgress", statuses: ["running", "awaiting_action_approval"], targetStatus: "running" },
  { label: "review", statuses: ["reviewing"], targetStatus: "reviewing" },
  { label: "done", statuses: ["completed"], targetStatus: "completed" },
  { label: "closed", statuses: ["failed", "cancelled"], targetStatus: "cancelled" },
];

export function sessionsForBoard<T extends Pick<Session, "workspaceId" | "archived">>(
  sessions: T[],
  workspaceId: string,
): T[] {
  return sessions.filter((session) => session.workspaceId === workspaceId && !session.archived);
}

export function workspaceHasBoard(workspace: Pick<Workspace, "kind"> | null): boolean {
  return workspace?.kind === "folder";
}
