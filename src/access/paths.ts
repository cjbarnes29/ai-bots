import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, win32 } from "node:path";

/**
 * Path rules for the folder permission system. Everything here uses Windows path rules on purpose (this is a Windows product), so the same
 * input gives the same answer on any machine the tests run on. The only contact with the real disk is the small `FsProbe`, which tests replace.
 *
 * What is refused outright: network (UNC) and device paths, alternate data streams (`file.txt:hidden`), 8.3 short names that could not be resolved,
 * names Windows silently rewrites (trailing dots or spaces), reserved device names, control characters, relative paths.
 */
export interface FsProbe {
  /** Real location of the deepest part of the path that exists (links, junctions and short names resolved), plus the rest. null = cannot be resolved. */
  resolve(abs: string): string | null;
  isDirectory(abs: string): boolean;
}

export const realFs: FsProbe = {
  resolve(abs) {
    try {
      let cur = abs;
      const rest: string[] = [];
      while (!existsSync(cur)) {
        const parent = dirname(cur);
        if (parent === cur) return null;
        rest.unshift(basename(cur));
        cur = parent;
      }
      const real = realpathSync.native(cur);
      return rest.length ? win32.join(real, ...rest) : real;
    } catch {
      return null;
    }
  },
  isDirectory(abs) {
    try {
      return statSync(abs).isDirectory();
    } catch {
      return false;
    }
  },
};

export interface NormalPath {
  /** The cleaned absolute path as it will be shown. */
  path: string;
  /** Lower-case form used for every comparison (Windows paths ignore case). */
  key: string;
}

