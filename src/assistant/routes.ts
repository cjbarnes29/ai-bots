import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { PROOF_HEADER } from "../remote/access.js";
import type { AssistantActions } from "./actions.js";
import { canYouAnswer, isOverviewQuestion, overviewAnswer, canYouGoal } from "../capabilities/explain.js";
import type { CapabilityService } from "../capabilities/service.js";
import { locate, type LocateResult } from "./locate.js";
import { overview, suggest } from "./suggestions.js";

const uuid = z.string().uuid();
const aid = (v: unknown) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, "action_not_found", "That action does not exist.");
  return p.data;
};

type Row = Record<string, unknown>;
/** Only whole requests for a status report (never a sentence that merely contains "summary"). */
const OVERVIEW = /^(?:please\s+)?(?:(?:show|give|get)\s+me\s+)?(?:the\s+|a\s+)?(?:status|overview|summary)(?:\s+of\s+(?:everything|my workforce|things))?\s*\??$|^(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:status|happening|going\s+on|new))\b|^how\s+(?:are|is)\s+(?:things|everything|my\s+workforce)\b|^catch\s+me\s+up\b|^anything\s+(?:new|wrong)\b/i;
const WHY_FAILED = /\bwhy\b.*\b(fail|failed|failing|error|broke|broken|didn'?t work)\b/i;

/**
 * The AI Assistant's understanding of a request, in this order: (1) an editing request (safe / review / restricted), (2) "why did it fail", (3) an
 * overview, (4) locate and open. If none fits, the dashboard sends the text to the chosen agent's model as ordinary chat.
 * Reading routes are open; confirming, rejecting and undoing a change are owner acts (a phone is refused, see remote/access.ts).
 */
export async function registerAssistantRoutes(app: FastifyInstance, a: AssistantActions, db: DatabaseSync, now: () => number = Date.now, checkProof?: (token: string) => Promise<boolean>, capabilities?: CapabilityService): Promise<void> {
  app.post("/api/assistant/interpret", async (req) => {
    const { text } = z.strictObject({ text: z.string().min(1).max(2000) }).parse(req.body);
    // Looking things up is open. Anything that would CHANGE or PROPOSE a change is an owner act, exactly like the routes it stands in for
    // (PATCH /api/projects/:id, PATCH /api/knowledge/docs/:id): refused from a phone, and it needs the Guardian passphrase proof when one is configured.
    const guard = async () => {
      if (req.access?.mode === "remote") throw new AppError(403, "owner_only", "This can only be changed on the PC.");
      if (checkProof) {
        const token = req.headers[PROOF_HEADER];
        if (typeof token !== "string" || !(await checkProof(token))) throw new AppError(403, "proof_required", "Enter your owner passphrase to do this. It is checked by the Guardian, not by the app.");
      }
    };
    const acted = await a.interpret(text, guard);
    if (acted.handled) return { kind: "action" as const, ...acted };
    if (WHY_FAILED.test(text)) {
      const t = db.prepare("SELECT t.id, t.instruction, t.error_message, t.error_code, b.name AS bot FROM tasks t JOIN bots b ON b.id = t.assignee_bot_id WHERE t.status = 'failed' ORDER BY t.finished_at DESC LIMIT 1").get() as Row | undefined;
      if (t) {
        const reason = t["error_message"] ? String(t["error_message"]).slice(0, 400) : "No reason was recorded.";
        return { kind: "explain" as const, handled: true, message: `Your latest failed task was "${String(t["instruction"]).slice(0, 80)}" (agent ${String(t["bot"])}). Recorded reason: ${reason}`, link: { label: "Open the task", to: `/tasks/${String(t["id"])}` } };
      }
      return { kind: "explain" as const, handled: true, message: "I found no failed task, so there is nothing to explain." };
    }
    // "What can you do?" and "can you X?" are answered from the LIVE capability registry on every ask (no copy, no cache), never from memory or a model.
    if (capabilities) {
      const goal = canYouGoal(text);
      if (isOverviewQuestion(text)) {
        const caps = await capabilities.list();
        return { kind: "capabilities" as const, handled: true, checkedAt: new Date(now()).toISOString(), ...overviewAnswer(caps) };
      }
      if (goal) {
        const answer = canYouAnswer(goal, await capabilities.list());
        if (answer) return { kind: "capabilities" as const, handled: true, checkedAt: new Date(now()).toISOString(), ...answer };
      }
    }
    if (OVERVIEW.test(text) && text.split(/\s+/).length <= 10) return { kind: "overview" as const, handled: true, ...overview(db, now()) };
    const found: LocateResult = locate(db, text, now());
    if (found.handled) return { kind: "locate" as const, ...found };
    return { kind: "none" as const, handled: false };
  });

  app.get("/api/assistant/suggestions", async () => ({ suggestions: suggest(db, now()) }));
  app.get("/api/assistant/actions", async () => ({ actions: a.list() }));
  app.post<{ Params: { id: string } }>("/api/assistant/actions/:id/confirm", async (req) => a.confirm(aid(req.params.id)));
  app.post<{ Params: { id: string } }>("/api/assistant/actions/:id/reject", async (req) => ({ action: a.reject(aid(req.params.id)) }));
  app.post<{ Params: { id: string } }>("/api/assistant/actions/:id/undo", async (req) => a.undo(aid(req.params.id)));
}
