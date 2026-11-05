import { createHash } from "node:crypto";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import { CAPABILITIES, type AccessStore, type AppCapability, type AppLevel, type AppRecord } from "./store.js";

/**
 * Application permission policy (D-027, D-033, D-038, D-039).
 *
 *  unknown    every application starts here. Allowed only for the current session, only for what the owner ticked, and only after the owner says so.
 *  approved   the owner chose exactly which capabilities. Optional expiry.
 *  trusted    permanent, but only with explicit capabilities AND a review date (a year at most). Past it, the approval stops working.
 *             Not available for a program with no embedded publisher signature, and it is pinned to the program file's SHA-256.
 *  protected  needs its own separate security policy. None is written yet, so a protected application can NOT be approved at all.
 *
 * The capabilities are about the PROGRAM only: open it, look at it, operate it, close it. There is no capability for files, accounts,
 * credentials or personal data. Those exist only as folder grants (folders.ts) and as separate vault/integration approvals, so approving a
 * program can never, by construction, grant any of them. `decide()` says so in every answer.
 */
export const CAPABILITY_WORDS: Record<AppCapability, string> = {
  open: "start the program",
  view: "see what the program shows on screen",
  control: "operate the program with the keyboard and mouse",
  close: "close the program",
};

export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const TRUSTED_MAX_REVIEW_DAYS = 365;

/** Built-in rules for programs that must not be easy targets. Matched on name, publisher and program file name (lower case). */
const PROTECTED_RULES: { category: string; why: string; re: RegExp }[] = [
  { category: "remote access", why: "it can give another person or device control of this PC", re: /ultraviewer|ultravnc|uvnc|tightvnc|realvnc|anydesk|teamviewer|rustdesk|chrome remote|rdpwrap|mstsc|vncviewer|winscp|putty|openssh|\bssh\b/ },
  { category: "password manager or authenticator", why: "it holds every password you own", re: /keepass|bitwarden|1password|lastpass|dashlane|nordpass|roboform|authy|authenticator|yubi/ },
  { category: "security or system control", why: "it can change the PC's security settings", re: /windows security|defender|firewall|regedit|gpedit|secpol|mmc\.exe|powershell|pwsh|cmd\.exe|windowsterminal|windows terminal|wsl\b|taskmgr|task manager|msconfig|services\.msc|eventvwr|bitlocker|sandbox/ },
  { category: "virtual machine software", why: "it controls the isolation boundary (D-026)", re: /vmware|virtualbox|hyper-v|vmrun|vmplayer|vmware-authd|qemu|docker desktop/ },
  { category: "trading or finance", why: "it can move money", re: /metatrader|metaeditor|terminal64|terminal\.exe|tradingview|ninjatrader|binance|coinbase|ledger live|trezor|metamask|exodus|paypal|banking|revolut\b/ },
  { category: "VPN or network tunnel", why: "it changes how this PC reaches the network", re: /tailscale|openvpn|wireguard|nordvpn|expressvpn|protonvpn|cloudflare warp|zerotier|hamachi/ },
];

/** Not forbidden, but the owner should know before approving: the program is probably already signed in to something. */
const RISK_NOTES: { re: RegExp; note: string }[] = [
  { re: /chrome|edge|firefox|brave|opera|vivaldi|browser/, note: "A web browser is usually already signed in to your accounts (mail, banking, social). Approving it lets the AI see and operate whatever is open in it." },
  { re: /outlook|thunderbird|mail/, note: "A mail program shows your private email. Approving it lets the AI see and operate what is on screen." },
  { re: /telegram|whatsapp|discord|slack|signal|teams|skype|zoom/, note: "A chat program shows private conversations and can message other people." },
  { re: /onedrive|dropbox|google drive|drive for desktop|icloud|mega/, note: "A cloud-drive program syncs your files. Approving it does not approve any folder, but it may display your files." },
  { re: /excel|word|powerpoint|libreoffice|notepad|code|studio/, note: "Documents it opens may contain private data. Folder access is approved separately." },
];

export function protectedMatch(text: string): { category: string; why: string } | null {
  const t = text.toLowerCase();
  const r = PROTECTED_RULES.find((x) => x.re.test(t));
  return r ? { category: r.category, why: r.why } : null;
}

export function riskNotesFor(text: string): string[] {
  const t = text.toLowerCase();
  return RISK_NOTES.filter((r) => r.re.test(t)).map((r) => r.note);
}