export type PathCheck = { ok: true; value: NormalPath } | { ok: false; reason: string };

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Cleans one path WITHOUT touching the disk. Used for the logical form of a path. */
export function cleanPath(input: unknown): PathCheck {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, reason: "Type the full path of a folder." };
  if (input.length > 400) return { ok: false, reason: "That path is too long." };
  if (/[\u0000-\u001f]/.test(input)) return { ok: false, reason: "That is not a valid path." };
  if (/^[\\/]{2}/.test(input)) return { ok: false, reason: "Network paths and device paths are not allowed." };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return { ok: false, reason: "Web addresses are not paths." };
  if (!/^[a-zA-Z]:[\\/]/.test(input)) return { ok: false, reason: "Use the full path starting with a drive letter, for example C:\\Users\\you\\Projects." };
  if (input.indexOf(":", 2) !== -1) return { ok: false, reason: "Hidden data streams (a second colon in the path) are not allowed." };
  if (/[<>"|?*]/.test(input)) return { ok: false, reason: "That path contains characters Windows does not allow." };
  const norm = win32.normalize(input).replace(/[\\]+$/, (m, off: number) => (off <= 2 ? "\\" : ""));
  const parts = norm.slice(3).split("\\").filter(Boolean);
  for (const p of parts) {
    if (/[. ]$/.test(p)) return { ok: false, reason: `"${p}" ends with a dot or a space, which Windows silently changes. Remove it.` };
    if (RESERVED.test(p)) return { ok: false, reason: `"${p}" is a reserved Windows device name.` };
  }
  return { ok: true, value: { path: norm, key: norm.toLowerCase() } };
}

/**
 * The path the decision is made on: cleaned, then resolved to its real location (so a shortcut, junction or symbolic link cannot lead
 * outside an approved folder). Anything that cannot be resolved safely is refused.
 */
export function resolvePath(input: unknown, fs: FsProbe = realFs): PathCheck {
  const c = cleanPath(input);
  if (!c.ok) return c;
  const real = fs.resolve(c.value.path);
  if (real === null) return { ok: false, reason: "That path could not be checked." };
  const again = cleanPath(real);
  if (!again.ok) return again;
  // a part that does not exist yet cannot be a short name or hide anything: refuse the ~1 form because it may name something else
  if (win32.normalize(real).slice(3).split("\\").some((p) => /~\d/.test(p))) return { ok: false, reason: "Short (8.3) Windows names are not allowed. Use the full name." };
  return again;
}

/** Is `candidate` the same as, or inside, `root`? (both are `key` forms) */
export function isInside(rootKey: string, candidateKey: string): boolean {
  const r = rootKey.endsWith("\\") ? rootKey : rootKey + "\\";
  return candidateKey === rootKey || candidateKey.startsWith(r);
}

export const parentKey = (key: string): string => {
  const p = win32.dirname(key);
  return p;
};

// ---------------- sensitive places ----------------
export type SensitiveCategory = "ssh_keys" | "credentials" | "tokens" | "env_files" | "password_store" | "browser_profile" | "mail" | "chat" | "personal" | "app_data";

export const SENSITIVE_LABEL: Record<SensitiveCategory, string> = {
  ssh_keys: "SSH or encryption keys",
  credentials: "saved credentials",
  tokens: "access tokens",
  env_files: ".env files (secrets)",
  password_store: "a password store",
  browser_profile: "a web browser profile (logins, cookies, history)",
  mail: "email data",
  chat: "chat or messaging data",
  personal: "personal information (contacts)",
  app_data: "the hidden application-data folder, which holds profiles and logins of many programs",
};

const RULES: { cat: SensitiveCategory; re: RegExp }[] = [
  { cat: "ssh_keys", re: /(^|\\)\.(ssh|gnupg|gpg)(\\|$)|(^|\\)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|\.(pem|ppk|pfx|p12|keystore|jks)$/ },
  { cat: "env_files", re: /(^|\\)\.env(\.[^\\]*)?$/ },
  { cat: "tokens", re: /(^|\\)(\.npmrc|\.pypirc|\.git-credentials|\.netrc|\.aws|\.azure|\.kube|\.docker|\.config\\gh|\.config\\gcloud)(\\|$)|(^|\\)[^\\]*(token|secret|apikey|api_key)[^\\]*\.(json|txt|ya?ml|key|dat)$/ },
  { cat: "credentials", re: /(^|\\)(credentials(\.json)?|vault\.key|secrets?(\.json|\.ya?ml)?)$|\\microsoft\\(credentials|protect|vault)(\\|$)|\\credential manager(\\|$)/ },
  { cat: "password_store", re: /\.(kdbx?|1pux|1pif|opvault|agilekeychain)$|\\(keepass[^\\]*|bitwarden|1password[^\\]*|lastpass|dashlane|keepassxc)(\\|$)/ },
  { cat: "browser_profile", re: /\\(google\\chrome|google\\chrome beta|microsoft\\edge|chromium|brave-?software|vivaldi|opera software|opera stable|yandex)\\(user data|opera stable)(\\|$)|\\mozilla\\(firefox|librewolf)(\\|$)|\\(user data|profiles)\\[^\\]*\\(cookies|login data|web data|history|local storage)(\\|$)/ },
  { cat: "mail", re: /\.(pst|ost|eml|msg|mbox)$|\\(thunderbird|microsoft\\outlook|windowsapps\\microsoft\.outlook[^\\]*|mailspring|windows mail|comms\\unistore)(\\|$)/ },
  { cat: "chat", re: /\\(telegram desktop(\\tdata)?|discord|slack|whatsapp[^\\]*|signal|skype|microsoft\\teams|teams)(\\|$)/ },
  { cat: "personal", re: /\\(contacts|addressbook)(\\|$)|\.(vcf|vcard)$/ },
  { cat: "app_data", re: /\\appdata(\\|$)/ },
];

/**
 * Which kind of secret or personal data does this path look like? Looked at BOTH on the whole path and on every part, so a file deep inside
 * a profile folder is still caught. Patterns can miss things (a renamed file): this is a safety net on top of default-deny, not the main rule.
 */
export function classifySensitive(key: string): SensitiveCategory | null {
  const k = key.toLowerCase();
  for (const r of RULES) if (r.re.test(k)) return r.cat;
  return null;
}

// ---------------- places a grant may never target ----------------
const SYSTEM_FOLDERS = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata", "c:\\$recycle.bin", "c:\\system volume information", "c:\\recovery", "c:\\boot"];

/** Reasons a folder cannot be offered for a grant even by the owner. null = acceptable target. */
export function forbiddenTarget(key: string, options: { home?: string; appFolders?: string[] } = {}): string | null {
  const p = win32.parse(key);
  if (key === p.root.toLowerCase()) return "A whole drive cannot be approved. Choose a folder inside it.";
  if (SYSTEM_FOLDERS.some((s) => isInside(s, key))) return "Windows and program folders cannot be approved.";
  if (options.home && key === options.home.toLowerCase()) return "Your whole user folder cannot be approved. Choose a folder inside it.";
  if (options.home && isInside(key, options.home.toLowerCase())) return "That folder contains your whole user folder. Choose a folder inside it.";
  for (const f of options.appFolders ?? []) {
    const fk = f.toLowerCase();
    if (isInside(fk, key) || isInside(key, fk)) return "That folder contains (or is inside) this app's own files, including its database and vault. Choose a different folder.";
  }
  return null;
}
