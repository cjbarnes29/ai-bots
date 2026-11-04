import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ToolRegistry } from "../tools/registry.js";
import { SKILL_LIMITS, skillContentSchema, type SkillService } from "./service.js";

const id = z.string().uuid();
const toolIdList = z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(40);

/** Everything that changes skills or tool access is owner-only (see src/remote/access.ts): skills become part of a bot's prompt. */
export async function registerSkillRoutes(app: FastifyInstance, skills: SkillService, tools: ToolRegistry): Promise<void> {
  app.get("/api/tools", async () => ({ tools: await tools.list() }));
  app.post("/api/tools/refresh", async () => ({ tools: await tools.refresh() }));

  app.get("/api/skills", async (req) => {
    const q = z.strictObject({ archived: z.enum(["0", "1"]).optional() }).parse(req.query);
    return { skills: await skills.list(q.archived === "1"), limits: SKILL_LIMITS };
  });
  app.post("/api/skills", async (req, reply) => {
    reply.code(201);
    return { skill: await skills.create(req.body) };
  });
  app.post("/api/skills/import", async (req, reply) => {
    reply.code(201);
    return { skill: await skills.importSkill(req.body) };
  });
  app.get<{ Params: { id: string } }>("/api/skills/:id", async (req) => ({ skill: await skills.get(id.parse(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/skills/:id", async (req) => ({ skill: await skills.update(id.parse(req.params.id), req.body) }));
  app.post<{ Params: { id: string } }>("/api/skills/:id/duplicate", async (req, reply) => {
    reply.code(201);
    return { skill: await skills.duplicate(id.parse(req.params.id)) };
  });
  app.post<{ Params: { id: string } }>("/api/skills/:id/archive", async (req) => ({ skill: await skills.setArchived(id.parse(req.params.id), true) }));
  app.post<{ Params: { id: string } }>("/api/skills/:id/unarchive", async (req) => ({ skill: await skills.setArchived(id.parse(req.params.id), false) }));
  app.post<{ Params: { id: string } }>("/api/skills/:id/restore", async (req) => {
    const body = z.strictObject({ version: z.number().int().min(1) }).parse(req.body);
    return { skill: await skills.restoreVersion(id.parse(req.params.id), body.version) };
  });
  app.get<{ Params: { id: string } }>("/api/skills/:id/export", async (req) => ({ file: skills.exportSkill(id.parse(req.params.id)) }));
  app.post<{ Params: { id: string } }>("/api/skills/:id/test", async (req) => {
    const body = z.strictObject({ input: z.string().max(SKILL_LIMITS.testInput + 1), modelRef: z.string().max(200).optional() }).parse(req.body);
    return { result: await skills.test(id.parse(req.params.id), body.input, body.modelRef) };
  });

  app.get<{ Params: { id: string } }>("/api/bots/:id/capabilities", async (req) => {
    const botId = id.parse(req.params.id);
    return { skills: skills.assignedTo(botId), tools: skills.toolsOf(botId) };
  });
  app.put<{ Params: { id: string } }>("/api/bots/:id/skills", async (req) => {
    const body = z.strictObject({ skillIds: z.array(id).max(SKILL_LIMITS.maxPerBot) }).parse(req.body);
    return { skills: skills.setBotSkills(id.parse(req.params.id), body.skillIds) };
  });
  app.put<{ Params: { id: string } }>("/api/bots/:id/tools", async (req) => {
    const body = z.strictObject({ toolIds: toolIdList }).parse(req.body);
    return { tools: await skills.setBotTools(id.parse(req.params.id), body.toolIds) };
  });
}

export { skillContentSchema };
