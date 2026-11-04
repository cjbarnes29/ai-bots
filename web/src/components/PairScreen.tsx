import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { usePair } from "../api/hooks";

function guessName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android/i.test(ua)) return "My Android phone";
  if (/iPhone|iPad/i.test(ua)) return "My iPhone";
  return "My device";
}

/** Shown on a phone that has not been paired yet. Nothing else of the dashboard is shown or loaded. */
export function PairScreen() {
  const fromLink = typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("pair") ?? "");
  const [code, setCode] = useState(fromLink);
  const [name, setName] = useState(guessName);
  const pair = usePair();
  const error = pair.error instanceof ApiError ? pair.error.friendly : pair.error ? "That did not work." : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    pair.mutate({ code: code.trim(), name: name.trim() }, { onSuccess: () => window.history.replaceState(null, "", window.location.pathname) });
  };

  return (
    <main className="mx-auto max-w-md space-y-5 p-6">
      <h1 className="text-2xl font-bold">Pair this device</h1>
      <p className="text-sm">
        This phone is not connected to your AI Workforce yet. On your Windows PC open the <strong>PC Control Center</strong> and press <strong>Pair a phone</strong>.
        Type the code it shows here. The code works once and expires after 5 minutes.
      </p>
      <form onSubmit={submit} className="card space-y-4">
        <label className="block">
          <span className="label">Pairing code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Pairing code"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-lg tracking-widest dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block">
          <span className="label">Name for this device</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Device name" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={!code.trim() || !name.trim() || pair.isPending}>
          {pair.isPending ? "Pairing…" : "Pair"}
        </button>
      </form>
    </main>
  );
}
