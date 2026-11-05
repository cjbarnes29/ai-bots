import { z } from "zod";
import { LIMITS } from "../agent-manager/schemas.js";
import { looksSecret } from "../desktop/redact.js";

/**
 * Bot export / import. A bot file carries CONTENT only: name, role, personality, instructions, responsibilities, and two generation settings.
 * It never carries: permissions, grants, application or folder approvals, delegation targets, memory, model choice, status, version history,
 * identifiers or secrets. Importing therefore cannot give a bot any power: it always creates an ordinary DISABLED bot with every permission OFF and no model.
 * A file is rejected (not "cleaned") if it contains a permission-like field, anything that looks like a key or token, or unknown fields.
 */
export const EXPORT_FORMAT = "awp-bot";
export const MAX_IMPORT_CHARS = 100_000;

export const portableBotSchema = z.strictObject({
  name: z.string().trim().min(1).max(LIMITS.name),
  role: z.string().trim().max(LIMITS.role),
  personality: z.string().max(LIMITS.personality),
  instructions: z.string().max(LIMITS.instructions),
  responsibilities: z.array(z.string().trim().min(1).max(LIMITS.responsibility)).max(LIMITS.responsibilities),
  temperature: z.number().min(0).max(2).nullable(),
  maxOutputTokens: z.number().int().min(1).max(4096).nullable(),
});
export type PortableBot = z.infer<typeof portableBotSchema>;

export const portableFileSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().max(40).optional(),
  bot: portableBotSchema,
});

/** The only field names a bot file may use. Anything else that sounds like a permission, secret or setting is refused with a clear reason. */
const FILE_KEYS = new Set(["format", "version", "exportedAt", "bot", "name", "role", "personality", "instructions", "responsibilities", "temperature", "maxOutputTokens"]);
const DANGEROUS_KEY = /permission|grant|approv|secret|token|password|passwd|api[_-]?key|credential|connector|vault|allow|policy|delegat|folder|application|runtime|model|status|\bid\b/i;

export interface ImportCheck {
  ok: boolean;
  /** Why the file was refused (plain language). */
  problems: string[];
  /** Things the owner should read before saving (not reasons to refuse). */
  warnings: string[];
  bot: PortableBot | null;
}

function keysOf(v: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x, i) => keysOf(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) (out.push(path ? `${path}.${k}` : k), keysOf(x, path ? `${path}.${k}` : k, out));
  return out;
}
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => strings(x, out));
  return out;
}

const SOFT = [
  { re: /ignore (all |any )?(previous|prior|above) (instructions|rules)/i, warn: "The instructions tell the bot to ignore earlier rules. Read them carefully." },
  { re: /(approve|accept) (it|everything|requests?) (automatically|without)/i, warn: "The instructions talk about approving things automatically. Approvals are always yours; the bot cannot do that." },
  { re: /(send|post|publish|transfer|pay|delete|format)\b.*\b(without|no) (asking|approval|confirmation|review)/i, warn: "The instructions suggest acting without asking. Outside actions always wait for your approval regardless." },
  { re: /https?:\/\//i, warn: "The instructions contain a web address. Web content is information to the bot, never orders." },
];

/** Parses and checks text from a bot file. Never creates anything. */
export function checkImport(text: string): ImportCheck {
  const bad = (problems: string[]): ImportCheck => ({ ok: false, problems, warnings: [], bot: null });
  if (typeof text !== "string" || text.trim() === "") return bad(["The file is empty."]);
  if (text.length > MAX_IMPORT_CHARS) return bad([`The file is larger than ${MAX_IMPORT_CHARS / 1000} KB.`]);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad(["That is not a valid bot file (it could not be read as JSON)."]);
  }
  // permission-like or secret-like FIELD NAMES anywhere: refuse outright, so a crafted file cannot smuggle a grant
  const dangerousKeys = keysOf(json).filter((k) => { const leaf = (k.split(".").pop() ?? ""); return !FILE_KEYS.has(leaf) && DANGEROUS_KEY.test(leaf); });
  if (dangerousKeys.length > 0) {
    return bad([`The file contains fields that a bot file must never contain (${[...new Set(dangerousKeys)].slice(0, 6).join(", ")}). Bot files carry content only; permissions, models and secrets are never imported.`]);
  }
  const parsed = portableFileSchema.safeParse(json);
  if (!parsed.success) return bad(parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "file"}: ${i.message}`));
  if (strings(parsed.data).some((s) => looksSecret(s))) return bad(["The file contains something that looks like a key, token or password. It was not imported."]);
  const warnings = SOFT.filter((s) => strings(parsed.data.bot).some((t) => s.re.test(t))).map((s) => s.warn);
  return { ok: true, problems: [], warnings, bot: parsed.data.bot };
}

export function exportFile(bot: PortableBot): z.infer<typeof portableFileSchema> {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), bot: { name: bot.name, role: bot.role, personality: bot.personality, instructions: bot.instructions, responsibilities: bot.responsibilities, temperature: bot.temperature, maxOutputTokens: bot.maxOutputTokens } };
}
