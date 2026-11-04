import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";

/**
 * Where the PC agent may work. The owner lists a few "workspace" folders; everything a bot touches must resolve to a place INSIDE one of them.
 * Checks use the real location of each folder (so a shortcut, junction or symbolic link cannot lead outside), refuse `..` tricks, refuse files
 * that hold secrets, and refuse the platform's own data folder.
 */
const isWindows = process.platform === "win32";
const norm = (p: string) => (isWindows ? p.toLowerCase() : p);

const SECRET_NAMES = [/^\.env($|\.)/i, /^vault\.key$/i, /\.(db|db-wal|db-shm|sqlite|sqlite3)$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i, /\.(pem|key|pfx|p12|keystore|jks)$/i, /^\.npmrc$/i, /^\.git-credentials$/i, /^\.netrc$/i, /^credentials(\.json)?$/i, /^secrets?(\.json|\.ya?ml)?$/i];

export function isSecretFileName(name: string): boolean {
  return SECRET_NAMES.some((r) => r.test(name));
}

const SYSTEM_FOLDERS_WINDOWS = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata", "c:\\$recycle.bin", "c:\\system volume information"];
const SYSTEM_FOLDERS_OTHER = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/var", "/sys", "/proc", "/dev", "/root"];

export type PathResult = { ok: true; abs: string } | { ok: false; reason: string };

function inside(root: string, candidate: string): boolean {
  const r = norm(root);
  const c = norm(candidate);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** The deepest part of a path that already exists, resolved to its real location (follows links), plus the part that does not exist yet. */
function realBase(abs: string): { real: string; rest: string } {
  let cur = abs;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return { real: realpathSync.native(cur), rest: join(...rest, "") };
}

/** Is this folder acceptable as a workspace? Returns the cleaned absolute path, or why not. */
export function validateRoot(input: string, forbidden: string[] = []): PathResult {
  if (typeof input !== "string" || input.trim() === "" || input.length > 300) return { ok: false, reason: "Type the full path of a folder." };
  if (!isAbsolute(input)) return { ok: false, reason: "Use the full path, for example C:\\Users\\you\\Projects." };
  const abs = normalize(resolve(input));
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return { ok: false, reason: "That folder does not exist." };
  const real = realpathSync.native(abs);
  const { root } = parse(real);
  if (norm(real) === norm(root)) return { ok: false, reason: "A whole drive cannot be a workspace. Choose a folder inside it." };
  if (norm(real) === norm(homedir())) return { ok: false, reason: "Your whole user folder cannot be a workspace. Choose a project folder inside it." };
  const system = isWindows ? SYSTEM_FOLDERS_WINDOWS : SYSTEM_FOLDERS_OTHER;
  if (system.some((s) => inside(s, real))) return { ok: false, reason: "System folders cannot be a workspace." };
  for (const f of forbidden) {
    if (existsSync(f)) {
      const fr = realpathSync.native(f);
      if (inside(fr, real) || inside(real, fr)) return { ok: false, reason: "That folder contains (or is inside) this app's own files, including its database and vault. Choose a different folder." };
    }
  }
  return { ok: true, abs: real };
}

/**
 * Turns a path a bot gave into a real absolute path, if (and only if) it lies inside a workspace.
 * `relativeTo` is used for relative paths (normally the first workspace or the command's working folder).
 */
export function resolveInRoots(roots: string[], input: string, relativeTo: string, options: { allowSecretNames?: boolean } = {}): PathResult {
  if (roots.length === 0) return { ok: false, reason: "No workspace folder has been set up yet (Settings → PC agent)." };
  if (typeof input !== "string" || input.length === 0 || input.length > 400 || /[\u0000-\u001f]/.test(input)) return { ok: false, reason: "That is not a valid path." };
  if (/^\\\\/.test(input) || /^[a-z]+:\/\//i.test(input)) return { ok: false, reason: "Network paths and web addresses are not allowed." };
  const abs = normalize(isAbsolute(input) ? input : resolve(relativeTo, input));
  const home = roots.find((r) => inside(r, abs));
  if (!home) return { ok: false, reason: "That path is outside the workspace folders." };
  let real: string;
  try {
    const { real: base, rest } = realBase(abs);
    real = rest ? join(base, rest) : base;
  } catch {
    return { ok: false, reason: "That path could not be checked." };
  }
  // the real location (after following any links) must still be inside the same workspace
  let realHome: string;
  try {
    realHome = realpathSync.native(home);
  } catch {
    return { ok: false, reason: "The workspace folder is missing." };
  }
  if (!inside(realHome, real)) return { ok: false, reason: "That path leads outside the workspace folder (through a link or shortcut)." };
  if (!options.allowSecretNames) {
    const parts = real.slice(realHome.length).split(sep).filter(Boolean);
    const bad = parts.find((p) => isSecretFileName(p));
    if (bad) return { ok: false, reason: `"${bad}" looks like a file that holds secrets (keys, passwords or a database), so bots may not touch it.` };
  }
  return { ok: true, abs: real };
}
