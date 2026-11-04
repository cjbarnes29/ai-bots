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
import { createBrowserConnector } from "./connectors/browser/browser.js";
import { createGmailConnector, registerGmailOAuthRoutes, type GoogleUrls } from "./connectors/gmail.js";
import { createTelegramConnector } from "./connectors/telegram.js";
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
import { CLIENT_HEADER } from "./security.js";
import { registerAccess } from "./remote/access.js";
import { DeviceService } from "./remote/devices.js";
import { registerDashboard } from "./remote/dashboard.js";
import { registerRemoteRoutes } from "./remote/routes.js";
import { registerMonitorRoutes } from "./monitor/monitor.js";
import { registerInboundRoutes } from "./inbound/routes.js";
import { ManagerService } from "./manager/service.js";
import { registerManagerRoutes } from "./manager/routes.js";
import { createDocumentsConnector } from "./connectors/documents.js";
import { createPcConnector } from "./connectors/pc/connector.js";
import { registerPcRoutes } from "./connectors/pc/routes.js";
import { PcService } from "./connectors/pc/service.js";
import { registerWorkflowRoutes } from "./workflows/routes.js";
import { WorkflowService } from "./workflows/service.js";
import { SkillService } from "./skills/service.js";
import { registerSkillRoutes } from "./skills/routes.js";
import { ToolRegistry, realRunner, type CommandRunner } from "./tools/registry.js";
import { ModelRouter } from "./routing/router.js";
import { RoutingMaintenance, registerRoutingRoutes } from "./routing/routes.js";
import { autoRef, loadRouting, saveRouting } from "./routing/config.js";
import { PushService, PUSH_SECRET_NAME } from "./push/push.js";
import { registerPushRoutes } from "./push/routes.js";
import { InboundService } from "./inbound/service.js";

declare module "fastify" {
  interface FastifyInstance {
    /** The automation clock. The real server starts it; tests call `tick()` by hand. */
    automation: AutomationScheduler;
    /** Phone alerts. The real server sends them with the clock; tests call `push.tick()` by hand. */
    push: PushService;
    /** The Manager AI. */
    manager: ManagerService;
    /** The tool registry and skill library. */
    skills: SkillService;
    /** Workflows (boxes and arrows) and their run queue. */
    workflows: WorkflowService;
    /** The PC agent (workspaces, permissions, emergency stop, log). */
    pc: PcService;
    tools: ToolRegistry;
    /** Inbound message sources. The real server checks them with the clock; tests call `inbound.tick()` by hand. */
    inbound: InboundService;
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
  /** Connectors bots may use through the approval gate. Default: Telegram only (needs a saved token to do anything). */
  connectors?: ConnectorDefinition[];
  /** Tests only: where the Gmail sign-in and API live (a fake Google on this PC). The real app always uses Google's own addresses. */
  googleUrls?: GoogleUrls;
  /** The vault's encryption key. Default: a key file next to the database (or a throwaway key for ":memory:"). */
  vaultKey?: Buffer;
  /** Tests: start with these routing settings instead of the defaults. */
  routingDefaults?: Partial<import("./routing/config.js").RoutingConfig>;
  /** Tests only: accept a pretend push service on this PC, and use a fake network call for alerts. */
  pushAllowHost?: (host: string) => boolean;
  pushFetch?: typeof fetch;
  /** Tests: how often the Manager looks at a specialist's task. */
  managerPollMs?: number;
  /** Tests: stands in for running 'git --version' and similar fixed checks on this PC. */
  toolRunner?: CommandRunner;
  /** Tests: add the PC agent connector to the connectors given above (the real app always has it). */
  includePc?: boolean;
  /** Tests: start programs with a fake instead of the real thing. */
  pcStart?: (spec: import("./connectors/pc/runner.js").RunSpec) => import("./connectors/pc/runner.js").PcProcess;
  /** Tailscale names (*.ts.net) the phone may use. Empty = remote access is off and only this PC can connect. */
  remoteHosts?: string[];
  /** Folder with the built dashboard (web/dist). When given, the app serves the dashboard itself. */
  dashboardDir?: string;
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

