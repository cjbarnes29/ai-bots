import { isIP } from "node:net";

/**
 * Decides which web addresses the browser connector may visit. The rule is: public HTTPS websites only.
 *
 * Refused: anything that is not https, addresses with a username or password in them, other ports than 443, plain IP
 * addresses, names that are not on the public internet (localhost, .local, .internal, single words like "router"), and any
 * name that points at this PC, your home or office network, or a cloud "metadata" service. The last check happens after the
 * name is looked up (see `resolvePublicAddress`), and the connection is then made to exactly that checked address, so a
 * name cannot answer "public" to the check and "private" to the connection.
 */
export class BlockedAddressError extends Error {}

const MAX_URL_CHARS = 2000;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".private", ".localdomain"];

export interface Target {
  url: URL;
  hostname: string;
}

/** The checks that need no network. Throws BlockedAddressError with a plain-language reason. */
export function parseTarget(input: string): Target {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_CHARS) throw new BlockedAddressError("The web address is empty or too long.");
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BlockedAddressError("That is not a valid web address.");
  }
  if (url.protocol !== "https:") throw new BlockedAddressError("Only secure https:// websites are allowed (not http, file, ftp or anything else).");
  if (url.username || url.password) throw new BlockedAddressError("Addresses with a username or password in them are not allowed.");
  if (url.port !== "" && url.port !== "443") throw new BlockedAddressError("Only the normal secure port (443) is allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new BlockedAddressError("The web address has no website name.");
  if (isIP(hostname) !== 0 || hostname.startsWith("[") || /^[0-9.]+$/.test(hostname) || /^0x/i.test(hostname)) {
    throw new BlockedAddressError("Websites must be given by name, not by number (IP address).");
  }
  if (!hostname.includes(".") || hostname === "localhost" || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new BlockedAddressError("That name is not a public website (it looks like this computer or a private network).");
  }
  if (!/^[a-z0-9.-]+$/.test(hostname)) throw new BlockedAddressError("Only plain website names are allowed.");
  url.hash = "";
  return { url, hostname };
}

function ipv4Parts(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

/** True only for a normal public internet IPv4 address. */
export function isPublicIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-network, private, loopback, multicast/reserved/broadcast
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT (also used by Tailscale)
  if (a === 169 && b === 254) return false; // link-local, cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // An IPv4 tail such as ::ffff:1.2.3.4
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = ipv4Parts(tail[1]!);
    if (!v4) return null;
    text = text.slice(0, -tail[1]!.length) + ((v4[0]! << 8) | v4[1]!).toString(16) + ":" + ((v4[2]! << 8) | v4[3]!).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/** True only for an ordinary public IPv6 address (global unicast). Everything unusual is refused. */
export function isPublicIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return false;
  // IPv4 inside IPv6 (::ffff:a.b.c.d and the older ::a.b.c.d form): judge the IPv4 part.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicIPv4(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  if (g[0]! < 0x2000 || g[0]! > 0x3fff) return false; // only global unicast 2000::/3
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false; // documentation, Teredo
  if (g[0] === 0x2002) return false; // 6to4 (can wrap a private IPv4)
  return true;
}

export const isPublicAddress = (ip: string): boolean => (isIP(ip) === 4 ? isPublicIPv4(ip) : isIP(ip) === 6 ? isPublicIPv6(ip) : false);

export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;

/** Looks the name up and requires EVERY answer to be public. Returns the address to connect to. */
export async function resolvePublicAddress(hostname: string, lookup: LookupAll): Promise<{ address: string; family: number }> {
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(hostname);
  } catch {
    throw new BlockedAddressError("That website name could not be found.");
  }
  if (answers.length === 0) throw new BlockedAddressError("That website name could not be found.");
  if (!answers.every((a) => isPublicAddress(a.address))) {
    throw new BlockedAddressError("That website name points at a private or internal address, so it was blocked.");
  }
  return answers[0]!;
}
