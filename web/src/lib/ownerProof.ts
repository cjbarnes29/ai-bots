/**
 * The owner's proof (a 10-minute "decision window"). The owner types the passphrase into the dashboard; it goes straight to the Guardian
 * (never to this app's server), and the Guardian answers with a short-lived token. The token is kept only in this page's memory: it is
 * not saved to disk, cookies or localStorage, so closing or reloading the page forgets it.
 */
export const PROOF_HEADER = "x-awp-proof";

let proof: { token: string; expiresAt: number } | null = null;
let asker: (() => Promise<boolean>) | null = null;
let inflight: Promise<boolean> | null = null;

/** The token, if it is still valid (with a few seconds to spare), else null. */
export function currentProof(now = Date.now()): string | null {
  if (proof && now < proof.expiresAt - 5000) return proof.token;
  proof = null;
  return null;
}

export function rememberProof(token: string, expiresAtIso: string): void {
  proof = { token, expiresAt: Date.parse(expiresAtIso) };
}

export function forgetProof(): void {
  proof = null;
}

/** The dialog registers itself here so the API client can ask for the passphrase when the server says a proof is needed. */
export function setProofAsker(fn: (() => Promise<boolean>) | null): void {
  asker = fn;
  if (!fn) inflight = null; // a dialog that went away can never answer: never leave a request waiting on it
}

/** Opens the passphrase dialog (once, even if several requests need it at the same time). True if a proof was obtained. */
export function askForProof(): Promise<boolean> {
  if (!asker) return Promise.resolve(false);
  inflight ??= asker().finally(() => {
    inflight = null;
  });
  return inflight;
}
