import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { TEMPLATE_MAX, automationLimitsUpdateSchema, EVENT_TEXT_MAX } from "./limits.js";
import type { AutomationService } from "./service.js";
import { TIME_OF_DAY } from "./timing.js";

const idSchema = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const botId = z.string().uuid();
const instruction = z.string().trim().min(1).max(4000);
const timeOfDay = z.string().regex(TIME_OF_DAY, "must look like 09:30");
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const eventName = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/, "use letters, numbers, dots, dashes or underscores");

const createScheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ name, botId, instruction, kind: z.literal("interval"), intervalMinutes: z.number().int().min(1).max(10_080) }),
  z.strictObject({ name, botId, instruction, kind: z.literal("daily"), timeOfDay, days: days.optional() }),
  z.strictObject({ name, botId, instruction, kind: z.literal("once"), runAt: z.string().min(8).max(40) }),
]);

const updateScheduleSchema = z.strictObject({
  name: name.optional(),
  botId: botId.optional(),
  instruction: instruction.optional(),
  kind: z.enum(["interval", "daily", "once"]).optional(),
  intervalMinutes: z.number().int().min(1).max(10_080).optional(),
  timeOfDay: timeOfDay.optional(),
  days: days.optional(),
  runAt: z.string().min(8).max(40).optional(),
  enabled: z.boolean().optional(),
});

const triggerFields = {
  name,
  source: z.enum(["event", "task_result"]),
  eventName: eventName.optional(),
  watchBotId: botId.optional(),
  contains: z.string().max(200).optional(),
  botId,
  instructionTemplate: z.string().max(TEMPLATE_MAX).optional(),
  cooldownSeconds: z.number().int().min(1).max(86_400).optional(),
};
const createTriggerSchema = z.strictObject(triggerFields);
const updateTriggerSchema = z.strictObject({
  ...Object.fromEntries(Object.entries(triggerFields).map(([k, v]) => [k, v.optional()])),
  enabled: z.boolean().optional(),
} as { [K in keyof typeof triggerFields]: z.ZodOptional<(typeof triggerFields)[K]> } & { enabled: z.ZodOptional<z.ZodBoolean> });

const eventSchema = z.strictObject({ name: eventName, text: z.string().max(EVENT_TEXT_MAX + 1) });
const pauseSchema = z.strictObject({ paused: z.boolean() });
const runsQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function parseId(value: unknown, code: string, message: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, code, message);
  return parsed.data;
}

export async function registerAutomationRoutes(app: FastifyInstance, service: AutomationService): Promise<void> {
  type Params = { Params: { id: string } };
  const scheduleId = (v: string) => parseId(v, "schedule_not_found", "Schedule not found");
  const triggerId = (v: string) => parseId(v, "trigger_not_found", "Trigger not found");

  // ---- the global switch, limits and the run log ----
  app.get("/api/automation/status", async () => service.status());

  app.put("/api/automation/pause", async (req) => {
    service.setPaused(pauseSchema.parse(req.body).paused);
    return service.status();
  });

  app.put("/api/automation/limits", async (req) => {
    service.updateLimits(automationLimitsUpdateSchema.parse(req.body));
    return service.status();
  });

  app.post("/api/automation/limits/reset", async () => {
    service.resetLimits();
    return service.status();
  });

  app.get("/api/automation/runs", async (req) => ({ runs: service.listRuns(runsQuery.parse(req.query).limit) }));

  // ---- schedules ----
  app.get("/api/schedules", async () => ({ schedules: service.listSchedules() }));

  app.post("/api/schedules", async (req, reply) => {
    const schedule = service.createSchedule(createScheduleSchema.parse(req.body));
    return reply.code(201).send({ schedule });
  });

  app.get<Params>("/api/schedules/:id", async (req) => ({ schedule: service.getSchedule(scheduleId(req.params.id)) }));

  app.patch<Params>("/api/schedules/:id", async (req) => ({
    schedule: service.updateSchedule(scheduleId(req.params.id), updateScheduleSchema.parse(req.body)),
  }));

  app.delete<Params>("/api/schedules/:id", async (req, reply) => {
    service.deleteSchedule(scheduleId(req.params.id));
    return reply.code(204).send();
  });

  app.post<Params>("/api/schedules/:id/run-now", async (req) => ({ outcome: service.runScheduleNow(scheduleId(req.params.id)) }));

  // ---- triggers ----
  app.get("/api/triggers", async () => ({ triggers: service.listTriggers() }));

  app.post("/api/triggers", async (req, reply) => {
    const trigger = service.createTrigger(createTriggerSchema.parse(req.body));
    return reply.code(201).send({ trigger });
  });

  app.get<Params>("/api/triggers/:id", async (req) => ({ trigger: service.getTrigger(triggerId(req.params.id)) }));

  app.patch<Params>("/api/triggers/:id", async (req) => ({
    trigger: service.updateTrigger(triggerId(req.params.id), updateTriggerSchema.parse(req.body)),
  }));

  app.delete<Params>("/api/triggers/:id", async (req, reply) => {
    service.deleteTrigger(triggerId(req.params.id));
    return reply.code(204).send();
  });

  // ---- text events (the test form now; Telegram and Gmail in the future) ----
  app.post("/api/events", async (req) => {
    const body = eventSchema.parse(req.body);
    return { outcomes: service.handleEvent(body.name, body.text) };
  });
}
