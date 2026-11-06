import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CapabilityService } from "./service.js";

const assessSchema = z.strictObject({ goal: z.string().min(1).max(4000) });

/** All read-only. Assessing a goal records one audit line (kind capability.assessed) with a short clip of the wording and the verdict, never a secret. */
export async function registerCapabilityRoutes(app: FastifyInstance, svc: CapabilityService, audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void }): Promise<void> {
  app.get("/api/capabilities", async () => svc.view());
  app.get("/api/capabilities/changes", async (req) => ({ changes: svc.changes(Number((req.query as { limit?: string }).limit) || 30) }));
  app.post("/api/capabilities/refresh", async () => svc.view(true));
  app.post("/api/capabilities/assess", async (req) => {
    const { goal } = assessSchema.parse(req.body);
    const assessment = await svc.assess(goal);
    audit.record("capability.assessed", { classification: assessment.classification, blockers: assessment.blockers, goal: goal.slice(0, 120) }, { actor: "system" });
    return { assessment };
  });
}
