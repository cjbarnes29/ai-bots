import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import type { VaultService } from "../vault/service.js";

/**
 * Phone alerts (Web Push), with no account of yours involved: the browser's own push service (Google/Mozilla/Apple/Microsoft) delivers them.
 *
 *  - The alert carries NO content at all. The phone is only woken; its service worker then asks this app, with the phone's own pairing cookie,
 *    how many actions are waiting, and shows that count. Nothing confidential passes through the push service.
 *  - Messages are signed with a key pair made on this PC (VAPID). The private half lives in the encrypted vault.
 *  - A device can only register an address on a short allow-list of real push-service hosts, so this can never be used to make the PC call
 *    any other website.
 *  - An alert is sent once per newly waiting approval, at most one per minute, to at most 20 registered devices.
 */
export const PUSH_SECRET_NAME = "PUSH_VAPID_PRIVATE_KEY";
export const PUSH_LIMITS = { minGapMs: 60_000, maxSubscriptions: 20, ttlSeconds: 3600, timeoutMs: 10_000 };

const HOST_ALLOW = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushServiceHost(host: string): boolean {
  return HOST_ALLOW.some((r) => r.test(host.toLowerCase()));
}

/** Throws unless the address is an https address on a real push service (tests may also allow plain http on this PC). */
export function checkEndpoint(endpoint: string, allowHost: (host: string) => boolean = isPushServiceHost, allowPlainLocal = false): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError(400, "bad_endpoint", "That is not a valid push address.");
  }
  if (endpoint.length > 600 || url.username || url.password || !allowHost(url.hostname)) {
    throw new AppError(400, "bad_endpoint", "That push address is not from a known push service.");
  }
  const plainLocalOk = allowPlainLocal && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !plainLocalOk) throw new AppError(400, "bad_endpoint", "Push addresses must be https.");
  return url;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface PushOptions {
  db: DatabaseSync;
  vault: VaultService;
  audit: AuditLog;
  now: () => number;
  /** The address the signed messages say they come from (your Tailscale name when remote access is on). */
  subject: () => string;
  pendingApprovals: () => { count: number; newestAt: string | null };
  /** Tests only: accept a pretend push service on this PC. */
  allowHost?: (host: string) => boolean;
  fetchImpl?: typeof fetch;
}

export class PushService {
  private lastSentMs = 0;
  private lastNotifiedAt: string | null;
  private keys: { priv: KeyObject; publicKey: string } | null = null;

  constructor(private readonly o: PushOptions) {
    // After a restart do not alert about what was already waiting.
    this.lastNotifiedAt = o.pendingApprovals().newestAt;
  }

  private allow(host: string): boolean {
    return (this.o.allowHost ?? isPushServiceHost)(host);
  }

  /** The signing key pair, made on first use. */
  private loadKeys(): { priv: KeyObject; publicKey: string } {
    if (this.keys) return this.keys;
    let der = this.o.vault.getStored(PUSH_SECRET_NAME);
    if (!der) {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
      this.o.vault.set(PUSH_SECRET_NAME, der);
    }
    const priv = createPrivateKey({ key: Buffer.from(der, "base64url"), format: "der", type: "pkcs8" });
    const jwk = createPublicKey(priv).export({ format: "jwk" });
    const publicKey = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(String(jwk.x), "base64url"), Buffer.from(String(jwk.y), "base64url")]));
    this.keys = { priv, publicKey };
    return this.keys;
  }

  publicKey(): string {
    return this.loadKeys().publicKey;
  }

  count(): number {
    return Number((this.o.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n);
  }

  subscribe(endpoint: string, deviceId: string | null): void {
    const url = checkEndpoint(endpoint, (h) => this.allow(h), this.o.allowHost !== undefined);
    const existing = this.o.db.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?").get(endpoint);
    if (!existing && this.count() >= PUSH_LIMITS.maxSubscriptions) throw new AppError(409, "too_many_subscriptions", "Too many devices have alerts switched on.");
    this.o.db
      .prepare("INSERT INTO push_subscriptions (id, device_id, endpoint, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET device_id = excluded.device_id")
      .run(randomUUID(), deviceId, endpoint, new Date(this.o.now()).toISOString());
    this.o.audit.record("push.subscribed", { host: url.hostname, device: deviceId }, { actor: deviceId ? `device:${deviceId}` : "owner" });
  }

  unsubscribe(endpoint: string): void {
    this.o.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  /** A revoked phone stops getting alerts. */
  dropDevice(deviceId: string): void {
    this.o.db.prepare("DELETE FROM push_subscriptions WHERE device_id = ?").run(deviceId);
  }

  private jwt(audience: string): string {
    const { priv } = this.loadKeys();
    const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const claims = b64url(JSON.stringify({ aud: audience, exp: Math.floor(this.o.now() / 1000) + 12 * 3600, sub: this.o.subject() }));
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: priv, dsaEncoding: "ieee-p1363" });
    return `${header}.${claims}.${b64url(signature)}`;
  }

  /** Wakes every registered device (no content). Returns how many were reached. Never throws. */
  async wakeAll(): Promise<number> {
    let reached = 0;
    const subs = this.o.db.prepare("SELECT s.id, s.endpoint FROM push_subscriptions s LEFT JOIN devices d ON d.id = s.device_id WHERE s.device_id IS NULL OR d.revoked_at IS NULL").all(); // a revoked phone gets nothing
    for (const s of subs) {
      const endpoint = String(s["endpoint"]);
      try {
        const url = checkEndpoint(endpoint, (h) => this.allow(h), this.o.allowHost !== undefined); // checked again at send time
        const res = await (this.o.fetchImpl ?? fetch)(endpoint, {
          method: "POST",
          headers: { authorization: `vapid t=${this.jwt(url.origin)}, k=${this.publicKey()}`, ttl: String(PUSH_LIMITS.ttlSeconds), urgency: "high", "content-length": "0" },
          signal: AbortSignal.timeout(PUSH_LIMITS.timeoutMs),
          redirect: "error", // never follow a redirect to somewhere else
        });
        if (res.status === 404 || res.status === 410) {
          this.o.db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(String(s["id"]));
          this.o.audit.record("push.expired", { host: url.hostname });
        } else if (res.status >= 200 && res.status < 300) reached++;
        else this.o.audit.record("push.failed", { host: url.hostname, status: res.status });
      } catch {
        this.o.audit.record("push.failed", { reason: "could not reach the push service" });
      }
    }
    return reached;
  }

  /** Called by the clock. Sends one alert when a NEW approval has started waiting. */
  async tick(): Promise<number> {
    try {
      const { count, newestAt } = this.o.pendingApprovals();
      if (count === 0 || newestAt === null || newestAt === this.lastNotifiedAt) {
        if (count === 0) this.lastNotifiedAt = newestAt ?? this.lastNotifiedAt;
        return 0;
      }
      if (this.count() === 0) {
        this.lastNotifiedAt = newestAt;
        return 0;
      }
      if (this.o.now() - this.lastSentMs < PUSH_LIMITS.minGapMs) return 0; // try again on a later tick
      this.lastSentMs = this.o.now();
      this.lastNotifiedAt = newestAt;
      const reached = await this.wakeAll();
      this.o.audit.record("push.sent", { devices: reached });
      return reached;
    } catch {
      return 0;
    }
  }
}
