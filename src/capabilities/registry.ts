/**
 * The unified capability registry (M1).
 *
 * ONE honest answer to "what can this workforce do right now?", built from facts the existing services already hold
 * (tool probes, connector checks recorded in the audit log, provider status, the model registry, Guardian, the approval gate, folder roots).
 * It stores nothing and changes nothing: it only reads. No migration, no outside request, no new permission.
 *
 * Registered is NOT working. Every capability carries six separate levels, each with the evidence it rests on:
 *   installed      the program, module or code exists on this PC / in this build
 *   configured     a key, address, folder or switch has been set
 *   authenticated  the service ACCEPTED the credential in a recorded check or real call (n/a for things that need no sign-in)
 *   operational    it has been seen working: a probe ran just now, or a recorded successful use
 *   tested         a deliberate test with a recorded passing result exists
 *   verified       tested AND used for real, with no later failure; the strongest claim, and never given to simulated or fake-only evidence
 * A level is "yes" only with evidence, "no" when evidence says it is not, "unknown" when nobody has looked, "n/a" when it cannot apply.
 */
import type { ToolInfo } from "../tools/registry.js";

export const LEVELS = ["installed", "configured", "authenticated", "operational", "tested", "verified"] as const;
export type CapLevel = (typeof LEVELS)[number];
export type LevelState = "yes" | "no" | "unknown" | "n/a";
export interface LevelFact {
  state: LevelState;
  evidence: string;
}
export type Levels = Record<CapLevel, LevelFact>;

/**
 * available   seen working (operational or tested) and nothing known to be wrong
 * unverified  installed and configured but never seen working: do NOT promise it works
 * partial     works with a stated restriction (paused, limited scope, some models only)
 * needs_setup exists, but the owner must configure or sign in first
 * unavailable not installed, or not built in this version
 */
export type CapState = "available" | "unverified" | "partial" | "needs_setup" | "unavailable";
export type CapCost = "free" | "free_with_limits" | "local" | "paid" | "simulated" | "unknown" | "not_applicable";
export type CapGroup = "tool" | "model" | "integration" | "permission" | "authentication" | "environment" | "agent" | "workflow";

export interface Capability {
  id: string;
  name: string;
  group: CapGroup;
  description: string;
  levels: Levels;
  /** The highest level reached with every applicable level below it "yes". null = not even installed. */
  reached: CapLevel | null;
  state: CapState;
  stateReason: string;
  cost: CapCost;
  costNote: string;
  /** What is missing, in plain words. */
  missing: string[];
  /** What only the owner can do (sign in, switch on, approve, install). */
  needsOwner: string[];
  /** Honest limits of what exists even when it works. */
  limits: string[];
}

// ---- Facts: everything the registry knows comes in through this one plain object, so tests can simulate any situation. ----
export interface IntegrationFact {
  id: string;
  label: string;
  /** null = ready; otherwise the reason it is not set up. */
  notReady: string | null;
  /** The newest recorded "Test connection" result, from the audit log. */
  lastCheck: { ok: boolean; at: string; text: string; local: boolean } | null;
  /** The newest recorded successful real use (an approved action that ran, or a read that succeeded). */
  lastUseAt: string | null;
  /** Does it need a sign-in at all? Local services (the PC agent, documents, notes) do not. */
  needsSignIn: boolean;
  readActions: number;
  writeActions: number;
}
export interface ProviderFact {
  id: string;
  name: string;
  kind: "cloud" | "local";
  simulated: boolean;
  enabled: boolean;
  keyConfigured: boolean;
  freeConfirmed: boolean;
  requiresFreeConfirmation: boolean;
  costClass: "permanently_free" | "free_with_limits" | "trial_credits" | "paid" | "local_free" | "unverified" | null;
  /** The provider's last recorded status: "connected" means a real call or test was accepted. */
  status: string | null;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  requestsToday: number;
  dailyRequestCap: number | null;
}
export interface ModelFact {
  ref: string;
  providerId: string;
  /** Provider on, key present, free policy, switched on, listed. */
  callable: boolean;
  verification: "verified" | "unverified" | "unavailable";
  routable: boolean;
  retired: boolean;
}
/** An agent (bot) as the agent manager and the task log know it. Archived agents are simply not passed in: that is how removal is noticed. */
export interface AgentFact {
  id: string;
  name: string;
  role: string;
  status: "disabled" | "paused" | "active";
  runtime: "builtin" | "openclaw";
  /** "provider/model", "auto/..." or null. */
  model: string | null;
  completedTasks: number;
  failedTasks: number;
}
/** A workflow as the workflow service knows it. Archived workflows are not passed in. */
export interface WorkflowFact {
  id: string;
  name: string;
  enabled: boolean;
  /** Number of problems the graph checker reports (0 = the graph is valid). */
  problems: number;
  /** Agents its boxes use. */
  botIds: string[];
  /** Does a box ask the Manager? */
  usesManager: boolean;
  lastRunStatus: string | null;
  completedRuns: number;
  failedRuns: number;
}
export interface EnvironmentFacts {
  platform: string;
  nodeVersion: string;
  cpuThreads: number;
  ramGb: number;
  guardian: { configured: boolean; reachable: boolean; held: string | null; tier: string | null; passphraseSet: boolean | null; protectsOwnerActions: boolean };
  approvalsPaused: boolean;
  groupsEnabled: boolean;
  pcRoots: number;
  pcStopped: boolean;
  /** Result of a fixed `ffmpeg -version` probe: a version line, or null. */
  ffmpeg: string | null;
}
export interface CapabilityFacts {
  tools: ToolInfo[];
  integrations: IntegrationFact[];
  providers: ProviderFact[];
  models: ModelFact[];
  environment: EnvironmentFacts;
  /** Optional so that older callers keep working: absent means "not looked at", not "none". */
  agents?: AgentFact[];
  workflows?: WorkflowFact[];
}