  // Who is asking: this PC, a paired phone (only when remote access is switched on), or nobody (refused).
  const now = options.clock ?? Date.now;
  const audit = new AuditLog(db, now);
  const remoteHosts = options.remoteHosts ?? [];
  const devices = new DeviceService(db, audit, now);
  registerAccess(app, { remoteHosts, devices, audit });
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

  if (!options.dashboardDir) app.get("/", async () => ({ message: "Hello from the AI Workforce Platform", phase: 2 }));
  app.get("/health", async () => ({ status: "ok" }));

  // ---- AI models (providers, models, limits, usage) ----
  const llmRepo = new LlmRepository(db);
  const usageRepo = new UsageRepository(db);
  const factory = options.providerFactory ?? defaultProviderFactory;
  const catalog = new ModelCatalogService(llmRepo, usageRepo, factory, now, audit);
  catalog.ensureProviders();
  const llm = new LlmService(llmRepo, usageRepo, catalog, factory, {
    now,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });

  // ---- Agent Manager (a bot's model is checked against the catalog) ----
  // Stage 1: universal model routing. "auto/<kind of task>" bots get an explicit free model chosen per call, with failover.
  if (options.routingDefaults) saveRouting(llmRepo, options.routingDefaults, new Date(now()).toISOString());
  const router = new ModelRouter(catalog, llmRepo, llm);
  llm.setRouter(router);
  const agentService = new AgentManagerService(
    new AgentManagerRepository(db),
    (ref) => catalog.validateModelRef(ref),
    () => {
      const cfg = loadRouting(llmRepo);
      return cfg.enabled && cfg.autoAssignNewBots && router.candidates("general", cfg).length > 0 ? autoRef("general") : null;
    },
  );
  await registerAgentManagerRoutes(app, agentService);
  await registerLlmRoutes(app, { catalog, llm, usage: usageRepo, now });
  await registerRoutingRoutes(app, {
    router,
    catalog,
    repo: llmRepo,
    now,
    breakerWaitMs: (id) => llm.breakerWaitMs(id),
    audit,
    assignUnassigned: () => {
      let changed = 0;
      for (const bot of agentService.listBots(false)) {
        if (bot.model === null && bot.runtime === "builtin") {
          agentService.updateBot(bot.id, { model: autoRef("general"), changeNote: "Automatic model routing" });
          changed++;
        }
      }
      return changed;
    },
  });
  const routingMaintenance = new RoutingMaintenance(llmRepo, catalog, now);

  // ---- Test chat: bots reply only when you send a message. No tools. ----
  let skillService: SkillService | undefined; // created just below, once the approval gate and vault exist
  const chat = new ChatService(new ChatRepository(db), (id) => agentService.getBot(id), createRuntimeRegistry(llm, async (botId) => (skillService ? await skillService.promptFor(botId) : "")), llm, now);
  await registerChatRoutes(app, chat);

