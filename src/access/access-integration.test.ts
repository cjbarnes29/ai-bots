import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardianGate } from "../guardian-link.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import type { RawDiscovery } from "./discovery.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const HOST = "my-pc.tail1234.ts.net";
const PROOF = "good-proof-token";
const fence = "```";
const act = (connector: string, action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector, action, args })}\n${fence}`;

let t: TestApp;
let base: string;
let ws: string;
let guardHeld: string | null;
/** Setup calls (not under test) are let through; the tests that check the proof turn this off. */
let lenient = false;
const withSetup = async <T,>(fn: () => Promise<T>): Promise<T> => {
  lenient = true;
  const original = t.app.inject.bind(t.app) as (o: any) => Promise<any>;
  // setup calls made through t.call carry a proof header, like the dashboard does after the owner typed the passphrase
  (t.app as any).inject = (o: any) => original({ ...o, headers: { ...(o.headers ?? {}), "x-awp-proof": PROOF } });
  try {
    return await fn();
  } finally {
    (t.app as any).inject = original;
    lenient = false;
  }
};
let ref: string;

const fakeGuardian: GuardianGate = {
  held: () => guardHeld,
  checkProof: async (token) => lenient || token === PROOF,
  view: () => ({ configured: true, url: "x", reachable: true, state: "RUN", reason: null, held: guardHeld, tier: "A", passphraseSet: true, presence: null, protectsOwnerActions: true }),
};

const RAW: RawDiscovery = {
  installed: [{ name: "Editor", version: "1", publisher: "Acme", location: "C:\\Apps\\Editor", icon: "C:\\Apps\\Editor\\editor.exe" }, { name: "UltraViewer", version: "6", publisher: "X", location: "C:\\Apps\\UV", icon: "C:\\Apps\\UV\\uv.exe" }],
  procs: [],
  services: [],
  startup: [],
  tasks: [],
  sigs: [{ path: "C:\\Apps\\Editor\\editor.exe", signer: "CN=Acme" }],
};
let scans = 0;

beforeEach(async () => {
  guardHeld = null;
  scans = 0;
  base = mkdtempSync(join(tmpdir(), "awp-acc-"));
  ws = join(base, "workspace");
  mkdirSync(join(ws, "sub"), { recursive: true });
  writeFileSync(join(ws, "hello.txt"), "Hello");
  writeFileSync(join(ws, ".env"), "SECRET=1");
  t = await createTestApp({
    connectors: [],
    includePc: true,
    guardian: fakeGuardian,
    remoteHosts: [HOST],
    enforceFolderGrants: true,
    accessTesting: { discover: async () => (scans++, RAW), hashFile: () => "abc123" },
  });
  ref = await withSetup(() => setupGeminiModel(t));
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const owner = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, proof: string | null = PROOF) =>
  t.app.inject({ method, url, ...(body !== undefined ? { payload: body as object } : {}), headers: { "x-awp-client": "dashboard", ...(proof ? { "x-awp-proof": proof } : {}) } }).then((r) => ({ status: r.statusCode, body: r.body ? (r.json() as any) : undefined }));
const phone = async (method: any, url: string, cookie?: string, body?: unknown) => {
  const r = await t.app.inject({ method, url, headers: { host: HOST, "x-awp-client": "dashboard", origin: `https://${HOST}`, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: r.statusCode, body: r.body ? (r.json() as any) : undefined, headers: r.headers };
};
const pair = async () => {
  const code = (await withSetup(() => t.call("POST", "/api/devices/pairing"))).body.code;
  const res = await phone("POST", "/api/devices/pair", undefined, { code, name: "Pixel" });
  return String(res.headers["set-cookie"]).split(";")[0]!;
};
// the temp folder sits in the hidden application-data folder, so approving it is a deliberate "sensitive" approval, which is itself under test
const GRANT = () => ({ subject: "workforce", path: ws, ops: ["read", "create", "edit", "delete"], inherit: true, acknowledgeSensitive: "app_data", expiresInMinutes: 60 });

