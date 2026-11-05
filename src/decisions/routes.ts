import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { DecisionInsights } from "./collaboration.js";
import type { DecisionService } from "./service.js";

const uuid = z.string().uuid();
const did = (v: unknown) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, "decision_not_found", "Decision not found");
  return p.data;
};
const option = z.strictObject({ title: z.string(), details: z.string().optional(), pros: z.string().optional(), cons: z.string().optional() });

/**
 * Decisions. The body of NO route can name a bot as the one who chooses, approves or rejects: those acts are the owner's, and approving, choosing and
 * rejecting also need the owner proof on the PC (see remote/access.ts). Bots contribute only through the model calls that inquire() and reviewRound()
 * make on the owner's request, and through the reports written from their real tasks.
 */
export async function registerDecisionRoutes(app: FastifyInstance, decisions: DecisionService, insights?: DecisionInsights): Promise<void> {
  app.get("/api/decisions", async (req) => {
    const q = z.object({ status: z.enum(["open", "chosen", "approved", "in_progress", "done", "rejected", "archived"]).optional(), projectId: z.string().max(80).optional() }).parse(req.query);
    return { decisions: decisions.list({ ...(q.status ? { status: q.status } : {}), ...(q.projectId ? { projectId: q.projectId } : {}) }) };
  });

  // Ask the relevant bots for options. Saves nothing.
  app.post("/api/decisions/inquire", async (req) => {
    const b = z.strictObject({ question: z.string(), projectId: z.string().uuid().nullable().optional(), botIds: z.array(z.string().max(80)).max(3).optional() }).parse(req.body);
    return { draft: await decisions.inquire({ question: b.question, ...(b.projectId !== undefined ? { projectId: b.projectId } : {}), ...(b.botIds ? { botIds: b.botIds } : {}) }) };
  });

  // Put a draft (or the owner's own options) on the chalkboard.
  app.post("/api/decisions", async (req, reply) => {
    const b = z.union([
      z.strictObject({ draftId: z.string().uuid(), title: z.string().optional(), projectId: z.string().uuid().nullable().optional() }),
      z.strictObject({ title: z.string(), question: z.string().optional(), options: z.array(option).min(2).max(12), projectId: z.string().uuid().nullable().optional() }),
    ]).parse(req.body);
    const id = "draftId" in b ? decisions.createFromDraft(b.draftId, { ...(b.title ? { title: b.title } : {}), ...(b.projectId !== undefined ? { projectId: b.projectId } : {}) }) : decisions.createManual({ title: b.title, ...(b.question ? { question: b.question } : {}), options: b.options.map((o) => ({ title: o.title, details: o.details ?? "", pros: o.pros ?? "", cons: o.cons ?? "" })), ...(b.projectId !== undefined ? { projectId: b.projectId } : {}) });
    reply.code(201);
    return { decision: decisions.get(id) };
  });

  app.get<{ Params: { id: string } }>("/api/decisions/:id", async (req) => ({ decision: decisions.get(did(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/decisions/:id", async (req) => {
    const id = did(req.params.id);
    const b = z.strictObject({ title: z.string().optional(), ownerNote: z.string().optional() }).parse(req.body);
    decisions.setTitleOrNote(id, b);
    return { decision: decisions.get(id) };
  });

  app.post<{ Params: { id: string } }>("/api/decisions/:id/options", async (req, reply) => {
    const id = did(req.params.id);
    const o = option.parse(req.body);
    decisions.addOption(id, { title: o.title, details: o.details ?? "", pros: o.pros ?? "", cons: o.cons ?? "" });
    reply.code(201);
    return { decision: decisions.get(id) };
  });
  app.patch<{ Params: { id: string; optionId: string } }>("/api/decisions/:id/options/:optionId", async (req) => {
    const id = did(req.params.id);
    decisions.editOption(id, req.params.optionId, option.partial().parse(req.body) as Partial<{ title: string; details: string; pros: string; cons: string }>);
    return { decision: decisions.get(id) };
  });
  app.delete<{ Params: { id: string; optionId: string } }>("/api/decisions/:id/options/:optionId", async (req) => {
    const id = did(req.params.id);
    decisions.removeOption(id, req.params.optionId);
    return { decision: decisions.get(id) };
  });

  app.post<{ Params: { id: string } }>("/api/decisions/:id/participants", async (req, reply) => {
    const id = did(req.params.id);
    decisions.addParticipant(id, z.strictObject({ botId: z.string().max(80) }).parse(req.body).botId);
    reply.code(201);
    return { decision: decisions.get(id) };
  });

  // The owner's acts.
  app.put<{ Params: { id: string } }>("/api/decisions/:id/choice", async (req) => {
    const id = did(req.params.id);
    const b = z.strictObject({ optionId: z.string().max(80).nullable(), note: z.string().max(4000).optional() }).parse(req.body);
    decisions.choose(id, b.optionId, b.note);
    return { decision: decisions.get(id) };
  });
  app.post<{ Params: { id: string } }>("/api/decisions/:id/review", async (req) => {
    const id = did(req.params.id);
    const round = await decisions.reviewRound(id);
    return { round, decision: decisions.get(id) };
  });
  app.post<{ Params: { id: string } }>("/api/decisions/:id/approve", async (req) => {
    const id = did(req.params.id);
    const b = z
      .strictObject({ assignments: z.array(z.strictObject({ botId: z.string().max(80), duty: z.string() })).max(5).optional(), projectId: z.string().uuid().nullable().optional(), newProjectName: z.string().max(80).optional() })
      .parse(req.body ?? {});
    const out = decisions.approve(id, { ...(b.assignments ? { assignments: b.assignments } : {}), ...(b.projectId !== undefined ? { projectId: b.projectId } : {}), ...(b.newProjectName ? { newProjectName: b.newProjectName } : {}) });
    return out;
  });
  app.post<{ Params: { id: string } }>("/api/decisions/:id/reject", async (req) => {
    const id = did(req.params.id);
    decisions.reject(id, z.strictObject({ note: z.string().max(4000).optional() }).parse(req.body ?? {}).note ?? "");
    return { decision: decisions.get(id) };
  });
  app.post<{ Params: { id: string } }>("/api/decisions/:id/reopen", async (req) => (decisions.reopen(did(req.params.id)), { decision: decisions.get(did(req.params.id)) }));
  app.post<{ Params: { id: string } }>("/api/decisions/:id/archive", async (req) => (decisions.archive(did(req.params.id)), { decision: decisions.get(did(req.params.id)) }));

  app.post<{ Params: { id: string } }>("/api/decisions/:id/assignments", async (req, reply) => {
    const id = did(req.params.id);
    const b = z.strictObject({ botId: z.string().max(80), duty: z.string() }).parse(req.body);
    const outcome = decisions.assign(id, b.botId, b.duty);
    reply.code(201);
    return { outcome, decision: decisions.get(id) };
  });
  app.post<{ Params: { id: string; botId: string } }>("/api/decisions/:id/assignments/:botId/start", async (req) => ({ outcome: decisions.start(did(req.params.id), req.params.botId) }));
  app.post<{ Params: { id: string; botId: string } }>("/api/decisions/:id/assignments/:botId/repair", async (req) => ({ outcome: decisions.repair(did(req.params.id), req.params.botId) }));

  if (insights) {
    // Versions of an option's wording (the original, then each owner edit with its exact changes) and which one was approved.
    app.get<{ Params: { id: string; optionId: string } }>("/api/decisions/:id/options/:optionId/versions", async (req) => {
      const id = did(req.params.id);
      return { versions: insights.optionVersions(id, req.params.optionId), approved: insights.approvedVersion(id) };
    });
    // What each bot was actually told and what came back.
    app.get<{ Params: { id: string } }>("/api/decisions/:id/execution", async (req) => ({ execution: insights.executionRecord(did(req.params.id)), approved: insights.approvedVersion(did(req.params.id)) }));
    // Whether the bots agree, from their recorded views only. Reading never writes; POST records the outcome in the decision history.
    app.get<{ Params: { id: string } }>("/api/decisions/:id/consensus", async (req) => ({ consensus: insights.evaluate(did(req.params.id)), outcome: insights.lastOutcome(did(req.params.id)) }));
    app.post<{ Params: { id: string } }>("/api/decisions/:id/consensus", async (req) => ({ consensus: insights.record(did(req.params.id)) }));
    // The Manager's loop: review rounds (at most two in total), consensus check after each, then escalate to the owner. Starts only when the owner asks.
    app.post<{ Params: { id: string } }>("/api/decisions/:id/collaborate", async (req) => {
      const id = did(req.params.id);
      const out = await insights.collaborate(id);
      return { ...out, decision: decisions.get(id) };
    });
  }
}
