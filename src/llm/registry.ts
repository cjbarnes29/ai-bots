import type { LlmRepository } from "./repository.js";
import { classifyModel, isChatKind, KIND_LABEL, type ModelKind, type NativeInfo } from "./model-kinds.js";
import { LlmError } from "./errors.js";

/**
 * The model registry: what is known about every model a provider has listed, and whether bots may use it.
 *
 * Three eligibility states:
 *  - verified    passed the core tests with real requests; eligible for automatic routing and for bot assignment
 *  - unverified  discovered but not (adequately) tested, or a test failed; excluded from automatic routing, cannot be given to a bot
 *  - unavailable retired, not listed any more, not a chat model, switched off or otherwise blocked; excluded until revalidated
 *
 * Storage: the existing llm_settings key/value table (one JSON document), so no migration is needed. It holds facts and test results only; no secrets.
 * Results are labelled with their source ("real" provider request or "simulated" provider); the evaluation process is the only thing that writes tests.
 */
export const TEST_NAMES = ["connectivity", "instruction", "json_output", "identity_instruction", "history", "action_format", "native_system_role"] as const;
export type TestName = (typeof TEST_NAMES)[number];
/** Without these a model is not verified. The rest decide what it is suitable for. */
export const CORE_TESTS: readonly TestName[] = ["connectivity", "instruction", "json_output"];
export const TEST_LABEL: Record<TestName, string> = {
  connectivity: "Connectivity",
  instruction: "Follows a simple instruction",
  json_output: "Structured JSON output",
  identity_instruction: "Keeps its identity and the owner's rule (system instructions)",
  history: "Remembers the conversation",
  action_format: "Writes a valid outside-action block",
  native_system_role: "Accepts and obeys a native system message",
};

export interface TestRecord {
  result: "pass" | "fail";
  source: "real" | "simulated";
  at: string;
  detail: string;
  latencyMs: number | null;
}
export interface RetiredInfo {
  at: string;
  reason: string;
  /** A model refresh has listed the model again since it was retired (step one of coming back; step two is a real connectivity test). */
  relisted?: boolean;
}
export type FailureCategory = "temporary" | "rate_limit" | "auth" | "unsupported_request" | "retired" | "bad_output" | "other";
export interface RegistryEntry {
  ref: string;
  providerId: string;
  modelId: string;
  kind: ModelKind;
  chatCapable: boolean;
  modalities: { input: string[]; output: string[] };
  basis: string;
  native: NativeInfo;
  firstSeenAt: string;
  lastSeenAt: string | null;
  missingSince: string | null;
  tests: Partial<Record<TestName, TestRecord>>;
  lastVerifiedAt: string | null;
  retired: RetiredInfo | null;
  failures: Partial<Record<FailureCategory, number>>;
  limitations: string[];
  /** How this model should be given its instructions, once TESTED: a real system message, or folded into the first user turn. Absent = decided by name. */
  instructionRole?: "native" | "folded";
}
export type Eligibility = "verified" | "unverified" | "unavailable";
export interface Context {
  /** From the catalog: provider on, key present, free policy, model switched on, listed. */
  callable: boolean;
  blockedReason: string | null;
  availability: string;
  contextWindow: number | null;
}
export interface Judged {
  status: Eligibility;
  reasons: string[];
  missingTests: TestName[];
  failedTests: TestName[];
}

/** Sorts a failed call into what it means for the model. Only "retired" ever excludes a model; the rest are temporary or about the request. */
export function classifyFailure(err: unknown): FailureCategory {
  if (!(err instanceof LlmError)) return "other";
  if (err.retired) return "retired";
  switch (err.llmCode) {
    case "rate_limited":
    case "quota_exceeded":
      return "rate_limit";
    case "auth_failed":
    case "key_missing":
      return "auth";
    case "bad_request":
      return "unsupported_request";
    case "bad_output":
    case "bad_response": // an empty or unreadable reply is a problem with the answer, not with the provider
      return "bad_output";
    case "network":
    case "timeout":
    case "provider_unavailable":
    case "circuit_open":
      return "temporary";
    default:
      return "other";
  }
}

/**
 * Results of REAL requests that the owner approved and that were run before this registry existed (board P-26, 2026-11-04). They are loaded once, for a model
 * that has no record yet, so the evidence is not lost. Nothing else is ever pre-filled.
 */
