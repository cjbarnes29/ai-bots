import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CopyValue, OfficialLink, StepHeader } from "../components/setup/SetupBits";
import { tutorialById } from "../lib/integrationGuides";
import { clearProgress, loadProgress, saveProgress } from "../lib/setupProgress";

/**
 * A built-in tutorial, one step at a time (never one long document). Back and Next move between steps; the place reached is remembered in
 * this browser so the person can come back later. The troubleshooting list is always one click away.
 */
export function IntegrationTutorial() {
  const { id = "" } = useParams();
  const tutorial = tutorialById(id);
  const key = `tutorial.${id}`;
  const [progress, setProgress] = useState(() => loadProgress(key));
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (tutorial) saveProgress(key, progress);
  }, [key, progress, tutorial]);

  if (!tutorial) {
    return (
      <div className="card space-y-3">
        <p>There is no guide with that name.</p>
        <Link to="/integrations" className="btn-secondary">
          Back to the Integrations Center
        </Link>
      </div>
    );
  }

  const last = tutorial.steps.length - 1;
  const current = Math.min(progress.step, last);
  const step = tutorial.steps[current]!;
  const reached = Math.max(current, ...progress.done.map((n) => Math.min(n + 1, last)));
  const go = (i: number) => setProgress((p) => ({ step: Math.max(0, Math.min(i, last)), done: i > p.step ? [...p.done, p.step] : p.done }));
  const finished = progress.done.includes(last);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/integrations" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
        ← Integrations Center
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{tutorial.title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{tutorial.summary}</p>
      </div>

      <StepHeader titles={tutorial.steps.map((s) => s.title)} current={current} reached={reached} onGo={go} />

      <section aria-labelledby="tutorial-step" className="card space-y-4">
        <h2 id="tutorial-step" className="text-xl font-semibold">
          {current + 1}. {step.title}
        </h2>
        {step.text.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {step.numbered && (
          <ol className="list-decimal space-y-1 pl-6">
            {step.numbered.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        )}
        {step.copy?.map((c) => <CopyValue key={c.value} label={c.label} value={c.value} />)}
        {(step.links?.length || step.appLink) && (
          <div className="flex flex-wrap gap-2">
            {step.links?.map((l, i) => <OfficialLink key={l.href} link={l} primary={i === 0} />)}
            {step.appLink && (
              <Link to={step.appLink.to} className="btn-primary min-h-11">
                {step.appLink.label}
              </Link>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary min-h-11" disabled={current === 0} onClick={() => go(current - 1)}>
          ← Back
        </button>
        {current < last ? (
          <button type="button" className="btn-primary min-h-11" onClick={() => go(current + 1)}>
            Next →
          </button>
        ) : (
          <button type="button" className="btn-primary min-h-11" onClick={() => setProgress((p) => ({ ...p, done: [...p.done, last] }))} disabled={finished}>
            {finished ? "Guide finished" : "Finish"}
          </button>
        )}
      </div>

      <section className="card space-y-2">
        <button type="button" className="btn-secondary min-h-11" aria-expanded={showHelp} onClick={() => setShowHelp((v) => !v)}>
          {showHelp ? "Hide troubleshooting" : "Something not working? Troubleshooting"}
        </button>
        {showHelp && (
          <dl className="space-y-3 text-sm">
            {tutorial.troubleshooting.map((t) => (
              <div key={t.problem}>
                <dt className="font-medium">{t.problem}</dt>
                <dd className="text-slate-700 dark:text-slate-300">{t.fix}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <button
        type="button"
        className="text-sm text-slate-600 underline dark:text-slate-400"
        onClick={() => {
          clearProgress(key);
          setProgress({ step: 0, done: [] });
        }}
      >
        Start this guide again
      </button>
    </div>
  );
}
