import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GuardianGate } from "../guardian-link.js";
import { createTestApp, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Assistant's "safe" and "review" edits stand in for owner-only routes (PATCH /api/projects/:id, PATCH /api/knowledge/docs/:id). These tests pin that
 * the shortcut is NOT a way around the same rules: a phone is refused, and when a Guardian is configured the passphrase proof is required. Lookups stay open.
 */
const HOST = "my-pc.tail1234.ts.net";
let t: TestApp;
let dist: string;
afterEach(async () => {
  await t?.app.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const fakeGuardian = (): GuardianGate => ({
  held: () => null,
  checkProof: async (token: string) => token === "good-proof",
  view: () => ({ configured: true, url: "http://127.0.0.1:1", reachable: true, state: "running", reason: null, held: null, tier: "A", passphraseSet: true, presence: null, protectsOwnerActions: true }),
});

describe("phone: lookups yes, edits no", () => {
  beforeEach(async () => {
    dist = mkdtempSync(join(tmpdir(), "awp-dist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>dash</title>");
    t = await createTestApp({ remoteHosts: [HOST], dashboardDir: dist });
  });
  const remote = async (method: string, url: string, body?: unknown, cookie?: string) => {
    const res = await t.app.inject({ method: method as any, url, headers: { host: HOST, "x-awp-client": "dashboard", origin: `https://${HOST}`, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, body: res.body ? (res.json() as any) : undefined, headers: res.headers };
  };
  async function pair() {
    const code = (await t.call("POST", "/api/devices/pairing")).body.code;
    const r = await remote("POST", "/api/devices/pair", { code, name: "Pixel" });
    return String(r.headers["set-cookie"]).split(";")[0]!;
  }

  it("a paired phone can look things up but cannot rename, tag or ask for a rewrite through the assistant", async () => {
    const cookie = await pair();
    const p = (await t.call("POST", "/api/projects", { name: "Cafe" })).body.project;
    // the real route is owner-only on a phone ...
    expect((await remote("PATCH", `/api/projects/${p.id}`, { name: "Hacked" }, cookie)).status).toBe(403);
    // ... and the assistant shortcut is too
    const edit = await remote("POST", "/api/assistant/interpret", { text: "rename project Cafe to Hacked" }, cookie);
    expect(edit.status).toBe(403);
    expect(edit.body.error).toBe("owner_only");
    expect((await remote("POST", "/api/assistant/interpret", { text: "improve the instructions of agent Nobody" }, cookie)).status).toBe(403);
    expect((await t.call("GET", `/api/projects/${p.id}`)).body.project.name).toBe("Cafe");
    expect((await t.call("GET", "/api/assistant/actions")).body.actions).toEqual([]); // nothing even proposed or logged as applied
    // lookups, refusals of restricted things and the overview stay available from the phone
    const find = await remote("POST", "/api/assistant/interpret", { text: "open my latest project" }, cookie);
    expect(find.status).toBe(200);
    expect(find.body).toMatchObject({ kind: "locate", candidates: [{ id: p.id }] });
    expect((await remote("POST", "/api/assistant/interpret", { text: "what's the status" }, cookie)).status).toBe(200);
    expect((await remote("POST", "/api/assistant/interpret", { text: "delete the project Cafe" }, cookie)).body.message).toMatch(/I will not do that myself/);
  });

  it("confirming, rejecting and undoing remain owner-only on a phone", async () => {
    const cookie = await pair();
    const id = "00000000-0000-4000-8000-000000000000";
    for (const op of ["confirm", "reject", "undo"]) expect((await remote("POST", `/api/assistant/actions/${id}/${op}`, undefined, cookie)).status).toBe(403);
  });
});

describe("this PC with a Guardian: the passphrase proof is needed for edits, not for lookups", () => {
  beforeEach(async () => {
    t = await createTestApp({ guardian: fakeGuardian() });
  });
  const call = (method: string, url: string, body?: unknown, proof?: string) =>
    t.app.inject({ method: method as any, url, headers: { "x-awp-client": "dashboard", ...(proof ? { "x-awp-proof": proof } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) }).then((r) => ({ status: r.statusCode, body: r.body ? (r.json() as any) : undefined }));

  it("an edit without the proof (or with a wrong one) is refused and changes nothing; with the proof it works", async () => {
    // a project is created with the proof, as the owner would
    const p = (await call("POST", "/api/projects", { name: "Cafe" }, "good-proof")).body.project;
    expect((await call("PATCH", `/api/projects/${p.id}`, { name: "x" })).status).toBe(403); // the real route needs it
    const none = await call("POST", "/api/assistant/interpret", { text: "rename project Cafe to Shop" });
    expect(none.status).toBe(403);
    expect(none.body.error).toBe("proof_required");
    expect((await call("POST", "/api/assistant/interpret", { text: "rename project Cafe to Shop" }, "wrong")).status).toBe(403);
    expect((await call("GET", `/api/projects/${p.id}`)).body.project.name).toBe("Cafe");
    const ok = await call("POST", "/api/assistant/interpret", { text: "rename project Cafe to Shop" }, "good-proof");
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe("applied");
    expect((await call("GET", `/api/projects/${p.id}`)).body.project.name).toBe("Shop");
  });

  it("lookups and refusals of restricted requests need no proof (they change nothing)", async () => {
    const p = (await call("POST", "/api/projects", { name: "Cafe" }, "good-proof")).body.project;
    expect((await call("POST", "/api/assistant/interpret", { text: "open my latest project" })).body).toMatchObject({ kind: "locate", candidates: [{ id: p.id }] });
    expect((await call("POST", "/api/assistant/interpret", { text: "approve the pending approval" })).body.message).toMatch(/I will not do that myself/);
    expect((await call("POST", "/api/assistant/interpret", { text: "Tell me a joke" })).body.handled).toBe(false);
  });
});