const EVIDENCE: { ref: string; tests?: Partial<Record<TestName, TestRecord>>; retired?: RetiredInfo; limitations?: string[]; failures?: Partial<Record<FailureCategory, number>> }[] = [
  {
    ref: "groq/openai/gpt-oss-20b",
    tests: {
      connectivity: { result: "pass", source: "real", at: "2026-11-04T22:47:46Z", detail: "Test chat: answered \"OK\" (P-26 run)", latencyMs: 594 },
      instruction: { result: "pass", source: "real", at: "2026-11-04T22:47:46Z", detail: "Replied with exactly the single word asked for (P-26 run)", latencyMs: 594 },
      json_output: { result: "pass", source: "real", at: "2026-11-04T22:47:55Z", detail: "Returned exactly {\"ok\": true, \"word\": \"hello\"} (P-26 run)", latencyMs: 560 },
    },
    limitations: ["System-role / identity, history and action-block tests have not been run for this model yet"],
  },
  {
    ref: "gemini/gemma-4-26b-a4b-it",
    tests: {
      connectivity: { result: "pass", source: "real", at: "2026-11-04T22:48:29Z", detail: "Answered (HTTP 200) after one internal retry (P-26 run)", latencyMs: 14096 },
      identity_instruction: { result: "fail", source: "real", at: "2026-11-04T22:48:29Z", detail: "Ignored the bot's name and the sign-off rule that were folded into the user turn, and printed its reasoning (P-26 run)", latencyMs: 14096 },
    },
    limitations: ["Treats instructions placed in the user turn as untrusted", "Prints <thought> reasoning blocks (now removed by the app; reasoning-only replies fail)", "Whether a native system role works was not tested"],
  },
  {
    ref: "gemini/gemini-2.5-flash",
    retired: { at: "2026-11-04T22:47:33Z", reason: "Google answered (HTTP 404): \"This model models/gemini-2.5-flash is no longer available to new users.\" (P-26 run)" },
  },
  { ref: "gemini/gemini-3.5-transcribe", failures: { unsupported_request: 2 }, limitations: ["A transcription model: it answered chat requests with HTTP 400 twice on 2026-11-04"] },
];

const KEY = "model_registry.v1";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface RegistryDeps {
  repo: LlmRepository;
  now?: () => number;
}

export class ModelRegistry {
  private cache: Record<string, RegistryEntry> | null = null;
  private readonly now: () => number;
  /** Tests and the "verification off" mode: nothing is excluded for lack of verification. Production is always enforced. */
  enforce = true;

  constructor(private readonly d: RegistryDeps) {
    this.now = d.now ?? Date.now;
  }
  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private load(): Record<string, RegistryEntry> {
    if (this.cache) return this.cache;
    try {
      const raw = this.d.repo.getSetting(KEY);
      this.cache = raw ? (JSON.parse(raw) as Record<string, RegistryEntry>) : {};
    } catch {
      this.cache = {}; // a damaged document starts empty; nothing is trusted from it
    }
    return this.cache;
  }
  private save(): void {
    this.d.repo.setSetting(KEY, JSON.stringify(this.cache ?? {}), this.iso());
  }

  private blank(providerId: string, modelId: string, native: NativeInfo = {}): RegistryEntry {
    const ref = `${providerId}/${modelId}`;
    const c = classifyModel(modelId, native);
    const e: RegistryEntry = { ref, providerId, modelId, kind: c.kind, chatCapable: c.chatCapable, modalities: c.modalities, basis: c.basis, native, firstSeenAt: this.iso(), lastSeenAt: null, missingSince: null, tests: {}, lastVerifiedAt: null, retired: null, failures: {}, limitations: [] };
    // The recorded real-run evidence belongs to the real application only (a test instance may reuse the same model names).
    const ev = this.enforce ? EVIDENCE.find((x) => x.ref === ref) : undefined;
    if (ev) {
      if (ev.tests) {
        e.tests = { ...ev.tests };
        e.lastVerifiedAt = Object.values(ev.tests).filter((t) => t.result === "pass").map((t) => t.at).sort().at(-1) ?? null;
      }
      if (ev.retired) e.retired = { ...ev.retired };
      if (ev.limitations) e.limitations = [...ev.limitations];
      if (ev.failures) e.failures = { ...ev.failures };
    }
    return e;
  }

