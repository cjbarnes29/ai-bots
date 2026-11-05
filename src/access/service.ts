import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import { AppPolicy, CAPABILITY_WORDS, type AppIdentity } from "./apps.js";
import { buildInventory, hashFileSync, powershellDiscovery, type DiscoveredApp, type DiscoveryRunner, type Inventory } from "./discovery.js";
import { FolderAccess, type AuthorizeInput, type Verdict } from "./folders.js";
import type { FsProbe } from "./paths.js";
import { AccessStore, CAPABILITIES, OPS, type KeyValue } from "./store.js";

export interface AccessDeps {
  kv: KeyValue;
  audit: AuditLog;
  now: () => number;
  guardHeld?: () => string | null;
  /** Folders that may never be approved (the app's own files). */
  appFolders?: () => string[];
  /** What the AI Workforce already uses on this PC, to show in the application list. */
  existingIntegrations?: () => { label: string; programs?: string[] }[];
  discover?: DiscoveryRunner;
  hashFile?: (path: string) => string | null;
  fs?: FsProbe;
  home?: string;
}

/**
 * The one place the rest of the app talks to. It holds the application policy (apps.ts), the folder permissions (folders.ts) and the last
 * read-only scan (discovery.ts). The two permission systems are independent on purpose: nothing here lets an application approval open a folder.
 */
export class AccessService {
  readonly store: AccessStore;
  readonly folders: FolderAccess;
  readonly apps: AppPolicy;
  private inventory: Inventory | null = null;
  private scanning: Promise<Inventory> | null = null;
  private lastScanMs = 0;

  constructor(private readonly d: AccessDeps) {
    this.store = new AccessStore(d.kv);
    this.folders = new FolderAccess({ store: this.store, audit: d.audit, now: d.now, ...(d.guardHeld ? { guardHeld: d.guardHeld } : {}), ...(d.fs ? { fs: d.fs } : {}), ...(d.home ? { home: d.home } : {}), ...(d.appFolders ? { appFolders: d.appFolders } : {}) });
    this.apps = new AppPolicy({ store: this.store, audit: d.audit, now: d.now, ...(d.guardHeld ? { guardHeld: d.guardHeld } : {}), hashFile: d.hashFile ?? hashFileSync });
  }

  /** The check the agents' file actions call. Throws a plain-language Error when denied (the connector shows it to the agent and the owner). */
  require(input: AuthorizeInput): Verdict & { allowed: true } {
    const v = this.folders.authorize(input);
    if (!v.allowed) throw new Error(`Folder access denied: ${v.reason}`);
    return v;
  }

  /** An application opening a file needs BOTH approvals, checked separately. Neither one implies the other. */
  authorizeAppFile(appId: string, input: { path: string; op: AuthorizeInput["op"]; isDirectory?: boolean }): { allowed: boolean; reason: string } {
    const app = this.identityOf(appId);
    if (!app) return { allowed: false, reason: "Unknown application. Scan applications first." };
    const a = this.apps.decide(app, "open");
    if (!a.allowed) return { allowed: false, reason: `Application: ${a.reason}` };
    const f = this.folders.authorize({ subject: `app:${appId}`, ...input });
    return f.allowed ? { allowed: true, reason: "Both the application and the folder are approved." } : { allowed: false, reason: `Folder: ${f.reason}` };
  }

  // ---------------- discovery ----------------
  async scan(): Promise<Inventory> {
    if (this.scanning) return this.scanning;
    if (this.inventory && this.d.now() - this.lastScanMs < 15_000) return this.inventory;
    this.scanning = (async () => {
      const raw = await (this.d.discover ?? powershellDiscovery)();
      const inv = buildInventory(raw, this.d.existingIntegrations?.() ?? [], new Date(this.d.now()).toISOString());
      this.inventory = inv;
      this.lastScanMs = this.d.now();
      this.d.audit.record("access.discovery.scan", { programs: inv.apps.length, running: inv.apps.filter((a) => a.running.count > 0).length, readOnly: true }, { actor: "owner" });
      return inv;
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  identityOf(id: string): (AppIdentity & { discovered: DiscoveredApp }) | null {
    const a = this.inventory?.apps.find((x) => x.id === id);
    return a ? { id: a.id, name: a.name, exePath: a.exePath, publisher: a.publisher ?? a.signer, signed: a.signed, discovered: a } : null;
  }

  private needIdentity(id: string) {
    const a = this.identityOf(id);
    if (!a) throw new AppError(404, "app_not_found", "That program is not in the last scan. Scan applications again.");
    return a;
  }

  /** The inventory with each program's current level and approval, ready for the dashboard. */
  view() {
    const inv = this.inventory;
    return {
      tampered: this.store.tampered(),
      generation: this.store.state().generation,
      scannedAt: inv?.scannedAt ?? null,
      notes: inv?.notes ?? [],
      capabilities: CAPABILITIES.map((c) => ({ id: c, label: CAPABILITY_WORDS[c] })),
      apps: (inv?.apps ?? []).map((a) => {
        const ident = { id: a.id, name: a.name, exePath: a.exePath, publisher: a.publisher ?? a.signer, signed: a.signed };
        return {
          ...a,
          level: this.apps.levelOf(ident),
          approval: this.apps.record(a.id),
          session: this.apps.sessionOf(a.id),
        };
      }),
    };
  }

  setApp(id: string, input: Parameters<AppPolicy["set"]>[1], actor: string) {
    return this.apps.set(this.needIdentity(id), input, actor);
  }
  approveAppForSession(id: string, capabilities: string[], actor: string) {
    return this.apps.approveForSession(this.needIdentity(id), capabilities, actor);
  }
  revokeApp(id: string, actor: string) {
    this.apps.revoke(this.needIdentity(id), actor);
  }

  reset(actor: string): void {
    this.store.reset(this.d.now());
    this.d.audit.record("access.reset", { note: "all application approvals and folder grants were cleared" }, { actor });
  }

  static readonly operations = OPS;
}
