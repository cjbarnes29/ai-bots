import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirewallRuleAdapter, VmrunAdapter, type AdapterResult, type NetAdapter, type Runner, type VmAdapter } from "./adapters.js";
import { GuardianCore, IDLE_LIMIT_MS, PROOF_WINDOW_MS, type Command } from "./core.js";
import { GENESIS, Journal, readEntries, verifyEntries } from "./journal.js";
import { LEASE_TTL_MS, newLeaseKey, signLease, verifyLease } from "./lease.js";
import { checkStrength, hashPassphrase, verifyPassphrase } from "./passphrase.js";
import { parsePresenceLine, type PresenceSample, type PresenceSource } from "./presence.js";
import { descendants, ProcessTreeGuard, type ProcessSnapshot, type ProcessTable, type ProcInfo } from "./process-tree.js";
import { createGuardianServer } from "./server.js";

const PASS = "correct horse battery staple";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guardian-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ------------------------------------------------------------------ fakes (nothing here touches a real process, VM or firewall)
class FakeTable implements ProcessTable {
  killed: number[] = [];
  killFails = new Set<number>();
  constructor(public snap: ProcessSnapshot) {}
  async snapshot() {
    return { listenerPid: this.snap.listenerPid, procs: this.snap.procs.filter((p) => !this.killed.includes(p.pid)) };
  }
  kill(pid: number) {
    if (this.killFails.has(pid)) return false;
    this.killed.push(pid);
    return true;
  }
}
const proc = (pid: number, ppid: number, name: string, start = "2026-01-01T00:00:00.000Z"): ProcInfo => ({ pid, ppid, name, path: `C:\\fake\\${name}`, start });

class FakePresence implements PresenceSource {
  s: PresenceSample | null = null;
  start() {}
  stop() {}
  sample() {
    return this.s;
  }
}
const ok = (detail: string): AdapterResult => ({ ok: true, detail });

interface Rig {
  core: GuardianCore;
  journal: Journal;
  table: FakeTable;
  presence: FakePresence;
  clock: { t: number };
  vm: { calls: string[] };
  net: { calls: string[] };
  key: Buffer;
}
function rig(opts: { vm?: boolean; net?: boolean; presenceRequired?: boolean; withPass?: boolean; presence?: boolean; netFails?: boolean } = {}): Rig {
  const clock = { t: Date.parse("2026-11-04T09:00:00Z") };
  const journal = new Journal(join(dir, "journal.jsonl"), () => clock.t);
  const table = new FakeTable({
    listenerPid: 100,
    procs: [proc(100, 4000, "node.exe"), proc(101, 100, "node.exe"), proc(102, 101, "cmd.exe"), proc(103, 102, "git.exe"), proc(200, 1, "notepad.exe"), proc(300, 100, "svchost.exe"), proc(301, 100, "explorer.exe")],
  });
  const presence = new FakePresence();
  presence.s = { locked: false, idleMs: 0, at: clock.t };
  const vm: VmAdapter & { calls: string[] } = { calls: [], suspend: async () => (vm.calls.push("suspend"), ok("suspended")), stop: async (hard) => (vm.calls.push(hard ? "stop-hard" : "stop-soft"), ok("stopped")) };
  const net: NetAdapter & { calls: string[] } = { calls: [], block: async () => (net.calls.push("block"), opts.netFails ? { ok: false, detail: "no admin" } : ok("blocked")), unblock: async () => (net.calls.push("unblock"), ok("unblocked")) };
  const key = newLeaseKey();
  const core = new GuardianCore({
    dir,
    now: () => clock.t,
    journal,
    tree: new ProcessTreeGuard(table, 9999),
    vm: opts.vm ? vm : null,
    net: opts.net ? net : null,
    presence: opts.presence === false ? null : presence,
    presenceRequired: opts.presenceRequired ?? true,
    leaseKey: key,
    sleep: async () => undefined,
  });
  if (opts.withPass !== false) writeFileSync(join(dir, "passphrase.json"), JSON.stringify(hashPassphrase(PASS)));
  return { core, journal, table, presence, clock, vm, net, key };
}
const cmd = (c: Command) => c;
const resume = (r: Rig) => r.core.handle(cmd({ cmd: "resume", passphrase: PASS }));