  get(ref: string): RegistryEntry | undefined {
    const e = this.load()[ref];
    return e;
  }
  /** The entry for a model, created (with the recorded evidence) the first time it is needed. */
  ensure(providerId: string, modelId: string): RegistryEntry {
    const all = this.load();
    const ref = `${providerId}/${modelId}`;
    if (!all[ref]) {
      all[ref] = this.blank(providerId, modelId);
      this.save();
    }
    return all[ref]!;
  }
  entries(): RegistryEntry[] {
    return Object.values(this.load());
  }

  /** Records what a provider listed (every model, chat or not). Models it no longer lists are marked missing, never deleted. */
  noteDiscovery(providerId: string, listed: { id: string; native?: NativeInfo }[]): void {
    const all = this.load();
    const now = this.iso();
    const seen = new Set<string>();
    for (const item of listed) {
      const ref = `${providerId}/${item.id}`;
      seen.add(ref);
      const e = all[ref] ?? (all[ref] = this.blank(providerId, item.id, item.native ?? {}));
      const c = classifyModel(item.id, item.native ?? e.native);
      e.native = { ...e.native, ...(item.native ?? {}) };
      e.kind = c.kind;
      e.chatCapable = c.chatCapable;
      e.modalities = c.modalities;
      e.basis = c.basis;
      e.lastSeenAt = now;
      e.missingSince = null;
      if (e.retired) e.retired.relisted = true;
    }
    for (const e of Object.values(all)) if (e.providerId === providerId && !seen.has(e.ref) && e.missingSince === null && e.lastSeenAt !== null) e.missingSince = now;
    this.save();
  }

  /** A confirmed "no longer available" answer. The model stays excluded until a refresh lists it again AND a real connectivity test passes. */
  markRetired(ref: string, reason: string): void {
    const e = this.load()[ref];
    if (!e || e.retired) return;
    e.retired = { at: this.iso(), reason: clip(reason, 400) };
    e.failures.retired = (e.failures.retired ?? 0) + 1;
    this.save();
  }

  /** Counts a failure by category. Only counts: nothing here excludes a model (temporary problems must never disable one). */
  noteFailure(ref: string, category: FailureCategory): void {
    const e = this.load()[ref];
    if (!e) return;
    e.failures[category] = (e.failures[category] ?? 0) + 1;
    this.save();
  }

  recordTest(ref: string, test: TestName, outcome: Omit<TestRecord, "at">): void {
    const e = this.load()[ref];
    if (!e) return;
    // A retired model cannot be cleared by a result that was obtained before a refresh listed it again.
    // Coming back: the provider lists it again (a refresh after the retirement) AND a real connectivity test passes. Results from before the retirement no longer count,
    // so the model has to be verified again from the start.
    if (e.retired && outcome.result === "pass" && test === "connectivity" && outcome.source === "real" && e.retired.relisted === true) {
      e.retired = null;
      e.tests = {};
      e.lastVerifiedAt = null;
    }
    e.tests[test] = { ...outcome, at: this.iso(), detail: clip(outcome.detail, 300) };
    if (outcome.result === "pass") e.lastVerifiedAt = e.tests[test]!.at;
    this.save();
  }

  setInstructionRole(ref: string, role: "native" | "folded"): void {
    const e = this.load()[ref];
    if (!e || e.instructionRole === role) return;
    e.instructionRole = role;
    this.save();
  }

  addLimitation(ref: string, text: string): void {
    const e = this.load()[ref];
    if (!e || e.limitations.includes(text)) return;
    e.limitations.push(clip(text, 300));
    this.save();
  }

  /** Why a retired model is excluded, or null. Used to refuse a call that would only repeat a known answer. */
  retiredInfo(ref: string): RetiredInfo | null {
    return this.load()[ref]?.retired ?? null;
  }

  /**
   * A test result as it counts NOW. An identity result obtained before the way of sending instructions was settled by the native-system-role test was obtained
   * under a different condition (for example folded instructions that the model distrusted), so it no longer counts either way until it is run again.
   */
  effectiveTest(e: RegistryEntry, test: TestName): TestRecord | undefined {
    const r = e.tests[test];
    const settledAt = e.instructionRole ? e.tests.native_system_role?.at : undefined;
    if (r && test === "identity_instruction" && settledAt && r.at < settledAt) return undefined;
    return r;
  }