const fact = (state: LevelState, evidence: string): LevelFact => ({ state, evidence });
const YES = (e: string) => fact("yes", e);
const NO = (e: string) => fact("no", e);
const UNK = (e: string) => fact("unknown", e);
const NA = (e: string) => fact("n/a", e);

export function reachedLevel(levels: Levels): CapLevel | null {
  let reached: CapLevel | null = null;
  for (const l of LEVELS) {
    const s = levels[l].state;
    if (s === "n/a") continue;
    if (s !== "yes") break;
    reached = l;
  }
  return reached;
}

interface Opts {
  partial?: string;
  missing?: string[];
  needsOwner?: string[];
  limits?: string[];
  /** Overrides the default reason text. */
  reason?: string;
}

function build(base: Pick<Capability, "id" | "name" | "group" | "description" | "cost" | "costNote">, levels: Levels, o: Opts = {}): Capability {
  let state: CapState;
  let reason: string;
  if (levels.installed.state === "no") {
    state = "unavailable";
    reason = o.reason ?? levels.installed.evidence;
  } else if (levels.configured.state === "no") {
    state = "needs_setup";
    reason = o.reason ?? levels.configured.evidence;
  } else if (levels.authenticated.state === "no") {
    state = "needs_setup";
    reason = o.reason ?? `The last sign-in check failed: ${levels.authenticated.evidence}`;
  } else if (o.partial) {
    state = "partial";
    reason = o.reason ?? o.partial;
  } else if (levels.operational.state === "yes" || levels.tested.state === "yes") {
    state = "available";
    reason = o.reason ?? (levels.verified.state === "yes" ? "Verified: tested and used for real." : "Seen working. Not yet verified end to end.");
  } else {
    state = "unverified";
    reason = o.reason ?? "Set up, but nobody has seen it work yet. Do not rely on it until it is tested.";
  }
  return {
    ...base,
    levels,
    reached: reachedLevel(levels),
    state,
    stateReason: reason,
    missing: o.missing ?? [],
    needsOwner: o.needsOwner ?? [],
    limits: o.limits ?? [],
  };
}

// ---- Tools (programs, built-in abilities) and integrations (outside services) ----
const FREE_PROGRAMS = new Set(["node", "npm", "git", "python", "vscode", "android"]);
/** Tools whose "available" comes from really running a fixed command or reading the machine, so it does prove they work. */
const PROBED = new Set([...FREE_PROGRAMS, "pc-resources"]);
/** Superseded by the per-provider model entries, which look at real status instead of "a key exists". */
const SUPERSEDED = new Set(["ai-cloud", "ai-local"]);

