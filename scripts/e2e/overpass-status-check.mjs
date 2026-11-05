// Map service status diagnostic: exactly ONE read-only GET to the status page of ONE service from the fixed list. No retry. No provider request.
// It refuses to run unless the owner approved it: AWP_APPROVED_STATUS_REQUESTS=1 (and the endpoint named on the command line).
//   node scripts/e2e/overpass-status-check.mjs main   -> GET https://overpass-api.de/api/status          (run once for P-36, 2026-11-05)
//   node scripts/e2e/overpass-status-check.mjs kumi   -> GET https://overpass.kumi.systems/api/status    (proposed as P-38, NOT run)
const ENDPOINTS = { main: "https://overpass-api.de/api/status", kumi: "https://overpass.kumi.systems/api/status" };
const id = process.argv[2];
const url = ENDPOINTS[id];
if (!url) { console.error(`Name one service: ${Object.keys(ENDPOINTS).join(" or ")}. Nothing was sent.`); process.exit(2); }
if (process.env.AWP_APPROVED_STATUS_REQUESTS !== "1") { console.error("Refusing: the owner has not approved this one request (AWP_APPROVED_STATUS_REQUESTS=1). Nothing was sent."); process.exit(2); }
const TIMEOUT_MS = 15_000;
const t0 = performance.now();
const out = { endpoint: id, url, startedAt: new Date().toISOString(), requests: 1, providerRequests: 0, timeoutMs: TIMEOUT_MS };
try {
  const res = await fetch(url, { method: "GET", headers: { "user-agent": "AIWorkforceDiscovery/1.0 (read-only status check)", accept: "text/plain" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  out.firstByteMs = Math.round(performance.now() - t0);
  out.status = res.status;
  out.headers = Object.fromEntries([...res.headers].filter(([k]) => /^(content-type|server|date|retry-after)$/i.test(k)));
  out.body = (await res.text()).slice(0, 2000);
  out.totalMs = Math.round(performance.now() - t0);
} catch (e) {
  out.totalMs = Math.round(performance.now() - t0);
  out.error = { name: e?.name, message: String(e?.message ?? e).slice(0, 300), causeCode: e?.cause?.code ?? null };
}
console.log(JSON.stringify(out, null, 2));
