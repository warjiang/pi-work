import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
} from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import type { ConductorNode, ConductorNodeState } from "@pi-work/protocol";

const compactNodeSize = { width: 168, height: 92 };
const fullNodeSize = { width: 200, height: 108 };

export type ConductorFlowNodeData = {
  node: ConductorNode;
  status: ConductorNodeState["status"];
  attempt: number;
  selected: boolean;
  statusLabel: string;
  attemptLabel: string;
  liveLabel: string;
  onSelectNode(node: ConductorNode): void;
};

export type ConductorFlowNode = Node<ConductorFlowNodeData, "conductor">;
export type ConductorFlowEdge = Edge<Record<string, never>, "smoothstep">;

export type ConductorFlowLayout = {
  nodes: Array<{
    node: ConductorNode;
    position: { x: number; y: number };
    width: number;
    height: number;
  }>;
  edges: Array<{ source: string; target: string }>;
};

export function layoutConductorFlow(
  nodes: ConductorNode[],
  compact: boolean,
): ConductorFlowLayout {
  const size = compact ? compactNodeSize : fullNodeSize;
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: compact ? 48 : 72,
    nodesep: compact ? 22 : 32,
    marginx: compact ? 18 : 28,
    marginy: compact ? 18 : 28,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { ...size });
  }

  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edges = nodes.flatMap((node) => node.dependsOn
    .filter((dependencyId) => nodeIds.has(dependencyId))
    .map((dependencyId) => ({ source: dependencyId, target: node.id })));

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id) as { x: number; y: number };
      return {
        node,
        width: size.width,
        height: size.height,
        position: {
          x: position.x - size.width / 2,
          y: position.y - size.height / 2,
        },
      };
    }),
    edges,
  };
}

export function buildConductorFlowGraph(options: {
  layout: ConductorFlowLayout;
  states: ConductorNodeState[];
  selectedNodeId: string | null;
  statusLabel(status: ConductorNodeState["status"]): string;
  attemptLabel: string;
  liveLabel: string;
  onSelectNode(node: ConductorNode): void;
}): { nodes: ConductorFlowNode[]; edges: ConductorFlowEdge[] } {
  const statesByNodeId = new Map(options.states.map((state) => [state.nodeId, state]));
  return {
    nodes: options.layout.nodes.map(({ node, position, width, height }) => {
      const state = statesByNodeId.get(node.id);
      const status = state?.status ?? "pending";
      return {
        id: node.id,
        type: "conductor",
        position,
        width,
        height,
        style: { width, height },
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        data: {
          node,
          status,
          attempt: state?.attempt ?? 0,
          selected: options.selectedNodeId === node.id,
          statusLabel: options.statusLabel(status),
          attemptLabel: options.attemptLabel,
          liveLabel: options.liveLabel,
          onSelectNode: options.onSelectNode,
        },
      };
    }),
    edges: options.layout.edges.map(({ source, target }) => {
      const targetStatus = statesByNodeId.get(target)?.status;
      const active = targetStatus === "running" || targetStatus === "ready";
      return {
        id: `${source}-${target}`,
        source,
        target,
        type: "smoothstep",
        animated: active,
        className: `conductor-flow-edge${statesByNodeId.get(source)?.status === "completed" ? " is-completed" : ""}${active ? " is-active" : ""}`,
        focusable: false,
        selectable: false,
      };
    }),
  };
}

function ConductorFlowNodeView({ data }: NodeProps<ConductorFlowNode>) {
  return (
    <div
      className={`conductor-flow-node conductor-flow-node-${data.status}${data.selected ? " is-selected" : ""}`}
      data-status={data.status}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="conductor-flow-handle"
      />
      <button
        type="button"
        className="conductor-flow-node-surface nodrag nopan"
        aria-pressed={data.selected}
      >
        <span className="conductor-flow-node-title">{data.node.title}</span>
        <span className="conductor-flow-node-status">
          <span className={`conductor-flow-status conductor-flow-status-${data.status}`}>
            {data.statusLabel}
          </span>
          {data.status === "running" ? (
            <span className="conductor-node-live">{data.liveLabel}</span>
          ) : null}
        </span>
        <span className="conductor-flow-node-meta">
          {data.attemptLabel} {data.attempt}/{data.node.maxAttempts}
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="conductor-flow-handle"
      />
    </div>
  );
}

const nodeTypes = { conductor: ConductorFlowNodeView };

export function ConductorFlow(props: {
  runId: string;
  nodes: ConductorNode[];
  states: ConductorNodeState[];
  selectedNodeId: string | null;
  compact?: boolean;
  statusLabel(status: ConductorNodeState["status"]): string;
  attemptLabel: string;
  liveLabel: string;
  onSelectNode(node: ConductorNode): void;
}) {
  const compact = props.compact === true;
  const layout = useMemo(
    () => layoutConductorFlow(props.nodes, compact),
    [compact, props.nodes],
  );
  const graph = useMemo(
    () => buildConductorFlowGraph({
      layout,
      states: props.states,
      selectedNodeId: props.selectedNodeId,
      statusLabel: props.statusLabel,
      attemptLabel: props.attemptLabel,
      liveLabel: props.liveLabel,
      onSelectNode: props.onSelectNode,
    }),
    [
      layout,
      props.attemptLabel,
      props.liveLabel,
      props.onSelectNode,
      props.selectedNodeId,
      props.states,
      props.statusLabel,
    ],
  );

  return (
    <div className={`conductor-flow${compact ? " is-compact" : " is-full"}`}>
      <ReactFlow<ConductorFlowNode, ConductorFlowEdge>
        key={props.runId}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => props.onSelectNode(node.data.node)}
        fitView
        fitViewOptions={{
          padding: compact ? 0.12 : 0.18,
          minZoom: 0.45,
          maxZoom: compact ? 1.05 : 1.2,
        }}
        minZoom={0.35}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll={!compact}
        zoomOnPinch
        zoomOnDoubleClick={!compact}
        preventScrolling={!compact}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        {!compact ? (
          <>
            <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="var(--border)" />
            <Controls showInteractive={false} position="bottom-right" />
          </>
        ) : null}
      </ReactFlow>
    </div>
  );
}
