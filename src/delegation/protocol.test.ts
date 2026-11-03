import { describe, expect, it } from "vitest";
import { buildDelegationAddendum, parseDelegations, stripDelegations } from "./protocol.js";

const block = (json: string) => "```delegate\n" + json + "\n```";

describe("reading delegate blocks from a bot's reply", () => {
  it("reads a valid request and removes the block from the text", () => {
    const text = `I will ask for help.\n\n${block('{"to": "Researcher", "task": "Find three facts."}')}\n\nThanks.`;
    const parsed = parseDelegations(text, 4000);
    expect(parsed.requests).toEqual([{ ok: true, to: "Researcher", task: "Find three facts." }]);
    expect(parsed.text).toBe("I will ask for help.\n\nThanks.");
  });

  it("reads several requests in order", () => {
    const text = [block('{"to":"A","task":"one"}'), "middle", block('{"to":"B","task":"two"}')].join("\n");
    expect(parseDelegations(text, 4000).requests).toEqual([
      { ok: true, to: "A", task: "one" },
      { ok: true, to: "B", task: "two" },
    ]);
  });

  it("reports (does not run) requests that are not valid JSON or are missing fields", () => {
    const text = [block("not json"), block('{"to":"A"}'), block('{"task":"x"}'), block("[1,2]"), block('{"to":3,"task":"x"}')].join("\n");
    const { requests } = parseDelegations(text, 4000);
    expect(requests).toHaveLength(5);
    expect(requests.every((r) => r.ok === false)).toBe(true);
    expect((requests[0] as { reason: string }).reason).toMatch(/valid JSON/);
    expect((requests[1] as { reason: string }).reason).toMatch(/"to".*"task"/);
  });

  it("rejects a task or name that is too long", () => {
    const long = parseDelegations(block(JSON.stringify({ to: "A", task: "x".repeat(101) })), 100).requests[0] as { ok: boolean; reason: string };
    expect(long.ok).toBe(false);
    expect(long.reason).toMatch(/too long/);
    const name = parseDelegations(block(JSON.stringify({ to: "n".repeat(81), task: "x" })), 100).requests[0] as { ok: boolean; reason: string };
    expect(name.ok).toBe(false);
  });

  it("ignores ordinary code fences and text that merely mentions delegating", () => {
    const text = 'Use ```json\n{"to":"A","task":"x"}\n``` for data. I could delegate this to A but will not.';
    expect(parseDelegations(text, 4000).requests).toEqual([]);
  });

  it("handles Windows line endings and surrounding spaces", () => {
    const text = '```delegate  \r\n  {"to": " Writer ", "task": " Draft it "}  \r\n```';
    expect(parseDelegations(text, 4000).requests).toEqual([{ ok: true, to: "Writer", task: "Draft it" }]);
  });

  it("strips blocks from any text, and tidies the blank lines", () => {
    expect(stripDelegations(`a\n\n\n${block("{}")}\n\n\nb`)).toBe("a\n\nb");
    expect(stripDelegations(block("{}"))).toBe("");
    expect(stripDelegations("nothing here")).toBe("nothing here");
  });

  it("tells a bot who its teammates are and how to ask", () => {
    const text = buildDelegationAddendum(
      [
        { name: "Researcher", role: "Finds facts", responsibilities: ["Search", "Summarise"] },
        { name: "Writer", role: "", responsibilities: [] },
      ],
      3,
    );
    expect(text).toContain("- Researcher: Finds facts | Search; Summarise");
    expect(text).toContain("- Writer");
    expect(text).toContain("```delegate");
    expect(text).toContain("at most 3");
    expect(text).toMatch(/cannot see this conversation/);
  });
});
