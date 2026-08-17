import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PiWorkStore } from "@pi-work/storage";
import { DurableConductor } from "./conductor.js";

const stores: PiWorkStore[] = [];
const conductors: DurableConductor[] = [];

afterEach(() => {
  conductors.splice(0).forEach((conductor) => conductor.dispose());
  stores.splice(0).forEach((store) => store.close());
});

function fixture(options: {
  maxParallel?: number;
  maxAttempts?: number;
  dependent?: boolean;
  executionClasses?: ["read" | "write", "read" | "write"];
} = {}) {
  const store = new PiWorkStore();
  stores.push(store);
  const workspace = store.createWorkspace({
    name: "Conductor",
    rootPath: `/workspace/conductor-${randomUUID()}`,
    outputPath: `/workspace/conductor-${randomUUID()}/output`,
  });
  const task = store.createTask({
    workspaceId: workspace.id,
    title: "Coordinate",
    goal: "Run a durable graph",
  });
  const firstId = randomUUID();
  const secondId = randomUUID();
  const run = store.createConductorRun({
    workspaceId: workspace.id,
    taskId: task.id,
    spec: {
      maxParallel: options.maxParallel ?? 1,
      nodes: [
        {
          id: firstId,
          title: "First",
          prompt: "First",
          dependsOn: [],
          executionClass: options.executionClasses?.[0],
          maxAttempts: options.maxAttempts ?? 1,
        },
        {
          id: secondId,
          title: "Second",
          prompt: "Second",
          dependsOn: options.dependent === false ? [] : [firstId],
          executionClass: options.executionClasses?.[1],
          maxAttempts: 1,
        },
      ],
    },
  });
  return { store, workspace, run, firstId, secondId };
}

