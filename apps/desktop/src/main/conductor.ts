import { randomUUID } from "node:crypto";
import type { ConductorNode, ConductorNodeState, ConductorRun } from "@pi-work/protocol";
import type { PiWorkStore } from "@pi-work/storage";

export type ConductorNodeExecutor = (
  run: ConductorRun,
  node: ConductorNode,
  dependencies: ConductorNodeState[],
  executionId: string,
) => Promise<string>;

export class DurableConductor {
  private readonly owner = randomUUID();
  private readonly active = new Map<string, Set<string>>();
  private readonly executionIds = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    private readonly store: PiWorkStore,
    private readonly execute: ConductorNodeExecutor,
    private readonly cancelExecution?: (executionId: string) => Promise<void>,
  ) {}

  recover(): void {
    for (const workspace of this.store.listWorkspaces()) {
      if (workspace.kind !== "folder") continue;
      for (const run of this.store.listConductorRuns(workspace.id)) {
        if (run.status === "pending" || run.status === "running") this.schedule(run.workspaceId, run.id);
      }
    }
  }

  start(workspaceId: string, runId: string): ConductorRun {
    const run = this.store.updateConductorRunStatus(workspaceId, runId, "running");
    this.schedule(workspaceId, runId, 0);
    return run;
  }

  pause(workspaceId: string, runId: string): ConductorRun {
    this.clearTimer(runId);
    return this.store.updateConductorRunStatus(workspaceId, runId, "paused");
  }

  resume(workspaceId: string, runId: string): ConductorRun {
    return this.start(workspaceId, runId);
  }

  stop(workspaceId: string, runId: string): ConductorRun {
    this.clearTimer(runId);
    const run = this.store.updateConductorRunStatus(workspaceId, runId, "cancelled");
    for (const state of this.store.listConductorNodeStates(workspaceId, runId)) {
      const executionId = this.executionIds.get(executionKey(runId, state.nodeId));
      if (state.status === "running" && executionId !== undefined) {
        void this.cancelExecution?.(executionId).catch(() => undefined);
      }
      if (state.status === "pending" || state.status === "ready") {
        this.store.updateConductorNodeState(workspaceId, runId, state.nodeId, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
        });
      }
    }
    return run;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private clearTimer(runId: string): void {
    const timer = this.timers.get(runId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(runId);
  }

  private schedule(workspaceId: string, runId: string, delay = 250): void {
    if (this.disposed) return;
    const pending = this.timers.get(runId);
    if (pending !== undefined) {
      if (delay > 0) return;
      this.clearTimer(runId);
    }
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      void this.pump(workspaceId, runId);
    }, delay);
    this.timers.set(runId, timer);
  }

  private async pump(workspaceId: string, runId: string): Promise<void> {
    if (this.disposed) return;
    const current = this.store.getConductorRun(workspaceId, runId);
    if (current === null || current.status === "paused" || isTerminal(current.status)) return;
    let run: ConductorRun;
    try {
      run = this.store.claimConductorRun(workspaceId, runId, this.owner, 30_000);
    } catch {
      this.schedule(workspaceId, runId, 1_000);
      return;
    }

    const active = this.active.get(runId) ?? new Set<string>();
    this.active.set(runId, active);
    const states = this.store.listConductorNodeStates(workspaceId, runId);
    for (const state of states) {
      if (state.status !== "running" || active.has(state.nodeId)) continue;
      const node = run.spec.nodes.find(({ id }) => id === state.nodeId);
      if (node === undefined || state.attempt >= node.maxAttempts) {
        this.store.updateConductorNodeState(workspaceId, runId, state.nodeId, {
          status: "failed",
          error: "Execution was interrupted and no retry remains.",
          completedAt: new Date().toISOString(),
        });
        this.store.updateConductorRunStatus(workspaceId, runId, "failed");
        return;
      }
      this.store.updateConductorNodeState(workspaceId, runId, state.nodeId, {
        status: "ready",
        error: "Execution was interrupted; retrying.",
      });
    }

    const refreshed = this.store.listConductorNodeStates(workspaceId, runId);
    if (refreshed.every(({ status }) => status === "completed" || status === "skipped")) {
      this.store.updateConductorRunStatus(workspaceId, runId, "completed");
      this.active.delete(runId);
      return;
    }
    if (refreshed.some(({ status }) => status === "failed")) {
      this.store.updateConductorRunStatus(workspaceId, runId, "failed");
      this.active.delete(runId);
      return;
    }

    const capacity = Math.max(0, run.spec.maxParallel - active.size);
    const ready = refreshed.filter(({ status }) => status === "ready").slice(0, capacity);
    for (const state of ready) {
      const node = run.spec.nodes.find(({ id }) => id === state.nodeId);
      if (node === undefined) continue;
      active.add(node.id);
      const startedAt = new Date().toISOString();
      this.store.updateConductorNodeState(workspaceId, runId, node.id, {
        status: "running",
        attempt: state.attempt + 1,
        error: null,
        startedAt,
        completedAt: null,
      });
      const dependencies = node.dependsOn
        .map((id) => refreshed.find((candidate) => candidate.nodeId === id))
        .filter((value): value is ConductorNodeState => value !== undefined);
      const executionId = randomUUID();
      this.executionIds.set(executionKey(run.id, node.id), executionId);
      void this.execute(run, node, dependencies, executionId)
        .then((output) => this.finishNode(run, node, output, null))
        .catch((cause: unknown) => this.finishNode(
          run,
          node,
          null,
          cause instanceof Error ? cause.message : String(cause),
        ));
    }

    if (ready.length === 0 && active.size === 0) {
      this.store.updateConductorRunStatus(workspaceId, runId, "failed");
      return;
    }
    this.schedule(workspaceId, runId, 5_000);
  }

  private finishNode(run: ConductorRun, node: ConductorNode, output: string | null, error: string | null): void {
    const active = this.active.get(run.id);
    active?.delete(node.id);
    this.executionIds.delete(executionKey(run.id, node.id));
    const currentRun = this.store.getConductorRun(run.workspaceId, run.id);
    const state = this.store.listConductorNodeStates(run.workspaceId, run.id)
      .find(({ nodeId }) => nodeId === node.id);
    if (currentRun === null || state === undefined) return;
    if (currentRun.status === "cancelled") {
      this.store.updateConductorNodeState(run.workspaceId, run.id, node.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });
      return;
    }
    if (error === null) {
      this.store.updateConductorNodeState(run.workspaceId, run.id, node.id, {
        status: "completed",
        output,
        error: null,
        completedAt: new Date().toISOString(),
      });
    } else if (state.attempt < node.maxAttempts) {
      this.store.updateConductorNodeState(run.workspaceId, run.id, node.id, {
        status: "ready",
        error,
        completedAt: null,
      });
    } else {
      this.store.updateConductorNodeState(run.workspaceId, run.id, node.id, {
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      });
    }
    if (currentRun.status !== "paused") this.schedule(run.workspaceId, run.id, 0);
  }
}

function executionKey(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`;
}

function isTerminal(status: ConductorRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
