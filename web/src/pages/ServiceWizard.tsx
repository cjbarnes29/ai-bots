import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useIntegrations, useSecrets, useVerifyIntegration } from "../api/hooks";
import { CredentialFields } from "../components/setup/CredentialFields";
import { DisconnectDialog } from "../components/setup/DisconnectDialog";
import { GoogleSignIn, TestEmail, useGoogleConnected } from "../components/setup/GoogleSignIn";
import { CopyValue, ErrorNote, OfficialLink, ProviderMark, StepHeader, SuccessNote } from "../components/setup/SetupBits";
import { explainFailure, serviceGuide, type ServiceGuide } from "../lib/serviceGuides";
import { clearProgress, loadProgress, saveProgress } from "../lib/setupProgress";

const friendly = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work. Try again.");

/**
 * The step-by-step wizard for ONE outside service (route /integrations/setup/:id). It only drives existing, tested endpoints: the vault for
 * credentials, the Google OAuth routes for Gmail/Workspace, and the catalog's "Test connection". Each service gets the sign-in step that fits
 * it (token, address, or Google sign-in). Progress (the step number only) is remembered in this browser; credentials never are.
 */
export function ServiceWizard() {
  const { id = "" } = useParams();
  const guide = serviceGuide(id);
  if (!guide) {
    return (
      <div className="card space-y-3">
        <p>There is no setup wizard for that service.</p>
        <Link to="/integrations" className="btn-secondary">
          Back to the Integrations Center
        </Link>
      </div>
    );
  }
  return <Wizard key={guide.id} guide={guide} />;
}

function Wizard({ guide }: { guide: ServiceGuide }) {
  const local = Boolean(guide.configure);
  const titles = local ? ["Introduction", "Set it up"] : ["Introduction", "Requirements", "Instructions", guide.oauth ? "Sign in" : "Connect", "Test", "Done"];
  const last = titles.length - 1;
  const key = `service.${guide.id}`;
  const [progress, setProgress] = useState(() => loadProgress(key));
  useEffect(() => saveProgress(key, progress), [key, progress]);
  const step = Math.min(progress.step, last);
  const reached = Math.max(step, ...progress.done.map((n) => Math.min(n + 1, last)));
  const go = (i: number) => setProgress((s) => ({ step: Math.max(0, Math.min(i, last)), done: i > s.step ? [...s.done, s.step] : s.done }));
  const next = () => go(step + 1);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/integrations" className="text-sm text-indigo-700 hover:underline dark:text-indigo-400">
        ← Integrations Center
      </Link>
      <div className="flex items-center gap-3">
        <ProviderMark mark={guide.mark} tone="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" name={guide.name} />
        <div>
          <h1 className="text-2xl font-bold">Connect {guide.name}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {guide.auth} ·{" "}
            <Link to={`/integrations/guide/${guide.id}`} className="underline">
              Read the tutorial
            </Link>
          </p>
        </div>
      </div>
      <StepHeader titles={titles} current={step} reached={reached} onGo={go} />
      <section aria-labelledby="service-step" className="card space-y-4">
        <h2 id="service-step" className="text-xl font-semibold">
          {titles[step]}
        </h2>
        {local ? <LocalStep guide={guide} step={step} next={next} /> : <Step guide={guide} step={step} next={next} />}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary min-h-11" disabled={step === 0} onClick={() => go(step - 1)}>
          ← Back
        </button>
        <button
          type="button"
          className="text-sm text-slate-600 underline dark:text-slate-400"
          onClick={() => {
            clearProgress(key);
            setProgress({ step: 0, done: [] });
          }}
        >
          Start the wizard again
        </button>
      </div>
    </div>
  );
}

function NextButton({ onClick, label = "Next →", disabled, why }: { onClick: () => void; label?: string; disabled?: boolean; why?: string }) {
  return (
    <div className="space-y-1">
      <button type="button" className="btn-primary min-h-11" onClick={onClick} disabled={disabled}>
        {label}
      </button>
      {disabled && why && <p className="hint">{why}</p>}
    </div>
  );
}

