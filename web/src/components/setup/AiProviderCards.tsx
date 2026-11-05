import { Link } from "react-router-dom";
import { useProviders } from "../../api/hooks";
import type { ProviderView } from "../../api/types";
import { OTHER_TUTORIALS, PROVIDER_GUIDES, type ProviderGuide } from "../../lib/integrationGuides";
import { OfficialLink, ProviderMark } from "./SetupBits";

function statusOf(p: ProviderView | undefined, guide: ProviderGuide): { label: string; tone: string } {
  if (!p) return { label: "Unavailable", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
  if (p.enabled && p.status === "connected") return { label: "Connected", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" };
  if (p.enabled && p.status && p.status !== "connected") return { label: guide.runs === "local" && p.status === "unreachable" ? "Not running" : "Problem: check it", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" };
  if (p.enabled || (guide.keyRequired && p.keyConfigured)) return { label: "Set up, not tested yet", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label: "Not connected", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
}

/** Integration Center: one card per AI provider, with everything a beginner needs to decide and to start. */
export function AiProviderCards() {
  const providers = useProviders();
  const anyConnected = (providers.data ?? []).some((p) => p.enabled && p.status === "connected");
  return (
    <section aria-labelledby="ai-providers-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ai-providers-heading" className="text-lg font-semibold">
            AI Providers
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">Connect at least one so your bots can think. Press Connect and follow the steps; no technical knowledge needed. Only free use is possible.</p>
        </div>
        {anyConnected && (
          <Link to="/integrations/ai-setup" className="btn-secondary min-h-11">
            Set up automatic AI
          </Link>
        )}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {PROVIDER_GUIDES.map((g) => {
          const p = providers.data?.find((x) => x.id === g.id);
          const s = providers.isPending ? { label: "Checking…", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" } : statusOf(p, g);
          return (
            <li key={g.id} className="card flex flex-col gap-3" aria-label={`${g.name} provider`}>
              <div className="flex items-start gap-3">
                <ProviderMark mark={g.mark} tone={g.markTone} name={g.name} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{g.name}</h3>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`} aria-label={`Status: ${s.label}`}>
                    {s.label}
                  </span>
                </div>
              </div>
              <p className="text-sm">{g.description}</p>
              <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
                {g.offers.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Setup</dt>
                  <dd className="font-medium">{g.difficulty}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">API key</dt>
                  <dd className="font-medium">{g.keyRequired ? "Required" : "Not needed"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Runs</dt>
                  <dd className="font-medium">{g.runs === "local" ? "On this PC" : "Over the internet"}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link to={`/integrations/connect/${g.id}`} className="btn-primary min-h-11" aria-label={`Connect ${g.name}`}>
                  {s.label === "Connected" ? "Manage" : "Connect"}
                </Link>
                <Link to={`/integrations/guide/${g.id}`} className="btn-secondary min-h-11" aria-label={`Setup tutorial for ${g.name}`}>
                  Setup tutorial
                </Link>
                <OfficialLink link={{ label: "Website", href: g.links.website }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Guides for the other kinds of integration, in the same step-by-step format. */
export function OtherGuides() {
  return (
    <section aria-labelledby="other-guides-heading" className="space-y-3">
      <h2 id="other-guides-heading" className="text-lg font-semibold">
        Step-by-step guides
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {OTHER_TUTORIALS.map((t) => (
          <li key={t.id} className="card flex items-start gap-3">
            <ProviderMark mark={t.mark} tone="bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200" name={t.title} />
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="font-semibold">{t.title}</h3>
              <p className="text-sm">{t.what}</p>
              <Link to={`/integrations/guide/${t.id}`} className="btn-secondary min-h-11">
                Open the guide
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
