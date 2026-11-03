import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";

/**
 * Device pairing for remote use (a phone over Tailscale).
 *
 * How it works: on the PC the owner presses "Pair a phone" and gets a short one-time code. The phone sends the code and
 * receives a long random secret, which the browser keeps as a protected cookie. The server stores only a hash of that secret.
 * The owner can revoke any device at any time, and a device unused for 90 days stops working.
 */
export const PAIRING = { codeLength: 10, ttlMs: 5 * 60_000, maxWrongGuesses: 5 };
export const DEVICE_LIMITS = { maxActive: 10, idleExpiryMs: 90 * 86_400_000, touchEveryMs: 60_000 };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid mix-ups

export interface Device {
  id: string;
  name: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class DeviceService {
  /** Only one pairing code exists at a time, and it lives in memory only. */
  private pairing: { code: string; expiresAt: number; wrong: number } | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: AuditLog,
    private readonly now: () => number = Date.now,
  ) {}

  startPairing(): { code: string; expiresAt: string } {
    const bytes = randomBytes(PAIRING.codeLength);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    this.pairing = { code, expiresAt: this.now() + PAIRING.ttlMs, wrong: 0 };
    this.audit.record("device.pairing_started", {}, { actor: "owner" });
    return { code, expiresAt: new Date(this.pairing.expiresAt).toISOString() };
  }

  cancelPairing(): void {
    this.pairing = null;
  }

  /** Exchanges a valid code for a new device secret. The secret is returned once and never again. */
  pair(rawCode: string, rawName: string, userAgent: string | null): { device: Device; token: string } {
    const p = this.pairing;
    if (!p || p.expiresAt <= this.now()) {
      this.pairing = null;
      throw new AppError(400, "pairing_invalid", "That pairing code is not valid. Ask for a new one on the PC.");
    }
    if (!sameText(normalizeCode(rawCode), p.code)) {
      p.wrong++;
      this.audit.record("device.pairing_wrong_code", { wrongGuesses: p.wrong });
      if (p.wrong >= PAIRING.maxWrongGuesses) {
        this.pairing = null; // too many guesses: the code is destroyed, the owner must make a new one
        this.audit.record("device.pairing_cancelled", { reason: "too many wrong codes" });
      }
      throw new AppError(400, "pairing_invalid", "That pairing code is not valid. Ask for a new one on the PC.");
    }
    const name = rawName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
    if (!name) throw new AppError(400, "device_name_required", "Give this device a name.");
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL").get() as { n: number };
    if (Number(active.n) >= DEVICE_LIMITS.maxActive) {
      throw new AppError(409, "too_many_devices", `At most ${DEVICE_LIMITS.maxActive} devices can be paired. Revoke one on the PC first.`);
    }
    this.pairing = null; // single use
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const nowMs = this.now();
    const iso = new Date(nowMs).toISOString();
    this.db
      .prepare("INSERT INTO devices (id, name, token_hash, user_agent, created_at, created_ms, last_seen_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, hash(token), userAgent ? userAgent.slice(0, 200) : null, iso, nowMs, nowMs);
    this.audit.record("device.paired", { deviceId: id, name }, { actor: "owner" });
    return { device: { id, name, userAgent, createdAt: iso, lastSeenAt: iso, revokedAt: null }, token };
  }

  /** The device behind a secret, or null if it is unknown, revoked or unused for too long. */
  authenticate(token: string | undefined): Device | null {
    if (!token || token.length < 20 || token.length > 200) return null;
    const row = this.db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hash(token));
    if (!row || row["revoked_at"] !== null) return null;
    const nowMs = this.now();
    const lastSeen = Number(row["last_seen_ms"]);
    if (nowMs - lastSeen > DEVICE_LIMITS.idleExpiryMs) return null;
    if (nowMs - lastSeen > DEVICE_LIMITS.touchEveryMs) this.db.prepare("UPDATE devices SET last_seen_ms = ? WHERE id = ?").run(nowMs, String(row["id"]));
    return this.toDevice({ ...row, last_seen_ms: nowMs });
  }

  list(): Device[] {
    return this.db.prepare("SELECT * FROM devices ORDER BY created_ms DESC").all().map((r) => this.toDevice(r));
  }

  revoke(id: string, actor: string): Device {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id);
    if (!row) throw new AppError(404, "device_not_found", "That device does not exist.");
    if (row["revoked_at"] === null) {
      this.db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(new Date(this.now()).toISOString(), id);
      this.audit.record("device.revoked", { deviceId: id, name: String(row["name"]) }, { actor });
    }
    return this.toDevice(this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id)!);
  }

  private toDevice(r: Record<string, unknown>): Device {
    return {
      id: String(r["id"]),
      name: String(r["name"]),
      userAgent: r["user_agent"] === null ? null : String(r["user_agent"]),
      createdAt: String(r["created_at"]),
      lastSeenAt: new Date(Number(r["last_seen_ms"])).toISOString(),
      revokedAt: r["revoked_at"] === null ? null : String(r["revoked_at"]),
    };
  }
}