// ------------------------------------------------------------------ passphrase
describe("the owner passphrase", () => {
  it("is stored only as a salted hash and verified without comparing plain text", () => {
    const rec = hashPassphrase(PASS);
    expect(JSON.stringify(rec)).not.toContain("horse");
    expect(verifyPassphrase(PASS, rec)).toBe(true);
    expect(verifyPassphrase(PASS + "x", rec)).toBe(false);
    expect(verifyPassphrase("", rec)).toBe(false);
    expect(hashPassphrase(PASS).hash).not.toBe(rec.hash); // new salt every time
  });
  it("refuses weak passphrases", () => {
    expect(checkStrength("short")).toMatch(/at least 12/);
    expect(checkStrength("aaaaaaaaaaaaaaaa")).toMatch(/more different/);
    expect(checkStrength(" leading space here")).toMatch(/space/);
    expect(checkStrength(PASS)).toBeNull();
  });
});

// ------------------------------------------------------------------ journal
describe("the hash-chained journal", () => {
  it("verifies, and reports where an edited or deleted line breaks the chain", () => {
    const j = new Journal(join(dir, "j.jsonl"));
    for (let i = 0; i < 5; i++) j.append("event", { i });
    expect(j.verify()).toEqual({ ok: true, count: 5 });
    const file = join(dir, "j.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, [lines[0], lines[1]!.replace('"i":1', '"i":99'), ...lines.slice(2)].join("\n") + "\n");
    expect(j.verify()).toMatchObject({ ok: false, at: 1 });
    writeFileSync(file, [lines[0], ...lines.slice(2)].join("\n") + "\n"); // a deleted line
    expect(j.verify()).toMatchObject({ ok: false });
  });
  it("continues the same chain after a restart", () => {
    const a = new Journal(join(dir, "j.jsonl"));
    a.append("one");
    const b = new Journal(join(dir, "j.jsonl"));
    b.append("two");
    expect(readEntries(join(dir, "j.jsonl")).map((e) => e.seq)).toEqual([1, 2]);
    expect(b.verify().ok).toBe(true);
    expect(verifyEntries(readEntries(join(dir, "j.jsonl")), GENESIS).ok).toBe(true);
  });
  it("documents its Tier A limit: a whole-file rewrite by the same user is NOT detected", () => {
    const j = new Journal(join(dir, "j.jsonl"));
    j.append("original");
    const forged = new Journal(join(dir, "forged.jsonl"));
    forged.append("forged");
    writeFileSync(join(dir, "j.jsonl"), readFileSync(join(dir, "forged.jsonl"), "utf8"));
    expect(j.verify().ok).toBe(true); // a rewritten, self-consistent chain looks valid: this is why Tier A is detection only
  });
});

// ------------------------------------------------------------------ lease
describe("leases", () => {
  it("are valid for a short time and refuse forgeries", () => {
    const key = newLeaseKey();
    const token = signLease(key, 1000);
    expect(verifyLease(key, token, 1000 + LEASE_TTL_MS - 1).ok).toBe(true);
    expect(verifyLease(key, token, 1000 + LEASE_TTL_MS)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyLease(newLeaseKey(), token, 1000)).toMatchObject({ ok: false, reason: "bad_signature" });
    // Change the FIRST character of the signature. (The old test changed the LAST one; in base64url the last character of a 32-byte signature carries
    // only 4 meaningful bits, so the change was sometimes ignored by decoding and the "forgery" was the genuine signature: a flaky failure, not a flaw.)
    const [payloadPart, sigPart] = token.split(".");
    const forged = `${payloadPart}.${sigPart!.startsWith("A") ? "B" : "A"}${sigPart!.slice(1)}`;
    expect(Buffer.from(forged.split(".")[1]!, "base64url").equals(Buffer.from(sigPart!, "base64url"))).toBe(false);
    expect(verifyLease(key, forged, 1000).ok).toBe(false);
    expect(verifyLease(key, "garbage", 1000)).toMatchObject({ ok: false, reason: "malformed" });
  });
});

// ------------------------------------------------------------------ core
describe("the Guardian core", () => {
  it("starts PAUSED after every start, and only the passphrase resumes it", async () => {
    const r = rig();
    expect(r.core.status().state).toBe("PAUSED");
    expect(await r.core.handle({ cmd: "resume", passphrase: "wrong passphrase!!" })).toMatchObject({ ok: false, code: "wrong_passphrase" });
    expect(r.core.status().state).toBe("PAUSED");
    expect(await resume(r)).toMatchObject({ ok: true, state: "RUN" });
  });
  it("issues no lease unless it is RUN", async () => {
    const r = rig();
    expect(await r.core.handle({ cmd: "lease" })).toMatchObject({ ok: false, code: "not_running" });
    await resume(r);
    const out = (await r.core.handle({ cmd: "lease" })) as { ok: true; lease: string };
    expect(verifyLease(r.key, out.lease, r.clock.t).ok).toBe(true);
    await r.core.handle({ cmd: "pause" });
    expect(await r.core.handle({ cmd: "lease" })).toMatchObject({ ok: false });
  });
  it("PAUSE needs no passphrase, ends every decision window, and cannot be undone without the passphrase", async () => {
    const r = rig();
    const res = (await resume(r)) as unknown as { token: string };
    expect(r.core.checkProof(res.token)).toBe(true);
    await r.core.handle({ cmd: "pause" });
    expect(r.core.checkProof(res.token)).toBe(false);
    expect(r.core.status().state).toBe("PAUSED");
  });
  it("the decision window lasts exactly 10 minutes and only while RUN", async () => {
    const r = rig();
    const res = (await resume(r)) as unknown as { token: string };
    r.clock.t += PROOF_WINDOW_MS - 1;
    expect(r.core.checkProof(res.token)).toBe(true);
    r.clock.t += 1;
    expect(r.core.checkProof(res.token)).toBe(false);
    expect(r.core.checkProof("not-a-real-token-at-all")).toBe(false);
  });
  it("opens a new window with the passphrase, and refuses a proof while paused", async () => {
    const r = rig();
    expect(await r.core.handle({ cmd: "proof", passphrase: PASS })).toMatchObject({ ok: false, code: "not_running" });
    await resume(r);
    const p = (await r.core.handle({ cmd: "proof", passphrase: PASS })) as { ok: true; token: string };
    expect(r.core.checkProof(p.token)).toBe(true);
    expect(await r.core.handle({ cmd: "proof", passphrase: "nope nope nope nope" })).toMatchObject({ ok: false, code: "wrong_passphrase" });
  });
  it("locks out guessing: 5 wrong tries, then a wait, and never logs the passphrase text", async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) await r.core.handle({ cmd: "resume", passphrase: `wrong guess number ${i}` });
    expect(await resume(r)).toMatchObject({ ok: false, code: "too_many_attempts" });
    r.clock.t += 15 * 60_000 + 1;
    expect(await resume(r)).toMatchObject({ ok: true });
    const log = readFileSync(join(dir, "journal.jsonl"), "utf8");
    expect(log).not.toContain("wrong guess");
    expect(log).not.toContain("horse battery");
    expect(log).toContain("passphrase_lockout");
  });
  it("refuses to resume when no passphrase has been set", async () => {
    const r = rig({ withPass: false });
    expect(await r.core.handle({ cmd: "resume", passphrase: "anything at all here" })).toMatchObject({ ok: false, code: "no_passphrase" });
  });
  it("session lock pauses immediately", async () => {
    const r = rig();
    await resume(r);
    r.presence.s = { locked: true, idleMs: 0, at: r.clock.t };
    await r.core.tick();
    expect(r.core.status()).toMatchObject({ state: "PAUSED", reason: "session_locked" });
  });
  it("15 minutes without input pauses; 14 minutes 59 seconds does not", async () => {
    const r = rig();
    await resume(r);
    r.presence.s = { locked: false, idleMs: IDLE_LIMIT_MS - 1000, at: r.clock.t };
    await r.core.tick();
    expect(r.core.status().state).toBe("RUN");
    r.presence.s = { locked: false, idleMs: IDLE_LIMIT_MS, at: r.clock.t };
    await r.core.tick();
    expect(r.core.status()).toMatchObject({ state: "PAUSED", reason: "idle_15_minutes" });
  });
  it("a silent presence monitor pauses after a minute (fails closed), unless the owner switched presence off", async () => {
    const r = rig();
    await resume(r);
    r.clock.t += 25_000;
    await r.core.tick();
    expect(r.core.status().state).toBe("RUN"); // not yet: short grace period
    r.clock.t += 61_000;
    await r.core.tick();
    expect(r.core.status()).toMatchObject({ state: "PAUSED", reason: "presence_unavailable" });
    const off = rig({ presence: false, presenceRequired: false });
    await off.core.handle({ cmd: "resume", passphrase: PASS });
    await off.core.tick();
    expect(off.core.status().state).toBe("RUN");
    expect(off.core.status().presence.monitoring).toBe(false);
  });
  it("a pause caused by presence is never undone by coming back: only an explicit resume", async () => {
    const r = rig();
    await resume(r);
    r.presence.s = { locked: true, idleMs: 0, at: r.clock.t };
    await r.core.tick();
    r.presence.s = { locked: false, idleMs: 0, at: r.clock.t };
    await r.core.tick();
    expect(r.core.status().state).toBe("PAUSED");
  });
  it("STOP ends only the Manager's descendants, never the Manager, Windows programs, the Guardian or unrelated programs", async () => {
    const r = rig({ vm: true, net: true });
    await resume(r);
    const res = await r.core.handle({ cmd: "stop" });
    expect(res).toMatchObject({ ok: true, state: "STOPPED" });
    expect(r.table.killed.sort()).toEqual([101, 102, 103]); // node child, its cmd, its git
    expect(r.table.killed).not.toContain(100); // the Manager
    expect(r.table.killed).not.toContain(200); // unrelated notepad
    expect(r.table.killed).not.toContain(300); // svchost under the manager is still protected
    expect(r.table.killed).not.toContain(301); // explorer likewise
    expect(r.vm.calls).toEqual(["suspend"]);
    expect(r.net.calls).toEqual(["block"]);
    expect(r.core.status().netBlocked).toBe(true);
  });
  it("STOP when the Manager cannot be found kills nothing and says so", async () => {
    const r = rig();
    r.table.snap = { listenerPid: 200, procs: r.table.snap.procs }; // notepad is "listening": not a node.exe, so not accepted as the Manager
    await resume(r);
    await r.core.handle({ cmd: "stop" });
    expect(r.table.killed).toEqual([]);
    expect(readFileSync(join(dir, "journal.jsonl"), "utf8")).toContain('"managerFound":false');
  });
  it("catches a program whose parent already exited, if it was seen earlier with the same start time", async () => {
    const r = rig();
    await resume(r);
    await r.core.tick(); // scan records 101, 102, 103
    r.table.snap = { listenerPid: 100, procs: [proc(100, 4000, "node.exe"), proc(102, 1, "cmd.exe"), proc(103, 102, "git.exe"), proc(200, 1, "notepad.exe")] }; // 101 exited; 102 is now orphaned
    await r.core.handle({ cmd: "stop" });
    expect(r.table.killed.sort()).toEqual([102, 103]);
  });
  it("does not kill a different program that reused an old process number", async () => {
    const r = rig();
    await resume(r);
    await r.core.tick();
    r.table.snap = { listenerPid: 100, procs: [proc(100, 4000, "node.exe"), proc(102, 1, "chrome.exe", "2026-06-01T00:00:00.000Z")] }; // pid 102 now belongs to something else
    await r.core.handle({ cmd: "stop" });
    expect(r.table.killed).toEqual([]);
  });
  it("keeps going when one step fails, and reports it", async () => {
    const r = rig({ net: true, netFails: true });
    r.table.killFails.add(102);
    await resume(r);
    const res = (await r.core.handle({ cmd: "stop" })) as { ok: true; steps: { network: { ok: boolean } } };
    expect(res.steps.network.ok).toBe(false);
    expect(r.core.status().netBlocked).toBe(false);
    expect(readFileSync(join(dir, "journal.jsonl"), "utf8")).toContain('"failed":[{"pid":102');
  });
  it("LOCKDOWN stops the VM hard if the soft stop fails, blocks the network, and needs unlock then resume", async () => {
    const r = rig({ vm: true, net: true });
    r.vm.calls.length = 0;
    const failingVm: VmAdapter = { suspend: async () => ok("s"), stop: async (hard) => (r.vm.calls.push(hard ? "stop-hard" : "stop-soft"), hard ? ok("hard") : { ok: false, detail: "no tools" }) };
    const core = new GuardianCore({ dir, now: () => r.clock.t, journal: r.journal, tree: new ProcessTreeGuard(r.table, 9999), vm: failingVm, net: { block: async () => ok("b"), unblock: async () => ok("u") }, presence: r.presence, presenceRequired: true, leaseKey: r.key, sleep: async () => undefined });
    await core.handle({ cmd: "resume", passphrase: PASS });
    await core.handle({ cmd: "lockdown" });
    expect(r.vm.calls).toEqual(["stop-soft", "stop-hard"]);
    expect(core.status().state).toBe("LOCKED");
    expect(await core.handle({ cmd: "resume", passphrase: PASS })).toMatchObject({ ok: false, code: "locked" });
    expect(await core.handle({ cmd: "unlock", passphrase: PASS })).toMatchObject({ ok: true, state: "PAUSED" });
    expect(await core.handle({ cmd: "resume", passphrase: PASS })).toMatchObject({ ok: true, state: "RUN" });
    expect(core.status().netBlocked).toBe(false);
  });
  it("a restart keeps STOPPED and LOCKED, and turns RUN into PAUSED", async () => {
    const r = rig();
    await resume(r);
    const again = new GuardianCore({ dir, now: () => r.clock.t, journal: r.journal, tree: new ProcessTreeGuard(r.table, 9999), vm: null, net: null, presence: r.presence, presenceRequired: true, leaseKey: r.key });
    expect(again.status()).toMatchObject({ state: "PAUSED", reason: "restart" });
    await r.core.handle({ cmd: "lockdown" });
    const third = new GuardianCore({ dir, now: () => r.clock.t, journal: r.journal, tree: new ProcessTreeGuard(r.table, 9999), vm: null, net: null, presence: r.presence, presenceRequired: true, leaseKey: r.key });
    expect(third.status().state).toBe("LOCKED");
  });
  it("records every action in a chain that still verifies", async () => {
    const r = rig();
    await resume(r);
    await r.core.handle({ cmd: "stop" });
    expect(r.journal.verify().ok).toBe(true);
    expect(readEntries(join(dir, "journal.jsonl")).map((e) => e.event)).toEqual(expect.arrayContaining(["guardian_started", "resume", "stop", "programs_stopped"]));
  });
});

