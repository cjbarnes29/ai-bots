import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GRAPH_LIMITS } from "./graph.js";
import { WORKFLOW_LIMITS, type WorkflowService } from "./service.js";

const id = z.string().uuid();
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);

/**
 * Owner-only (a phone is refused): creating, editing, switching on, archiving, duplicating and retrying a failed box.
 * Allowed from a phone: looking, pressing Run, cancelling a run, and deciding a checkpoint.
 */
export async function registerWorkflowRoutes(app: FastifyInstance, wf: WorkflowService): Promise<void> {
  app.get("/api/workflows", async (req) => {
    const q = z.strictObject({ archived: z.enum(["0", "1"]).optional() }).parse(req.query);
    return { workflows: wf.list(q.archived === "1"), runs: wf.listRuns(30), waiting: wf.waitingCheckpoints(), limits: { ...GRAPH_LIMITS, ...WORKFLOW_LIMITS } };
  });
  app.post("/api/workflows", async (req, reply) => {
    const body = z.strictObject({ name: z.string().min(1).max(GRAPH_LIMITS.name), graph: z.unknown() }).parse(req.body);
    reply.code(201);
    return { workflow: wf.create(body) };
  });
  // Checks a drawing without saving it (the editor calls this while you work).
  app.post("/api/workflows/validate", async (req) => ({ problems: wf.check(z.strictObject({ graph: z.unknown() }).parse(req.body).graph) }));
  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req) => ({ workflow: wf.get(id.parse(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/workflows/:id", async (req) => {
    const body = z.strictObject({ name: z.string().min(1).max(GRAPH_LIMITS.name).optional(), graph: z.unknown().optional(), note: z.string().max(200).optional() }).parse(req.body);
    return { workflow: wf.update(id.parse(req.params.id), body) };
  });
  app.post<{ Params: { id: string } }>("/api/workflows/:id/enable", async (req) => ({ workflow: wf.setEnabled(id.parse(req.params.id), true) }));
  app.post<{ Params: { id: string } }>("/api/workflows/:id/disable", async (req) => ({ workflow: wf.setEnabled(id.parse(req.params.id), false) }));
  app.post<{ Params: { id: string } }>("/api/workflows/:id/archive", async (req) => ({ workflow: wf.setArchived(id.parse(req.params.id), true) }));
  app.post<{ Params: { id: string } }>("/api/workflows/:id/unarchive", async (req) => ({ workflow: wf.setArchived(id.parse(req.params.id), false) }));
  app.post<{ Params: { id: string } }>("/api/workflows/:id/duplicate", async (req, reply) => {
    reply.code(201);
    return { workflow: wf.duplicate(id.parse(req.params.id)) };
  });
  app.post<{ Params: { id: string } }>("/api/workflows/:id/run", async (req, reply) => {
    const body = z.strictObject({ input: z.string().max(4000).default("") }).parse(req.body ?? {});
    const by = req.access?.device ? `device:${req.access.device.name}` : "owner";
    reply.code(202);
    const run = wf.run(id.parse(req.params.id), body.input, by);
    wf.tick();
    return { run };
  });

  app.get<{ Params: { id: string } }>("/api/workflows/runs/:id", async (req) => ({ run: wf.runView(id.parse(req.params.id)) }));
  app.post<{ Params: { id: string } }>("/api/workflows/runs/:id/cancel", async (req) => {
    const by = req.access?.device ? `device:${req.access.device.name}` : "owner";
    return { run: wf.cancel(id.parse(req.params.id), by) };
  });
  for (const verb of ["approve", "reject"] as const) {
    app.post<{ Params: { id: string; nodeId: string } }>(`/api/workflows/runs/:id/steps/:nodeId/${verb}`, async (req) => {
      const by = req.access?.device ? `device:${req.access.device.name}` : "owner";
      const run = wf.decide(id.parse(req.params.id), nodeId.parse(req.params.nodeId), verb === "approve", by);
      wf.tick();
      return { run };
    });
  }
  app.post<{ Params: { id: string; nodeId: string } }>("/api/workflows/runs/:id/steps/:nodeId/retry", async (req) => {
    const run = wf.retryStep(id.parse(req.params.id), nodeId.parse(req.params.nodeId));
    wf.tick();
    return { run };
  });
}
