import { buildActionAddendum, parseActions } from "../approvals/protocol.js";
import { buildSystemPrompt } from "../runtimes/prompt.js";
import { extractJson } from "../decisions/relevance.js";
import { AppError } from "../errors.js";
import { classifyFailure, TEST_LABEL, TEST_NAMES, type ModelRegistry, type TestName } from "./registry.js";
import type { LlmService } from "./service.js";
import type { ChatMessage } from "./types.js";
import { stripReasoning } from "./reasoning.js";

/**
 * The model evaluation battery. Each model is judged by what it actually does, never by returning HTTP 200:
 *   connectivity + instruction   "Reply with the single word OK."                                  (1 request, records both)
 *   json_output                  "Reply with only this JSON ..."                                   (1 request)
 *   identity_instruction         the bot system prompt (identity, owner rule, instruction order)    (1 request)
 *   history                      a codeword given in an earlier turn is remembered                  (1 request)
 *   action_format                the real outside-action addendum; a valid ```action block is expected (1 request)
 * Everything else the owner listed is covered without extra requests: error handling, rate-limit handling, timeout and retry behaviour,
 * failover and permission enforcement are properties of THIS APP (tested with simulated providers), and "consistency" is read from repeated results over time.
 * A real run needs the owner's approval of the exact models and tests; the caller states how many requests it was approved for and the runner never exceeds it.
 */
interface Probe {
  /** Send the instructions as a real system message (never folded). */
  nativeRole?: boolean;
  /** The tests this single request decides. */
  decides: TestName[];
  messages: ChatMessage[];
  maxOutputTokens: number;
  judge(text: string): { ok: boolean; detail: string };
}

const SIGNOFF = "ZETA-7";
const eval1 = (t: string) => t.trim();

type ProbeName = Exclude<TestName, "instruction">;
const PROBES: Record<ProbeName, Probe> = {
  connectivity: {
    decides: ["connectivity", "instruction"],
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    maxOutputTokens: 400, // room for a reasoning model to think AND answer (its reasoning counts toward the limit)
    judge: (t) => {
      const text = eval1(t);
      if (text === "") return { ok: false, detail: "Empty answer" };
      return /^\W*ok\W*$/i.test(text) ? { ok: true, detail: `Answered "${text}"` } : { ok: false, detail: `Did not follow the one-word instruction: "${text.slice(0, 80)}"` };
    },
  },
  json_output: {
    decides: ["json_output"],
    messages: [{ role: "user", content: 'Reply with only this JSON: {"ok": true, "word": "hello"}' }],
    maxOutputTokens: 500,
    judge: (t) => {
      const j = extractJson(t) as { ok?: unknown; word?: unknown } | null;
      return j && j.ok === true && j.word === "hello" ? { ok: true, detail: "Returned the requested JSON" } : { ok: false, detail: `Not the requested JSON: "${eval1(t).slice(0, 80)}"` };
    },
  },
  identity_instruction: {
    decides: ["identity_instruction"],
    messages: [
      { role: "system", content: `${buildSystemPrompt({ name: "Evaluator", role: "Test assistant", personality: "", instructions: `Always sign off with ${SIGNOFF}.`, responsibilities: [] })}` },
      { role: "user", content: "Who are you? Answer in one short sentence." },
    ],
    maxOutputTokens: 600,
    judge: (t) => {
      const text = eval1(t);
      const name = /evaluator/i.test(text);
      const sign = text.includes(SIGNOFF);
      return name && sign ? { ok: true, detail: "Kept its name and followed the owner's sign-off rule" } : { ok: false, detail: `${name ? "" : "Did not keep its name. "}${sign ? "" : "Did not follow the owner's sign-off rule. "}Answer: "${text.slice(0, 80)}"`.trim() };
    },
  },
  history: {
    decides: ["history"],
    messages: [
      { role: "user", content: "My codeword is KITE. Please remember it." },
      { role: "assistant", content: "Noted." },
      { role: "user", content: "What is my codeword? Answer with the one word only." },
    ],
    maxOutputTokens: 400,
    judge: (t) => (/kite/i.test(t) ? { ok: true, detail: "Remembered the earlier turn" } : { ok: false, detail: `Lost the earlier turn: "${eval1(t).slice(0, 80)}"` }),
  },
  native_system_role: {
    decides: ["native_system_role"],
    messages: [
      { role: "system", content: `${buildSystemPrompt({ name: "Evaluator", role: "Test assistant", personality: "", instructions: `Always sign off with ${SIGNOFF}.`, responsibilities: [] })}` },
      { role: "user", content: "Who are you? Answer in one short sentence." },
    ],
    maxOutputTokens: 600,
    nativeRole: true,
    judge: (t) => {
      const text = eval1(t);
      return /evaluator/i.test(text) && text.includes(SIGNOFF) ? { ok: true, detail: "Accepted a native system message and obeyed it" } : { ok: false, detail: `Accepted a native system message but did not obey it: "${text.slice(0, 80)}"` };
    },
  },
  action_format: {
    decides: ["action_format"],
    messages: [
      { role: "system", content: `${buildSystemPrompt({ name: "Evaluator", role: "Test assistant", personality: "", instructions: "", responsibilities: [] })}\n\n${buildActionAddendum([{ connector: "telegram", connectorLabel: "Telegram", action: "send_message", kind: "write", description: "Send a Telegram message", argNames: ["chat", "text"] }], 3)}` },
      { role: "user", content: "Send the text hello to the chat sam." },
    ],
    maxOutputTokens: 700,
    judge: (t) => {
      const found = parseActions(t);
      const ok = found.length === 1 && found[0]!.ok === true && found[0]!.connector === "telegram" && found[0]!.action === "send_message" && (found[0] as { args: Record<string, unknown> }).args["chat"] === "sam" && (found[0] as { args: Record<string, unknown> }).args["text"] === "hello";
      return ok ? { ok: true, detail: "Wrote one valid action block" } : { ok: false, detail: found.length === 0 ? "No action block" : "The action block was invalid or wrong" };
    },
  },
};