function fromIntegration(t: ToolInfo, i: IntegrationFact): Capability {
  const ready = i.notReady === null;
  const chk = i.lastCheck;
  const authenticated: LevelFact = !i.needsSignIn
    ? NA("Runs on this PC; nothing to sign in to.")
    : !ready
      ? UNK(`Not set up: ${i.notReady}`)
      : chk === null
        ? UNK("Credentials are saved but no connection test has been recorded.")
        : chk.ok
          ? YES(`The service accepted the credential on ${chk.at}: ${chk.text || "check passed"}`)
          : NO(chk.text || "The last connection test failed.");
  const operational: LevelFact = i.lastUseAt ? YES(`A real use succeeded on ${i.lastUseAt}.`) : chk?.ok && !chk.local ? YES(`A real connection test succeeded on ${chk.at}.`) : UNK("No successful real use is recorded.");
  const tested: LevelFact = chk === null ? NO("No connection test has been run.") : chk.ok ? YES(chk.local ? "A local readiness check passed (it makes no outside call)." : `A real connection test passed on ${chk.at}.`) : NO("The last connection test failed.");
  const verified: LevelFact = chk?.ok && i.lastUseAt && !chk.local ? YES("A passing test and a successful real use are both recorded.") : NO("Needs both a passing test and a successful real use. Everything in development ran against fake services only.");
  const levels: Levels = {
    installed: YES("The connector is part of this build."),
    configured: ready ? YES("Credentials or settings are saved.") : NO(i.notReady ?? "Not set up."),
    authenticated,
    operational,
    tested,
    verified,
  };
  const isWrite = i.writeActions > 0;
  return build(
    { id: t.id, name: t.name, group: "integration", description: t.description, cost: i.needsSignIn ? "free" : "not_applicable", costNote: i.needsSignIn ? "This app adds no charge. The service's own plan terms apply and were not checked." : "Runs on this PC." },
    levels,
    {
      missing: ready ? [] : [i.notReady ?? "Set it up in the Integrations Center."],
      needsOwner: [...(ready ? [] : ["Set it up in the Integrations Center."]), ...(ready && chk === null && i.needsSignIn ? ["Press 'Test connection' in the Integrations Center."] : []), ...(isWrite ? ["Every write waits for your approval."] : [])],
      limits: [`${i.readActions} read action(s), ${i.writeActions} write action(s) (writes always need your approval).`, ...(i.needsSignIn ? ["Each agent also needs its own Permissions switch for reading."] : [])],
    },
  );
}

function fromTool(t: ToolInfo, env: EnvironmentFacts, integrations: Map<string, IntegrationFact>): Capability {
  const integ = integrations.get(t.id) ?? integrations.get(t.id === "pc-agent" ? "pc" : t.id);
  if (integ && t.category !== "coding") return fromIntegration(t, integ);

  const free = FREE_PROGRAMS.has(t.id);
  const notBuilt = t.status === "unavailable" && /not built|no free, verified service/i.test(t.detail);
  const cost: CapCost = notBuilt ? "not_applicable" : free ? "free" : t.id.startsWith("ai-") ? (t.id === "ai-local" ? "local" : "free_with_limits") : t.id === "pc-resources" || t.id === "documents" || t.id === "pc-agent" ? "not_applicable" : "unknown";
  const levels: Levels = {
    installed: t.status === "unavailable" ? NO(t.detail) : YES(t.status === "available" ? `Found: ${t.detail}` : "Part of this build."),
    configured: t.status === "needs_setup" ? NO(t.detail) : t.status === "unavailable" ? NO("Not installed.") : YES("Nothing more to configure."),
    authenticated: NA("Needs no sign-in."),
    // Only a real program run (or the resource read) proves it works. For everything else "available" means "ready", which is not the same.
    operational: t.status === "available" ? (PROBED.has(t.id) ? YES(`The check ran just now: ${t.detail.slice(0, 100)}`) : UNK("Ready to use, but no successful use is recorded.")) : NO(t.status === "needs_setup" ? t.detail : "Not available."),
    tested: NO("Finding or probing it is not a test of doing real work with it."),
    verified: NO("No end-to-end task has been recorded with it."),
  };
  return build(
    { id: t.id, name: t.name, group: "tool", description: t.description, cost, costNote: notBuilt ? "Does not exist in this build." : free ? "Free software." : cost === "free_with_limits" ? "Free tiers only; the free-only lock stays on." : "No cost from this app." },
    levels,
    {
      missing: t.status === "available" ? [] : [t.detail],
      needsOwner: t.status === "needs_setup" ? [t.detail] : t.status === "unavailable" && !notBuilt ? [t.detail] : [],
      limits: t.requiresAssignment ? ["An agent must be given access to this tool before it can use it."] : [],
    },
  );
}