  // ---- Collaboration: bots hand text tasks to teammates you allow (nobody, by default) ----
  // ---- Secrets vault, audit log and the approval gate (Phase 5). The real app has ONE connector, Telegram (Phase 6),
  // which does nothing until the owner saves a bot token. Gmail and the browser come in Phases 7 and 8.
  // Tests and test harnesses supply their own (fake) connectors instead. ----
  const vaultKey =
    options.vaultKey ?? (options.dbPath === ":memory:" ? newEphemeralKey() : loadOrCreateKeyFile(join(dirname(resolve(options.dbPath)), "vault.key")));
  const pcService = new PcService({
    db,
    audit,
    now,
    forbiddenRoots: () => [process.cwd(), ...(options.dbPath === ":memory:" ? [] : [dirname(resolve(options.dbPath))])],
    botName: (id) => {
      try {
        return agentService.getBot(id).name;
      } catch {
        return null;
      }
    },
    botExists: (id) => {
      try {
        agentService.getBot(id);
        return true;
      } catch {
        return false;
      }
    },
    ...(options.pcStart ? { start: options.pcStart } : {}),
    ollama: () => ({ enabled: catalog.listProviders().find((p) => p.id === "ollama")?.enabled ?? false, usableModels: catalog.listModels("ollama").filter((m) => m.callable).length }),
  });
  app.decorate("pc", pcService);
  app.addHook("onClose", async () => pcService.shutdown());
  const registry = new ConnectorRegistry([
    ...(options.connectors ?? [createTelegramConnector(), createBrowserConnector(), createGmailConnector(options.googleUrls ? { urls: options.googleUrls, now } : { now })]),
    ...(options.connectors === undefined || options.includePc ? [createPcConnector(pcService), createDocumentsConnector(pcService)] : []),
  ]);
  const vault = new VaultService(db, vaultKey, audit, () => [...registry.list().flatMap((c) => c.secrets ?? []), { name: PUSH_SECRET_NAME, description: "Phone alerts signing key (made automatically, do not paste)" }], now);
  setSecretLookup((name) => vault.getStored(name));
  app.addHook("onClose", async () => setSecretLookup(null));
  await registerVaultRoutes(app, vault);
  if (registry.get("gmail")) await registerGmailOAuthRoutes({ app, vault, audit, now, ...(options.googleUrls ? { urls: options.googleUrls } : {}) });
  const gate = new ActionGate({
    repo: new ApprovalRepository(db),
    registry,
    audit,
    vault,
    getBot: (id) => agentService.getBot(id),
    // The PC agent has its own five permissions (checked by the connector); the generic read switch does not apply to it.
    readEnabled: (botId, connector) => connector === "pc" || connector === "documents" || agentService.getBot(botId).permissions.some((p) => p.connector === connector && p.readEnabled),
    now,
  });
  await registerApprovalRoutes(app, gate, audit);

  // ---- Tool registry and skill library (Stage 3) ----
  const tools = new ToolRegistry(
    {
      run: options.toolRunner ?? realRunner,
      connectors: () => registry.list().map((c) => ({ id: c.id, label: c.label, notReady: c.notReady ? c.notReady({ secret: (n) => vault.resolve(n) }) : null })),
      ollama: () => {
        const p = catalog.listProviders().find((x) => x.id === "ollama");
        return { enabled: p?.enabled ?? false, status: p?.status ?? null, usableModels: catalog.listModels("ollama").filter((m) => m.callable).length };
      },
      pc: () => ({ roots: pcService.roots().length, stopped: pcService.isStopped() }),
      providersReady: () => catalog.listProviders().filter((p) => p.kind === "cloud" && p.enabled && p.keyConfigured).length,
    },
    now,
  );
  skillService = new SkillService({
    db,
    audit,
    now,
    tools: () => tools.list(),
    toolIds: () => tools.ids(),
    complete: (input) => llm.complete(input),
    botExists: (id) => {
      try {
        agentService.getBot(id);
        return true;
      } catch {
        return false;
      }
    },
  });
  app.decorate("skills", skillService);
  app.decorate("tools", tools);
  await registerSkillRoutes(app, skillService, tools);
  await registerPcRoutes(app, pcService);

  const taskRepo = new TaskRepository(db);
  let automation: AutomationService | undefined; // created just below; the engine tells it when a chain ends
  const engine = new TaskEngine({
    tasks: taskRepo,
    getBot: (id) => agentService.getBot(id),
    llm,
    now,
    actions: gate,
    promptExtras: (botId) => skillService!.promptFor(botId),
    onRootFinished: (task) => automation?.onRootFinished(task),
  });
  engine.recoverInterrupted();

