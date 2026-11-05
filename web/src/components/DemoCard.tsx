import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useDemo, useSetupDemo } from "../api/hooks";
import type { DemoStatus } from "../api/types";

const NEEDS_LABEL: Record<DemoStatus["capabilities"][number]["needs"], string> = {
  nothing: "No AI needed",
  demo: "Simulated AI",
  real_ai: "Real AI needed",
  credentials: "Your accounts needed",
};

/**
 * Demo mode: a built-in SIMULATED AI plus sample agents and workflows you can open, edit and run. It makes no network request and is not a real AI;
 * every answer it gives starts with "[SIMULATED RESPONSE - no real AI was used]".
 */
export function DemoCard({ compact = false }: { compact?: boolean }) {
  const demo = useDemo();
  const setup = useSetupDemo();
  const d = demo.data;
  if (demo.isError) return null;
  if (!d) return null;
  const complete = d.ready && d.bots.every((b) => b.id) && d.workflows.every((w) => w.id);
  const err = setup.error ? (setup.error instanceof ApiError ? setup.error.friendly : "That did not work.") : null;

  return (
    <section aria-label="Demo mode" className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Try it without an AI account</h2>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Simulated</span>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Demo mode adds a built-in <strong>simulated</strong> AI. It is <strong>not a real AI</strong>: it only shows what a real model would have been given. Every reply starts with
        "[SIMULATED RESPONSE - no real AI was used]". It costs nothing, needs no key and sends nothing anywhere. Use it to learn how agents, workflows, approvals and routing behave.
      </p>

      {!complete && (
        <div className="space-y-1">
          <button className="btn-primary" disabled={setup.isPending} onClick={() => setup.mutate()}>
            {setup.isPending ? "Setting up…" : d.ready ? "Add the missing sample agents and workflows" : "Set up the demo"}
          </button>
          <p className="hint">Creates four sample agents (no permissions, you can edit or delete them) and two sample workflows. Anything you already edited is left alone. Only the PC can do this.</p>
        </div>
      )}
      {err && (
        <p role="alert" className="rounded-md bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {err}
        </p>
      )}

      {d.ready && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">Sample agents</h3>
            <ul className="text-sm">
              {d.bots.map((b) => (
                <li key={b.key}>
                  {b.id ? (
                    <Link className="underline" to={`/bots/${b.id}`}>
                      {b.name}
                    </Link>
                  ) : (
                    <span className="hint">{b.name} (not created)</span>
                  )}
                  {b.status ? <span className="hint"> · {b.status === "active" ? "on" : "off"}</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">Sample workflows</h3>
            <ul className="space-y-1 text-sm">
              {d.workflows.map((w) => (
                <li key={w.name}>
                  {w.id ? (
                    <Link className="underline" to="/workflows">
                      {w.name}
                    </Link>
                  ) : (
                    <span className="hint">{w.name} (not created)</span>
                  )}
                  <span className="hint block">{w.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!compact && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">What works without a real AI provider, and what does not</summary>
          <div className="mt-2 space-y-3">
            {d.capabilities.map((c) => (
              <div key={c.title}>
                <p className="font-semibold">
                  {c.title} <span className="hint">({NEEDS_LABEL[c.needs]})</span>
                </p>
                <ul className="list-disc pl-5">
                  {c.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
