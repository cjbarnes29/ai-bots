import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";
import { buildCapabilities } from "./registry.js";
import { vmReadiness } from "./vm-readiness.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const caps = () =>
  buildCapabilities({ tools: [], integrations: [], providers: [], models: [], environment: { platform: "win32", nodeVersion: "v24", cpuThreads: 8, ramGb: 16, guardian: { configured: true, reachable: true, held: null, tier: "A", passphraseSet: true, protectsOwnerActions: true }, approvalsPaused: false, groupsEnabled: false, pcRoots: 1, pcStopped: false, ffmpeg: null } });

describe("desktop and VM readiness (prepare only)", () => {
  it("is never 'ready': nothing about a VM exists and Tier B is not built", () => {
    const r = vmReadiness({ ramGb: 32, cpuThreads: 16, vmwareFound: true, caps: caps() });
    expect(r.ready).toBe(false);
    expect(r.steps.find((s) => s.id === "tier-b")!.state).toBe("not_done");
    expect(r.steps.find((s) => s.id === "vm")!.state).toBe("not_done");
    expect(r.summary).toMatch(/Nothing about a VM has been created/);
  });
  it("every step that would change the machine needs the owner's approval", () => {
    const r = vmReadiness({ ramGb: 32, cpuThreads: 16, vmwareFound: true, caps: caps() });
    for (const id of ["firewall-audit", "image-licence", "account", "firewall-rules", "tier-b", "vm", "in-guest"]) expect(r.steps.find((s) => s.id === id)!.needsOwnerApproval, id).toBe(true);
  });
  it("'met' only with evidence: the Guardian's real-machine checks stay not done (NV-8), unknown VMware stays unknown", () => {
    const r = vmReadiness({ ramGb: 16, cpuThreads: 8, vmwareFound: null, caps: caps() });
    expect(r.steps.find((s) => s.id === "guardian-a-verified")!.state).toBe("not_done");
    expect(r.steps.find((s) => s.id === "vmware")!.state).toBe("unknown");
    expect(r.steps.find((s) => s.id === "guardian-a")!.state).toBe("met");
  });
  it("sizes a guest from the real host and always leaves the owner 8 GB", () => {
    const big = vmReadiness({ ramGb: 32, cpuThreads: 16, vmwareFound: false, caps: caps() }).sizing;
    expect(big.vmRamGb).toBe(8);
    expect(big.vmCpus).toBe(4);
    const small = vmReadiness({ ramGb: 8, cpuThreads: 4, vmwareFound: false, caps: caps() });
    expect(small.sizing.vmRamGb).toBe(0);
    expect(small.sizing.note).toMatch(/not enough spare memory/);
    expect(small.steps.find((s) => s.id === "host")!.state).toBe("not_done");
  });
  it("lists the approvals in the owner's order, audit first and Tier B last", () => {
    const r = vmReadiness({ ramGb: 16, cpuThreads: 8, vmwareFound: false, caps: caps() });
    expect(r.approvalOrder[0]).toMatch(/firewall audit/);
    expect(r.approvalOrder.at(-1)).toMatch(/Tier B/);
  });
});

describe("GET /api/capabilities/vm-readiness", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });
  afterEach(async () => { await t.app.close(); });
  it("answers read-only and never touches the real machine in tests (VMware is 'unknown')", async () => {
    const res = await t.call("GET", "/api/capabilities/vm-readiness");
    expect(res.status).toBe(200);
    expect(res.body.readiness.ready).toBe(false);
    expect((res.body.readiness.steps as any[]).find((s) => s.id === "vmware").state).toBe("unknown");
  });
});
