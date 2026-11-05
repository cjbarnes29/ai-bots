import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { win32 } from "node:path";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import { OPS, type AccessState, type AccessStore, type FolderGrant, type FolderOp } from "./store.js";
import { classifySensitive, forbiddenTarget, isInside, realFs, resolvePath, SENSITIVE_LABEL, type FsProbe, type SensitiveCategory } from "./paths.js";

/**
 * Folder permissions (D-038/D-039 and the owner's rules).
 *  - DEFAULT DENY. Nothing is allowed unless an active grant says so.
 *  - A grant names ONE folder. It never covers the parent, a sibling or another drive.
 *  - Without `inherit`, a grant covers the folder and the entries directly inside it, not folders below. With `inherit` it covers everything below.
 *  - Secrets and personal places (keys, .env, browser profiles, mail, chat, password stores ...) are never covered by an ordinary grant. They need
 *    their own grant that names the kind, and it must expire within 24 hours.
 *  - Application approval and folder approval are independent: this class knows nothing about applications except the word in `subject`.
 *  - Every decision reads the saved state fresh, so a revoke or an expiry takes effect on the very next check.
 *  - Every grant, change, revoke, expiry and denial is written to the audit log.
 */
export type Verdict = { allowed: true; grantId: string; generation: number } | { allowed: false; reason: string; generation: number };

export interface AuthorizeInput {
  subject: string;
  path: string;
  op: FolderOp;
  /** Needed for delete/rename: deleting a folder removes everything inside it, so it needs an inheriting grant. */
  isDirectory?: boolean;
}

export interface GrantInput {
  subject: string;
  path: string;
  ops: string[];
  inherit?: boolean;
  /** Minutes until it stops working. null/undefined = until revoked (not allowed for secrets/personal places). */
  expiresInMinutes?: number | null;
  /** To grant a secrets/personal place the owner must type its kind back. */
  acknowledgeSensitive?: string;
  note?: string;
}

export interface GrantPreview {
  ok: boolean;
  problem: string | null;
  path: string | null;
  sensitive: { category: SensitiveCategory; label: string } | null;
  /** Plain-language lines describing exactly what the grant would allow and what it would NOT. */
  allows: string[];
  doesNotAllow: string[];
  warnings: string[];
}

const SUBJECT = /^(workforce|app:[A-Za-z0-9_-]{4,64})$/;
const MAX_ACTIVE = 50;
const MAX_MINUTES = 365 * 24 * 60;
export const SENSITIVE_MAX_MINUTES = 24 * 60;

const OP_WORDS: Record<FolderOp, string> = { read: "read and list files", create: "create new files and folders", edit: "change the content of existing files", rename: "rename files and folders", delete: "delete files and folders" };

export interface FolderDeps {
  store: AccessStore;
  audit: AuditLog;
  now: () => number;
  /** Why nothing may be allowed right now (the Guardian is not RUN), or null. */
  guardHeld?: () => string | null;
  fs?: FsProbe;
  home?: string;
  /** This app's own folders (database, vault, project): never grantable. */
  appFolders?: () => string[];
}

export class FolderAccess {
  private readonly fs: FsProbe;
  constructor(private readonly d: FolderDeps) {
    this.fs = d.fs ?? realFs;
  }

  private iso = () => new Date(this.d.now()).toISOString();

  private active(g: FolderGrant, nowMs = this.d.now()): boolean {
    return g.revokedAt === null && (g.expiresAt === null || Date.parse(g.expiresAt) > nowMs);
  }

  /** Marks (and logs, once) grants that ran out. */
  private noteExpiries(state: AccessState): AccessState {
    const nowMs = this.d.now();
    let changed = false;
    for (const g of state.folders) {
      if (g.revokedAt === null && g.expiresAt !== null && Date.parse(g.expiresAt) <= nowMs && !g.expiryRecorded) {
        g.expiryRecorded = true;
        changed = true;
        this.d.audit.record("access.folder.expire", { grantId: g.id, subject: g.subject, path: g.path }, { actor: "system" });
      }
    }
    if (changed) {
      state.generation += 1;
      this.d.store.save(state);
    }
    return state;
  }