  judge(e: RegistryEntry, ctx: Context): Judged {
    const reasons: string[] = [];
    // The native-system-role test is information about HOW to talk to the model, not a reason to exclude it (the folded form may work); it decides instructionRole.
    const failedTests = (Object.keys(e.tests) as TestName[]).filter((t) => t !== "native_system_role" && this.effectiveTest(e, t)?.result === "fail");
    const counts = (t: TestName) => {
      const r = this.effectiveTest(e, t);
      return !!r && r.result === "pass" && r.source === "real";
    };
    const missingTests = CORE_TESTS.filter((t) => !counts(t));
    if (!e.chatCapable) reasons.push(`Not a chat model: ${KIND_LABEL[e.kind]} (${e.basis}).`);
    if (e.retired) reasons.push(`Retired: ${e.retired.reason} It returns only after a refresh lists it again and a real connectivity test passes.`);
    if (e.missingSince) reasons.push("The provider no longer lists this model.");
    if (ctx.availability === "removed" || ctx.availability === "not_installed") reasons.push("The provider no longer lists this model.");
    if (!ctx.callable && ctx.blockedReason) reasons.push(ctx.blockedReason);
    if (reasons.length > 0) return { status: "unavailable", reasons: [...new Set(reasons)], missingTests, failedTests };
    // Any recorded failure keeps a model out: a model that ignores a bot's identity or cannot write an action block is not safe to hand to bots, however well it chats.
    if (failedTests.length > 0) return { status: "unverified", reasons: [`Failed: ${failedTests.map((t) => `${TEST_LABEL[t]} (${this.effectiveTest(e, t)!.detail})`).join("; ")}.`], missingTests, failedTests };
    if (missingTests.length > 0) return { status: "unverified", reasons: [`Not tested yet: ${missingTests.map((t) => TEST_LABEL[t]).join(", ")}.`], missingTests, failedTests };
    return { status: "verified", reasons: [], missingTests, failedTests };
  }

  /** What a verified model is shown to be suitable for, from its recorded tests, kind and context size. Untested abilities are listed as untested, never assumed. */
  suitability(e: RegistryEntry, ctx: Pick<Context, "contextWindow">): { task: string; ok: boolean; basis: string }[] {
    const t = (n: TestName) => this.effectiveTest(e, n)?.result === "pass" && this.effectiveTest(e, n)?.source === "real";
    const window = ctx.contextWindow ?? e.native.contextWindow ?? null;
    return [
      { task: "General chat and tasks", ok: e.chatCapable, basis: e.chatCapable ? KIND_LABEL[e.kind] : "not a chat model" },
      { task: "Coding", ok: e.kind === "coding", basis: e.kind === "coding" ? "a coding model" : "not specialised for coding" },
      { task: "Long documents (100k+ tokens)", ok: window !== null && window >= 100_000, basis: window === null ? "context size not listed" : `${window.toLocaleString()} tokens` },
      { task: "Structured JSON output", ok: t("json_output"), basis: t("json_output") ? "tested" : "not tested" },
      { task: "Bot instructions and identity (system prompt)", ok: t("identity_instruction"), basis: t("identity_instruction") ? "tested" : "not tested" },
      { task: "Conversation history", ok: t("history"), basis: t("history") ? "tested" : "not tested" },
      { task: "Outside-action blocks", ok: t("action_format"), basis: t("action_format") ? "tested" : "not tested" },
    ];
  }

  /**
   * May automatic routing use this model, and may a bot be given it? With enforcement on (always, in production) only a VERIFIED model qualifies.
   * `ctx` comes from the catalog. A model with no registry record yet is unverified.
   */
  eligibility(providerId: string, modelId: string, ctx: Context): { ok: boolean; status: Eligibility; reason: string | null } {
    const e = this.ensure(providerId, modelId);
    const j = this.judge(e, ctx);
    if (!this.enforce) {
      const ok = e.chatCapable && !e.retired && j.status !== "unavailable";
      return { ok, status: j.status, reason: ok ? null : j.reasons.join(" ") };
    }
    return { ok: j.status === "verified", status: j.status, reason: j.status === "verified" ? null : j.reasons.join(" ") };
  }
}