async function waitUntil(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for conductor state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("DurableConductor", () => {
  it("runs dependencies in order and retries failed nodes", async () => {
    const { store, workspace, run, firstId, secondId } = fixture({ maxAttempts: 2 });
    const calls: string[] = [];
    let firstAttempts = 0;
    const conductor = new DurableConductor(store, async (_run, node, dependencies) => {
      calls.push(node.id);
      if (node.id === firstId && firstAttempts++ === 0) throw new Error("temporary");
      if (node.id === secondId) expect(dependencies[0]?.output).toBe("first-result");
      return node.id === firstId ? "first-result" : "second-result";
    });
    conductors.push(conductor);

    conductor.start(workspace.id, run.id);
    await waitUntil(() => store.getConductorRun(workspace.id, run.id)?.status === "completed");

    expect(calls).toEqual([firstId, firstId, secondId]);
    expect(store.listConductorNodeStates(workspace.id, run.id).map(({ status }) => status))
      .toEqual(["completed", "completed"]);
    const firstNodeAttempts = store.listConductorNodeAttempts(workspace.id, run.id)
      .filter(({ nodeId }) => nodeId === firstId);
    expect(firstNodeAttempts.map(({ status, output, error }) => ({ status, output, error }))).toEqual([
      { status: "failed", output: null, error: "temporary" },
      { status: "completed", output: "first-result", error: null },
    ]);
    expect(firstNodeAttempts.every(({ executionId }) => /^[0-9a-f-]{36}$/.test(executionId))).toBe(true);
  });

  it("does not launch new nodes while paused and resumes them later", async () => {
    const { store, workspace, run, firstId, secondId } = fixture({ dependent: false });
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const conductor = new DurableConductor(store, async (_run, node) => {
      calls.push(node.id);
      if (node.id === firstId) await firstPending;
      return node.title;
    });
    conductors.push(conductor);

    conductor.start(workspace.id, run.id);
    await waitUntil(() => calls.length === 1);
    conductor.pause(workspace.id, run.id);
    releaseFirst();
    await waitUntil(() => store.listConductorNodeStates(workspace.id, run.id)
      .find(({ nodeId }) => nodeId === firstId)?.status === "completed");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(calls).toEqual([firstId]);

    conductor.resume(workspace.id, run.id);
    await waitUntil(() => store.getConductorRun(workspace.id, run.id)?.status === "completed");
    expect(calls).toEqual([firstId, secondId]);
  });

  it("runs independent read nodes in parallel", async () => {
    const { store, workspace, run } = fixture({
      maxParallel: 2,
      dependent: false,
      executionClasses: ["read", "read"],
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const conductor = new DurableConductor(store, async (_run, node) => {
      calls.push(node.id);
      await pending;
      return node.title;
    });
    conductors.push(conductor);

    conductor.start(workspace.id, run.id);
    await waitUntil(() => calls.length === 2);
    expect(store.listConductorNodeStates(workspace.id, run.id)
      .filter(({ status }) => status === "running")).toHaveLength(2);

    release();
    await waitUntil(() => store.getConductorRun(workspace.id, run.id)?.status === "completed");
  });

  it("runs write nodes exclusively", async () => {
    const { store, workspace, run, firstId, secondId } = fixture({
      maxParallel: 2,
      dependent: false,
      executionClasses: ["read", "write"],
    });
    let releaseWrite!: () => void;
    const writePending = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const active = new Set<string>();
    const overlaps: string[][] = [];
    const calls: string[] = [];
    const conductor = new DurableConductor(store, async (_run, node) => {
      calls.push(node.id);
      active.add(node.id);
      if (active.size > 1) overlaps.push([...active]);
      if (node.id === secondId) await writePending;
      active.delete(node.id);
      return node.title;
    });
    conductors.push(conductor);

    conductor.start(workspace.id, run.id);
    await waitUntil(() => calls.includes(secondId));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(calls).toEqual([secondId]);

    releaseWrite();
    await waitUntil(() => calls.includes(firstId));
    await waitUntil(() => store.getConductorRun(workspace.id, run.id)?.status === "completed");
    expect(overlaps).toEqual([]);
  });

  it("does not start pending runs during recovery", async () => {
    const { store, workspace, run } = fixture({
      executionClasses: ["read", "read"],
    });
    const calls: string[] = [];
    const conductor = new DurableConductor(store, async (_run, node) => {
      calls.push(node.id);
      return node.title;
    });
    conductors.push(conductor);

    conductor.recover();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(calls).toEqual([]);
    expect(store.getConductorRun(workspace.id, run.id)?.status).toBe("pending");
  });

  it("recovers interrupted nodes and honours cancellation of active work", async () => {
    const recovered = fixture({ maxAttempts: 2 });
    recovered.store.updateConductorNodeState(
      recovered.workspace.id,
      recovered.run.id,
      recovered.firstId,
      { status: "running", attempt: 1, startedAt: new Date().toISOString() },
    );
    recovered.store.updateConductorRunStatus(recovered.workspace.id, recovered.run.id, "running");
    const recovering = new DurableConductor(recovered.store, async () => "recovered");
    conductors.push(recovering);
    recovering.recover();
    await waitUntil(() => recovered.store.getConductorRun(recovered.workspace.id, recovered.run.id)?.status === "completed");
    expect(recovered.store.listConductorNodeStates(recovered.workspace.id, recovered.run.id)
      .find(({ nodeId }) => nodeId === recovered.firstId)?.attempt).toBe(2);

    const cancelled = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancelledExecutions: string[] = [];
    const stopping = new DurableConductor(cancelled.store, async () => {
      await pending;
      return "late";
    }, async (executionId) => {
      cancelledExecutions.push(executionId);
    });
    conductors.push(stopping);
    stopping.start(cancelled.workspace.id, cancelled.run.id);
    await waitUntil(() => cancelled.store.listConductorNodeStates(cancelled.workspace.id, cancelled.run.id)
      .some(({ status }) => status === "running"));
    stopping.stop(cancelled.workspace.id, cancelled.run.id);
    release();
    await waitUntil(() => cancelled.store.listConductorNodeStates(cancelled.workspace.id, cancelled.run.id)
      .some(({ status }) => status === "cancelled"));
    expect(cancelledExecutions).toHaveLength(1);
    expect(cancelled.store.getConductorRun(cancelled.workspace.id, cancelled.run.id)?.status).toBe("cancelled");
  });
});