describe("who may change approvals", () => {
  it("creating a folder approval needs the owner's passphrase proof; looking and previewing do not", async () => {
    expect((await owner("GET", "/api/access/folders", undefined, null)).status).toBe(200);
    expect((await owner("POST", "/api/access/folders/preview", GRANT(), null)).status).toBe(200);
    const refused = await owner("POST", "/api/access/folders", GRANT(), null);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("proof_required");
    expect((await owner("POST", "/api/access/folders", GRANT(), "wrong-proof-token")).status).toBe(403);
    expect((await owner("POST", "/api/access/folders", GRANT())).status).toBe(200);
  });

  it("application approvals and the reset need the proof too; revoking never does", async () => {
    const inv = (await owner("POST", "/api/access/applications/scan", {}, null)).body;
    const editor = inv.apps.find((a: any) => a.name === "Editor");
    expect((await owner("PUT", `/api/access/applications/${editor.id}`, { level: "approved", capabilities: ["open"] }, null)).status).toBe(403);
    expect((await owner("POST", `/api/access/applications/${editor.id}/session`, { capabilities: ["open"] }, null)).status).toBe(403);
    expect((await owner("POST", "/api/access/reset", {}, null)).status).toBe(403);
    expect((await owner("PUT", `/api/access/applications/${editor.id}`, { level: "approved", capabilities: ["open"] })).status).toBe(200);
    expect((await owner("POST", `/api/access/applications/${editor.id}/revoke`, {}, null)).status).toBe(200);
    expect((await owner("POST", "/api/access/folders/revoke-all", {}, null)).status).toBe(200);
  });

  it("a paired phone can look and take access away, but cannot grant or approve", async () => {
    const cookie = await pair();
    const g = (await owner("POST", "/api/access/folders", GRANT())).body;
    expect((await phone("GET", "/api/access/folders", cookie)).status).toBe(200);
    expect((await phone("POST", "/api/access/folders", cookie, GRANT())).status).toBe(403);
    expect((await phone("PATCH", `/api/access/folders/${g.id}`, cookie, { ops: ["read", "delete"] })).status).toBe(403);
    expect((await phone("PUT", "/api/access/applications/abc", cookie, { level: "approved", capabilities: ["open"] })).status).toBe(403);
    expect((await phone("POST", "/api/access/reset", cookie, {})).status).toBe(403);
    expect((await phone("POST", `/api/access/folders/${g.id}/revoke`, cookie, {})).status).toBe(200);
  });

  it("the log shows every grant, denial and revoke", async () => {
    const g = (await owner("POST", "/api/access/folders", GRANT())).body;
    await owner("POST", "/api/access/check", { path: join(base, "elsewhere", "x.txt"), op: "read" }, null);
    await owner("POST", `/api/access/folders/${g.id}/revoke`, {}, null);
    const kinds = ((await owner("GET", "/api/access/log", undefined, null)).body.events as any[]).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["access.folder.grant", "access.folder.deny", "access.folder.revoke"]));
  });
});

describe("application discovery over the API", () => {
  it("scans read-only, flags protected programs and refuses to approve them", async () => {
    const inv = (await owner("POST", "/api/access/applications/scan", {}, null)).body;
    expect(scans).toBe(1);
    expect(inv.apps.map((a: any) => a.level).sort()).toEqual(["protected", "unknown"]);
    const uv = inv.apps.find((a: any) => a.name === "UltraViewer");
    const r = await owner("PUT", `/api/access/applications/${uv.id}`, { level: "approved", capabilities: ["open"] });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("protected_application");
    const after = (await owner("GET", "/api/access/applications", undefined, null)).body;
    expect(after.apps.find((a: any) => a.name === "UltraViewer").level).toBe("protected");
  });
  it("approving a program does not open any folder", async () => {
    const inv = (await owner("POST", "/api/access/applications/scan", {}, null)).body;
    const editor = inv.apps.find((a: any) => a.name === "Editor");
    await owner("PUT", `/api/access/applications/${editor.id}`, { level: "approved", capabilities: ["open", "view", "control", "close"] });
    expect((await owner("POST", "/api/access/check", { subject: `app:${editor.id}`, path: join(ws, "hello.txt"), op: "read" }, null)).body.allowed).toBe(false);
  });
});

