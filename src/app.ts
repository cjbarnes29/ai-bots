import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AgentManagerRepository } from "./agent-manager/repository.js";
import { registerAgentManagerRoutes } from "./agent-manager/routes.js";
import { AgentManagerService } from "./agent-manager/service.js";
import { ChatRepository } from "./chat/repository.js";
import { registerChatRoutes } from "./chat/routes.js";
import { ChatService } from "./chat/service.js";
import { openDatabase } from "./db/database.js";
import { dirname, join, resolve } from "node:path";
import { ApprovalRepository } from "./approvals/repository.js";
import { registerApprovalRoutes } from "./approvals/routes.js";
import { ActionGate } from "./approvals/service.js";
import { AuditLog } from "./audit/audit.js";
import { ConnectorRegistry, type ConnectorDefinition } from "./connectors/types.js";
import { setSecretLookup } from "./llm/secrets.js";
import { loadOrCreateKeyFile, newEphemeralKey } from "./vault/crypto.js";
import { registerVaultRoutes } from "./vault/routes.js";
import { VaultService } from "./vault/service.js";
import { AutomationRepository } from "./automation/repository.js";
import { registerAutomationRoutes } from "./automation/routes.js";
import { AutomationScheduler } from "./automation/scheduler.js";
import { AutomationService } from "./automation/service.js";
import { TaskEngine } from "./delegation/engine.js";
import { TaskRepository } from "./delegation/repository.js";
import { registerDelegationRoutes } from "./delegation/routes.js";
import { DelegationService } from "./delegation/service.js";
import { AppError } from "./errors.js";
import { ModelCatalogService } from "./llm/catalog.js";
import { defaultProviderFactory, type ProviderFactory } from "./llm/factory.js";
import { LlmRepository } from "./llm/repository.js";
import { registerLlmRoutes } from "./llm/routes.js";
import { LlmService } from "./llm/service.js";
import { UsageRepository } from "./llm/usage.js";
import { createRuntimeRegistry } from "./runtimes/registry.js";
import { CLIENT_HEADER, registerSecurity } from "./security.js";

declare module "fastify" {
  interface FastifyInstance {
    /** The automation clock. The real server starts it; tests call `tick()` by hand. */
    automation: AutomationScheduler;
  }
}

export interface BuildAppOptions {
  /** Path to the SQLite file, or ":memory:" for a throwaway database. */
  dbPath: string;
  logger?: boolean;
  /** Websites allowed to call the API from a browser (the dashboard's address). */
  dashboardOrigins?: string[];
  /** Tests can supply their own provider connections, a fake clock and a fake sleep. */
  providerFactory?: ProviderFactory;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Connectors bots may use through the approval gate. Empty in the real app until Phases 6 to 8. */
  connectors?: ConnectorDefinition[];
  /** The vault's encryption key. Default: a key file next to the database (or a throwaway key for ":memory:"). */
  vaultKey?: Buffer;
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

  app.get("/", async () => ({ message: "Hello from the AI Workforce Platform", phase: 2 }));
  app.get("/health", async () => ({ status: "ok" }));

  // ---- AI models (providers, models, limits, usage) ----
  const now = options.clock ?? Date.now;
  const llmRepo = new LlmRepository(db);
  const usageRepo = new UsageRepository(db);
  const factory = options.providerFactory ?? defaultProviderFactory;
  const catalog = new ModelCatalogService(llmRepo, usageRepo, factory, now);
  catalog.ensureProviders();
  const llm = new LlmService(llmRepo, usageRepo, catalog, factory, {
    now,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });

  // ---- Agent Manager (a bot's model is checked against the catalog) ----
  const agentService = new AgentManagerService(new AgentManagerRepository(db), (ref) => catalog.validateModelRef(ref));
  await registerAgentManagerRoutes(app, agentService);
  await registerLlmRoutes(app, { catalog, llm, usage: usageRepo, now });

  // ---- Test chat: bots reply only when you send a message. No tools. ----
  const chat = new ChatService(new ChatRepository(db), (id) => agentService.getBot(id), createRuntimeRegistry(llm), llm, now);
  await registerChatRoutes(app, chat);

  // ---- Collaboration: bots hand text tasks to teammates you allow (nobody, by default) ----
  // ---- Secrets vault, audit log and the approval gate (Phase 5). The connector list is EMPTY in the real app
  // until Phases 6 to 8, so no bot can reach anything outside. Tests and test harnesses can supply fake connectors. ----
  const audit = new AuditLog(db, now);
  const vaultKey =
    options.vaultKey ?? (options.dbPath === ":memory:" ? newEphemeralKey() : loadOrCreateKeyFile(join(dirname(resolve(options.dbPath)), "vault.key")));
  const registry = new ConnectorRegistry(options.connectors ?? []);
  const vault = new VaultService(db, vaultKey, audit, () => registry.list().flatMap((c) => c.secrets ?? []), now);
  setSecretLookup((name) => vault.getStored(name));
  app.addHook("onClose", async () => setSecretLookup(null));
  await registerVaultRoutes(app, vault);
  const gate = new ActionGate({
    repo: new ApprovalRepository(db),
    registry,
    audit,
    vault,
    getBot: (id) => agentService.getBot(id),
    readEnabled: (botId, connector) => agentService.getBot(botId).permissions.some((p) => p.connector === connector && p.readEnabled),
    now,
  });
  await registerApprovalRoutes(app, gate, audit);

  const taskRepo = new TaskRepository(db);
  let automation: AutomationService | undefined; // created just below; the engine tells it when a chain ends
  const engine = new TaskEngine({
    tasks: taskRepo,
    getBot: (id) => agentService.getBot(id),
    llm,
    now,
    actions: gate,
    onRootFinished: (task) => automation?.onRootFinished(task),
  });
  engine.recoverInterrupted();
  await registerDelegationRoutes(app, new DelegationService(taskRepo, engine, (id) => agentService.getBot(id), now), engine);

  // ---- Automation: schedules and text triggers. They start tasks through the engine above, so every
  // limit, the pause switches and the free-only gate apply. The clock is started by server.ts, not here. ----
  automation = new AutomationService({ repo: new AutomationRepository(db), engine, llm, getBot: (id) => agentService.getBot(id), now });
  const scheduler = new AutomationScheduler(automation);
  app.decorate("automation", scheduler);
  app.addHook("onClose", async () => scheduler.stop());
  await registerAutomationRoutes(app, automation);

  return app;
}
