import { z } from "zod";

/**
 * The shape of a workflow: boxes (nodes) and arrows (edges), each box with a place on the canvas.
 * A workflow is data, never code. The only things a box can do are listed here, and every one of them already has its own limits.
 */
export const GRAPH_LIMITS = { nodes: 25, edges: 60, template: 4000, name: 60, label: 60 };

const id = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);
const pos = { x: z.number().finite().min(-5000).max(5000), y: z.number().finite().min(-5000).max(5000) };
const label = z.string().max(GRAPH_LIMITS.label).default("");
const template = z.string().min(1).max(GRAPH_LIMITS.template);

const nodeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    id,
    type: z.literal("trigger"),
    label,
    ...pos,
    /** manual = only when you press Run; event = when a text event with this name arrives; interval = every N minutes (15 or more). */
    kind: z.enum(["manual", "event", "interval"]),
    eventName: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/).optional(),
    everyMinutes: z.number().int().min(15).max(10080).optional(),
  }),
  z.strictObject({ id, type: z.literal("bot_task"), label, ...pos, botId: z.string().uuid(), instruction: template, retries: z.number().int().min(0).max(2).default(0) }),
  z.strictObject({ id, type: z.literal("manager"), label, ...pos, goal: template }),
  z.strictObject({
    id,
    type: z.literal("condition"),
    label,
    ...pos,
    left: z.string().min(1).max(200),
    op: z.enum(["contains", "not_contains", "equals", "not_equals", "not_empty", "longer_than"]),
    value: z.string().max(500).default(""),
  }),
  z.strictObject({ id, type: z.literal("checkpoint"), label, ...pos, message: z.string().min(1).max(500) }),
  z.strictObject({ id, type: z.literal("set"), label, ...pos, value: template }),
  z.strictObject({ id, type: z.literal("end"), label, ...pos }),
]);

const edgeSchema = z.strictObject({ id, from: id, to: id, /** "true" / "false" leave a condition box; anything else means "always". */ when: z.enum(["always", "true", "false"]).default("always") });

export const graphSchema = z.strictObject({
  nodes: z.array(nodeSchema).min(1).max(GRAPH_LIMITS.nodes),
  edges: z.array(edgeSchema).max(GRAPH_LIMITS.edges),
});
export type Graph = z.infer<typeof graphSchema>;
export type GraphNode = Graph["nodes"][number];
export type GraphEdge = Graph["edges"][number];

export interface Problem {
  node?: string;
  message: string;
}

/** Everything that would make a workflow unsafe or impossible to run, in plain words. An empty list means it can be saved and run. */
export function validateGraph(g: Graph): Problem[] {
  const problems: Problem[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) problems.push({ node: n.id, message: `Two boxes share the name "${n.id}".` });
    ids.add(n.id);
  }
  const triggers = g.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) problems.push({ message: triggers.length === 0 ? "A workflow needs one Start box." : "A workflow can have only one Start box." });
  for (const t of triggers) {
    if (t.type !== "trigger") continue;
    if (t.kind === "event" && !t.eventName) problems.push({ node: t.id, message: "The Start box waits for an event but no event name is set." });
    if (t.kind === "interval" && !t.everyMinutes) problems.push({ node: t.id, message: "The Start box repeats but no number of minutes is set." });
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) problems.push({ message: `Two arrows share the name "${e.id}".` });
    edgeIds.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push({ message: "An arrow points at a box that does not exist." });
    if (e.from === e.to) problems.push({ node: e.from, message: "A box cannot point at itself." });
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const e of g.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (from.type === "end") problems.push({ node: from.id, message: "Nothing can follow an End box." });
    if (to.type === "trigger") problems.push({ node: to.id, message: "Nothing can point at the Start box." });
    if (e.when !== "always" && from.type !== "condition") problems.push({ node: from.id, message: "Only an If box can have true/false arrows." });
    if (from.type === "condition" && e.when === "always") problems.push({ node: from.id, message: "Arrows leaving an If box must say true or false." });
  }
  for (const n of g.nodes) {
    if (n.type !== "condition") continue;
    const out = g.edges.filter((e) => e.from === n.id);
    if (out.filter((e) => e.when === "true").length > 1 || out.filter((e) => e.when === "false").length > 1) problems.push({ node: n.id, message: "An If box can have only one true arrow and one false arrow." });
  }
  // No loops: a workflow always moves forward, so it always finishes.
  const next = new Map<string, string[]>();
  for (const e of g.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (u: string): boolean => {
    if (state.get(u) === 2) return false;
    if (state.get(u) === 1) return true;
    state.set(u, 1);
    for (const v of next.get(u) ?? []) if (visit(v)) return true;
    state.set(u, 2);
    return false;
  };
  if (g.nodes.some((n) => visit(n.id))) problems.push({ message: "Arrows form a loop. A workflow can only move forward." });
  // Every box must be reachable from Start, otherwise it can never run.
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0]!.id]);
    const queue = [triggers[0]!.id];
    while (queue.length) for (const v of next.get(queue.shift()!) ?? []) if (!seen.has(v)) (seen.add(v), queue.push(v));
    for (const n of g.nodes) if (!seen.has(n.id)) problems.push({ node: n.id, message: "This box is not connected to the Start box, so it would never run." });
  }
  return problems;
}

// ---------------------------------------------------------------- templates
export interface TemplateScope {
  input: string;
  /** Outputs of finished boxes, by box name. */
  outputs: Map<string, string>;
}

const MAX_SUBSTITUTED = 3000;

/**
 * Fills {{input}} and {{boxname.output}} into a text. Only these two forms exist: a template cannot run anything, read a file or reach a secret.
 * Whatever is filled in is plain text from earlier boxes and is clipped, so one box cannot flood the next.
 */
export function renderTemplate(text: string, scope: TemplateScope): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]{1,24})(?:\.output)?\s*\}\}/g, (_m, name: string) => {
    const v = name === "input" ? scope.input : (scope.outputs.get(name) ?? "");
    return v.length > MAX_SUBSTITUTED ? `${v.slice(0, MAX_SUBSTITUTED)}...` : v;
  });
}

export function evaluateCondition(op: string, left: string, value: string): boolean {
  const a = left.toLowerCase();
  const b = value.toLowerCase();
  switch (op) {
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "equals":
      return a.trim() === b.trim();
    case "not_equals":
      return a.trim() !== b.trim();
    case "not_empty":
      return left.trim().length > 0;
    case "longer_than":
      return left.length > (Number(value) || 0);
    default:
      return false;
  }
}