export const BATTERY_ORDER: ProbeName[] = ["connectivity", "json_output", "identity_instruction", "history", "action_format", "native_system_role"];
/** What a normal full run covers (the native system-role test is a separate, opt-in request). */
export const FULL_RUN: ProbeName[] = ["connectivity", "json_output", "identity_instruction", "history", "action_format"];

export interface EvaluationDeps {
  llm: LlmService;
  registry: ModelRegistry;
  /** Is this provider a built-in simulation? Its results are recorded as "simulated" and never verify a real model. */
  isSimulated: (providerId: string) => boolean;
  /** The refreshed-at facts are in the registry; the runner only needs to resolve ref -> provider/model. */
}

export interface EvaluationResult {
  ref: string;
  requestsUsed: number;
  budget: number;
  stoppedBecause: string | null;
  results: { test: TestName; label: string; result: "pass" | "fail" | "not_run"; detail: string; latencyMs: number | null }[];
  status: string;
}

/**
 * Runs the chosen tests against ONE explicit model, one request per probe, never more than `budget` requests. It stops at the first provider-level
 * problem (key refused, rate limit, outage) instead of hammering the provider. A temporary failure is recorded as "not run", never as a model failure.
 */
export async function evaluateModel(d: EvaluationDeps, ref: string, tests: TestName[], budget: number): Promise<EvaluationResult> {
  if (!Number.isInteger(budget) || budget < 1 || budget > 20) throw new AppError(400, "bad_budget", "State how many requests the owner approved for this run (1 to 20).");
  const wanted = [...new Set(tests)].filter((t): t is ProbeName => t !== "instruction" && (TEST_NAMES as readonly string[]).includes(t));
  if (wanted.length === 0) throw new AppError(400, "no_tests", "Choose at least one test.");
  if (wanted.length > budget) throw new AppError(400, "budget_too_small", `${wanted.length} tests need ${wanted.length} requests, but only ${budget} were approved.`);
  const slash = ref.indexOf("/");
  const providerId = ref.slice(0, slash);
  const modelId = ref.slice(slash + 1);
  const entry = d.registry.ensure(providerId, modelId);
  const source = d.isSimulated(providerId) ? "simulated" : "real";
  const out: EvaluationResult = { ref, requestsUsed: 0, budget, stoppedBecause: null, results: [], status: "" };
  for (const test of BATTERY_ORDER.filter((t) => wanted.includes(t))) {
    const probe = PROBES[test];
    if (out.requestsUsed >= budget) {
      out.results.push({ test, label: TEST_LABEL[test], result: "not_run", detail: "Request budget used up", latencyMs: null });
      continue;
    }
    if (out.stoppedBecause) {
      out.results.push({ test, label: TEST_LABEL[test], result: "not_run", detail: out.stoppedBecause, latencyMs: null });
      continue;
    }
    out.requestsUsed += 1;
    const started = Date.now();
    try {
      const reply = await d.llm.completeDirect({ botId: null, conversationId: null, modelRef: ref, messages: probe.messages, temperature: 0.2, maxOutputTokens: probe.maxOutputTokens, verification: true, ...(probe.nativeRole ? { instructionRole: "native" as const } : {}) });
      const latencyMs = reply.latencyMs ?? Date.now() - started;
      const text = stripReasoning(reply.text, modelId).text;
      const verdict = probe.judge(text);
      for (const name of probe.decides) {
        const answered = text.trim() !== "";
        const detail = name === "connectivity" ? (answered ? "Answered" : "Empty answer") : verdict.detail;
        const result = name === "connectivity" ? (answered ? "pass" : "fail") : verdict.ok ? "pass" : "fail";
        d.registry.recordTest(ref, name, { result, source, detail, latencyMs });
        out.results.push({ test: name, label: TEST_LABEL[name], result, detail, latencyMs });
      }
      if (probe.nativeRole && verdict.ok) d.registry.setInstructionRole(ref, "native"); // tested: from now on this model gets a real system message
      if (probe.nativeRole && !verdict.ok) {
        // The native role does not work for this model; the folded form is used from now on, and the identity test says whether THAT works.
        d.registry.addLimitation(ref, "Accepted a native system message but did not obey it");
        d.registry.setInstructionRole(ref, "folded");
      }
    } catch (err) {
      const category = classifyFailure(err);
      const message = err instanceof Error ? err.message : "failed";
      // A temporary or provider-level failure says nothing about the model: nothing is recorded as a failed test, and the run stops so the provider is not hammered.
      if (category === "bad_output") {
        for (const name of probe.decides) {
          d.registry.recordTest(ref, name, { result: "fail", source, detail: message, latencyMs: null });
          out.results.push({ test: name, label: TEST_LABEL[name], result: "fail", detail: message, latencyMs: null });
        }
        continue;
      }
      if (category === "unsupported_request") {
        if (probe.nativeRole) d.registry.setInstructionRole(ref, "folded"); // the provider refused a real system message: this model has to be given its instructions inside the user turn
        for (const name of probe.decides) {
          d.registry.recordTest(ref, name, { result: "fail", source, detail: `The provider refused this kind of request: ${message}`, latencyMs: null });
          out.results.push({ test: name, label: TEST_LABEL[name], result: "fail", detail: `The provider refused this kind of request: ${message}`, latencyMs: null });
        }
        continue;
      }
      out.stoppedBecause = category === "retired" ? "The provider says this model is no longer available." : `Stopped: ${category.replace("_", " ")} (${message.slice(0, 120)})`;
      for (const name of probe.decides) out.results.push({ test: name, label: TEST_LABEL[name], result: "not_run", detail: out.stoppedBecause, latencyMs: null });
    }
  }
  const view = d.registry.get(ref) ?? entry;
  const fresh = d.registry.judge(view, { callable: true, blockedReason: null, availability: "available", contextWindow: null });
  out.status = fresh.status;
  return out;
}