// ---- Models ----
function modelCapabilities(f: CapabilityFacts): Capability[] {
  const out: Capability[] = [];
  for (const p of f.providers) {
    const models = f.models.filter((m) => m.providerId === p.id);
    const callable = models.filter((m) => m.callable && !m.retired);
    const verified = callable.filter((m) => m.verification === "verified");
    const unverified = callable.filter((m) => m.verification !== "verified");
    // In enforced mode a routable model is a verified one; with enforcement off (tests only) routable is what agents can actually use.
    const usable = callable.filter((m) => m.routable);
    const configured = p.kind === "local" ? p.enabled : p.enabled && (p.keyConfigured || p.simulated);
    const accepted = p.status === "connected";
    const cost: CapCost = p.simulated ? "simulated" : p.costClass === "paid" ? "paid" : p.costClass === "local_free" || p.kind === "local" ? "local" : p.costClass === "permanently_free" ? "free" : p.costClass === "free_with_limits" ? "free_with_limits" : "unknown";
    const levels: Levels = {
      installed: YES("The provider plugin is part of this build."),
      configured: configured ? YES(p.kind === "local" ? "Switched on." : p.simulated ? "The built-in demo provider." : "Switched on and a key is saved.") : NO(!p.enabled ? "Switched off." : "No key is saved."),
      authenticated: p.simulated ? NA("A simulated provider has no sign-in.") : !configured ? UNK("Not configured.") : accepted ? YES(`The provider accepted the last call or test${p.lastCheckedAt ? ` (${p.lastCheckedAt})` : ""}.`) : p.status ? NO(`Last status: ${p.status}${p.statusMessage ? `: ${p.statusMessage.slice(0, 120)}` : ""}`) : UNK("No connection test or call is recorded."),
      operational: p.simulated ? YES("Simulated answers only (no real AI).") : p.requestsToday > 0 && accepted ? YES(`${p.requestsToday} request(s) went through today.`) : callable.length > 0 && accepted ? YES(`${callable.length} model(s) are listed and callable after an accepted call.`) : UNK("No request has gone through recently."),
      tested: verified.length > 0 ? YES(`${verified.length} model(s) passed the registry's real tests.`) : NO("No model has passed the registry's tests with real requests."),
      verified: p.simulated ? NO("Simulated; it can never be verified as a real AI.") : verified.length > 0 && accepted ? YES(`${verified.length} verified model(s) on a provider that accepted real calls.`) : NO("Needs a model that passed the real tests."),
    };
    const o: Opts = {
      missing: [
        ...(configured ? [] : [p.kind === "local" ? "Switch the provider on (and install the local runtime)." : !p.enabled ? "Switch the provider on in Settings > AI Models." : "Save an API key in the Integrations Center."]),
        ...(configured && verified.length === 0 && !p.simulated ? ["No verified model yet (run the registry tests with the owner's approval)."] : []),
      ],
      needsOwner: [...(configured ? [] : ["Connect the provider (key, free-plan confirmation, test)."]), ...(p.requiresFreeConfirmation && !p.freeConfirmed ? ["Confirm the account is on the free plan."] : [])],
      limits: [
        `${verified.length} verified, ${unverified.length} unverified, ${models.length - callable.length} not usable.`,
        ...(p.dailyRequestCap !== null ? [`Daily cap ${p.dailyRequestCap} requests (${p.requestsToday} used today).`] : []),
        "Text only: no images, audio or native tool calling are sent to any provider.",
      ],
    };
    if (p.simulated) o.partial = "Simulated answers only: useful to try the app, never real work.";
    else if (p.costClass === "paid") {
      o.partial = "Paid. Blocked by the free-only lock; it is never used without your explicit approval.";
    } else if (configured && accepted && usable.length === 0) o.partial = "Connected, but no model is verified, so it is not used automatically.";
    out.push(build({ id: `model-provider:${p.id}`, name: `${p.name} (AI models)`, group: "model", description: p.kind === "local" ? "AI models running on this PC." : "AI models from this provider.", cost, costNote: p.simulated ? "No cost and no real AI." : p.costClass === "paid" ? "Paid: blocked." : p.costClass === "unverified" || p.costClass === null ? "Cost terms not verified." : "Free tier only; limits apply." }, levels, o));
  }

  // An aggregate the feasibility checker depends on: is there at least one real, verified, callable model?
  const real = f.providers.filter((p) => !p.simulated).map((p) => p.id);
  const callableReal = f.models.filter((m) => real.includes(m.providerId) && m.callable && !m.retired);
  const usableReal = callableReal.filter((m) => m.routable);
  const verifiedAny = callableReal.filter((m) => m.verification === "verified");
  const verifiedReal = verifiedAny.filter((m) => m.routable);
  const demo = f.providers.some((p) => p.simulated && p.enabled);
  const connectedReal = f.providers.some((p) => !p.simulated && p.status === "connected");
  const agg: Levels = {
    installed: YES("Model routing is part of this build."),
    configured: callableReal.length > 0 ? YES(`${callableReal.length} real model(s) are callable.`) : NO("No real model is callable."),
    authenticated: connectedReal ? YES("At least one real provider accepted a call or test.") : UNK("No real provider has a recorded accepted call."),
    operational: connectedReal && callableReal.length > 0 ? YES("A real provider is connected with callable models.") : UNK("Nothing real has been seen answering."),
    tested: verifiedReal.length > 0 ? YES(`${verifiedReal.length} model(s) passed the registry tests.`) : NO("No real model passed the registry tests."),
    verified: verifiedReal.length > 0 && connectedReal ? YES(`${verifiedReal.length} verified, routable real model(s).`) : NO("No verified real model."),
  };
  out.push(
    build(
      { id: "ai-models", name: "A verified AI model for agents", group: "model", description: "At least one real, free, verified model that agents and the Manager can use for text work.", cost: verifiedReal.length > 0 ? "free_with_limits" : "not_applicable", costNote: "Free-only lock is on; paid models are never used automatically." },
      agg,
      {
        missing: usableReal.length > 0 ? [] : ["No verified real model."],
        needsOwner: usableReal.length > 0 ? [] : ["Connect a free provider and approve the registry tests (the exact request count needs your approval)."],
        limits: demo ? ["The simulated demo provider is switched on but is not counted as an AI."] : [],
        ...(usableReal.length === 0 && callableReal.length > 0 ? { partial: "Real models are callable but none is verified, so agents refuse them." } : {}),
      },
    ),
  );

  // Abilities no provider can use through this app today. Stated as facts so nobody promises them.
  const noFeature = (id: string, name: string, description: string): Capability =>
    build({ id, name, group: "model", description, cost: "not_applicable", costNote: "Not available." }, { installed: NO("This app's model adapter sends text only."), configured: NO("Not applicable."), authenticated: NA("n/a"), operational: NO("Not wired to any provider."), tested: NO("Not built."), verified: NO("Not built.") }, { missing: ["Not built in this version."], needsOwner: [], limits: [] });
  out.push(noFeature("model-tool-calling", "Native tool calling by models", "Models calling tools directly. Agents use text requests that pass through the approval gate instead."));
  out.push(noFeature("model-vision", "Reading pictures", "Sending images to a model."));
  out.push(noFeature("model-audio", "Listening to or producing audio with a model", "Speech input or output."));
  return out;
}

