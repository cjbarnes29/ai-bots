import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditError, ExternalDisabledError, auditSite, type HttpResponse } from "./audit.js";
import { createGuardedFetcher, mapNetworkError, nodeTransport, type Transport } from "./netfetch.js";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const ok = (over: Partial<HttpResponse> = {}): HttpResponse => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html></html>"), ms: 5, ...over });

function guarded(over: { allowed?: boolean; lookup?: () => Promise<{ address: string; family: number }[]>; transport?: Transport } = {}) {
  const transport = vi.fn<Transport>(over.transport ?? (async () => ok()));
  const lookup = vi.fn(over.lookup ?? (async () => PUBLIC));
  const seen: string[] = [];
  const fetcher = createGuardedFetcher({ allowed: () => over.allowed ?? true, transport, lookup, onRequest: (h) => seen.push(h) });
  return { fetcher, transport, lookup, seen };
}

describe("the guard in front of every website request", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.0.0.5/",
    "http://192.168.1.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://0x7f000001/",
    "http://localhost/",
    "https://router.local/",
    "https://intranet/",
    "https://user:secret@shop.ae/",
    "https://shop.ae:8443/",
    "http://shop.ae:8080/",
  ])("%s is refused before anything is requested", async (address) => {
    const g = guarded();
    await expect(g.fetcher(new URL(address))).rejects.toMatchObject({ code: "blocked_address" });
    expect(g.transport).not.toHaveBeenCalled();
    expect(g.seen).toEqual([]);
  });

  it("a name that resolves to a private address is blocked, a name that does not resolve is 'not found'", async () => {
    const priv = guarded({ lookup: async () => [{ address: "10.1.2.3", family: 4 }] });
    await expect(priv.fetcher(new URL("https://sneaky.example.com/"))).rejects.toMatchObject({ code: "blocked_address" });
    const mixed = guarded({ lookup: async () => [...PUBLIC, { address: "127.0.0.1", family: 4 }] });
    await expect(mixed.fetcher(new URL("https://sneaky.example.com/"))).rejects.toMatchObject({ code: "blocked_address" });
    const gone = guarded({
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(gone.fetcher(new URL("https://nothere.example.com/"))).rejects.toMatchObject({ code: "dns_failed" });
    for (const g of [priv, mixed, gone]) expect(g.transport).not.toHaveBeenCalled();
  });

  it("the switch is a real lock: while it is off, no lookup and no request happens at all", async () => {
    const g = guarded({ allowed: false });
    await expect(g.fetcher(new URL("https://shop.ae/"))).rejects.toBeInstanceOf(ExternalDisabledError);
    expect(g.lookup).not.toHaveBeenCalled();
    expect(g.transport).not.toHaveBeenCalled();
    expect(g.seen).toEqual([]);
  });

  it("connects to the address that was checked, on the standard port, and reports the host only", async () => {
    const g = guarded();
    await g.fetcher(new URL("https://Shop.AE/menu?x=1"));
    await g.fetcher(new URL("http://shop.ae/"));
    expect(g.transport.mock.calls[0]![0]).toMatchObject({ tls: true, hostname: "shop.ae", address: "93.184.216.34", port: 443, path: "/menu?x=1" });
    expect(g.transport.mock.calls[1]![0]).toMatchObject({ tls: false, port: 80, path: "/" });
    expect(g.seen).toEqual(["shop.ae", "shop.ae"]);
  });

  it("only http and https addresses are accepted", async () => {
    const g = guarded();
    for (const a of ["ftp://shop.ae/", "file:///etc/passwd", "javascript:alert(1)"]) await expect(g.fetcher(new URL(a))).rejects.toMatchObject({ code: "bad_address" });
    expect(g.transport).not.toHaveBeenCalled();
  });

  it("a redirect to a private address is stopped by the guard on the next hop, and the private address is never requested", async () => {
    const g = guarded({
      transport: async () => ok({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" }, body: Buffer.alloc(0) }),
    });
    const out = await auditSite("https://shop.ae/", { fetch: g.fetcher, now: () => Date.now() });
    expect(out).toMatchObject({ state: "failed", failure: "blocked_address" });
    expect(g.transport).toHaveBeenCalledTimes(1); // only the public site was ever contacted
  });
});

describe("network errors become audit failures, never scores", () => {
  it.each([
    [{ message: "timeout" }, "timed_out"],
    [{ code: "ETIMEDOUT" }, "timed_out"],
    [{ message: "too big" }, "too_large"],
    [{ code: "ENOTFOUND" }, "dns_failed"],
    [{ code: "CERT_HAS_EXPIRED" }, "tls_certificate_invalid"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls_certificate_invalid"],
    [{ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "tls_certificate_invalid"],
    [{ code: "ECONNREFUSED" }, "connection_failed"],
    [{ code: "ECONNRESET" }, "connection_failed"],
    [new Error("something odd"), "connection_failed"],
  ])("%j -> %s", (err, code) => {
    const mapped = mapNetworkError(err);
    expect(mapped).toBeInstanceOf(AuditError);
    expect(mapped.code).toBe(code);
  });
});

/** The real transport, against a server on THIS PC only (the guard that blocks private addresses sits one layer above it). */
describe("the real transport", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => (s.closeAllConnections?.(), s.close(() => r())))));
  });
  async function serve(handler: http.RequestListener) {
    const s = http.createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    return (s.address() as AddressInfo).port;
  }
  const spec = (port: number, over: Partial<Parameters<Transport>[0]> = {}) => ({ tls: false, hostname: "shop.ae", address: "127.0.0.1", family: 4, port, path: "/", timeoutMs: 1000, maxBytes: 1000, ...over });

  it("makes one plain GET that identifies itself, sends no cookies, and returns status, headers, body and timing", async () => {
    let seen: http.IncomingMessage | undefined;
    const port = await serve((req, res) => {
      seen = req;
      res.writeHead(200, { "content-type": "text/html", "x-test": "1" });
      res.end("<html>hello</html>");
    });
    const r = await nodeTransport(spec(port));
    expect(r).toMatchObject({ status: 200, ms: expect.any(Number) });
    expect(r.body.toString()).toBe("<html>hello</html>");
    expect(r.headers["x-test"]).toBe("1");
    expect(seen!.method).toBe("GET");
    expect(seen!.headers.host).toBe("shop.ae"); // the site's own name is asked for, though the connection went to the checked address
    expect(seen!.headers["user-agent"]).toMatch(/AIWorkforceSiteCheck.*read-only/);
    expect(seen!.headers.cookie).toBeUndefined();
    expect(seen!.headers.authorization).toBeUndefined();
    expect(seen!.headers["accept-encoding"]).toBe("identity");
  });

  it("does not follow redirects by itself (the caller checks every hop)", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
    });
    const r = await nodeTransport(spec(port));
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("http://169.254.169.254/");
  });

  it("an oversized answer, a silent server and a refused connection are three different failures", async () => {
    const big = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(5000));
    });
    await expect(nodeTransport(spec(big, { maxBytes: 1000 }))).rejects.toMatchObject({ code: "too_large" });

    const silent = await serve(() => {
      /* never answers */
    });
    await expect(nodeTransport(spec(silent, { timeoutMs: 150 }))).rejects.toMatchObject({ code: "timed_out" });

    const closed = await serve(() => undefined);
    servers.pop()!.close();
    await expect(nodeTransport(spec(closed))).rejects.toMatchObject({ code: "connection_failed" });
  });

  it("a server that trickles bytes forever is cut off by the overall deadline", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const t = setInterval(() => res.write("x"), 30);
      res.on("close", () => clearInterval(t));
    });
    const started = Date.now();
    await expect(nodeTransport(spec(port, { timeoutMs: 150, maxBytes: 1_000_000 }))).rejects.toMatchObject({ code: "timed_out" });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
