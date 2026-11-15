import { describe, expect, it } from "vitest";
import { flowToGraph, graphToFlow } from "./adapter";
import { SAMPLE } from "./sample";
import type { WfGraph } from "../api/types";
const rt = (g: WfGraph) => { const f = graphToFlow(g); return flowToGraph(f.nodes, f.edges); };
describe("adapter round trip", () => {
  it("keeps every field of the sample graph", () => expect(rt(SAMPLE)).toEqual(SAMPLE));
  it("keeps an empty graph", () => expect(rt({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] }));
  it("keeps unknown fields and edge conditions", () => {
    const g: WfGraph = { nodes: [{ id: "a", type: "set", label: "A", x: 1, y: 2, weird: { deep: [null, true, "x"] } }], edges: [{ id: "e", from: "a", to: "a", when: "false" }] };
    expect(rt(g)).toEqual(g);
  });
  it("applies only a changed position and does not mutate the input", () => {
    const copy = structuredClone(SAMPLE); const f = graphToFlow(SAMPLE); f.nodes[0]!.position = { x: 99.6, y: 5 };
    const out = flowToGraph(f.nodes, f.edges);
    expect(out.nodes[0]).toEqual({ ...SAMPLE.nodes[0], x: 100, y: 5 }); expect(SAMPLE).toEqual(copy);
  });
  it("keeps 500 nodes in order", () => {
    const g: WfGraph = { nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: "set" as const, label: `N${i}`, x: i, y: i * 2 })), edges: Array.from({ length: 499 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, when: "always" as const })) };
    expect(rt(g)).toEqual(g);
  });
});
