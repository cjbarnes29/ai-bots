import type { FastifyInstance } from "fastify";

export const CLIENT_HEADER = "x-awp-client";
export const CLIENT_HEADER_VALUE = "dashboard";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  // IPv6 hosts look like "[::1]:3000"; others like "localhost:3000".
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
}

/**
 * Protects a local-only API from malicious web pages opened in your browser:
 *  1. Host check: blocks "DNS rebinding" (a hostile site pointing its own name at your PC).
 *  2. Required header on every request that changes data. Browsers will not let a
 *     website add a custom header to a cross-origin request unless CORS approves it.
 */
export function registerSecurity(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(req.headers.host))) {
      return reply.code(403).send({ error: "forbidden_host", message: "Host not allowed" });
    }
    if (!SAFE_METHODS.has(req.method) && req.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      return reply
        .code(403)
        .send({ error: "missing_client_header", message: "Missing required client header" });
    }
  });
}
