/**
 * Redaction of anything that looks like a secret or a credential. The SAME list of patterns is compiled into the Windows host script
 * (so text is redacted BEFORE it leaves the Windows host process) and used again on the Node side (second layer). The patterns are
 * written in the common subset of JavaScript and .NET regular-expression syntax.
 *
 * This is a safety net for text that happens to be on screen. It cannot recognise every secret (a renamed or oddly formatted one can pass),
 * which is why password fields are never read at all, why field contents are not returned to the model by default, and why screenshots are
 * never kept. See docs/SECURITY-AUDIT.md (incident 2026-11-04).
 */
export const REDACTED = "[redacted]";

/** [name, pattern source]. A pattern with a capture group named "keep" keeps that part (the label) and hides the rest. */
export const SECRET_PATTERNS: readonly (readonly [string, string])[] = [
  ["google-api-key", String.raw`\bAIza[0-9A-Za-z_\-]{30,}`],
  ["google-oauth", String.raw`\bAQ\.[A-Za-z0-9_\-]{20,}`],
  ["sk-key", String.raw`\bsk-[A-Za-z0-9_\-]{12,}`],
  ["github-token", String.raw`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}`],
  ["slack-token", String.raw`\bxox[abprs]-[A-Za-z0-9\-]{10,}`],
  ["aws-key", String.raw`\bAKIA[0-9A-Z]{16}\b`],
  ["jwt", String.raw`\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}`],
  ["private-key", String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`],
  ["labelled-secret", String.raw`\b(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|authorization|bearer|credential)s?\b\s*[:=]\s*[^\s,;]{3,}`],
  ["card-number", String.raw`\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b`],
  ["long-token", String.raw`\b(?=[A-Za-z0-9_\-+/=]*[0-9])(?=[A-Za-z0-9_\-+/=]*[A-Za-z])[A-Za-z0-9_\-+/=]{32,}\b`],
];

const COMPILED = SECRET_PATTERNS.map(([, src]) => new RegExp(src, "gi"));

/** Replaces every secret-looking part of the text with [redacted]. */
export function redactSensitive(text: string): string {
  let out = text;
  for (const re of COMPILED) out = out.replace(re, REDACTED);
  return out;
}

export const looksSecret = (text: string): boolean => redactSensitive(text) !== text;

/** The patterns as a PowerShell array literal of single-quoted strings (for the host script). */
export function patternsForPowerShell(): string {
  return `@(${SECRET_PATTERNS.map(([, src]) => `'${src.replace(/'/g, "''")}'`).join(", ")})`;
}