// ------------------------------------------------------------------ process tree helpers
describe("process tree", () => {
  it("finds every descendant, deepest last, and survives a loop in the data", () => {
    const procs = [proc(1, 0, "a"), proc(2, 1, "b"), proc(3, 2, "c"), proc(4, 3, "d"), proc(5, 5, "loop")];
    expect(descendants(procs, 1).map((d) => d.proc.pid)).toEqual([2, 3, 4]);
  });
});

// ------------------------------------------------------------------ presence reading
describe("presence readings", () => {
  it("accepts a well-formed reading and rejects anything else", () => {
    expect(parsePresenceLine('{"idleMs":1200,"locked":false}', 5)).toEqual({ idleMs: 1200, locked: false, at: 5 });
    expect(parsePresenceLine('{"idleMs":-1,"locked":false}', 5)).toBeNull();
    expect(parsePresenceLine("garbage", 5)).toBeNull();
    expect(parsePresenceLine('{"idleMs":"1","locked":false}', 5)).toBeNull();
  });
});

// ------------------------------------------------------------------ adapters (fake runner only)
describe("VM and firewall adapters", () => {
  it("build fixed command lines and refuse unsafe settings", async () => {
    const calls: string[][] = [];
    const run: Runner = async (file, args) => (calls.push([file, ...args]), { code: 0, output: "" });
    const vm = new VmrunAdapter("C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe", "C:\\VMs\\ai\\ai.vmx", run);
    await vm.suspend();
    await vm.stop(true);
    expect(calls[0]).toEqual(["C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe", "-T", "ws", "suspend", "C:\\VMs\\ai\\ai.vmx", "soft"]);
    expect(calls[1]![4]).toBe("C:\\VMs\\ai\\ai.vmx");
    expect(calls[1]![5]).toBe("hard");
    expect(() => new VmrunAdapter("vmrun", "C:\\a.vmx", run)).toThrow();
    expect(() => new VmrunAdapter("C:\\x\\vmrun.exe", 'C:\\a" & calc.vmx', run)).toThrow();
    expect(() => new VmrunAdapter("C:\\x\\vmrun.exe", "relative.vmx", run)).toThrow();
    const fw = new FirewallRuleAdapter("AI Workforce VM Block", run);
    await fw.block();
    await fw.unblock();
    expect(calls[2]).toEqual(["netsh", "advfirewall", "firewall", "set", "rule", "name=AI Workforce VM Block", "new", "enable=yes"]);
    expect(calls[3]!.at(-1)).toBe("enable=no");
    expect(() => new FirewallRuleAdapter('x" & calc', run)).toThrow();
  });
});