  private fresh(): AccessState {
    const state = this.d.store.state();
    return this.d.store.tampered() ? state : this.noteExpiries(state);
  }

  generation(): number {
    return this.d.store.state().generation;
  }

  // ---------------- decisions ----------------
  authorize(input: AuthorizeInput): Verdict {
    const state = this.fresh();
    const deny = (reason: string, audit = true): Verdict => {
      if (audit) this.d.audit.record("access.folder.deny", { subject: input.subject, op: input.op, path: String(input.path).slice(0, 300), reason }, { actor: input.subject });
      return { allowed: false, reason, generation: state.generation };
    };
    const tampered = this.d.store.tampered();
    if (tampered) return deny(tampered);
    const held = this.d.guardHeld?.() ?? null;
    if (held) return deny(`Blocked by the Guardian: ${held}`);
    if (!(OPS as readonly string[]).includes(input.op)) return deny("Unknown operation.");
    if (!SUBJECT.test(input.subject)) return deny("Unknown requester.");

    const logical = resolvePath(input.path, { resolve: (p) => p, isDirectory: () => false });
    if (!logical.ok) return deny(logical.reason);
    const real = resolvePath(input.path, this.fs);
    if (!real.ok) return deny(real.reason);

    // Both the path as written and its real location must be acceptable: a link cannot smuggle a secret place in or an approved place out.
    const category = classifySensitive(real.value.key) ?? classifySensitive(logical.value.key);
    const grants = state.folders.filter((g) => g.subject === input.subject && this.active(g));
    const covers = (g: FolderGrant, key: string): boolean => {
      if (!g.ops.includes(input.op)) return false;
      if (!(g.inherit ? isInside(g.key, key) : key === g.key || win32.dirname(key) === g.key)) return false;
      // deleting or renaming the approved folder itself would go beyond the grant
      if ((input.op === "delete" || input.op === "rename") && key === g.key) return false;
      // deleting a folder removes everything under it: only an inheriting grant covers that
      if (input.op === "delete" && input.isDirectory && !g.inherit) return false;
      return true;
    };
    const matching = grants.filter((g) => covers(g, real.value.key) && covers(g, logical.value.key));
    if (matching.length === 0) {
      return deny(grants.length === 0 ? "No folder has been approved for this." : `That location is not covered by an approved folder for "${input.op}".`);
    }
    if (category) {
      const special = matching.find((g) => g.sensitive === category);
      if (!special) return deny(`That looks like ${SENSITIVE_LABEL[category]}. An ordinary folder approval never covers it; it needs its own separate approval.`);
      this.d.audit.record("access.folder.allow_sensitive", { subject: input.subject, op: input.op, path: real.value.path, category, grantId: special.id }, { actor: input.subject });
      return { allowed: true, grantId: special.id, generation: state.generation };
    }
    // most specific grant first, for the record
    matching.sort((a, b) => b.key.length - a.key.length);
    return { allowed: true, grantId: matching[0]!.id, generation: state.generation };
  }

  /** For a long job: is the permission it started with still in force? False after any revoke, expiry or reset. */
  stillValid(verdict: Verdict): boolean {
    if (!verdict.allowed) return false;
    const state = this.fresh();
    const g = state.folders.find((x) => x.id === verdict.grantId);
    return !!g && this.active(g) && !this.d.store.tampered() && !(this.d.guardHeld?.() ?? null);
  }

