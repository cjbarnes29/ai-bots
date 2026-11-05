import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A lease is a short permission slip: "the AI Workforce may act until this time". Components that act (the Manager, a future
 * broker, the guest agent inside the VM) must hold a valid lease. The Guardian stops issuing leases when it is not in RUN, so every
 * lease-checking component stops by itself within the lease time even if nothing can reach it any more.
 *
 * The signing key stays in the Guardian. A checker that needs to verify a lease offline is given the key (that is only the
 * future VM broker; in Tier A the key sits in a file the same Windows user can read, so a lease is a safety mechanism, not
 * a defence against a hostile script of that user).
 */
export const LEASE_TTL_MS = 30_000;

export interface Lease {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function newLeaseKey(): Buffer {
  return randomBytes(32);
}

export function signLease(key: Buffer, now: number, ttlMs = LEASE_TTL_MS): string {
  const lease: Lease = { v: 1, iat: now, exp: now + ttlMs, nonce: randomBytes(8).toString("hex") };
  const payload = b64(JSON.stringify(lease));
  return `${payload}.${b64(createHmac("sha256", key).update(payload).digest())}`;
}

export function verifyLease(key: Buffer, token: string, now: number): { ok: true; lease: Lease } | { ok: false; reason: "malformed" | "bad_signature" | "expired" } {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || token.split(".").length !== 2) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", key).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  let lease: Lease;
  try {
    lease = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Lease;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (lease.v !== 1 || typeof lease.exp !== "number" || typeof lease.iat !== "number") return { ok: false, reason: "malformed" };
  if (now >= lease.exp) return { ok: false, reason: "expired" };
  return { ok: true, lease };
}