// ---- Environment, permissions and authentication ----
function environmentCapabilities(f: CapabilityFacts): Capability[] {
  const e = f.environment;
  const out: Capability[] = [];
  const base = (id: string, name: string, group: CapGroup, description: string, cost: CapCost = "not_applicable", costNote = "No cost."): Pick<Capability, "id" | "name" | "group" | "description" | "cost" | "costNote"> => ({ id, name, group, description, cost, costNote });

  out.push(build(base("env-host", "This PC", "environment", "The machine and runtime the platform runs on."), { installed: YES(`${e.platform}, Node ${e.nodeVersion}`), configured: YES("Running."), authenticated: NA("n/a"), operational: YES(`${e.cpuThreads} CPU threads, ${e.ramGb} GB memory.`), tested: YES("The platform is running and answering."), verified: NO("Hardware limits for heavy local models were not measured.") }, { limits: ["No GPU check is made; local image or video generation is deferred (D-025)."] }));

  const g = e.guardian;
  out.push(
    build(
      base("env-guardian", "Guardian (emergency stop and pause), Tier A", "permission", "A separate program that can pause or stop the workforce. Tier A is for supervised development use only."),
      {
        installed: YES("Part of this build."),
        configured: g.configured ? YES("GUARDIAN_URL is set.") : NO("Not configured: no GUARDIAN_URL."),
        authenticated: g.configured ? (g.passphraseSet ? YES("An owner passphrase is set.") : NO("No passphrase is set.")) : UNK("Not configured."),
        operational: g.configured ? (g.reachable ? YES("The Guardian answers.") : NO("The Guardian does not answer.")) : NO("Not running."),
        tested: NO("Built and tested with fakes. The real lock-screen and 15-minute idle checks were never run (NV-8)."),
        verified: NO("Not verified on this PC (NV-8)."),
      },
      {
        needsOwner: g.configured ? [] : ["Set the Guardian passphrase, start it and put GUARDIAN_URL in .env (docs/GUARDIAN.md)."],
        limits: ["Tier A only. Unattended operation is not allowed until Tier B is built and verified."],
        ...(g.configured && g.held ? { partial: `Holding new work: ${g.held}.` } : {}),
      },
    ),
  );

  out.push(build(base("env-guardian-tier-b", "Guardian Tier B (needed for unattended work)", "permission", "A system-level, fixed-command Guardian that must exist before anything runs while you are away."), { installed: NO("NOT BUILT (NV-9)."), configured: NO("Not built."), authenticated: NA("n/a"), operational: NO("Not built."), tested: NO("Not built."), verified: NO("Not built.") }, { missing: ["Tier B is not built; administrator steps need your separate approval."], needsOwner: ["Approve and perform the Tier B steps (docs/TIER-B-PLAN.md)."] }));
  out.push(build(base("env-vm", "Isolated virtual machine for the desktop agent (VMware)", "environment", "A separate VM where the AI could operate a desktop away from your own windows."), { installed: NO("NOT BUILT. No VM, dedicated account or firewall design exists (NV-10)."), configured: NO("Not built."), authenticated: NA("n/a"), operational: NO("Not built."), tested: NO("Not run."), verified: NO("Not run.") }, { missing: ["No VM exists. The firewall audit has not been run."], needsOwner: ["Approve creating the VM, the account and the firewall changes (each separately)."] }));

  out.push(build(base("env-desktop-engine", "Desktop engine (operate programs it launched itself)", "environment", "Windows UI Automation and OCR on programs the engine started, from the approved list."), { installed: e.platform === "win32" ? YES("Built; Windows only.") : NO("Windows only."), configured: UNK("Needs an approved program and a folder grant."), authenticated: NA("n/a"), operational: UNK("Not probed here: probing could touch your windows (D-045)."), tested: YES("Real tests ran on disposable windows only."), verified: NO("Not verified on Office, browsers, VS Code or other real programs (NV-14).") }, { partial: "Only verified on disposable test windows; every plan needs your approval.", needsOwner: ["Approve a program (Access page) and a folder, then approve each plan."], limits: ["Never attaches to windows it did not start."] }));

  out.push(build(base("env-ffmpeg", "FFmpeg (video and audio processing)", "environment", "Required for any local video or audio editing.", e.ffmpeg ? "free" : "not_applicable", e.ffmpeg ? "Free software." : "Not installed."), { installed: e.ffmpeg ? YES(`Found: ${e.ffmpeg.slice(0, 80)}`) : NO("Not found on this PC. Nothing is installed without your approval (D-018)."), configured: e.ffmpeg ? YES("On the PATH.") : NO("Not installed."), authenticated: NA("n/a"), operational: e.ffmpeg ? YES("The version check ran.") : NO("Not installed."), tested: NO("No video task has used it."), verified: NO("No video task has used it.") }, { missing: e.ffmpeg ? [] : ["FFmpeg is not installed."], needsOwner: e.ffmpeg ? [] : ["Approve installing FFmpeg if you want local video work."] }));

  out.push(build(base("perm-approval-gate", "Approval gate for outside actions", "permission", "Every send, publish or write to the outside waits for your approval."), { installed: YES("Part of this build."), configured: YES("Always on."), authenticated: NA("n/a"), operational: e.approvalsPaused ? NO("Outside actions are paused.") : YES("Active."), tested: YES("Covered by the automated tests."), verified: NO("Not exercised with real outside services.") }, e.approvalsPaused ? { partial: "All outside actions are paused. Switch them back on to continue." } : {}));

  out.push(build(base("perm-folders", "Folder permissions (default deny)", "permission", "Agents may read or write only in folders you approved."), { installed: YES("Part of this build."), configured: e.pcRoots > 0 ? YES(`${e.pcRoots} workspace folder(s) chosen.`) : NO("No workspace folder is chosen, so agents cannot touch files."), authenticated: NA("n/a"), operational: e.pcStopped ? NO("The PC agent is stopped.") : e.pcRoots > 0 ? YES("Enforced by the application for the PC agent and the document writer.") : UNK("Nothing to enforce yet."), tested: YES("Covered by the automated tests."), verified: NO("Enforced by the app, not by Windows (S-19).") }, { needsOwner: e.pcRoots > 0 ? [] : ["Add a folder in the PC Control Center and approve it under Access."], limits: ["Application-level only; same-account programs can still reach what Windows allows."] }));

  out.push(build(base("auth-owner-proof", "Owner proof (passphrase step-up)", "authentication", "Owner-only changes ask for your Guardian passphrase."), { installed: YES("Part of this build."), configured: g.protectsOwnerActions ? YES("Owner-only changes need the passphrase.") : NO("No Guardian passphrase is protecting owner actions."), authenticated: NA("n/a"), operational: g.protectsOwnerActions && g.reachable ? YES("The Guardian is reachable.") : NO("Not active."), tested: YES("Covered by automated tests."), verified: NO("Not verified on the real machine (NV-8).") }, { needsOwner: g.protectsOwnerActions ? [] : ["Set the Guardian passphrase."] }));

  out.push(build(base("perm-groups", "Agent group chats (@mentions, agent-to-agent)", "permission", "Groups where you @mention agents and the Manager coordinates."), { installed: YES("Built."), configured: e.groupsEnabled ? YES("The owner's switch is on.") : NO("Switched off (NV-15)."), authenticated: NA("n/a"), operational: e.groupsEnabled ? UNK("On, but no real run is recorded.") : NO("Off."), tested: YES("Tested with fake providers (44 browser checks)."), verified: NO("Never run against a real provider (NV-15).") }, { needsOwner: e.groupsEnabled ? [] : ["Switch groups on in the Groups page (your decision)."], limits: ["Real agent-to-agent behaviour with real models is not yet observed."] }));

  out.push(build(base("perm-free-only", "Free-only lock", "permission", "No paid model or service is used; it cannot be switched off from here.", "free", "Protects against cost."), { installed: YES("Permanently locked on."), configured: YES("Always on."), authenticated: NA("n/a"), operational: YES("Applies to every model call."), tested: YES("Covered by automated tests."), verified: NO("Provider price lists are only partly verified (NV-13).") }));

  out.push(build(base("perm-autonomy", "Unattended (autonomous) operation", "permission", "Work that continues while you are away."), { installed: NO("NOT ALLOWED until Guardian Tier B is built and verified (D-030, D-035)."), configured: NO("Everything is supervised."), authenticated: NA("n/a"), operational: NO("Supervised only."), tested: NO("n/a"), verified: NO("n/a") }, { missing: ["Guardian Tier B."], needsOwner: ["Stay present while work runs. Pause happens on lock or after 15 idle minutes."], reason: "Supervised only. You must be present and able to stop it." }));
  return out;
}

