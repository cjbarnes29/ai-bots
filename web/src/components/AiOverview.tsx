import { Link } from "react-router-dom";
import { useProviders, useRouting } from "../api/hooks";
import type { ProviderView } from "../api/types";

function stateOf(p: ProviderView): { word: string; tone: "ok" | "warn" | "idle" | "sim" } {
  if (p.simulated) return p.enabled ? { word: "Simulated (on)", tone: "sim" } : { word: "Simulated (off)", tone: "idle" };
  if (!p.connectable) return { word: "Not available", tone: "idle" };
  if (p.kind === "cloud" && !p.keyConfigured) return { word: "No key yet", tone: "idle" };
  if (!p.enabled) return { word: "Switched off", tone: "idle" };
  if (p.status === "connected") return { word: "Connected", tone: "ok" };
  if (p.status) return { word: `Problem: ${p.status}`, tone: "warn" };
  return { word: "Not tested yet", tone: "warn" };
}
const CLASS_TONE = { ok: "text-emerald-700 dark:text-emerald-300", warn: "text-amber-700 dark:text-amber-300", idle: "text-slate-600 dark:text-slate-400", sim: "text-amber-700 dark:text-amber-300" };

/** Which AI is available right now and how automatic routing will choose between them. Real and simulated providers are kept apart on purpose. */
export function AiOverview() {
  const providers = useProviders();
  const routing = useRouting();
  const list = providers.data;
  const r = routing.data;
  if (!list) return null;
  const real = list.filter((p) => !p.simulated && p.connectable);
  const realConnected = real.filter((p) => p.enabled && p.status === "connected");
  const demo = list.find((p) => p.simulated);
  const cfg = r?.config;
  const allowedWords = cfg ? (cfg.allowedProviders.length === 0 ? "every real provider that is switched on" : cfg.allowedProviders.join(", ")) : "";
  const firstChoices = cfg ? Object.entries(cfg.preferred).filter(([, v]) => v) : [];

  return (
    <section aria-labelledby="ai-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-heading" className="text-lg font-semibold">
          Your AI right now
        </h2>
        <Link to="/settings/ai-models" className="text-sm underline">
          Providers and routing
        </Link>
      </div>
      {realConnected.length === 0 ? (
        <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>No real AI is connected.</strong> Agents can only give simulated answers (Demo AI) until you connect Gemini, Groq, OpenRouter or Ollama.{" "}
          <Link to="/integrations" className="underline">
            Connect one
          </Link>
          .
        </p>
      ) : (
        <p className="hint">
          {realConnected.length} real provider{realConnected.length === 1 ? "" : "s"} connected. Connected means a test call succeeded, not that your quota is available.
        </p>
      )}
      <ul className="card divide-y divide-slate-200 py-1 dark:divide-slate-800">
        {[...real, ...(demo ? [demo] : [])].map((p) => {
          const s = stateOf(p);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-40 flex-1 font-medium">{p.displayName}</span>
              <span className={`font-medium ${CLASS_TONE[s.tone]}`}>{s.word}</span>
              <span className="hint">
                {p.enabledModelCount} model{p.enabledModelCount === 1 ? "" : "s"} on · {p.requestsToday}
                {p.dailyRequestCap !== null ? ` of ${p.dailyRequestCap}` : ""} calls today
              </span>
            </li>
          );
        })}
      </ul>
      {cfg && r && (
        <div className="card space-y-1 text-sm" aria-label="Routing strategy">
          <p>
            <strong>Automatic routing is {cfg.enabled ? "on" : "off"}.</strong> It tries up to {cfg.maxAttempts} model{cfg.maxAttempts === 1 ? "" : "s"} per task, using {allowedWords}
            {cfg.preferLocal ? ", local models first" : ", local models only as a backup"}. The Demo AI is used only if you tick it there.
          </p>
          <p className="hint">
            {firstChoices.length > 0 ? `Your first choices: ${firstChoices.map(([k, v]) => `${k} → ${v}`).join(", ")}. ` : "No first choice set; the best free model for each kind of task is picked. "}
            For general tasks right now:{" "}
            {r.preview.general.length === 0 ? "no eligible model yet" : r.preview.general.slice(0, 3).map((m) => `${m.ref}${m.simulated ? " (simulated)" : ""}`).join(" → ")}
          </p>
        </div>
      )}
    </section>
  );
}
