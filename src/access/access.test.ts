import { beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { AppError } from "../errors.js";
import { appIdFor, type AppIdentity } from "./apps.js";
import { DISCOVERY_SCRIPT, buildInventory, exeFromCommand, type RawDiscovery } from "./discovery.js";
import { classifySensitive, cleanPath, resolvePath, type FsProbe } from "./paths.js";
import { AccessService } from "./service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const clock = { t: Date.parse("2026-11-04T09:00:00Z") };
const MIN = 60_000;
const DAY = 86_400_000;

/** A pretend disk: these folders exist; a "link" makes one path really live somewhere else. Nothing real is read. */
class FakeFs implements FsProbe {
  dirs = new Set<string>();
  links = new Map<string, string>();
  add(...paths: string[]) {
    for (const p of paths) this.dirs.add(p.toLowerCase());
  }
  resolve(abs: string): string | null {
    let p = abs;
    for (const [from, to] of this.links) if (p.toLowerCase() === from || p.toLowerCase().startsWith(from + "\\")) p = to + p.slice(from.length);
    return p;
  }
  isDirectory(abs: string): boolean {
    return this.dirs.has(abs.toLowerCase());
  }
}

let fs: FakeFs;
let kv: Map<string, string>;
let audit: AuditLog;
let held: string | null;
let svc: AccessService;
const hashes = new Map<string, string>();

const mkService = () =>
  new AccessService({
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    audit,
    now: () => clock.t,
    guardHeld: () => held,
    fs,
    home: "C:\\Users\\owner",
    appFolders: () => ["C:\\Users\\owner\\Desktop\\ai bot"],
    hashFile: (p) => hashes.get(p.toLowerCase()) ?? null,
  });

beforeEach(() => {
  clock.t = Date.parse("2026-11-04T09:00:00Z");
  fs = new FakeFs();
  fs.add("D:\\work\\proj", "D:\\work\\proj\\sub", "D:\\work", "D:\\work\\other", "E:\\proj", "C:\\Users\\owner\\Documents", "C:\\Users\\owner");
  kv = new Map();
  held = null;
  hashes.clear();
  audit = new AuditLog(openDatabase(":memory:"), () => clock.t);
  svc = mkService();
});

const kinds = () => audit.list(500).map((e) => e.kind);
const grant = (over: Record<string, unknown> = {}) => svc.folders.grant({ subject: "workforce", path: "D:\\work\\proj", ops: ["read"], ...over } as any, "owner");
const can = (path: string, op: any, extra: Record<string, unknown> = {}) => svc.folders.authorize({ subject: "workforce", path, op, ...extra }).allowed;

describe("path rules", () => {
  it("refuses network, device, stream, relative, tricky and reserved paths", () => {
    for (const bad of ["\\\\server\\share\\x", "\\\\?\\C:\\x", "//server/x", "relative\\x", "C:x", "C:\\a\\b.txt:stream", "C:\\a\\b.\\c", "C:\\a\\con", "C:\\a\\x*", "https://example.com/x", "", "C:\\a\u0000b"]) {
      expect(cleanPath(bad).ok, bad).toBe(false);
    }
    expect(cleanPath("C:/Users/x/../y/./z").ok && (cleanPath("C:/Users/x/../y/./z") as any).value.path).toBe("C:\\Users\\y\\z");
  });
  it("refuses unresolved 8.3 short names", () => {
    expect(resolvePath("C:\\PROGRA~1\\x", fs).ok).toBe(false);
  });
  it("recognises secret and personal places", () => {
    const k = (p: string) => classifySensitive(p.toLowerCase());
    expect(k("c:\\u\\.ssh\\id_rsa")).toBe("ssh_keys");
    expect(k("d:\\proj\\.env")).toBe("env_files");
    expect(k("d:\\proj\\.env.local")).toBe("env_files");
    expect(k("c:\\users\\a\\appdata\\local\\google\\chrome\\user data\\default")).toBe("browser_profile");
    expect(k("c:\\users\\a\\appdata\\roaming\\mozilla\\firefox\\profiles\\x")).toBe("browser_profile");
    expect(k("d:\\vault.kdbx")).toBe("password_store");
    expect(k("c:\\users\\a\\appdata\\roaming\\telegram desktop\\tdata")).toBe("chat");
    expect(k("d:\\mail\\archive.pst")).toBe("mail");
    expect(k("d:\\proj\\.git-credentials")).toBe("tokens");
    expect(k("d:\\proj\\src\\index.ts")).toBeNull();
  });
});

describe("folder permissions", () => {
  it("denies everything by default and records each denial", () => {
    expect(can("D:\\work\\proj\\a.txt", "read")).toBe(false);
    const ev = audit.list(5).find((e) => e.kind === "access.folder.deny")!;
    expect(ev.detail["reason"]).toMatch(/No folder has been approved/);
  });

  it("approves exactly one folder: not its parent, siblings, other drives, or sub-folders (unless asked)", () => {
    grant();
    expect(can("D:\\work\\proj", "read")).toBe(true);
    expect(can("D:\\work\\proj\\a.txt", "read")).toBe(true);
    expect(can("D:\\work\\proj\\sub", "read")).toBe(true); // the sub-folder entry itself is a direct child
    expect(can("D:\\work\\proj\\sub\\deep.txt", "read")).toBe(false); // but not what is inside it
    expect(can("D:\\work", "read")).toBe(false); // parent
    expect(can("D:\\work\\other\\a.txt", "read")).toBe(false); // sibling
    expect(can("E:\\proj\\a.txt", "read")).toBe(false); // other drive
    expect(can("D:\\work\\proj2\\a.txt", "read")).toBe(false); // name that merely starts the same
    expect(can("D:\\WORK\\PROJ\\A.TXT", "read")).toBe(true); // Windows ignores case
  });

  it("inherits to sub-folders only when explicitly configured", () => {
    grant({ inherit: true });
    expect(can("D:\\work\\proj\\sub\\deep\\x.txt", "read")).toBe(true);
    expect(can("D:\\work\\x.txt", "read")).toBe(false);
  });

  it("keeps the five operations separate", () => {
    grant({ ops: ["read", "create"] });
    expect(can("D:\\work\\proj\\n.txt", "create")).toBe(true);
    for (const op of ["edit", "rename", "delete"]) expect(can("D:\\work\\proj\\n.txt", op)).toBe(false);
  });

  it("never lets a grant delete or rename the approved folder itself; deleting a folder needs an inheriting grant", () => {
    grant({ ops: ["read", "rename", "delete"] });
    expect(can("D:\\work\\proj", "delete", { isDirectory: true })).toBe(false);
    expect(can("D:\\work\\proj", "rename", { isDirectory: true })).toBe(false);
    expect(can("D:\\work\\proj\\f.txt", "delete")).toBe(true);
    expect(can("D:\\work\\proj\\sub", "delete", { isDirectory: true })).toBe(false); // would remove everything inside
    svc.folders.revokeAll("owner");
    grant({ ops: ["delete"], inherit: true });
    expect(can("D:\\work\\proj\\sub", "delete", { isDirectory: true })).toBe(true);
    expect(can("D:\\work\\proj", "delete", { isDirectory: true })).toBe(false);
  });

  it("uses the real location: a link out of the folder is refused, and ../ tricks collapse", () => {
    grant({ inherit: true });
    fs.links.set("d:\\work\\proj\\shortcut", "D:\\secret\\place");
    expect(can("D:\\work\\proj\\shortcut\\x.txt", "read")).toBe(false);
    expect(can("D:\\work\\proj\\sub\\..\\..\\other\\x.txt", "read")).toBe(false);
    expect(can("D:\\work\\proj\\sub\\..\\ok.txt", "read")).toBe(true);
  });

  it("refuses targets that must never be approved", () => {
    for (const bad of ["D:\\", "C:\\Windows\\System32", "C:\\Program Files", "C:\\Users\\owner", "C:\\Users", "C:\\Users\\owner\\Desktop\\ai bot"]) {
      fs.add(bad);
      expect(() => grant({ path: bad }), bad).toThrow(AppError);
    }
    expect(() => grant({ path: "D:\\missing" })).toThrow(/does not exist/);
    expect(() => grant({ ops: [] })).toThrow();
    expect(() => grant({ ops: ["format"] })).toThrow();
    expect(() => grant({ subject: "root" })).toThrow();
  });

  it("does not let an ordinary grant reach secrets or personal data, even inside the folder", () => {
    grant({ inherit: true, ops: ["read", "edit", "create", "delete"] });
    for (const p of ["D:\\work\\proj\\.env", "D:\\work\\proj\\.ssh\\id_rsa", "D:\\work\\proj\\mail.pst", "D:\\work\\proj\\keys.kdbx", "D:\\work\\proj\\.git-credentials"]) {
      expect(can(p, "read"), p).toBe(false);
    }
    expect(audit.list(10).some((e) => String(e.detail["reason"]).includes("separate approval"))).toBe(true);
  });

  it("allows a secrets place only through its own short-lived, named approval", () => {
    fs.add("D:\\work\\proj\\.ssh");
    expect(() => grant({ path: "D:\\work\\proj\\.ssh" })).toThrow(/confirm the kind/);
    expect(() => grant({ path: "D:\\work\\proj\\.ssh", acknowledgeSensitive: "ssh_keys" })).toThrow(/within 24 hours/);
    expect(() => grant({ path: "D:\\work\\proj\\.ssh", acknowledgeSensitive: "ssh_keys", expiresInMinutes: 48 * 60 })).toThrow(/within 24 hours/);
    const g = grant({ path: "D:\\work\\proj\\.ssh", acknowledgeSensitive: "ssh_keys", expiresInMinutes: 30 });
    expect(g.sensitive).toBe("ssh_keys");
    expect(can("D:\\work\\proj\\.ssh\\id_rsa", "read")).toBe(true);
    expect(can("D:\\work\\proj\\.env", "read")).toBe(false); // another kind is still closed
    expect(() => svc.folders.change(g.id, { expiresInMinutes: null }, "owner")).toThrow(/within 24 hours/);
    clock.t += 31 * MIN;
    expect(can("D:\\work\\proj\\.ssh\\id_rsa", "read")).toBe(false);
  });

  it("a sub-folder grant's sensitive flag does not widen an ordinary grant, and the ordinary grant does not cover the secret", () => {
    fs.add("C:\\Users\\owner\\AppData\\Local\\Google\\Chrome\\User Data");
    expect(() => grant({ path: "C:\\Users\\owner\\AppData\\Local\\Google\\Chrome\\User Data", ops: ["read"] })).toThrow(/confirm the kind/);
  });

  it("temporary grants expire, and the expiry is recorded once", () => {
    grant({ expiresInMinutes: 10 });
    expect(can("D:\\work\\proj\\a", "read")).toBe(true);
    clock.t += 10 * MIN + 1;
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
    expect(kinds().filter((k) => k === "access.folder.expire")).toHaveLength(1);
    expect(svc.folders.list()[0]!.status).toBe("expired");
  });

  it("revoking invalidates the grant at once, including a job that already started", () => {
    const g = grant({ inherit: true });
    const verdict = svc.folders.authorize({ subject: "workforce", path: "D:\\work\\proj\\a", op: "read" });
    expect(svc.folders.stillValid(verdict)).toBe(true);
    const before = svc.folders.generation();
    svc.folders.revoke(g.id, "owner");
    expect(svc.folders.stillValid(verdict)).toBe(false);
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
    expect(svc.folders.generation()).toBeGreaterThan(before);
    expect(kinds()).toContain("access.folder.revoke");
  });

  it("records every grant, change, revoke and the take-it-all-back button", () => {
    const g = grant({ ops: ["read"] });
    svc.folders.change(g.id, { ops: ["read", "edit"], inherit: true }, "owner");
    const change = audit.list(5).find((e) => e.kind === "access.folder.change")!;
    expect((change.detail["before"] as any).ops).toEqual(["read"]);
    expect((change.detail["after"] as any).ops).toEqual(["read", "edit"]);
    grant({ path: "D:\\work\\other" });
    expect(svc.folders.revokeAll("owner")).toBe(2);
    expect(kinds()).toEqual(expect.arrayContaining(["access.folder.grant", "access.folder.change", "access.folder.revoke_all"]));
    expect(svc.folders.list().every((x) => x.status === "revoked")).toBe(true);
  });

  it("is blocked while the Guardian holds everything", () => {
    grant();
    held = "the Windows session is locked";
    const v = svc.folders.authorize({ subject: "workforce", path: "D:\\work\\proj\\a", op: "read" });
    expect(v.allowed).toBe(false);
    expect((v as any).reason).toMatch(/Guardian/);
    held = null;
    expect(can("D:\\work\\proj\\a", "read")).toBe(true);
  });

  it("denies everything when the saved permissions were edited by hand, until the owner resets", () => {
    grant();
    const raw = JSON.parse(kv.get("access.state")!);
    raw.folders[0].ops = ["read", "edit", "create", "rename", "delete"];
    raw.folders[0].inherit = true;
    kv.set("access.state", JSON.stringify(raw));
    svc = mkService();
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
    expect(svc.store.tampered()).toMatch(/checksum/);
    expect(() => grant({ path: "D:\\work\\other" })).toThrow(/damaged|reset/);
    svc.reset("owner");
    expect(svc.store.tampered()).toBeNull();
    expect(svc.folders.list()).toHaveLength(0);
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
  });

  it("keeps grants for one requester away from another", () => {
    grant({ subject: "app:abcd1234" });
    expect(can("D:\\work\\proj\\a", "read")).toBe(false);
    expect(svc.folders.authorize({ subject: "app:abcd1234", path: "D:\\work\\proj\\a", op: "read" }).allowed).toBe(true);
  });

  it("previews in plain words what a grant would and would not allow", () => {
    const p = svc.folders.preview({ subject: "workforce", path: "D:\\work\\proj", ops: ["read", "delete"], inherit: false });
    expect(p.ok).toBe(true);
    expect(p.allows[0]).toMatch(/read and list files, delete files and folders/);
    expect(p.doesNotAllow.join(" ")).toMatch(/not the parent folder/);
    expect(p.warnings.join(" ")).toMatch(/Delete is included/);
    expect(svc.folders.preview({ subject: "workforce", path: "nope", ops: ["read"] }).ok).toBe(false);
  });
});

const ident = (name: string, over: Partial<AppIdentity> = {}): AppIdentity => ({ id: appIdFor(`C:\\Apps\\${name}.exe`, name, "Acme"), name, exePath: `C:\\Apps\\${name}.exe`, publisher: "Acme", signed: true, ...over });

describe("application policy", () => {
  it("treats every new program as unknown: denied until approved for this session", () => {
    const a = ident("Notepadish");
    const d = svc.apps.decide(a, "open");
    expect(d).toMatchObject({ allowed: false, level: "unknown", needsSessionApproval: true, grantsDataAccess: false });
    svc.apps.approveForSession(a, ["open", "view"], "owner");
    expect(svc.apps.decide(a, "open").allowed).toBe(true);
    expect(svc.apps.decide(a, "control").allowed).toBe(false); // only what was ticked
    // "once per session": a new session (restart) forgets it
    expect(mkService().apps.decide(a, "open").allowed).toBe(false);
  });

  it("lets the owner choose exact capabilities; files and accounts are not capabilities", () => {
    const a = ident("Editor");
    expect(() => svc.apps.set(a, { level: "approved", capabilities: ["files"] }, "owner")).toThrow(/approved separately/);
    expect(() => svc.apps.set(a, { level: "approved", capabilities: [] }, "owner")).toThrow();
    svc.apps.set(a, { level: "approved", capabilities: ["open", "view"] }, "owner");
    expect(svc.apps.decide(a, "view").allowed).toBe(true);
    expect(svc.apps.decide(a, "close")).toMatchObject({ allowed: false, level: "approved" });
  });

  it("an application approval never grants a folder, and a folder approval never grants an application", () => {
    const a = ident("Editor");
    const id = a.id;
    hashes.set(a.exePath!.toLowerCase(), "x");
    svc.apps.set(a, { level: "trusted", capabilities: ["open", "view", "control", "close"], reviewInDays: 30 }, "owner");
    // identity must be in the last scan for the facade; use the policy and folder system directly, as independent parts
    expect(svc.apps.decide(a, "control").allowed).toBe(true);
    expect(svc.apps.decide(a, "control").grantsDataAccess).toBe(false);
    expect(svc.folders.authorize({ subject: `app:${id}`, path: "D:\\work\\proj\\a", op: "read" }).allowed).toBe(false);
    grant({ subject: `app:${id}` });
    expect(svc.folders.authorize({ subject: `app:${id}`, path: "D:\\work\\proj\\a", op: "read" }).allowed).toBe(true);
    // folder approval alone for another (unknown) program does not approve the program
    const other = ident("Other");
    grant({ subject: `app:${other.id}`, path: "D:\\work\\other" });
    expect(svc.apps.decide(other, "open").allowed).toBe(false);
  });

  it("trusted needs a publisher signature, a review date and a pinned file fingerprint; it lapses and detects changes", () => {
    const a = ident("Signed");
    hashes.set(a.exePath!.toLowerCase(), "hash-1");
    expect(() => svc.apps.set(ident("Unsigned", { signed: false, publisher: null }), { level: "trusted", capabilities: ["open"], reviewInDays: 30 }, "owner")).toThrow(/publisher signature/);
    expect(() => svc.apps.set(a, { level: "trusted", capabilities: ["open"] }, "owner")).toThrow(/review date/);
    expect(() => svc.apps.set(a, { level: "trusted", capabilities: ["open"], reviewInDays: 400 }, "owner")).toThrow(/review date/);
    expect(() => svc.apps.set(ident("Missing"), { level: "trusted", capabilities: ["open"], reviewInDays: 30 }, "owner")).toThrow(/fingerprint/);
    svc.apps.set(a, { level: "trusted", capabilities: ["open"], reviewInDays: 30 }, "owner");
    expect(svc.apps.decide(a, "open", { sha256: "hash-1" }).allowed).toBe(true);
    expect(svc.apps.decide(a, "open", { sha256: "hash-2" })).toMatchObject({ allowed: false });
    clock.t += 31 * DAY;
    expect(svc.apps.decide(a, "open", { sha256: "hash-1" })).toMatchObject({ allowed: false, level: "unknown" });
    expect(svc.apps.levelOf(a)).toBe("unknown");
  });

  it("an approved program with an expiry stops working at the expiry", () => {
    const a = ident("Temp");
    svc.apps.set(a, { level: "approved", capabilities: ["open"], expiresInDays: 2 }, "owner");
    expect(svc.apps.decide(a, "open").allowed).toBe(true);
    clock.t += 3 * DAY;
    expect(svc.apps.decide(a, "open").allowed).toBe(false);
  });

  it("protected programs cannot be approved at all, whatever the owner asks, and are always refused", () => {
    for (const name of ["UltraViewer", "UltraVNC Server", "KeePassXC", "VMware Workstation", "MetaTrader 5", "Windows PowerShell", "Tailscale", "AnyDesk"]) {
      const a = ident(name);
      expect(() => svc.apps.set(a, { level: "approved", capabilities: ["open"] }, "owner"), name).toThrow(/protected/i);
      expect(() => svc.apps.approveForSession(a, ["open"], "owner"), name).toThrow(/protected/i);
      expect(svc.apps.decide(a, "open")).toMatchObject({ allowed: false, level: "protected" });
    }
    expect(kinds()).toContain("access.app.deny_protected");
  });

  it("revoking turns a program back to unknown immediately, and everything is recorded", () => {
    const a = ident("Editor");
    svc.apps.set(a, { level: "approved", capabilities: ["open"] }, "owner");
    svc.apps.approveForSession(a, ["open"], "owner");
    svc.apps.revoke(a, "owner");
    expect(svc.apps.decide(a, "open").allowed).toBe(false);
    svc.apps.set(ident("B"), { level: "approved", capabilities: ["open"] }, "owner");
    expect(svc.apps.revokeAll("owner")).toBeGreaterThan(0);
    expect(kinds()).toEqual(expect.arrayContaining(["access.app.set", "access.app.revoke", "access.app.revoke_all", "access.app.session_approve"]));
  });

  it("is blocked while the Guardian holds, and by a damaged store", () => {
    const a = ident("Editor");
    svc.apps.set(a, { level: "approved", capabilities: ["open"] }, "owner");
    held = "STOP";
    expect(svc.apps.decide(a, "open").allowed).toBe(false);
    held = null;
    kv.set("access.state", kv.get("access.state")!.replace('"open"', '"open","control"'));
    expect(mkService().apps.decide(a, "open").allowed).toBe(false);
  });
});

describe("read-only discovery", () => {
  const raw: RawDiscovery = {
    installed: [
      { name: "Visual Studio Code", version: "1.9", publisher: "Microsoft Corporation", location: "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\", icon: "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe,0" },
      { name: "UltraViewer", version: "6.6", publisher: "DucFabulous", location: "C:\\Program Files (x86)\\UltraViewer", icon: "C:\\Program Files (x86)\\UltraViewer\\UltraViewer_Desktop.exe" },
      { name: "Node.js", version: "24", publisher: "Node.js Foundation", location: "C:\\Program Files\\nodejs\\", icon: "" },
    ],
    procs: [
      { pid: 10, name: "Code", path: "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
      { pid: 11, name: "Code", path: "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
      { pid: 20, name: "node", path: "C:\\Program Files\\nodejs\\node.exe" },
      { pid: 30, name: "portable", path: "D:\\tools\\portable.exe" },
      { pid: 4, name: "explorer", path: "C:\\Windows\\explorer.exe" },
    ],
    services: [
      { name: "UltraViewer_Service", display: "UltraViewer Service", state: "Running", start: "Auto", path: '"C:\\Program Files (x86)\\UltraViewer\\UltraViewer_Service.exe"' },
      { name: "Spooler", display: "Print Spooler", state: "Running", start: "Auto", path: "C:\\Windows\\System32\\spoolsv.exe" },
    ],
    startup: [{ name: "UltraViewer", command: '"C:\\Program Files (x86)\\UltraViewer\\UltraViewer_Desktop.exe" /min', location: "HKLM Run", user: "Public" }],
    tasks: [{ name: "Backup", path: "\\Acme\\", state: "Ready", exe: "D:\\tools\\portable.exe", args: "" }],
    sigs: [
      { path: "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", signer: "CN=Microsoft Corporation, O=Microsoft Corporation" },
      { path: "D:\\tools\\portable.exe", signer: "" },
    ],
  };
  const inv = buildInventory(raw, [{ label: "PC agent", programs: ["node", "git"] }], "2026-11-04T09:00:00Z");
  const by = (n: string) => inv.apps.find((a) => a.name === n)!;

  it("joins installed, running, service, startup and task information per program", () => {
    expect(by("Visual Studio Code")).toMatchObject({ running: { count: 2 }, signed: true, signer: "Microsoft Corporation", system: false });
    expect(by("UltraViewer").services.map((s) => s.name)).toEqual(["UltraViewer_Service"]);
    expect(by("UltraViewer").startup).toHaveLength(1);
    expect(by("UltraViewer").sources).toEqual(expect.arrayContaining(["installed", "service", "startup"]));
    expect(by("portable").tasks[0]).toMatchObject({ name: "\\Acme\\Backup" });
    expect(by("portable").signed).toBe(false);
  });
  it("marks protected programs, Windows' own programs and existing integrations", () => {
    expect(by("UltraViewer").protectedBy?.category).toBe("remote access");
    expect(by("explorer").system).toBe(true);
    expect(by("Node.js").integrations).toEqual(["PC agent"]);
    expect(inv.apps.some((a) => a.name === "Print Spooler")).toBe(false);
  });
  it("is labelled read-only, says what it may have missed, and the ids are stable", () => {
    expect(inv.readOnly).toBe(true);
    expect(inv.notes.join(" ")).toMatch(/Read-only/);
    expect(buildInventory(raw, [], "x").apps.map((a) => a.id)).toEqual(inv.apps.map((a) => a.id));
  });
  it("reads the program out of a command line", () => {
    expect(exeFromCommand('"C:\\A B\\x.exe" /s')).toBe("C:\\A B\\x.exe");
    expect(exeFromCommand("C:\\Tools\\y.exe -k")).toBe("C:\\Tools\\y.exe");
    expect(exeFromCommand("cmd /c something")).toBeNull();
    expect(exeFromCommand("")).toBeNull();
  });
  it("the fixed scan script contains only reading commands", () => {
    const verbs = [...DISCOVERY_SCRIPT.matchAll(/\b([A-Z][a-z]+)-[A-Z][A-Za-z]+/g)].map((m) => m[1]);
    const allowed = new Set(["Get", "Where", "ForEach", "Select", "New", "Convert"]);
    expect(verbs.filter((v) => !allowed.has(v!))).toEqual([]);
    for (const banned of [/Start-/, /Stop-/, /Set-/, /Remove-/, /Invoke-/, /Disable-/, /Enable-/, /Uninstall-/, /Out-File/, /Add-Content/, /Restart-/, /Register-/, /Unregister-/, /Net\.WebClient/, /Invoke-WebRequest/, /Get-AuthenticodeSignature/, /Format-/, /\bsc\.exe/, /netsh/, /reg add/i]) {
      expect(DISCOVERY_SCRIPT).not.toMatch(banned);
    }
    // New- is only used to build an in-memory set, never a file, service, task or account
    expect([...DISCOVERY_SCRIPT.matchAll(/New-\w+(\s+\S+)?/g)].map((m) => m[0])).toEqual(["New-Object System.Collections.Generic.HashSet[string]"]);
  });
});