// ---- Public builder ----
export function buildCapabilities(f: CapabilityFacts): Capability[] {
  const integ = new Map(f.integrations.map((i) => [i.id, i]));
  const tools = f.tools.filter((t) => !SUPERSEDED.has(t.id)).map((t) => fromTool(t, f.environment, integ));
  // Outside services the tool list does not carry (for example Business Workforce).
  const covered = new Set(f.tools.flatMap((t) => [t.id, t.id === "pc-agent" ? "pc" : t.id]));
  const extra = f.integrations
    .filter((i) => !covered.has(i.id))
    .map((i) => fromIntegration({ id: i.id, name: i.label, category: "integration", description: `${i.label} connection.`, status: i.notReady ? "needs_setup" : "available", detail: i.notReady ?? "Ready", requiresAssignment: false }, i));
  const base = [...tools, ...extra, ...modelCapabilities(f), ...environmentCapabilities(f)];
  const models = perModelCapabilities(f);
  const agents = agentCapabilities(f, [...base, ...models]);
  const workflows = workflowCapabilities(f, [...base, ...agents]);
  return [...base, ...models, ...agents, ...workflows];
}

// ---- Individual models, agents and workflows: these register themselves because they are read from the services that own them ----
const MAX_MODEL_ENTRIES = 80;
function perModelCapabilities(f: CapabilityFacts): Capability[] {
  const byProvider = new Map(f.providers.map((p) => [p.id, p]));
  // Only models that matter: switched on and callable, or verified. A provider can list dozens of speech, image and retired models.
  const shown = f.models.filter((m) => !m.retired && (m.callable || m.verification === "verified")).slice(0, MAX_MODEL_ENTRIES);
  return shown.map((m) => {
    const p = byProvider.get(m.providerId);
    const simulated = p?.simulated ?? false;
    const connected = p?.status === "connected";
    const verified = m.verification === "verified";
    const levels: Levels = {
      installed: YES("Listed by its provider."),
      configured: m.callable ? YES("Switched on and allowed by the free-only lock.") : NO("Not callable: switched off or blocked."),
      authenticated: simulated ? NA("Simulated; no sign-in.") : connected ? YES("Its provider accepted the last call or test.") : p?.status ? NO(`Provider status: ${p.status}`) : UNK("No provider check is recorded."),
      operational: simulated ? YES("Simulated answers only.") : verified && connected ? YES("It passed real registry tests.") : UNK("Callable, but no request to this model is recorded."),
      tested: verified ? YES("Passed the registry's core tests.") : NO(m.verification === "unavailable" ? "Not usable." : "Not tested, or a test failed."),
      verified: simulated ? NO("Simulated; never verified.") : verified && connected ? YES("Tested with real requests and its provider is connected.") : NO("Needs passing real tests."),
    };
    const o: Opts = { limits: ["Text only in this app."] };
    if (simulated) o.partial = "Simulated answers only.";
    else if (!m.routable && !verified) o.partial = "Not verified, so agents and automatic routing refuse it.";
    const cost: CapCost = simulated ? "simulated" : p?.costClass === "paid" ? "paid" : p?.kind === "local" ? "local" : p?.costClass === "permanently_free" ? "free" : p?.costClass === "free_with_limits" ? "free_with_limits" : "unknown";
    return build({ id: `model:${m.ref}`, name: m.ref, group: "model", description: "One AI model.", cost, costNote: cost === "paid" ? "Paid: blocked by the free-only lock." : cost === "unknown" ? "Cost terms not verified." : "Free tier or local only." }, levels, o);
  });
}

