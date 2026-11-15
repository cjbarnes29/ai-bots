import { Background, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useState } from "react";
import type { WfGraph } from "../api/types";
import { flowToGraph, graphToFlow, type FlowEdgeData, type FlowNodeData } from "./adapter";

function WfBox({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const n = data.orig;
  return (
    <div className={`rounded-md border bg-white px-3 py-2 text-sm shadow dark:bg-slate-800 ${selected ? "border-indigo-600 ring-2 ring-indigo-400" : "border-slate-400"}`} style={{ width: 176, minHeight: 78 }}>
      <Handle type="target" position={Position.Left} style={{ width: 14, height: 14 }} />
      <p className="text-xs uppercase text-slate-500">{n.type}</p>
      <p className="font-semibold">{n.label}</p>
      <Handle type="source" position={Position.Right} style={{ width: 14, height: 14 }} />
    </div>
  );
}
const nodeTypes = { wf: WfBox }; // defined outside the component, as the React Flow docs require

export function Canvas({ graph }: { graph: WfGraph }) {
  const init = graphToFlow(graph);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>(init.nodes);
  const [edges, setEdges] = useState<Edge<FlowEdgeData>[]>(init.edges);
  const onNodes = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns) as Node<FlowNodeData>[]), []);
  const onEdges = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es) as Edge<FlowEdgeData>[]), []);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, id: `e-${c.source}-${c.target}-${es.length}`, data: { orig: { id: `e-${c.source}-${c.target}-${es.length}`, from: c.source!, to: c.target!, when: "always" } } }, es) as Edge<FlowEdgeData>[]), []);
  return (
    <div>
      <div style={{ height: 520, width: "100%" }} data-testid="canvas">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodes} onEdgesChange={onEdges} onConnect={onConnect} fitView>
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <pre id="out" data-testid="out">{JSON.stringify(flowToGraph(nodes, edges))}</pre>
    </div>
  );
}