function LocalStep({ guide, step, next }: { guide: ServiceGuide; step: number; next: () => void }) {
  if (step === 0) {
    return (
      <>
        <p>{guide.description}</p>
        <ul className="list-disc pl-6">
          {guide.allows.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="text-sm">{guide.authExplain}</p>
        <NextButton onClick={next} />
      </>
    );
  }
  return (
    <>
      {guide.instructions.map((i) => (
        <p key={i.text}>{i.text}</p>
      ))}
      <Link to={guide.configure!.to} className="btn-primary min-h-11">
        {guide.configure!.label}
      </Link>
    </>
  );
}

function Step({ guide, step, next }: { guide: ServiceGuide; step: number; next: () => void }) {
  const secrets = useSecrets();
  const integrations = useIntegrations();
  const verify = useVerifyIntegration();
  const entry = integrations.data?.integrations.find((i) => i.id === guide.id);
  const saved = (name: string) => Boolean(secrets.data?.find((s) => s.name === name && (s.inVault || s.inEnv)));
  const requiredSaved = guide.fields.filter((f) => f.required).every((f) => saved(f.secret));
  const signedIn = useGoogleConnected(guide.oauth);
  const ready = requiredSaved && signedIn;
  const result = verify.data;

  switch (step) {
    case 0:
      return (
        <>
          <p>{guide.description}</p>
          <h3 className="font-semibold">For example, bots could:</h3>
          <ul className="list-disc space-y-1 pl-6">
            {guide.allows.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
            Connecting it gives no bot access by itself: you switch it on per bot (Permissions tab), and anything that sends or changes something waits on the Approvals page.
          </p>
          <NextButton onClick={next} label="Start →" />
        </>
      );
    case 1:
      return (
        <>
          <ul className="list-disc space-y-1 pl-6">
            {guide.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <h3 className="font-semibold">How you sign in: {guide.auth}</h3>
          <p>{guide.authExplain}</p>
          <p className="text-sm">
            You will enter:{" "}
            {guide.fields.map((f, i) => (
              <span key={f.secret}>
                {i > 0 ? ", " : ""}
                <strong>{f.label}</strong> {f.required ? "(required)" : "(optional)"}
              </span>
            ))}
            {guide.oauth ? ", then sign in on Google's page." : "."} Never paste these into a chat.
          </p>
          <NextButton onClick={next} />
        </>
      );
    case 2:
      return (
        <>
          <ol className="list-decimal space-y-3 pl-6">
            {guide.instructions.map((i) => (
              <li key={i.text} className="space-y-2">
                <p>{i.text}</p>
                {i.link && <OfficialLink link={i.link} />}
                {i.copy && <CopyValue label={i.copy.label} value={i.copy.value} />}
              </li>
            ))}
          </ol>
          {guide.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {guide.links.map((l) => (
                <OfficialLink key={l.href} link={l} />
              ))}
            </div>
          )}
          <NextButton onClick={next} label="I have what I need →" />
        </>
      );
    case 3:
      return (
        <>
          {guide.oauth && <p className="text-sm">First the one-time Google client (from your Google Cloud project), then the sign-in itself.</p>}
          <CredentialFields fields={guide.fields} />
          {guide.oauth && <GoogleSignIn kind={guide.oauth} />}
          <NextButton onClick={next} disabled={!ready} why={!requiredSaved ? "Save the required values first." : "Sign in with Google first."} />
        </>
      );
    case 4:
      return (
        <>
          <p>{guide.testNote}</p>
          <button type="button" className="btn-primary min-h-11" disabled={verify.isPending || !ready} onClick={() => verify.mutate(guide.id)} aria-label={`Test connection for ${guide.name}`}>
            {verify.isPending ? "Testing…" : "Test connection"}
          </button>
          {result?.result === "verified" && <SuccessNote>It works. {result.summary}</SuccessNote>}
          {result?.result === "not_testable" && (
            <p role="status" className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
              {guide.id === "n8n" ? "The address looks right. It is not called now, because calling it would really start your workflow." : (result.message ?? "This service cannot be tested without doing something real.")}
            </p>
          )}
          {result?.result === "failed" && (
            <div role="alert" className="space-y-1 rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">{explainFailure(result.reason, guide)}</p>
              {result.message && <p>Details: {result.message}</p>}
            </div>
          )}
          <ErrorNote text={friendly(verify.error)} />
          {(result?.result === "failed" || verify.error) && <Troubleshooting guide={guide} />}
          <NextButton onClick={next} label={result?.result === "verified" || result?.result === "not_testable" ? "Next →" : "Skip the test →"} />
        </>
      );
    default:
      return <Done guide={guide} status={entry?.status ?? null} />;
  }
}

function Troubleshooting({ guide }: { guide: ServiceGuide }) {
  return (
    <dl className="space-y-2 text-sm">
      {guide.troubleshooting.map((t) => (
        <div key={t.problem}>
          <dt className="font-medium">{t.problem}</dt>
          <dd>{t.fix}</dd>
        </div>
      ))}
    </dl>
  );
}

function Done({ guide, status }: { guide: ServiceGuide; status: string | null }) {
  const secrets = useSecrets();
  const gmailSignedIn = useGoogleConnected(guide.oauth === "gmail" ? "gmail" : undefined) && guide.oauth === "gmail";
  const [asking, setAsking] = useState(false);
  const toRemove = guide.disconnect.secrets.filter((n) => secrets.data?.some((s) => s.name === n && s.inVault));
  const label = status === "verified" ? "Connected and verified" : status === "failed" ? "Saved, but the last test failed" : status === "ready" ? "Saved, not tested yet" : "Not connected";
  return (
    <>
      <p role="status" className="text-lg font-medium">
        {guide.name}: {label}
      </p>
      <p>Next: open a bot, go to its Permissions tab, and switch {guide.name} on for that bot. Anything that sends or changes something waits on the Approvals page.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/agents" className="btn-primary min-h-11">
          Go to your bots
        </Link>
        <Link to="/integrations" className="btn-secondary min-h-11">
          Back to the Integrations Center
        </Link>
        {toRemove.length > 0 && (
          <button type="button" className="btn-secondary min-h-11" onClick={() => setAsking(true)}>
            Disconnect
          </button>
        )}
      </div>
      {gmailSignedIn && <TestEmail />}
      {asking && <DisconnectDialog guide={guide} names={toRemove} onClose={() => setAsking(false)} />}
    </>
  );
}

