import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { DecisionService } from "../decisions/service.js";
import { DIVISIONS, PARTICIPATION, type GroupService } from "./service.js";

const uuid = z.string().uuid();
const gid = (v: unknown) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, "group_not_found", "Group not found");
  return p.data;
};
const division = z.enum(DIVISIONS.map((d) => d.key) as [string, ...string[]]);

/**
 * Bot groups. Everything except /status refuses while the owner has not switched groups on. Changing the switch, creating, editing, archiving and
 * changing members are owner-only on a phone (see remote/access.ts); writing in a group and handing work over are allowed there, like chat.
 * No route lets a bot (or anyone) post as a bot: a bot's message is written by the server from a finished task.
 */
export async function registerGroupRoutes(app: FastifyInstance, groups: GroupService, decisions?: DecisionService): Promise<void> {
  app.get("/api/groups/status", async () => groups.status());
  app.put("/api/groups/enabled", async (req) => {
    groups.setEnabled(z.strictObject({ on: z.boolean() }).parse(req.body).on);
    return groups.status();
  });

  app.get("/api/groups", async (req) => {
    const q = z.object({ archived: z.enum(["0", "1", "true", "false"]).optional(), kind: z.enum(["general", "division", "project"]).optional(), division: division.optional() }).parse(req.query);
    return { groups: groups.list({ archived: q.archived === "1" || q.archived === "true", ...(q.kind ? { kind: q.kind } : {}), ...(q.division ? { division: q.division as never } : {}) }) };
  });
  app.post("/api/groups", async (req, reply) => {
    const b = z
      .strictObject({
        name: z.string(),
        description: z.string().optional(),
        avatar: z.string().optional(),
        kind: z.enum(["general", "division", "project"]).optional(),
        division: division.optional(),
        projectId: z.string().uuid().optional(),
        participationMode: z.enum(PARTICIPATION).optional(),
        maxRounds: z.number().int().optional(),
        botIds: z.array(z.string().max(80)).max(12).optional(),
      })
      .parse(req.body);
    reply.code(201);
    return { group: groups.create(b as never) };
  });
  app.get<{ Params: { id: string } }>("/api/groups/:id", async (req) => ({ group: groups.view(gid(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/groups/:id", async (req) => {
    const b = z
      .strictObject({
        name: z.string().optional(),
        description: z.string().optional(),
        avatar: z.string().optional(),
        participationMode: z.enum(PARTICIPATION).optional(),
        maxRounds: z.number().int().optional(),
        coordinatorBotId: z.string().max(80).nullable().optional(),
        modelRef: z.string().max(200).nullable().optional(),
        paused: z.boolean().optional(),
      })
      .parse(req.body);
    return { group: groups.update(gid(req.params.id), b as never) };
  });
  app.put<{ Params: { id: string } }>("/api/groups/:id/archive", async (req) => ({ group: groups.archive(gid(req.params.id), z.strictObject({ on: z.boolean() }).parse(req.body).on) }));

  app.post<{ Params: { id: string } }>("/api/groups/:id/members", async (req, reply) => {
    const b = z.strictObject({ botId: z.string().max(80), role: z.enum(["member", "reviewer", "observer"]).optional() }).parse(req.body);
    reply.code(201);
    return { group: groups.addMember(gid(req.params.id), b.botId, b.role) };
  });
  app.delete<{ Params: { id: string; botId: string } }>("/api/groups/:id/members/:botId", async (req) => ({ group: groups.removeMember(gid(req.params.id), req.params.botId) }));
  app.put<{ Params: { id: string; botId: string } }>("/api/groups/:id/members/:botId/role", async (req) => ({ group: groups.setMemberRole(gid(req.params.id), req.params.botId, z.strictObject({ role: z.enum(["member", "reviewer", "observer"]) }).parse(req.body).role) }));
  app.put<{ Params: { id: string } }>("/api/groups/:id/responsibilities", async (req) => {
    const b = z.strictObject({ botId: z.string().max(80), duty: z.string() }).parse(req.body);
    return { group: groups.assignResponsibility(gid(req.params.id), b.botId, b.duty) };
  });

  app.get<{ Params: { id: string } }>("/api/groups/:id/messages", async (req) => ({ messages: groups.messages(gid(req.params.id)) }));
  app.get<{ Params: { id: string } }>("/api/groups/:id/activity", async (req) => groups.activity(gid(req.params.id)));
  app.post<{ Params: { id: string } }>("/api/groups/:id/messages", async (req, reply) => {
    const b = z.strictObject({ content: z.string(), mentionBotIds: z.array(z.string().max(80)).max(12).optional(), directToBotId: z.string().max(80).nullable().optional() }).parse(req.body);
    reply.code(201);
    return groups.post(gid(req.params.id), b);
  });
  app.post<{ Params: { id: string } }>("/api/groups/:id/handoffs", async (req, reply) => {
    const b = z.strictObject({ fromBotId: z.string().max(80), toBotId: z.string().max(80), instruction: z.string(), sourceTaskId: z.string().uuid().optional() }).parse(req.body);
    reply.code(201);
    return groups.handoff(gid(req.params.id), b);
  });

  if (decisions) {
    // Recommendations: the group's members offer options for a question (drafts only, up to three bots, one model call each).
    app.post<{ Params: { id: string } }>("/api/groups/:id/recommendations", async (req) => {
      const id = gid(req.params.id);
      const b = z.strictObject({ question: z.string(), botIds: z.array(z.string().max(80)).max(3).optional() }).parse(req.body);
      const members = groups.memberIds(id);
      const chosen = (b.botIds?.length ? b.botIds : members).slice(0, 3);
      if (chosen.some((x) => !members.includes(x))) throw new AppError(400, "not_members", "Only active members of the group can be asked.");
      const g = groups.get(id);
      return { draft: await decisions.inquire({ question: b.question, ...(g.projectId ? { projectId: g.projectId } : {}), botIds: chosen }) };
    });
    // An unresolved disagreement (or simply a choice the owner must make) goes to the existing Decisions system; the group keeps a record of that.
    app.post<{ Params: { id: string } }>("/api/groups/:id/escalate", async (req, reply) => {
      const id = gid(req.params.id);
      const b = z.strictObject({ draftId: z.string().uuid(), title: z.string().optional() }).parse(req.body);
      const g = groups.get(id);
      const decisionId = decisions.createFromDraft(b.draftId, { ...(b.title ? { title: b.title } : {}), ...(g.projectId ? { projectId: g.projectId } : {}) });
      const decision = decisions.get(decisionId);
      groups.recordEscalation(id, decisionId, decision.title);
      reply.code(201);
      return { decision };
    });
  }
}