function agentCapabilities(f: CapabilityFacts, known: Capability[]): Capability[] {
  const aiOk = known.find((c) => c.id === "ai-models")?.state === "available";
  const byRef = new Map(f.models.map((m) => [m.ref, m]));
  return (f.agents ?? []).map((a) => {
    const auto = a.model?.startsWith("auto/") ?? false;
    const m = a.model && !auto ? byRef.get(a.model) : undefined;
    const modelUsable = a.model === null ? false : auto ? aiOk : Boolean(m && m.callable && m.routable && !m.retired);
    const active = a.status === "active" && a.runtime === "builtin";
    const configured = active && a.model !== null;
    const levels: Levels = {
      installed: YES("The agent exists and is not archived."),
      configured: configured ? YES(`Active with model ${a.model}.`) : NO(a.runtime !== "builtin" ? "Uses a runtime that is not installed." : a.model === null ? "No model chosen." : `Status is ${a.status}, so it does not run.`),
      authenticated: NA("Agents sign in to nothing themselves; connectors have their own sign-in."),
      operational: !configured ? NO("Not configured.") : !modelUsable ? NO("Its model cannot be used right now.") : a.completedTasks > 0 ? YES(`${a.completedTasks} task(s) completed.`) : UNK("Ready, but no completed task is recorded."),
      tested: UNK("No deliberate test of this agent is recorded."),
      verified: NO("A completed task is not an independently checked result."),
    };
    const o: Opts = {
      missing: configured ? (modelUsable ? [] : ["Its model is not usable right now."]) : [levels.configured.evidence],
      needsOwner: configured ? [] : ["Give it a model and switch it to Active (Agents page)."],
      limits: [`${a.completedTasks} completed and ${a.failedTasks} failed task(s) on record.`, "Outside actions still need your approval."],
    };
    if (configured && !modelUsable) o.partial = "Its model cannot be used right now, so it cannot run.";
    else if (configured && a.failedTasks > 0 && a.completedTasks === 0) o.partial = "Every recorded task failed.";
    return build({ id: `agent:${a.id}`, name: a.name, group: "agent", description: a.role || "An agent.", cost: "not_applicable", costNote: "Costs only what its model costs (free-only lock is on)." }, levels, o);
  });
}

