import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Serves the built dashboard (web/dist) from the same address as the API. That is what lets a phone use ONE address
 * (https://<pc>.ts.net) for the pages and the data, and lets the installable app work over HTTPS.
 * Only files inside the dashboard folder can be served; anything else under /api is never touched.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function dashboardAvailable(dir: string): boolean {
  return existsSync(join(dir, "index.html"));
}

export function registerDashboard(app: FastifyInstance, dir: string): void {
  const root = resolve(dir);
  app.setNotFoundHandler((req, reply) => {
    const path = decodeURIComponentSafe(req.url.split("?")[0] ?? "/");
    if ((req.method !== "GET" && req.method !== "HEAD") || path === null || path.startsWith("/api/") || path === "/api") {
      return reply.code(404).send({ error: "not_found", message: "Not found" });
    }
    const target = normalize(join(root, path === "/" ? "index.html" : path));
    let file = target.startsWith(root + sep) && existsSync(target) && statSync(target).isFile() ? target : null;
    // A page address such as /approvals is handled by the dashboard itself, so it gets index.html.
    const isAsset = extname(path) !== "";
    if (!file && isAsset) return reply.code(404).send({ error: "not_found", message: "Not found" });
    file ??= join(root, "index.html");
    const isIndex = file.endsWith(`${sep}index.html`);
    reply
      .header("content-type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .header("cache-control", isIndex || file.endsWith(`${sep}sw.js`) ? "no-cache" : path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    if (isIndex) reply.header("content-security-policy", CSP);
    return reply.send(req.method === "HEAD" ? "" : readFileSync(file));
  });
}

function decodeURIComponentSafe(s: string): string | null {
  try {
    const d = decodeURIComponent(s);
    return d.includes("\0") || d.includes("\\") ? null : d;
  } catch {
    return null;
  }
}
