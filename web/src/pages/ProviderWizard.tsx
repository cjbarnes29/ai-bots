import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useDeleteSecret, useModels, usePatchProvider, useProviders, useRefreshModels, useRouting, useSetSecret, useTestProvider, useTryModel, useUpdateRouting } from "../api/hooks";
import type { ProviderView } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ModelPicker } from "../components/setup/ModelPicker";
import { CopyValue, ErrorNote, OfficialLink, ProviderMark, StepHeader, SuccessNote } from "../components/setup/SetupBits";
import { OLLAMA_DEFAULT_ADDRESS, OLLAMA_STARTER_MODELS, checkKey, providerGuide, type ProviderGuide } from "../lib/integrationGuides";
import { clearProgress, loadProgress, saveProgress } from "../lib/setupProgress";

const friendly = (e: unknown): string | null => (e == null ? null : e instanceof ApiError ? e.friendly : "That did not work. Try again.");

const CLOUD_STEPS = ["Introduction", "Create account", "Get your key", "Enter the key", "Connect", "Test connection", "Find models", "Done"];
const OLLAMA_STEPS = ["Introduction", "Download", "Install", "Start Ollama", "Download a model", "Connect", "Find models", "Test chat", "Done"];

/**
 * The guided Connect wizard for one AI provider. It drives only the existing, tested endpoints (vault, provider switches, connection test,
 * model discovery), so every rule stays as it was: keys go straight to the encrypted vault and are never shown again, the free-plan
 * confirmation is required where it was, only free models can be switched on, and nothing is downloaded or installed for the person.
 */
export function ProviderWizard() {
  const { provider: id = "" } = useParams();
  const guide = providerGuide(id);
  const providers = useProviders();
  if (!guide) {
    return (
      <div className="card space-y-3">
        <p>There is no setup wizard for that provider.</p>
        <Link to="/integrations" className="btn-secondary">
          Back to the Integrations Center
        </Link>
      </div>
    );
  }
  if (providers.isPending) return <p role="status">Loading…</p>;
  const p = providers.data?.find((x) => x.id === guide.id);
  if (!p) return <p role="alert">This provider is not available in this version of the app.</p>;
  return <Wizard guide={guide} p={p} />;
}