  // ---- The Manager AI (Stage 2): plans, uses specialist bots only when needed, checks and combines the result ----
  const manager = new ManagerService({
    db,
    now,
    engine,
    getTask: (id) => taskRepo.getTask(id),
    complete: (input) => llm.complete(input),
    listBots: () => agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, role: b.role, responsibilities: b.responsibilities, archived: b.archived, model: b.model, runtime: b.runtime })),
    audit,
    validateModel: (ref) => catalog.validateModelRef(ref),
    toolsSummary: () => tools.summary(),
    ...(options.managerPollMs ? { pollMs: options.managerPollMs } : {}),
  });
  manager.recoverInterrupted();
  app.decorate("manager", manager);
  await registerManagerRoutes(app, manager);
  await registerDelegationRoutes(app, new DelegationService(taskRepo, engine, (id) => agentService.getBot(id), now), engine);

  // ---- Automation: schedules and text triggers. They start tasks through the engine above, so every
  // limit, the pause switches and the free-only gate apply. The clock is started by server.ts, not here. ----
  automation = new AutomationService({ repo: new AutomationRepository(db), engine, llm, getBot: (id) => agentService.getBot(id), now });
  // ---- Inbound messages: Telegram / Gmail messages become events (off by default, read through the approval gate) ----
  const inbound = new InboundService({
    db,
    audit,
    now,
    read: (botId, connector, action, args) => gate.request(botId, null, { connector, action, args }),
    readEnabled: (botId, connector) => agentService.getBot(botId).permissions.some((p) => p.connector === connector && p.readEnabled),
    botName: (id) => agentService.getBot(id).name,
    botArchived: (id) => agentService.getBot(id).archived,
    fireEvent: (name, text) => automation!.handleEvent(name, text),
    paused: () => (gate.isPaused() ? "outside actions paused" : automation!.isPaused() ? "automation paused" : llm.isPaused() ? "AI paused" : null),
  });
  app.decorate("inbound", inbound);
  await registerInboundRoutes(app, inbound);
  // ---- Phone alerts: a content-free wake-up when a new approval is waiting ----
  const push = new PushService({
    db,
    vault,
    audit,
    now,
    subject: () => (remoteHosts[0] ? `https://${remoteHosts[0]}` : "mailto:owner@localhost.invalid"),
    pendingApprovals: () => {
      const r = db.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM approval_requests WHERE status = 'pending'").get() as { n: number; newest: string | null };
      return { count: Number(r.n), newestAt: r.newest };
    },
    ...(options.pushAllowHost ? { allowHost: options.pushAllowHost } : {}),
    ...(options.pushFetch ? { fetchImpl: options.pushFetch } : {}),
  });
  app.decorate("push", push);
  await registerPushRoutes(app, push);
  // ---- Workflows (Stage 6): drawn as boxes and arrows, with a saved queue that survives restarts ----
  const workflows = new WorkflowService({
    db,
    audit,
    now,
    engine,
    getTask: (id) => taskRepo.getTask(id),
    manager,
    botExists: (id) => {
      try {
        agentService.getBot(id);
        return true;
      } catch {
        return false;
      }
    },
    automationPaused: () => automation!.isPaused(),
    ...(options.managerPollMs ? { pollMs: options.managerPollMs } : {}),
  });
  workflows.recover();
  automation.addEventListener((name, text) => workflows.onEvent(name, text));
  app.decorate("workflows", workflows);
  await registerWorkflowRoutes(app, workflows);
  const scheduler = new AutomationScheduler(automation, async () => {
    workflows.tickSchedules();
    workflows.tick();
    await Promise.all([inbound.tick(), push.tick(), routingMaintenance.tick()]);
  });
  app.decorate("automation", scheduler);
  app.addHook("onClose", async () => scheduler.stop());
  await registerAutomationRoutes(app, automation);

  // ---- Phone access (Phase 11): sessions, device pairing, and the dashboard pages themselves ----
  await registerRemoteRoutes(app, devices, remoteHosts, now);

  // ---- Monitoring: a read-only overview of health and recent activity (PC and phone) ----
  await registerMonitorRoutes(app, {
    db,
    now,
    aiPaused: () => llm.isPaused(),
    outsidePaused: () => gate.isPaused(),
    automationPaused: () => automation!.isPaused(),
    remoteEnabled: remoteHosts.length > 0,
  });
  if (options.dashboardDir) registerDashboard(app, options.dashboardDir);

  return app;
}