// ------------------------------------------------------------------ the door
describe("the Guardian server", () => {
  let server: ReturnType<typeof createGuardianServer>;
  let base: string;
  let r: Rig;
  beforeEach(async () => {
    r = rig();
    server = createGuardianServer({ core: r.core, journal: r.journal, allowedOrigins: ["http://127.0.0.1:3000"] });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((done) => server.close(() => done())));
  const post = (body: unknown, headers: Record<string, string> = { "x-awp-guardian": "1" }) => fetch(`${base}/v1/command`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("serves its own page and status", async () => {
    expect((await fetch(`${base}/`)).headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(((await (await fetch(`${base}/v1/status`)).json()) as { state: string }).state).toBe("PAUSED");
  });
  it("accepts only the fixed commands", async () => {
    for (const bad of [{ cmd: "run", program: "calc.exe" }, { cmd: "exec", command: "whoami" }, { cmd: "stop", extra: 1 }, { cmd: "kill", pid: 4 }, {}]) expect((await post(bad)).status).toBe(400);
  });
  it("refuses a change without the Guardian header, from a foreign site, and from a foreign host name", async () => {
    expect((await post({ cmd: "pause" }, {})).status).toBe(403);
    expect((await post({ cmd: "pause" }, { "x-awp-guardian": "1", origin: "http://evil.example" })).status).toBe(403);
    // fetch() ignores a custom Host header, so this one case uses a raw request
    const status = await new Promise<number>((done, fail) => {
      const rq = httpRequest(`${base}/v1/status`, { headers: { host: "evil.example" } }, (rs) => (rs.resume(), done(rs.statusCode ?? 0)));
      rq.on("error", fail);
      rq.end();
    });
    expect(status).toBe(403);
  });
  it("lets the dashboard origin talk to it (CORS) but nobody else", async () => {
    const ok = await post({ cmd: "status" }, { "x-awp-guardian": "1", origin: "http://127.0.0.1:3000" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");
  });
  it("resumes with the passphrase over HTTP, returns a proof token once, and reports wrong passphrases as 401", async () => {
    expect((await post({ cmd: "resume", passphrase: "not the right one!" })).status).toBe(401);
    const res = await post({ cmd: "resume", passphrase: PASS });
    const body = (await res.json()) as { ok: boolean; token: string; state: string };
    expect(body).toMatchObject({ ok: true, state: "RUN" });
    const check = await post({ cmd: "check_proof", token: body.token });
    expect(await check.json()).toEqual({ ok: true, valid: true });
  });
  it("limits request size", async () => {
    expect((await post({ cmd: "resume", passphrase: "x".repeat(10_000) })).status).toBe(413);
  });
  it("exposes the journal and whether its chain is intact", async () => {
    const j = (await (await fetch(`${base}/v1/journal`)).json()) as { chain: { ok: boolean }; entries: unknown[] };
    expect(j.chain.ok).toBe(true);
    expect(j.entries.length).toBeGreaterThan(0);
  });
});
