import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentManagerService } from "../agent-manager/service.js";
import { AppError } from "../errors.js";
import type { AuditLog } from "../audit/audit.js";
import type { CompleteInput, CompleteOutput } from "../llm/service.js";
import { autoRef } from "../routing/config.js";
import { buildDraftMessages, parseDraft } from "./draft.js";
import { BotModes, MODES, MODE_INFO } from "./modes.js";
import { checkImport, exportFile, portableFileSchema } from "./portable.js";
import { BOT_TEMPLATES, templateById } from "./templates.js";

/**
 * Bot Studio routes. Creating anything here goes through the EXISTING Agent Manager, so every rule of it applies: new bots are disabled, have no model
 * and every permission OFF. Read-only routes are open to a paired phone; every route that creates or changes something is owner-only (see remote/access.ts).
 */
export interface BotStudioDeps {
  agents: AgentManagerService;
  modes: BotModes;
  audit: AuditLog;
  complete: (input: CompleteInput) => Promise<CompleteOutput>;
}

const actorOf = (req: { access?: { device?: { name: string } | null } }) => (req.access?.device ? `device:${req.access.device.name}` : "owner");

export async function registerBotStudioRoutes(app: FastifyInstance, d: BotStudioDeps): Promise<void> {
  app.get("/api/bot-studio/templates", async () => ({ templates: BOT_TEMPLATES }));

  app.post<{ Params: { id: string } }>("/api/bot-studio/templates/:id/create", async (req, reply) => {
    const tpl = templateById(req.params.id);
    if (!tpl) throw new AppError(404, "template_not_found", "That template does not exist.");
    const body = z.strictObject({ name: z.string().trim().min(1).max(80).optional() }).parse(req.body ?? {});
    const bot = d.agents.createBot({ name: body.name ?? tpl.name, role: tpl.role, personality: tpl.personality, instructions: tpl.instructions, responsibilities: tpl.responsibilities, changeNote: `Created from the "${tpl.name}" template` });
    d.audit.record("bot_studio.create_from_template", { botId: bot.id, template: tpl.id }, { actor: actorOf(req) });
    return reply.code(201).send({ bot, suggestedMode: tpl.suggestedMode, suggests: tpl.suggests });
  });

  app.get<{ Params: { id: string } }>("/api/bot-studio/bots/:id/export", async (req) => {
    const bot = d.agents.getBot(z.string().uuid().parse(req.params.id));
    d.audit.record("bot_studio.export", { botId: bot.id }, { actor: actorOf(req) });
    return exportFile({ name: bot.name, role: bot.role, personality: bot.personality, instructions: bot.instructions, responsibilities: bot.responsibilities, temperature: bot.temperature, maxOutputTokens: bot.maxOutputTokens });
  });

  const importBody = z.strictObject({ text: z.string().min(1).max(110_000) });
  app.post("/api/bot-studio/import/preview", async (req) => checkImport(importBody.parse(req.body).text));
  app.post("/api/bot-studio/import", async (req, reply) => {
    const check = checkImport(importBody.parse(req.body).text);
    if (!check.ok || !check.bot) {
      d.audit.record("bot_studio.import_refused", { problems: check.problems.map((p) => p.slice(0, 120)) }, { actor: actorOf(req) });
      throw new AppError(400, "import_refused", check.problems.join(" "));
    }
    const b = check.bot;
    const bot = d.agents.createBot({ name: b.name, role: b.role, personality: b.personality, instructions: b.instructions, responsibilities: b.responsibilities, temperature: b.temperature, maxOutputTokens: b.maxOutputTokens, changeNote: "Imported from a bot file" });
    d.audit.record("bot_studio.import", { botId: bot.id }, { actor: actorOf(req) });
    return reply.code(201).send({ bot, warnings: check.warnings });
  });

  app.post("/api/bot-studio/draft", async (req) => {
    const body = z.strictObject({ description: z.string().min(1).max(5000), modelRef: z.string().max(200).optional() }).parse(req.body);
    const messages = buildDraftMessages(body.description);
    const out = await d.complete({ botId: null, conversationId: null, modelRef: body.modelRef ?? autoRef("general"), messages, temperature: 0.4, maxOutputTokens: 1500, contract: { name: "a bot configuration", check: (t) => { try { parseDraft(t); return null; } catch (e) { return e instanceof Error ? e.message : "unreadable"; } } } });
    const result = parseDraft(out.text);
    d.audit.record("bot_studio.draft", { model: `${out.providerId}/${out.modelId}`, saved: false }, { actor: actorOf(req) });
    return { ...result, model: `${out.providerId}/${out.modelId}` };
  });

  app.get("/api/bot-studio/modes", async () => ({
    modes: MODES.map((m) => ({ id: m, ...MODE_INFO[m] })),
    assignments: d.modes.list(),
    note: "A mode only limits what a bot may ask for. It never grants a permission.",
  }));
  app.put<{ Params: { id: string } }>("/api/bot-studio/bots/:id/mode", async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    d.agents.getBot(id);
    const body = z.strictObject({ mode: z.enum(MODES).nullable() }).parse(req.body);
    const before = d.modes.get(id);
    d.modes.set(id, body.mode);
    d.audit.record("bot_studio.mode", { botId: id, before, after: body.mode }, { actor: actorOf(req) });
    return { botId: id, mode: body.mode };
  });
  void portableFileSchema;
}
