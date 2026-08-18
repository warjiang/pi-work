import { describe, expect, it } from "vitest";
import type { ConductorNode, ConductorNodeState } from "@pi-work/protocol";
import {
  buildConductorFlowGraph,
  layoutConductorFlow,
} from "./conductor-flow.js";

const runId = "00000000-0000-4000-8000-000000000010";
const firstId = "00000000-0000-4000-8000-000000000011";
const secondId = "00000000-0000-4000-8000-000000000012";
const thirdId = "00000000-0000-4000-8000-000000000013";

const nodes: ConductorNode[] = [
  {
    id: firstId,
    title: "Inspect workspace",
    prompt: "Inspect the workspace.",
    dependsOn: [],
    executionClass: "read",
    maxAttempts: 2,
  },
  {
    id: secondId,
    title: "Update runtime",
    prompt: "Update the runtime.",
    dependsOn: [firstId],
    executionClass: "write",
    maxAttempts: 3,
  },
  {
    id: thirdId,
    title: "Synthesize results",
    prompt: "Synthesize the results.",
    dependsOn: [secondId],
    executionClass: "read",
    maxAttempts: 1,
  },
];

function state(
  nodeId: string,
  status: ConductorNodeState["status"],
  attempt = 1,
): ConductorNodeState {
  return {
    runId,
    nodeId,
    status,
    attempt,
    executionId: null,
    output: null,
    error: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

const labels = {
  statusLabel: (status: ConductorNodeState["status"]) => status,
  attemptLabel: "Attempt",
  liveLabel: "Live",
  onSelectNode: () => undefined,
};

describe("ConductorFlow", () => {
  it("converts dependencies into left-to-right React Flow edges", () => {
    const layout = layoutConductorFlow(nodes, false);
    const positions = new Map(layout.nodes.map(({ node, position }) => [node.id, position]));

    expect(layout.edges).toEqual([
      { source: firstId, target: secondId },
      { source: secondId, target: thirdId },
    ]);
    expect(positions.get(firstId)!.x).toBeLessThan(positions.get(secondId)!.x);
    expect(positions.get(secondId)!.x).toBeLessThan(positions.get(thirdId)!.x);
    expect(layout.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
  });

  it("maps every node status, selection, and attempt into custom node data", () => {
    const statuses: ConductorNodeState["status"][] = [
      "pending",
      "ready",
      "running",
      "completed",
      "failed",
      "skipped",
      "cancelled",
    ];
    const layout = layoutConductorFlow([nodes[0]!], true);

    for (const status of statuses) {
      const graph = buildConductorFlowGraph({
        layout,
        states: [state(firstId, status, 2)],
        selectedNodeId: firstId,
        ...labels,
      });

      expect(graph.nodes[0]!.data).toMatchObject({
        status,
        attempt: 2,
        selected: true,
        statusLabel: status,
      });
    }
  });

  it("updates state and completed edges without changing Dagre positions", () => {
    const layout = layoutConductorFlow(nodes, false);
    const pending = buildConductorFlowGraph({
      layout,
      states: [state(firstId, "running")],
      selectedNodeId: null,
      ...labels,
    });
    const completed = buildConductorFlowGraph({
      layout,
      states: [state(firstId, "completed")],
      selectedNodeId: secondId,
      ...labels,
    });

    expect(completed.nodes.map(({ position }) => position)).toEqual(
      pending.nodes.map(({ position }) => position),
    );
    expect(pending.edges[0]!.className).toBe("conductor-flow-edge");
    expect(completed.edges[0]!.className).toBe("conductor-flow-edge is-completed");
    expect(completed.nodes.find(({ id }) => id === secondId)?.data.selected).toBe(true);
  });

  it("uses the requested compact and full node dimensions", () => {
    expect(layoutConductorFlow([nodes[0]!], true).nodes[0]).toMatchObject({
      width: 168,
      height: 92,
    });
    expect(layoutConductorFlow([nodes[0]!], false).nodes[0]).toMatchObject({
      width: 200,
      height: 108,
    });
  });
});