  // ---------------- grants ----------------
  preview(input: GrantInput): GrantPreview {
    const none = (problem: string): GrantPreview => ({ ok: false, problem, path: null, sensitive: null, allows: [], doesNotAllow: [], warnings: [] });
    if (!SUBJECT.test(input.subject)) return none("Unknown requester.");
    const ops = [...new Set(input.ops)];
    if (ops.length === 0 || ops.some((o) => !(OPS as readonly string[]).includes(o))) return none("Choose at least one of: read, create, edit, rename, delete.");
    const r = resolvePath(input.path, this.fs);
    if (!r.ok) return none(r.reason);
    if (!this.fs.isDirectory(r.value.path)) return none("That folder does not exist.");
    const bad = forbiddenTarget(r.value.key, { home: this.d.home ?? homedir(), appFolders: this.d.appFolders?.() ?? [] });
    if (bad) return none(bad);
    const cat = classifySensitive(r.value.key);
    const who = input.subject === "workforce" ? "The AI Workforce (its agents and the PC agent)" : "That application";
    const where = r.value.path;
    const reach = input.inherit ? `this folder and everything inside it, at any depth` : `this folder and the files and folders directly inside it (NOT the folders below them)`;
    const allows = [`${who} may ${ops.map((o) => OP_WORDS[o as FolderOp]).join(", ")} in ${reach}: ${where}`];
    const doesNotAllow = [
      `Nothing outside ${where}: not the parent folder, not neighbouring folders, not other drives.`,
      "Nothing in secret places even inside this folder (keys, .env files, browser profiles, mail, chat, password stores). Those need their own approval.",
      ...(input.inherit ? [] : ["Nothing inside sub-folders (turn on \"include sub-folders\" if you want that)."]),
      ...(ops.includes("delete") ? [] : ["Deleting."]),
      "Opening or using any program. Application approval is separate.",
    ];
    const warnings: string[] = [];
    if (ops.includes("delete")) warnings.push("Delete is included. Deleted items are not recoverable by this app unless the agent moves them to its trash folder.");
    if (input.inherit && ops.includes("edit")) warnings.push("Editing is allowed in every sub-folder too.");
    const minutes = input.expiresInMinutes ?? null;
    if (minutes === null) warnings.push("This approval does not expire. You can revoke it at any time.");
    if (cat) {
      warnings.push(`This folder looks like ${SENSITIVE_LABEL[cat]}. Approving it is a separate, short-lived decision (24 hours at most).`);
    }
    return { ok: true, problem: null, path: where, sensitive: cat ? { category: cat, label: SENSITIVE_LABEL[cat] } : null, allows, doesNotAllow, warnings };
  }

