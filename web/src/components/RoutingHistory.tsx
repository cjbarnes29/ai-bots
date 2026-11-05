import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface Attempt {
  ref: string;
  outcome: string;
}
interface Routed {
  at: string;
  class: string;
  botId: string | null;
  attempts: Attempt[];
  answeredBy: string | null;
  switched: boolean;
}
interface History {
  current: Record<string, { ref: string; at: string }>;
  recent: Routed[];
  switches: { createdAt: string; detail: { class?: string; answeredBy?: string | null; attempts?: Attempt[] } }[];
  note: string;
}

const OUTCOME: Record<string, string> = {
  answered: "answered",
  rate_limited: "rate-limited",
  timeout: "timed out",
  provider_unavailable: "unavailable",
  network: "network error",
  auth_failed: "key rejected",
  quota_exceeded: "quota used up",
  bad_output: "unusable reply",
  model_unavailable: "model unavailable",
  circuit_open: "cooling down",
};
const chain = (attempts: Attempt[]) => attempts.map((a) => `${a.ref} (${OUTCOME[a.outcome] ?? a.outcome})`).join(" → ");

/** Which model is answering now, and every recent switch, from the real routing decisions (nothing estimated). */
export function RoutingHistory() {
  const q = useQuery({ queryKey: ["llm", "routing", "history"], refetchInterval: 10_000, queryFn: () => api<History>("GET", "/api/llm/routing/history") });
  const h = q.data;
  if (!h) return null;
  const current = Object.entries(h.current);
  const switches = h.recent.filter((r) => r.switched);
  return (
    <div className="space-y-2" aria-label="Live routing">
      <h3 className="font-semibold">Answering now</h3>
      {current.length === 0 ? (
        <p className="hint">No automatic request since the app started.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {current.map(([cls, c]) => (
            <li key={cls}>
              <strong>{cls}:</strong> {c.ref} <span className="hint">(last answer {new Date(c.at).toLocaleTimeString()})</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">Recent model switches</h3>
      {switches.length === 0 && h.switches.length === 0 ? (
        <p className="hint">No switch so far: the first model chosen answered every time.</p>
      ) : (
        <ul className="space-y-1 text-sm" aria-label="Model switches">
          {(switches.length > 0 ? switches.map((r) => ({ at: r.at, answeredBy: r.answeredBy, attempts: r.attempts })) : h.switches.map((s) => ({ at: s.createdAt, answeredBy: s.detail.answeredBy ?? null, attempts: s.detail.attempts ?? [] })))
            .slice(0, 10)
            .map((r, i) => (
              <li key={i} className={r.answeredBy ? "" : "text-red-700 dark:text-red-300"}>
                <span className="hint">{new Date(r.at).toLocaleString()} · </span>
                {chain(r.attempts)}
                {r.answeredBy ? "" : " · no model could answer"}
              </li>
            ))}
        </ul>
      )}
      <p className="hint">{h.note}</p>
    </div>
  );
}
