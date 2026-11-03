import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AgentManagerRepository } from "./agent-manager/repository.js";
import { registerAgentManagerRoutes } from "./agent-manager/routes.js";
import { AgentManagerService } from "./agent-manager/service.js";
import { AppError } from "./agent-manager/types.js";
import { openDatabase } from "./db/database.js";
import { CLIENT_HEADER, registerSecurity } from "./security.js";

export interface BuildAppOptions {
  /** Path to the SQLite file, or ":memory:" for a throwaway database. */
  dbPath: string;
  logger?: boolean;
  /** Websites allowed to call the API from a browser (the dashboard's address). */
  dashboardOrigins?: string[];
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  const db = openDatabase(options.dbPath);
  app.addHook("onClose", async () => {
    db.close();
  });

  // Accept an empty body with "Content-Type: application/json" (actions like "restore" have no
  // body, and many browser clients send that header on every request). Fastify rejects it by default.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body);
    if (text.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("Invalid JSON in request body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  registerSecurity(app);
  await app.register(cors, {
    origin: options.dashboardOrigins ?? [],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["content-type", CLIENT_HEADER],
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid input",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "internal_error", message: "Something went wrong" });
  });

  app.get("/", async () => ({ message: "Hello from the AI Workforce Platform", phase: 1 }));
  app.get("/health", async () => ({ status: "ok" }));

  const service = new AgentManagerService(new AgentManagerRepository(db));
  await registerAgentManagerRoutes(app, service);

  return app;
}