describe("the PC agent obeys the folder approvals", () => {
  const mkBot = async () => {
    return withSetup(async () => {
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Dev", model: ref }))).body.bot as any;
      await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
      await owner("PUT", `/api/bots/${bot.id}/pc`, { grants: ["read", "modify"] });
      await owner("POST", "/api/pc/workspaces", { path: ws });
      return bot;
    });
  };
  const runTask = async (botId: string, ...blocks: string[]) => {
    t.provider.calls.length = 0;
    t.provider.script.push({ ...OK_RESULT, text: blocks.join("\n") }, { ...OK_RESULT, text: "done" });
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
    return t.provider.calls[1]!.messages[3]!.content as string;
  };

  it("a workspace alone grants nothing: reading is refused until the folder is approved, then works, then stops when revoked", async () => {
    const bot = await mkBot();
    expect(await runTask(bot.id, act("pc", "read_file", { path: "hello.txt" }))).toMatch(/Folder access denied: No folder has been approved/);
    const g = (await owner("POST", "/api/access/folders", { ...GRANT(), ops: ["read"] })).body;
    expect(await runTask(bot.id, act("pc", "read_file", { path: "hello.txt" }))).toContain("Hello");
    // the .env file is a secret place: still refused even inside the approved folder
    expect(await runTask(bot.id, act("pc", "read_file", { path: ".env" }))).toMatch(/refus|secret|denied|looks like/i);
    await owner("POST", `/api/access/folders/${g.id}/revoke`, {}, null);
    expect(await runTask(bot.id, act("pc", "read_file", { path: "hello.txt" }))).toMatch(/Folder access denied/);
  });

  it("an approved write waits for the owner as before, and is checked again when it runs", async () => {
    const bot = await mkBot();
    const g = (await owner("POST", "/api/access/folders", { ...GRANT(), ops: ["read", "create"] })).body;
    await runTask(bot.id, act("pc", "write_file", { path: "new.txt", content: "x" }));
    const pend = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    expect(pend).toHaveLength(1);
    // the owner revokes while the request waits: approving it can no longer write the file
    await owner("POST", `/api/access/folders/${g.id}/revoke`, {}, null);
    await owner("POST", `/api/approvals/${pend[0].id}/approve`);
    expect(existsSync(join(ws, "new.txt"))).toBe(false);
  });

  it("an edit needs the edit operation, a delete the delete operation", async () => {
    const bot = await mkBot();
    await owner("POST", "/api/access/folders", { ...GRANT(), ops: ["read", "create"] });
    await runTask(bot.id, act("pc", "write_file", { path: "hello.txt", content: "changed", overwrite: true }));
    const pend = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    await owner("POST", `/api/approvals/${pend[0].id}/approve`);
    expect(readFileSync(join(ws, "hello.txt"), "utf8")).toBe("Hello"); // create is not edit
  });
});

describe("the Guardian holds the folder system too", () => {
  it("while the Guardian is not RUN every check is refused", async () => {
    await owner("POST", "/api/access/folders", { ...GRANT(), ops: ["read"] });
    expect((await owner("POST", "/api/access/check", { path: join(ws, "hello.txt"), op: "read" }, null)).body.allowed).toBe(true);
    guardHeld = "the Windows session is locked";
    const r = (await owner("POST", "/api/access/check", { path: join(ws, "hello.txt"), op: "read" }, null)).body;
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Guardian/);
  });
});
