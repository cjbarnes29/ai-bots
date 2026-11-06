import { describe, expect, it } from "vitest";
import { GUIDE_PREFIXES, guidanceFor } from "./lib/guidance";
import { NAV } from "./components/shell/nav";

/**
 * The plain-language guides are for a complete beginner. These tests pin what makes them readable (short, simple, every term explained) and that every
 * screen listed at the Simple or Intermediate level has one (a beginner should not meet an unexplained screen).
 */
const syll = (word: string): number => {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
};
function stats(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.match(/[A-Za-z’']+/g) ?? [];
  const syllables = words.reduce((n, w) => n + syll(w), 0);
  return { words: words.length, avgSentence: words.length / sentences.length, grade: 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59 };
}

const allGuides = () => GUIDE_PREFIXES.map((p) => ({ prefix: p, text: guidanceFor(p === "/" ? "/" : p)! }));

describe("plain-language guides", () => {
  it("are short, in short sentences, at a reading level a beginner can follow", () => {
    for (const g of allGuides()) {
      const s = stats(g.text);
      expect(s.words, `${g.prefix} words`).toBeLessThanOrEqual(75);
      expect(s.avgSentence, `${g.prefix} average sentence`).toBeLessThanOrEqual(20);
      expect(s.grade, `${g.prefix} reading grade`).toBeLessThanOrEqual(9.5);
    }
  });

  it("explain a term the first time it appears: 'agent' always comes with 'AI helper', 'model' with 'AI brain'", () => {
    for (const g of allGuides()) {
      if (/\bagents?\b/i.test(g.text)) expect(g.text, `${g.prefix} uses 'agent'`).toMatch(/AI helpers?/);
      if (/\bmodels?\b/i.test(g.text)) expect(g.text, `${g.prefix} uses 'model'`).toMatch(/AI brain/);
    }
  });

  it("never promise more than the app does: the only 'never' is the assistant's 'never deletes, sends or buys by itself'", () => {
    for (const g of allGuides()) {
      const nevers = g.text.match(/\bnever\b/gi) ?? [];
      if (g.prefix === "/assistant") expect(g.text).toMatch(/never deletes, sends or buys anything by itself/);
      else expect(nevers, g.prefix).toHaveLength(0);
      expect(g.text, g.prefix).not.toMatch(/\b(always|guarantee|safe to|automatically fixes)\b/i);
    }
  });

  it("exist for every screen that the Simple or Intermediate menu lists (and the agent page)", () => {
    const missing: string[] = [];
    for (const entry of NAV.filter((e) => e.level !== "advanced")) {
      for (const path of [entry.to, ...entry.tabs.map((t) => t.to)]) if (!guidanceFor(path)) missing.push(path);
    }
    expect(missing).toEqual([]);
    expect(guidanceFor("/bots/some-agent-id")).toMatch(/This is one agent/);
    expect(guidanceFor("/projects/some-id")).toMatch(/project keeps everything/);
    expect(guidanceFor("/tasks/some-id")).toMatch(/task is one job/);
  });

  it("say nothing for a screen that has none (no empty box)", () => {
    expect(guidanceFor("/nowhere")).toBeNull();
    expect(guidanceFor("/settings")).toBeNull(); // Advanced only
  });
});
