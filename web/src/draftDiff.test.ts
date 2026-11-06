import { describe, expect, it } from "vitest";
import { summarizeChange } from "./lib/draftDiff";

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: type === "bot_task" ? "Writer" : id, x: 0, y: 0, ...extra });
const draft = (...steps: Record<string, unknown>[]) => ({ name: "Notes", graph: { nodes: [node("start", "trigger"), ...steps, node("end", "end")] } });
const task = (id: string, instruction: string) => node(id, "bot_task", { instruction });
const ask = (id: string, message: string) => node(id, "checkpoint", { message });

describe("saying what a revision changed", () => {
  it("says so plainly when nothing changed (a real model sometimes returns the same draft)", () => {
    const a = draft(task("s1", "Collect prices"), task("s2", "Summarise"));
    expect(summarizeChange(a, JSON.parse(JSON.stringify(a)))).toMatch(/^Nothing changed: the assistant returned the same steps, so your change was not applied/);
  });
  it("lists an added question and a removed step, and tells the owner to check", () => {
    const before = draft(task("s1", "Collect prices"), task("s2", "Summarise"));
    const after = draft(task("s1", "Collect prices"), ask("s3", "Archive the result?"));
    const s = summarizeChange(before, after);
    expect(s).toContain("added “Ask you: Archive the result?”");
    expect(s).toContain("removed “Writer: Summarise”");
    expect(s).toMatch(/Check that this is what you asked for/);
  });
  it("notices a change of order only, and a name-only change", () => {
    const a = draft(task("s1", "One"), task("s2", "Two"));
    const b = draft(task("s2", "Two"), task("s1", "One"));
    expect(summarizeChange(a, b)).toMatch(/different order/);
    expect(summarizeChange(a, { ...JSON.parse(JSON.stringify(a)), name: "Other" })).toMatch(/only the name is different/);
  });
  it("counts a repeated step correctly", () => {
    const a = draft(task("s1", "Write"), task("s2", "Write"));
    const b = draft(task("s1", "Write"), task("s2", "Write"), task("s3", "Write"));
    expect(summarizeChange(a, b)).toMatch(/added “Writer: Write”/);
  });
});
