import type { FastifyInstance } from "fastify";
import type { DemoService } from "./service.js";

/** Reading is open (a phone may look); creating the sample agents and workflows is owner-only (see remote/access.ts). */
export async function registerDemoRoutes(app: FastifyInstance, demo: DemoService): Promise<void> {
  app.get("/api/demo", async () => demo.status());
  app.post("/api/demo/setup", async () => demo.setup());
}
