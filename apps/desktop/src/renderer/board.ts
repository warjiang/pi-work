import type { Session, StatusDefinition, Workspace } from "@pi-work/protocol";

export function sessionsByStage<T extends Pick<Session, "statusId">>(
  sessions: T[],
  status: Pick<StatusDefinition, "id"> | null,
  knownStatuses: ReadonlyArray<Pick<StatusDefinition, "id">> = [],
): T[] {
  if (status !== null) {
    return sessions.filter((session) => session.statusId === status.id);
  }
  const knownStatusIds = new Set(knownStatuses.map(({ id }) => id));
  return sessions.filter((session) => (
    session.statusId === null
    || (knownStatusIds.size > 0 && !knownStatusIds.has(session.statusId))
  ));
}

export function sessionsForBoard<T extends Pick<Session, "workspaceId" | "archived">>(
  sessions: T[],
  workspaceId: string,
): T[] {
  return sessions.filter((session) => session.workspaceId === workspaceId && !session.archived);
}

export function workspaceHasBoard(workspace: Pick<Workspace, "kind"> | null): boolean {
  return workspace?.kind === "folder";
}