  grant(input: GrantInput, actor: string): FolderGrant {
    const p = this.preview(input);
    if (!p.ok) throw new AppError(400, "invalid_grant", p.problem ?? "That grant is not valid.");
    const state = this.fresh();
    if (this.d.store.tampered()) throw new AppError(409, "access_damaged", this.d.store.tampered()!);
    const r = resolvePath(input.path, this.fs);
    if (!r.ok) throw new AppError(400, "invalid_grant", r.reason);
    const ops = OPS.filter((o) => input.ops.includes(o));
    const minutes = input.expiresInMinutes ?? null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES)) throw new AppError(400, "invalid_grant", "The time limit must be between 1 minute and 365 days.");
    const cat = p.sensitive?.category ?? null;
    if (cat) {
      if (input.acknowledgeSensitive !== cat) throw new AppError(400, "sensitive_needs_ack", `This folder looks like ${p.sensitive!.label}. To approve it on purpose, confirm the kind: "${cat}".`);
      if (minutes === null || minutes > SENSITIVE_MAX_MINUTES) throw new AppError(400, "sensitive_needs_expiry", "An approval for secrets or personal data must expire within 24 hours.");
    }
    const live = state.folders.filter((g) => this.active(g));
    if (live.length >= MAX_ACTIVE) throw new AppError(409, "too_many_grants", `At most ${MAX_ACTIVE} folder approvals can be active. Revoke some first.`);
    if (live.some((g) => g.subject === input.subject && g.key === r.value.key)) throw new AppError(409, "grant_exists", "That folder is already approved for this requester. Change or revoke the existing approval instead.");
    const now = this.iso();
    const g: FolderGrant = {
      id: randomUUID(),
      subject: input.subject,
      path: r.value.path,
      key: r.value.key,
      ops,
      inherit: input.inherit === true,
      sensitive: cat,
      createdAt: now,
      createdBy: actor,
      expiresAt: minutes === null ? null : new Date(this.d.now() + minutes * 60_000).toISOString(),
      revokedAt: null,
      revokedBy: null,
      expiryRecorded: false,
      note: (input.note ?? "").slice(0, 200),
    };
    state.folders.push(g);
    this.d.store.save(state);
    this.d.audit.record("access.folder.grant", { grantId: g.id, subject: g.subject, path: g.path, ops: g.ops, inherit: g.inherit, sensitive: g.sensitive, expiresAt: g.expiresAt }, { actor });
    return g;
  }

  /** Change an existing grant (fewer or more operations, sub-folders on/off, a new time limit). Both the old and new values are recorded. */
  change(id: string, patch: { ops?: string[]; inherit?: boolean; expiresInMinutes?: number | null }, actor: string): FolderGrant {
    const state = this.fresh();
    if (this.d.store.tampered()) throw new AppError(409, "access_damaged", this.d.store.tampered()!);
    const g = state.folders.find((x) => x.id === id);
    if (!g || !this.active(g)) throw new AppError(404, "grant_not_found", "That approval does not exist or is no longer active.");
    const before = { ops: [...g.ops], inherit: g.inherit, expiresAt: g.expiresAt };
    if (patch.ops !== undefined) {
      const ops = OPS.filter((o) => patch.ops!.includes(o));
      if (ops.length === 0 || patch.ops.some((o) => !(OPS as readonly string[]).includes(o))) throw new AppError(400, "invalid_grant", "Choose at least one of: read, create, edit, rename, delete.");
      g.ops = [...ops];
    }
    if (patch.inherit !== undefined) g.inherit = patch.inherit;
    if (patch.expiresInMinutes !== undefined) {
      const m = patch.expiresInMinutes;
      if (m !== null && (!Number.isFinite(m) || m < 1 || m > MAX_MINUTES)) throw new AppError(400, "invalid_grant", "The time limit must be between 1 minute and 365 days.");
      if (g.sensitive && (m === null || m > SENSITIVE_MAX_MINUTES)) throw new AppError(400, "sensitive_needs_expiry", "An approval for secrets or personal data must expire within 24 hours.");
      g.expiresAt = m === null ? null : new Date(this.d.now() + m * 60_000).toISOString();
      g.expiryRecorded = false;
    }
    state.generation += 1;
    this.d.store.save(state);
    this.d.audit.record("access.folder.change", { grantId: g.id, subject: g.subject, path: g.path, before, after: { ops: g.ops, inherit: g.inherit, expiresAt: g.expiresAt } }, { actor });
    return g;
  }

  revoke(id: string, actor: string): FolderGrant {
    const state = this.fresh();
    if (this.d.store.tampered()) throw new AppError(409, "access_damaged", this.d.store.tampered()!);
    const g = state.folders.find((x) => x.id === id);
    if (!g) throw new AppError(404, "grant_not_found", "That approval does not exist.");
    if (g.revokedAt === null) {
      g.revokedAt = this.iso();
      g.revokedBy = actor;
      state.generation += 1;
      this.d.store.save(state);
      this.d.audit.record("access.folder.revoke", { grantId: g.id, subject: g.subject, path: g.path }, { actor });
    }
    return g;
  }

  /** The "take it all back" button. Never needs the passphrase: it only removes access. */
  revokeAll(actor: string, subject?: string): number {
    const state = this.fresh();
    if (this.d.store.tampered()) return 0;
    let n = 0;
    for (const g of state.folders) {
      if (g.revokedAt === null && (!subject || g.subject === subject)) {
        g.revokedAt = this.iso();
        g.revokedBy = actor;
        n += 1;
      }
    }
    if (n > 0) {
      state.generation += 1;
      this.d.store.save(state);
    }
    this.d.audit.record("access.folder.revoke_all", { count: n, subject: subject ?? "all" }, { actor });
    return n;
  }

  list(): (FolderGrant & { status: "active" | "expired" | "revoked" })[] {
    const state = this.fresh();
    return state.folders
      .map((g) => ({ ...g, status: g.revokedAt !== null ? ("revoked" as const) : this.active(g) ? ("active" as const) : ("expired" as const) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
