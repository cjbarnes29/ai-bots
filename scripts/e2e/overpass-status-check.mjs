// P-36 diagnostic (run once, owner-approved): exactly ONE read-only GET to https://overpass-api.de/api/status. No retry. No provider request. Needs a new approval to run again.
const url = "https://overpass-api.de/api/status";
const t0 = performance.now();
const out = { url, startedAt: new Date().toISOString(), requests: 1, providerRequests: 0 };
try {
  const res = await fetch(url, { method: "GET", headers: { "user-agent": "AIWorkforceDiscovery/1.0 (read-only status check)", accept: "text/plain" }, signal: AbortSignal.timeout(40_000) });
  out.firstByteMs = Math.round(performance.now() - t0);
  out.status = res.status;
  out.headers = Object.fromEntries([...res.headers].filter(([k]) => /^(content-type|server|date|retry-after|x-|via|cf-)/i.test(k)));
  const text = await res.text();
  out.totalMs = Math.round(performance.now() - t0);
  out.body = text.slice(0, 2000);
} catch (e) {
  out.totalMs = Math.round(performance.now() - t0);
  out.error = { name: e?.name, message: String(e?.message ?? e).slice(0, 300), causeCode: e?.cause?.code ?? null, causeMessage: e?.cause?.message ? String(e.cause.message).slice(0, 300) : null };
}
console.log(JSON.stringify(out, null, 2));