function workflowCapabilities(f: CapabilityFacts, known: Capability[]): Capability[] {
  const byId = new Map(known.map((c) => [c.id, c]));
  const aiOk = byId.get("ai-models")?.state === "available";
  return (f.workflows ?? []).map((w) => {
    const dependencyProblems: string[] = [];
    for (const id of new Set(w.botIds)) {
      const a = byId.get(`agent:${id}`);
      if (!a) dependencyProblems.push("A box uses an agent that no longer exists or is archived.");
      else if (a.state === "needs_setup" || a.state === "unavailable" || a.state === "partial") dependencyProblems.push(`Agent ${a.name}: ${a.stateReason}`);
    }
    if (w.usesManager && !aiOk) dependencyProblems.push("A box asks the Manager, which needs a verified AI model.");
    const valid = w.problems === 0;
    const levels: Levels = {
      installed: YES("The workflow exists and is not archived."),
      configured: valid && w.enabled ? YES("Valid and switched on.") : NO(!valid ? `The graph has ${w.problems} problem(s).` : "Switched off."),
      authenticated: NA("Workflows sign in to nothing themselves."),
      operational: w.lastRunStatus === "failed" ? NO("The last run failed.") : w.completedRuns > 0 ? YES(`${w.completedRuns} run(s) completed.`) : UNK("No completed run is recorded."),
      tested: UNK("No deliberate test run is recorded."),
      verified: NO("A completed run is not an independently checked result."),
    };
    const o: Opts = { missing: dependencyProblems, needsOwner: dependencyProblems.length ? ["Fix the agents or settings listed, then run it."] : [], limits: [`${w.completedRuns} completed and ${w.failedRuns} failed run(s) on record.`, "Steps that send or save wait for your approval."] };
    if (valid && w.enabled && dependencyProblems.length > 0) o.partial = dependencyProblems[0]!;
    return build({ id: `workflow:${w.id}`, name: w.name, group: "workflow", description: `Workflow with ${new Set(w.botIds).size} agent(s).`, cost: "not_applicable", costNote: "Costs only what its agents cost." }, levels, o);
  });
}

export interface Summary {
  total: number;
  byState: Record<CapState, number>;
  verified: number;
  /** The one sentence the Assistant says first. */
  headline: string;
}
export function summarize(caps: Capability[]): Summary {
  const byState: Record<CapState, number> = { available: 0, unverified: 0, partial: 0, needs_setup: 0, unavailable: 0 };
  for (const c of caps) byState[c.state]++;
  const verified = caps.filter((c) => c.reached === "verified").length;
  return {
    total: caps.length,
    byState,
    verified,
    headline: `${byState.available} working, ${byState.partial} partly working, ${byState.unverified} set up but unproven, ${byState.needs_setup} waiting for you to set up, ${byState.unavailable} not available. ${verified} fully verified end to end.`,
  };
}
