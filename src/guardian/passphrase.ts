import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The owner's passphrase. It is never stored: only a salted scrypt hash is kept, so a copy of the file cannot be read back
 * into the passphrase (a weak passphrase could still be guessed offline, so the minimum length matters).
 * Used by the Guardian only. The Manager and the agents never see the passphrase or the hash.
 */
export interface PassphraseRecord {
  v: 1;
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export const MIN_PASSPHRASE_CHARS = 12;
export const MAX_PASSPHRASE_CHARS = 200;
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };
const MAXMEM = 128 * 1024 * 1024;

/** A plain-language reason the passphrase is too weak, or null if it is acceptable. */
export function checkStrength(pass: string): string | null {
  if (pass.length < MIN_PASSPHRASE_CHARS) return `Use at least ${MIN_PASSPHRASE_CHARS} characters (a few unrelated words is a good passphrase).`;
  if (pass.length > MAX_PASSPHRASE_CHARS) return `Use at most ${MAX_PASSPHRASE_CHARS} characters.`;
  if (new Set(pass).size < 5) return "Use more different characters.";
  if (/^\s|\s$/.test(pass)) return "Do not start or end the passphrase with a space.";
  return null;
}

export function hashPassphrase(pass: string): PassphraseRecord {
  const salt = randomBytes(16);
  const hash = scryptSync(pass.normalize("NFKC"), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return { v: 1, salt: salt.toString("base64"), hash: hash.toString("base64"), ...PARAMS };
}

export function verifyPassphrase(pass: string, rec: PassphraseRecord): boolean {
  if (typeof pass !== "string" || pass.length === 0 || pass.length > MAX_PASSPHRASE_CHARS) return false;
  const expected = Buffer.from(rec.hash, "base64");
  const actual = scryptSync(pass.normalize("NFKC"), Buffer.from(rec.salt, "base64"), rec.keylen, { N: rec.N, r: rec.r, p: rec.p, maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parsePassphraseRecord(raw: string): PassphraseRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<PassphraseRecord>;
    if (o.v === 1 && typeof o.salt === "string" && typeof o.hash === "string" && o.N === PARAMS.N && o.r === PARAMS.r && o.p === PARAMS.p && o.keylen === PARAMS.keylen) return o as PassphraseRecord;
  } catch {
    /* damaged file: treated as "no passphrase" by the caller, which then refuses to resume */
  }
  return null;
}
