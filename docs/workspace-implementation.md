# Workspace implementation

Pi Work treats a workspace as the top-level isolation boundary for configuration, authorized directories, workflow resources, boards, tasks, events, and conductor runs.

## Data model

- `workspaces` carries optimistic `version` and `updated_at` fields.
- `workspace_directories` stores canonical authorized paths. A canonical path belongs to only one folder workspace, and a workspace root cannot be removed.
- `boards` and `board_columns` define visual workflow layout independently from task workflow status.
- `task_board_state` is a projection of a task into a board and stores column, stable rank, and optimistic version.
- `workspace_events` is an append-only workspace event stream with integer sequence numbers.
- `conductor_runs` and `conductor_node_states` persist durable orchestration state.

Every command that mutates a workspace-owned entity carries `workspaceId`, and storage verifies ownership before applying the change.

## Workflow and boards

Workflow status and board placement are separate:

- A status describes business workflow and has an `open`, `active`, `review`, or `closed` category.
- A board column describes visual placement and may map a drop to a status through `dropStatusId`.
- Moving a card changes status only when the destination column explicitly configures `dropStatusId`.

Cards are task projections rather than duplicated task records. Every task appears on its workspace board.

Card moves run in one SQLite transaction. They support exact before/after placement, stable integer ranks, an idempotent `commandId`, and an `expectedVersion` concurrency check. Retrying the same command returns the recorded result.

## Durable conductor

A conductor run is a validated acyclic dependency graph. Nodes become ready after all dependencies complete, run up to `maxParallel`, and retry up to each node's `maxAttempts`.

Run and node state is persisted before and after execution. A SQLite lease ensures only one conductor owns a run. On process restart, interrupted running nodes are returned to ready state when retries remain; otherwise the run fails. Pause prevents new scheduling while allowing active nodes to persist their result. Stop cancels pending nodes and sends cancellation to active Agent execution sessions.

Each node attempt receives a fresh execution session ID, so retries and separate runs cannot collide even when their graph node IDs are reused.

## Compatibility and migration

Startup migrations add workspace versions, directory records, boards, events, and conductor tables. Legacy project tasks remain in their workspace, while project tables, project boards, and project-specific projections are removed. Legacy text event sequences are rebuilt as integers so ordering remains numeric beyond sequence 9.

Existing folder workspaces receive a default workspace board and their root directory is backfilled into `workspace_directories`.

## Desktop API

The preload bridge exposes:

- `workspace`: get, update, choose/list/add/remove directories
- `board`: list, snapshot, manage columns, move cards
- `conductor`: list, get, create, inspect nodes, start, pause, resume, stop

The renderer includes workspace editing for its name, artifact output, and source folders; configurable board columns and status-on-drop behavior; precise card ordering; and a task-level orchestration inspector.
