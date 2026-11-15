import type { Edge, Node } from "@xyflow/react";
import type { WfEdge, WfGraph, WfNode } from "../api/types";

/** Whole original node/edge kept in `data.orig`, so no field (known or unknown) can be dropped. Only position is read back from the canvas. */
export type FlowNodeData = { orig: WfNode; [key: string]: unknown };
export type FlowEdgeData = { orig: WfEdge; [key: string]: unknown };

export function graphToFlow(g: WfGraph): { nodes: Node<FlowNodeData>[]; edges: Edge<FlowEdgeData>[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: "wf", position: { x: n.x, y: n.y }, data: { orig: structuredClone(n) } })),
    edges: g.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.when === "always" ? undefined : e.when, data: { orig: structuredClone(e) } })),
  };
}

export function flowToGraph(nodes: Node<FlowNodeData>[], edges: Edge<FlowEdgeData>[]): WfGraph {
  return {
    nodes: nodes.map((n) => ({ ...n.data.orig, id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ ...e.data!.orig, id: e.id, from: e.source, to: e.target })),
  };
}
