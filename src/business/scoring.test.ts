import { describe, expect, it } from "vitest";
import { makeLead, type Lead } from "./leads.js";
import { MAX_SCORE, RUBRIC, applyScore, scoreLead } from "./scoring.js";

const NOW = "2026-11-04T10:00:00.000Z";
const L = (over: Record<string, unknown> = {}): Lead => makeLead({ business_name: "Al Noor", city: "Dubai", source: "osm", source_id: "n/1", ...over }, NOW);
const WITH_CONTACT = { phone: "04 123 4567", address: "Main St, Dubai" };

describe("the scoring rubric is a visible table that adds up", () => {
  it("the maximum points add up to exactly 100", () => {
    expect(RUBRIC.reduce((n, r) => n + r.max, 0)).toBe(100);
    expect(MAX_SCORE).toBe(100);
  });
});

describe("what each website situation is worth", () => {
  it("a confirmed 'no website' is worth the most; 'none listed' is worth less and is marked unverified", () => {
    const confirmed = scoreLead(L({ ...WITH_CONTACT, website_state: "confirmed_none" }));
    const listed = scoreLead(L({ ...WITH_CONTACT }));
    expect(confirmed.criteria[0]).toMatchObject({ id: "website", points: 70 });
    expect(listed.criteria[0]).toMatchObject({ id: "website", points: 50 });
    expect(confirmed.score).toBe(100);
    expect(listed.score).toBe(80);
    expect(confirmed.confidence).toBe("normal");
    expect(listed.confidence).toBe("unverified");
    expect(listed.criteria[0]!.evidence).toMatch(/Unverified: confirm there really is none/);
  });

  it("an audited website earns points in proportion to how poor it is", () => {
    const pts = (audit: number) => scoreLead(L({ website_url: "https://x.ae", website_state: "audited", audit_score: audit })).criteria[0]!.points;
    expect(pts(0)).toBe(70);
    expect(pts(50)).toBe(35);
    expect(pts(100)).toBe(0);
    expect(pts(90)).toBe(7);
  });

  it("a low-confidence audit is capped, and says so", () => {
    const s = scoreLead(L({ website_url: "https://x.ae", website_state: "audited", audit_score: 0, audit_confidence: "low" }));
    expect(s.criteria[0]!.points).toBe(35);
    expect(s.confidence).toBe("low");
    expect(s.criteria[0]!.evidence).toMatch(/low confidence.*capped/);
  });

  it("a parked or placeholder page counts almost like no website at all", () => {
    const s = scoreLead(L({ website_url: "https://x.ae", website_state: "audited", audit_score: 0, audit_summary: "Placeholder or parked page: there is no real website yet." }));
    expect(s.criteria[0]!.points).toBe(65);
  });

  it("a failed audit is worth NO website points: it is neither 'poor' nor 'missing', and it is flagged for a manual check", () => {
    for (const failure of ["timed_out", "dns_failed", "tls_certificate_invalid", "blocked_address"]) {
      const s = scoreLead(L({ ...WITH_CONTACT, website_url: "https://x.ae", website_state: "audit_failed", audit_failure: failure }));
      expect(s.criteria[0]).toMatchObject({ points: 0 });
      expect(s.confidence).toBe("needs_check");
      expect(s.score).toBe(30); // only the contact points
      expect(s.priority).toBe("low");
      expect(s.reasons).toMatch(/Needs a manual check/);
      expect(s.criteria[0]!.evidence).toMatch(/says nothing about its quality/);
    }
    // ...and that is clearly different from a business with no website
    expect(scoreLead(L({ ...WITH_CONTACT })).score).toBeGreaterThan(scoreLead(L({ ...WITH_CONTACT, website_url: "https://x.ae", website_state: "audit_failed", audit_failure: "timed_out" })).score);
  });

  it("a website nobody has looked at yet earns nothing and is flagged", () => {
    const s = scoreLead(L({ website_url: "https://x.ae" }));
    expect(s.criteria[0]).toMatchObject({ points: 0, evidence: "The website has not been checked yet." });
    expect(s.confidence).toBe("needs_check");
  });
});

describe("contact points and priority", () => {
  it("a phone number and an address are worth 20 and 10", () => {
    const base = { website_state: "confirmed_none" };
    expect(scoreLead(L({ ...base })).score).toBe(70);
    expect(scoreLead(L({ ...base, phone: "04 123 4567" })).score).toBe(90);
    expect(scoreLead(L({ ...base, address: "Main St" })).score).toBe(80);
  });

  it("priority bands: high from 60, medium from 35", () => {
    const at = (website: Record<string, unknown>, contact: Record<string, unknown> = {}) => scoreLead(L({ ...website, ...contact }));
    expect(at({ website_state: "confirmed_none" }).priority).toBe("high"); // 70
    expect(at({}, WITH_CONTACT).priority).toBe("high"); // 80
    expect(at({ website_url: "https://x.ae", website_state: "audited", audit_score: 50 }).priority).toBe("medium"); // 35
    expect(at({ website_url: "https://x.ae", website_state: "audited", audit_score: 52 }).priority).toBe("low"); // 34
    expect(at({ website_url: "https://x.ae", website_state: "audited", audit_score: 100 }, WITH_CONTACT).priority).toBe("low"); // 30
  });
});

describe("explainability", () => {
  it("the breakdown adds up to the score, and the reasons sentence lists every point awarded", () => {
    const s = scoreLead(L({ ...WITH_CONTACT, website_url: "https://x.ae", website_state: "audited", audit_score: 40 }));
    expect(s.criteria.reduce((n, c) => n + c.points, 0)).toBe(s.score);
    expect(s.breakdown).toBe("website=42;phone=20;address=10");
    expect(s.reasons).toBe("The website scored 40 out of 100 in the audit (+42); A phone number is listed (+20); An address is listed (+10).");
  });

  it("the same lead always gets the same score (no randomness, no model)", () => {
    const l = L({ ...WITH_CONTACT });
    expect(scoreLead(l)).toEqual(scoreLead({ ...l }));
  });

  it("applyScore fills the score fields and leaves everything else alone", () => {
    const l = L({ ...WITH_CONTACT, notes: "keep me", status: "qualified" });
    const scored = applyScore(l);
    expect(scored).toMatchObject({ lead_score: 80, priority: "high", score_breakdown: "website=50;phone=20;address=10", notes: "keep me", status: "qualified", business_name: "Al Noor" });
    expect(scored.score_reasons).toMatch(/^No website is listed in the source/);
  });
});