function Wizard({ guide, p }: { guide: ProviderGuide; p: ProviderView }) {
  const local = guide.runs === "local";
  const titles = local ? OLLAMA_STEPS : CLOUD_STEPS;
  const key = `wizard.${guide.id}`;
  const last = titles.length - 1;
  const models = useModels();
  const mine = (models.data ?? []).filter((m) => m.providerId === p.id);
  const usable = mine.filter((m) => m.callable);
  const connected = p.status === "connected";

  // Resume where the person left off; if they never started, start where the real state says they are.
  const [progress, setProgress] = useState(() => {
    const saved = loadProgress(key);
    if (saved.step > 0 || saved.done.length > 0) return saved;
    const derived = connected && p.enabled && p.modelCount > 0 ? last : 0;
    return { step: derived, done: derived > 0 ? Array.from({ length: derived }, (_, i) => i) : [] };
  });
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
        <ProviderMark mark={guide.mark} tone={guide.markTone} name={guide.name} />
        <div>
          <h1 className="text-2xl font-bold">Connect {guide.name}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {connected ? "Connected" : "Not connected yet"} ·{" "}
            <Link to={`/integrations/guide/${guide.id}`} className="underline">
              Read the tutorial
            </Link>
          </p>
        </div>
      </div>
      <StepHeader titles={titles} current={step} reached={reached} onGo={go} />
      {local ? <OllamaStep guide={guide} p={p} step={step} next={next} usable={usable.length} /> : <CloudStep guide={guide} p={p} step={step} next={next} />}
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="wizard-step" className="card space-y-4">
      <h2 id="wizard-step" className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NextButton({ onClick, disabled, label = "Next →", why }: { onClick: () => void; disabled?: boolean; label?: string; why?: string }) {
  return (
    <div className="space-y-1">
      <button type="button" className="btn-primary min-h-11" onClick={onClick} disabled={disabled}>
        {label}
      </button>
      {disabled && why && <p className="hint">{why}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ cloud providers (Gemini, Groq, OpenRouter)

function CloudStep({ guide, p, step, next }: { guide: ProviderGuide; p: ProviderView; step: number; next: () => void }) {
  const [keyText, setKeyText] = useState("");
  const [show, setShow] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [confirmFree, setConfirmFree] = useState(p.freeConfirmed);
  const [useForRouting, setUseForRouting] = useState(true);
  const setSecret = useSetSecret();
  const patch = usePatchProvider();
  const test = useTestProvider();
  const refresh = useRefreshModels();
  const routing = useRouting();
  const updateRouting = useUpdateRouting();
  const checked = checkKey(keyText, guide);
  const haveKey = p.keyConfigured && !replacing;
  const busy = setSecret.isPending || patch.isPending || test.isPending || refresh.isPending || updateRouting.isPending;
  const connected = p.status === "connected";

  // Find models by itself the first time the person reaches that step (one model-list request; it uses no tokens).
  const asked = useRef(false);
  useEffect(() => {
    if (step === 6 && connected && p.modelCount === 0 && !asked.current) {
      asked.current = true;
      refresh.mutate(p.id);
    }
  }, [step, connected, p.modelCount, p.id, refresh]);

  const connect = async () => {
    if (!haveKey) {
      if (checked.error || !p.keyEnv) return;
      await setSecret.mutateAsync({ name: p.keyEnv, value: keyText.trim() });
      setKeyText("");
      setReplacing(false);
    }
    if (p.requiresFreeConfirmation && !p.freeConfirmed) await patch.mutateAsync({ id: p.id, patch: { freeConfirmed: true } });
    if (!p.enabled) await patch.mutateAsync({ id: p.id, patch: { enabled: true } });
    const cfg = routing.data?.config;
    if (useForRouting && cfg && cfg.allowedProviders.length > 0 && !cfg.allowedProviders.includes(p.id)) {
      await updateRouting.mutateAsync({ allowedProviders: [...cfg.allowedProviders, p.id] });
    }
    next();
  };

  switch (step) {
    case 0:
      return (
        <Card title={`What is ${guide.name}?`}>
          <p>{guide.description}</p>
          <ul className="list-disc space-y-1 pl-6">
            {guide.offers.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <h3 className="font-semibold">What you need</h3>
          <ul className="list-disc space-y-1 pl-6">
            {guide.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">{guide.freeNote}</p>
          <NextButton onClick={next} label="Start →" />
        </Card>
      );
    case 1:
      return (
        <Card title="Create your account">
          <p>Open {guide.name} in a new tab and sign up or sign in. Come back to this tab when you are signed in.</p>
          <div className="flex flex-wrap gap-2">
            <OfficialLink link={{ label: `Open ${guide.name}`, href: guide.links.website }} primary />
            <OfficialLink link={{ label: "Official getting-started guide", href: guide.links.docs }} />
          </div>
          <NextButton onClick={next} label="I am signed in →" />
        </Card>
      );
    case 2:
      return (
        <Card title="Get your API key">
          <p>An API key works like a password that lets AI Workforce use {guide.name} for you. Keep it private.</p>
          <ol className="list-decimal space-y-1 pl-6">
            {guide.keySteps!.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <OfficialLink link={{ label: "Open the API keys page", href: guide.links.keys! }} primary />
          <NextButton onClick={next} label="I copied my key →" />
        </Card>
      );
    case 3:
      return (
        <Card title="Paste your key">
          {haveKey ? (
            <>
              <SuccessNote>A key is already saved. It is stored encrypted on this PC and is never shown again.</SuccessNote>
              <div className="flex flex-wrap gap-2">
                <NextButton onClick={next} />
                <button type="button" className="btn-secondary min-h-11" onClick={() => setReplacing(true)}>
                  Replace the key
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="label">Your {guide.name} API key</span>
                <div className="flex flex-wrap gap-2">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={keyText}
                    onChange={(e) => setKeyText(e.target.value)}
                    placeholder={guide.keyExample}
                    aria-invalid={Boolean(keyText && checked.error)}
                    aria-describedby="key-help"
                    className="min-w-0 flex-1 font-mono"
                  />
                  <button type="button" className="btn-secondary min-h-11" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                    {show ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary min-h-11"
                    onClick={async () => {
                      try {
                        setKeyText((await navigator.clipboard.readText()).trim());
                      } catch {
                        /* the browser refused: the person can press Ctrl+V in the box */
                      }
                    }}
                  >
                    Paste
                  </button>
                </div>
              </label>
              <p id="key-help" className="hint">
                Click in the box and press Ctrl+V, or use Paste. The key is sent only to this app on this PC, saved encrypted, and never shown again.
              </p>
              {keyText && checked.error && <ErrorNote text={checked.error} />}
              {keyText && !checked.error && checked.warning && (
                <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {checked.warning}
                </p>
              )}
              {keyText && !checked.error && !checked.warning && <SuccessNote>That looks like a {guide.name} key.</SuccessNote>}
              <NextButton onClick={next} disabled={!keyText || Boolean(checked.error)} why="Paste a key that passes the check first." />
            </>
          )}
        </Card>
      );
    case 4:
      return (
        <Card title="Connect">
          <p>{haveKey ? "Your saved key will be used." : "Your key is saved encrypted on this PC when you press Connect."}</p>
          {p.requiresFreeConfirmation && (
            <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={confirmFree} onChange={(e) => setConfirmFree(e.target.checked)} />
              <span>
                I confirm my {guide.name} account has <strong>no billing</strong>: no payment card and no billing account is attached. (This app only uses free models and never turns billing on.)
              </span>
            </label>
          )}
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={useForRouting} onChange={(e) => setUseForRouting(e.target.checked)} />
            <span>Let automatic model choice use {guide.name} (recommended)</span>
          </label>
          <ErrorNote text={friendly(setSecret.error ?? patch.error ?? updateRouting.error)} />
          <NextButton
            onClick={() => void connect().catch(() => undefined)}
            disabled={busy || (p.requiresFreeConfirmation && !confirmFree) || (!haveKey && (!keyText || Boolean(checked.error)))}
            label={busy ? "Connecting…" : p.enabled && haveKey ? "Continue →" : "Connect"}
            why={!haveKey && !keyText ? "Go back one step and paste your key." : "Tick the confirmation first."}
          />
        </Card>
      );
    case 5:
      return (
        <Card title="Test the connection">
          <p>This asks {guide.name} for its list of models. It uses none of your free requests' tokens.</p>
          <button type="button" className="btn-primary min-h-11" disabled={busy || !p.enabled} onClick={() => test.mutate(p.id)}>
            {test.isPending ? "Testing…" : "Test connection"}
          </button>
          {connected ? <SuccessNote>Connected. {p.statusMessage}</SuccessNote> : p.statusMessage && <ErrorNote text={`Not connected: ${p.statusMessage}`} />}
          {!connected && p.status && (
            <p className="hint">
              Most often the key was copied incompletely. Go back to Enter the key and replace it, or see the{" "}
              <Link to={`/integrations/guide/${guide.id}`} className="underline">
                troubleshooting list
              </Link>
              .
            </p>
          )}
          <ErrorNote text={friendly(test.error)} />
          <NextButton onClick={next} disabled={!connected} why="The test must succeed first." />
        </Card>
      );
    case 6:
      return (
        <Card title="Find the models">
          <p>The app asks {guide.name} which models exist and keeps only the free ones usable. New free models are switched on by themselves.</p>
          <button type="button" className="btn-secondary min-h-11" disabled={busy || !connected} onClick={() => refresh.mutate(p.id)}>
            {refresh.isPending ? "Looking for models…" : "Find models again"}
          </button>
          {p.modelCount > 0 && <SuccessNote>Found {p.modelCount} models. {p.enabledModelCount} are switched on.</SuccessNote>}
          <ErrorNote text={friendly(refresh.error)} />
          <NextButton onClick={next} disabled={p.modelCount === 0} why="Wait until models are found." />
        </Card>
      );
    default:
      return <DoneStep guide={guide} p={p} />;
  }
}

// ------------------------------------------------------------------ Ollama (local)

function OllamaStep({ guide, p, step, next, usable }: { guide: ProviderGuide; p: ProviderView; step: number; next: () => void; usable: number }) {
  const test = useTestProvider();
  const patch = usePatchProvider();
  const refresh = useRefreshModels();
  const routing = useRouting();
  const updateRouting = useUpdateRouting();
  const tryModel = useTryModel();
  const models = useModels();
  const [useForRouting, setUseForRouting] = useState(true);
  const [message, setMessage] = useState("Say hello in one short sentence.");
  const installed = (models.data ?? []).filter((m) => m.providerId === "ollama" && m.availability === "available" && m.freeStatus !== "blocked");
  const [chosen, setChosen] = useState<number | null>(null);
  const running = p.status === "connected";
  const busy = test.isPending || patch.isPending || refresh.isPending || updateRouting.isPending;

  // While the person is on "Start Ollama", check every 5 seconds whether it answers. Only this PC is contacted (127.0.0.1 / localhost).
  const { mutate: check } = test;
  useEffect(() => {
    if (step !== 3 || running) return;
    check(p.id);
    const timer = setInterval(() => check(p.id), 5000);
    return () => clearInterval(timer);
  }, [step, running, p.id, check]);

  switch (step) {
    case 0:
      return (
        <Card title="What is Ollama?">
          <p>{guide.description}</p>
          <ul className="list-disc space-y-1 pl-6">
            {guide.offers.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <h3 className="font-semibold">What you need</h3>
          <ul className="list-disc space-y-1 pl-6">
            {guide.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">{guide.freeNote}</p>
          <NextButton onClick={next} label="Start →" />
        </Card>
      );
    case 1:
      return (
        <Card title="Download Ollama for Windows">
          <p>Download the free installer from Ollama&apos;s official site. AI Workforce never downloads or installs software for you.</p>
          <div className="flex flex-wrap gap-2">
            <OfficialLink link={{ label: "Download Ollama for Windows", href: guide.links.download! }} primary />
            <OfficialLink link={{ label: "Ollama website", href: guide.links.website }} />
          </div>
          <NextButton onClick={next} label="I downloaded it →" />
        </Card>
      );
    case 2:
      return (
        <Card title="Install it">
          <ol className="list-decimal space-y-1 pl-6">
            <li>Open your Downloads folder.</li>
            <li>Double-click OllamaSetup.exe.</li>
            <li>Choose Install and wait until it finishes. Windows may ask for permission: that is your decision.</li>
          </ol>
          <p className="hint">Skip this step if Ollama is already installed.</p>
          <NextButton onClick={next} label="It is installed →" />
        </Card>
      );
    case 3:
      return (
        <Card title="Start Ollama">
          <p>Ollama usually starts by itself after installing and shows a small llama icon near the clock. If not, open Ollama from the Start menu.</p>
          <CopyValue label="Ollama's address (only on this PC)" value={OLLAMA_DEFAULT_ADDRESS} />
          <p role="status" aria-live="polite" className={`rounded-md p-3 text-sm ${running ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
            {running ? "Ollama is running." : "Ollama is not running yet. Checking again every few seconds…"}
          </p>
          <button type="button" className="btn-secondary min-h-11" disabled={test.isPending} onClick={() => test.mutate(p.id)}>
            Check now
          </button>
          <NextButton onClick={next} disabled={!running} why="Start Ollama first; this page notices by itself." />
        </Card>
      );
    case 4:
      return (
        <Card title="Download a model">
          <p>A model is the AI &quot;brain&quot;. Download one small model first. AI Workforce never downloads models for you, because they are large.</p>
          <ol className="list-decimal space-y-1 pl-6">
            <li>Open the Start menu, type PowerShell and open Windows PowerShell.</li>
            <li>Copy a command below, paste it into PowerShell and press Enter.</li>
            <li>Wait until it says success, then come back here.</li>
          </ol>
          {OLLAMA_STARTER_MODELS.map((m) => (
            <CopyValue key={m.id} label={`${m.note} (${m.size})`} value={`ollama pull ${m.id}`} />
          ))}
          <OfficialLink link={{ label: "Browse the Ollama model library", href: guide.links.library! }} />
          <p className="hint">Models whose names end in &quot;cloud&quot; run on Ollama&apos;s servers and are billed. This app never uses them.</p>
          <NextButton onClick={next} label="I downloaded a model →" />
        </Card>
      );
    case 5:
      return (
        <Card title="Connect">
          <p>Switch Ollama on for AI Workforce. Nothing leaves this PC.</p>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={useForRouting} onChange={(e) => setUseForRouting(e.target.checked)} />
            <span>Let automatic model choice use Ollama as a private backup (recommended)</span>
          </label>
          <ErrorNote text={friendly(patch.error ?? updateRouting.error)} />
          <NextButton
            disabled={busy}
            label={p.enabled ? "Continue →" : "Connect"}
            onClick={() =>
              void (async () => {
                if (!p.enabled) await patch.mutateAsync({ id: p.id, patch: { enabled: true } });
                const cfg = routing.data?.config;
                if (useForRouting && cfg && cfg.allowedProviders.length > 0 && !cfg.allowedProviders.includes("ollama")) {
                  await updateRouting.mutateAsync({ allowedProviders: [...cfg.allowedProviders, "ollama"] });
                }
                next();
              })().catch(() => undefined)
            }
          />
        </Card>
      );
    case 6:
      return (
        <Card title="Find your models">
          <button type="button" className="btn-primary min-h-11" disabled={busy || !p.enabled} onClick={() => refresh.mutate(p.id)}>
            {refresh.isPending ? "Looking…" : "Find models"}
          </button>
          {installed.length > 0 ? (
            <SuccessNote>Found {installed.length} downloaded model{installed.length === 1 ? "" : "s"}.</SuccessNote>
          ) : (
            p.modelCount > 0 && <p className="text-sm">No downloaded model yet. Go back one step and download one, then press Find models.</p>
          )}
          <ErrorNote text={friendly(refresh.error)} />
          <ModelPicker providerId="ollama" local />
          <NextButton onClick={next} disabled={installed.length === 0} why="Download a model and press Find models first." />
        </Card>
      );
    case 7: {
      const pick = installed.find((m) => m.id === chosen) ?? installed.find((m) => m.callable) ?? installed[0];
      return (
        <Card title="Send a test message">
          {installed.length === 0 ? (
            <p>No downloaded model yet.</p>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="label">Model</span>
                <select value={pick?.id ?? ""} onChange={(e) => setChosen(Number(e.target.value))}>
                  {installed.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.callable}>
                      {m.displayName}
                      {m.callable ? "" : " (switch it on in the previous step)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="label">Message</span>
                <input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <button type="button" className="btn-primary min-h-11" disabled={!pick?.callable || !message.trim() || tryModel.isPending} onClick={() => pick && tryModel.mutate({ id: pick.id, message: message.trim() })}>
                {tryModel.isPending ? "Waiting for the answer (local models can take a minute)…" : "Send test message"}
              </button>
              {tryModel.data && (
                <div role="status" className="space-y-1 rounded-md bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                  <p className="font-medium">It works. {tryModel.data.modelId} answered in {(tryModel.data.latencyMs / 1000).toFixed(1)} s:</p>
                  <p className="whitespace-pre-wrap">{tryModel.data.reply}</p>
                </div>
              )}
              <ErrorNote text={friendly(tryModel.error)} />
            </>
          )}
          <NextButton onClick={next} label={tryModel.data ? "Next →" : "Skip the test →"} />
        </Card>
      );
    }
    default:
      return <DoneStep guide={guide} p={p} extra={usable === 0 ? "No model is switched on yet: switch one on below." : undefined} />;
  }
}

// ------------------------------------------------------------------ the last step, shared

function DoneStep({ guide, p, extra }: { guide: ProviderGuide; p: ProviderView; extra?: string | undefined }) {
  const [asking, setAsking] = useState(false);
  const del = useDeleteSecret();
  const patch = usePatchProvider();
  const local = guide.runs === "local";
  const connected = p.status === "connected" && p.enabled;
  return (
    <Card title={connected ? `${guide.name} is connected` : `${guide.name} is not connected`}>
      {connected ? (
        <SuccessNote>
          Done. {p.enabledModelCount} model{p.enabledModelCount === 1 ? "" : "s"} switched on. Bots set to Automatic can use them now.
        </SuccessNote>
      ) : (
        <ErrorNote text={p.statusMessage ? `Not connected: ${p.statusMessage}` : "Not connected. Go back to the Test step."} />
      )}
      {extra && <p className="text-sm">{extra}</p>}
      <h3 className="font-semibold">Choose which models your bots may use</h3>
      <ModelPicker providerId={p.id} local={local} />
      <div className="flex flex-wrap gap-2">
        <Link to="/integrations/ai-setup" className="btn-primary min-h-11">
          Set up automatic AI (recommended) →
        </Link>
        <Link to="/integrations" className="btn-secondary min-h-11">
          Back to the Integrations Center
        </Link>
        {(p.enabled || p.keyConfigured) && (
          <button type="button" className="btn-secondary min-h-11" onClick={() => setAsking(true)}>
            Disconnect
          </button>
        )}
      </div>
      <ErrorNote text={friendly(del.error ?? patch.error)} />
      {asking && (
        <ConfirmDialog
          title={`Disconnect ${guide.name}?`}
          confirmLabel="Disconnect"
          danger
          busy={del.isPending || patch.isPending}
          onCancel={() => setAsking(false)}
          onConfirm={() =>
            void (async () => {
              await patch.mutateAsync({ id: p.id, patch: { enabled: false } });
              if (!local && p.keyConfigured && p.keyEnv) await del.mutateAsync(p.keyEnv);
              setAsking(false);
            })().catch(() => undefined)
          }
        >
          <p>
            {local
              ? "Ollama is switched off for AI Workforce. Ollama itself and your downloaded models stay on this PC."
              : `${guide.name} is switched off and its saved key is deleted from this PC. Bots set to Automatic use your other providers. You may also delete the key on ${guide.name}'s website.`}
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
