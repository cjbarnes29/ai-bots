/**
 * After the assistant revises a workflow draft, say plainly what changed. A real model sometimes returns the draft unchanged or changes something else
 * (seen in the real-model tests, board P-47/P-48), so the owner is told what is different and must read it before opening it. Pure functions, no model call.
 */
type Graph = { nodes: Record<string, unknown>[] };
const isStep = (n: Record<string, unknown>) => n["type"] === "bot_task" || n["type"] === "checkpoint";
export const stepLine = (n: Record<string, unknown>): string => (n["type"] === "checkpoint" ? `Ask you: ${String(n["message"])}` : `${String(n["label"])}: ${String(n["instruction"]).slice(0, 120)}`);
const stepsOf = (g: Graph): string[] => g.nodes.filter(isStep).map(stepLine);

/** Items of `a` that are not in `b` (each match is used once, so a repeated step is counted correctly). */
function without(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((x) => {
    const i = left.indexOf(x);
    if (i >= 0) {
      left.splice(i, 1);
      return false;
    }
    return true;
  });
}
const quote = (xs: string[]) => xs.map((x) => `“${x.length > 90 ? `${x.slice(0, 90)}…` : x}”`).join("; ");

export function summarizeChange(before: { name: string; graph: Graph }, after: { name: string; graph: Graph }): string {
  const a = stepsOf(before.graph);
  const b = stepsOf(after.graph);
  const added = without(b, a);
  const removed = without(a, b);
  const nameChanged = before.name !== after.name;
  if (added.length === 0 && removed.length === 0) {
    if (a.join("\n") !== b.join("\n")) return "The steps are the same but in a different order. Read the list to check that this is what you asked for.";
    return `Nothing changed: the assistant returned the same steps${nameChanged ? " (only the name is different)" : ""}, so your change was not applied. Try saying it in different words, or edit the workflow yourself after opening it.`;
  }
  const parts = [added.length ? `added ${quote(added)}` : "", removed.length ? `removed ${quote(removed)}` : ""].filter(Boolean).join(", and ");
  return `What changed: ${parts}. Check that this is what you asked for before you open it.`;
}