/** A stable id for an application: the same program file always gives the same id. */
export function appIdFor(exePath: string | null, name: string, publisher: string | null): string {
  const basis = exePath ? `exe:${exePath.toLowerCase()}` : `name:${name.toLowerCase()}|${(publisher ?? "").toLowerCase()}`;
  return "a" + createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export interface AppIdentity {
  id: string;
  name: string;
  exePath: string | null;
  publisher: string | null;
  /** Does the program file carry a publisher signature? (Embedded only; the signature chain is NOT verified here, see docs.) */
  signed: boolean;
}

export interface AppDecision {
  allowed: boolean;
  level: AppLevel;
  reason: string;
  /** Always false: approving a program never grants files, accounts, credentials or personal data. */
  grantsDataAccess: false;
  needsSessionApproval: boolean;
}

export interface SetAppInput {
  level: "approved" | "trusted";
  capabilities: string[];
  /** approved: optional. */
  expiresInDays?: number | null;
  /** trusted: required, 1-365. */
  reviewInDays?: number | null;
  note?: string;
}

export interface AppPolicyDeps {
  store: AccessStore;
  audit: AuditLog;
  now: () => number;
  guardHeld?: () => string | null;
  hashFile: (path: string) => string | null;
}

export class AppPolicy {
  /** Once-per-session approvals for unknown programs. Memory only: gone when the app restarts. */
  private readonly session = new Map<string, { caps: AppCapability[]; until: number; exePath: string | null; sha256: string | null }>();
  constructor(private readonly d: AppPolicyDeps) {}

  private iso = () => new Date(this.d.now()).toISOString();

  private caps(list: string[]): AppCapability[] {
    const out = CAPABILITIES.filter((c) => list.includes(c));
    if (out.length === 0 || list.some((c) => !(CAPABILITIES as readonly string[]).includes(c))) throw new AppError(400, "invalid_capability", `Choose at least one of: ${CAPABILITIES.join(", ")}. Files and accounts are not application permissions; they are approved separately.`);
    return [...out];
  }

  isProtected(app: Pick<AppIdentity, "name" | "exePath" | "publisher">): { category: string; why: string } | null {
    return protectedMatch(`${app.name} ${app.publisher ?? ""} ${app.exePath ?? ""}`);
  }

  /** The level the program has RIGHT NOW (an expired approval counts as unknown). */
  levelOf(app: AppIdentity): AppLevel {
    if (this.isProtected(app)) return "protected";
    const rec = this.d.store.state().apps[app.id];
    if (!rec || rec.level === "unknown") return "unknown";
    if (rec.level === "protected") return "protected";
    const nowMs = this.d.now();
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= nowMs) return "unknown";
    if (rec.level === "trusted" && (!rec.reviewBy || Date.parse(rec.reviewBy) <= nowMs)) return "unknown";
    return rec.level;
  }

  decide(app: AppIdentity, cap: AppCapability, current?: { sha256?: string | null }): AppDecision {
    const base = { grantsDataAccess: false as const };
    const no = (level: AppLevel, reason: string, needsSessionApproval = false): AppDecision => {
      this.d.audit.record("access.app.deny", { appId: app.id, name: app.name, capability: cap, level, reason }, { actor: "system" });
      return { ...base, allowed: false, level, reason, needsSessionApproval };
    };
    const tampered = this.d.store.tampered();
    if (tampered) return no("unknown", tampered);
    const held = this.d.guardHeld?.() ?? null;
    if (held) return no(this.levelOf(app), `Blocked by the Guardian: ${held}`);
    if (!(CAPABILITIES as readonly string[]).includes(cap)) return no("unknown", "Unknown capability.");
    const level = this.levelOf(app);
    if (level === "protected") return no("protected", "This program is protected. It needs its own separate security policy, and none exists yet, so it cannot be used.");
    const rec = this.d.store.state().apps[app.id];
    if (level === "approved" || level === "trusted") {
      if (!rec) return no("unknown", "No approval found.");
      if (rec.sha256 && current?.sha256 !== undefined && current.sha256 !== rec.sha256) return no("unknown", "The program file has changed since you approved it. Approve it again.");
      if (!rec.capabilities.includes(cap)) return no(level, `You approved this program, but not to ${CAPABILITY_WORDS[cap]}.`);
      return { ...base, allowed: true, level, reason: `${level === "trusted" ? "Trusted" : "Approved"} by the owner to ${CAPABILITY_WORDS[cap]}. This does not include any files or accounts.`, needsSessionApproval: false };
    }
    // unknown (or an approval that has run out)
    const s = this.session.get(app.id);
    if (s && s.until > this.d.now() && s.caps.includes(cap)) {
      if (s.sha256 && current?.sha256 !== undefined && current.sha256 !== s.sha256) return no("unknown", "The program file has changed since you approved it for this session.");
      return { ...base, allowed: true, level: "unknown", reason: `Allowed for this session only, to ${CAPABILITY_WORDS[cap]}. This does not include any files or accounts.`, needsSessionApproval: false };
    }
    return no("unknown", "Unknown program: the owner must approve it for this session first.", true);
  }

  /** Owner approves an unknown program for this session only. */
  approveForSession(app: AppIdentity, capabilities: string[], actor: string): { until: string } {
    this.guardWrite(app);
    const caps = this.caps(capabilities);
    const until = this.d.now() + SESSION_MAX_MS;
    this.session.set(app.id, { caps, until, exePath: app.exePath, sha256: app.exePath ? this.d.hashFile(app.exePath) : null });
    this.d.audit.record("access.app.session_approve", { appId: app.id, name: app.name, capabilities: caps, until: new Date(until).toISOString() }, { actor });
    return { until: new Date(until).toISOString() };
  }

  /** Owner sets "approved" or "trusted". */
  set(app: AppIdentity, input: SetAppInput, actor: string): AppRecord {
    this.guardWrite(app);
    const caps = this.caps(input.capabilities);
    const state = this.d.store.state();
    const nowMs = this.d.now();
    let expiresAt: string | null = null;
    let reviewBy: string | null = null;
    if (input.level === "trusted") {
      if (!app.signed || !app.publisher) throw new AppError(400, "trust_needs_signature", "A program without a publisher signature can be Approved, but not Trusted.");
      const d = input.reviewInDays ?? null;
      if (d === null || !Number.isFinite(d) || d < 1 || d > TRUSTED_MAX_REVIEW_DAYS) throw new AppError(400, "trust_needs_review", `Trusted needs a review date: between 1 and ${TRUSTED_MAX_REVIEW_DAYS} days from now.`);
      reviewBy = new Date(nowMs + d * 86_400_000).toISOString();
    } else if (input.expiresInDays != null) {
      const d = input.expiresInDays;
      if (!Number.isFinite(d) || d < 1 || d > 3650) throw new AppError(400, "invalid_expiry", "The time limit must be between 1 and 3650 days.");
      expiresAt = new Date(nowMs + d * 86_400_000).toISOString();
    }
    const sha256 = app.exePath ? this.d.hashFile(app.exePath) : null;
    if (input.level === "trusted" && !sha256) throw new AppError(400, "trust_needs_hash", "Trusted needs the program file to be readable so its fingerprint can be pinned.");
    const before = state.apps[app.id];
    const rec: AppRecord = { id: app.id, name: app.name, exePath: app.exePath, publisher: app.publisher, sha256, level: input.level, capabilities: caps, reviewBy, expiresAt, updatedAt: this.iso(), updatedBy: actor, note: (input.note ?? "").slice(0, 200) };
    state.apps[app.id] = rec;
    state.generation += 1;
    this.d.store.save(state);
    this.d.audit.record("access.app.set", { appId: app.id, name: app.name, level: rec.level, capabilities: caps, reviewBy, expiresAt, before: before ? { level: before.level, capabilities: before.capabilities } : null }, { actor });
    return rec;
  }

  /** Back to "unknown": removes the approval and any session approval. Needs no proof (it only removes access). */
  revoke(app: AppIdentity, actor: string): void {
    const state = this.d.store.state();
    const had = !!state.apps[app.id];
    this.session.delete(app.id);
    if (had && !this.d.store.tampered()) {
      delete state.apps[app.id];
      state.generation += 1;
      this.d.store.save(state);
    }
    this.d.audit.record("access.app.revoke", { appId: app.id, name: app.name, hadApproval: had }, { actor });
  }

  /** Takes back every application approval at once. */
  revokeAll(actor: string): number {
    const state = this.d.store.state();
    const n = Object.keys(state.apps).length + this.session.size;
    this.session.clear();
    if (!this.d.store.tampered() && Object.keys(state.apps).length > 0) {
      state.apps = {};
      state.generation += 1;
      this.d.store.save(state);
    }
    this.d.audit.record("access.app.revoke_all", { count: n }, { actor });
    return n;
  }

  record(id: string): AppRecord | null {
    return this.d.store.state().apps[id] ?? null;
  }

  sessionOf(id: string): { capabilities: AppCapability[]; until: string } | null {
    const s = this.session.get(id);
    return s && s.until > this.d.now() ? { capabilities: s.caps, until: new Date(s.until).toISOString() } : null;
  }

  private guardWrite(app: AppIdentity): void {
    const p = this.isProtected(app);
    if (p) {
      this.d.audit.record("access.app.deny_protected", { appId: app.id, name: app.name, category: p.category }, { actor: "owner" });
      throw new AppError(403, "protected_application", `This is a protected program (${p.category}: ${p.why}). Protected programs need their own separate security policy before they can be approved, and none exists yet.`);
    }
    const t = this.d.store.tampered();
    if (t) throw new AppError(409, "access_damaged", t);
  }
}
