import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AgentManagerRepository } from "./agent-manager/repository.js";
import { registerAgentManagerRoutes } from "./agent-manager/routes.js";
import { AgentManagerService } from "./agent-manager/service.js";
import { ChatRepository } from "./chat/repository.js";
import { registerChatRoutes } from "./chat/routes.js";
import { InboxService } from "./inbox/service.js";
import { makeVerifySource } from "./inbox/sources.js";
import { registerInboxRoutes } from "./inbox/routes.js";
import { ProjectService, type ItemKind } from "./projects/service.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { WorkspaceService } from "./project-workspace/service.js";
import { registerWorkspaceRoutes } from "./project-workspace/routes.js";
import { KnowledgeService } from "./knowledge/service.js";
import { registerKnowledgeRoutes } from "./knowledge/routes.js";
import { HubService } from "./project-hub/service.js";
import { AssistantActions } from "./assistant/actions.js";
import { registerAssistantRoutes } from "./assistant/routes.js";
import { registerHubRoutes } from "./project-hub/routes.js";
import { createWorkspaceConnector } from "./project-workspace/connector.js";
import { DecisionService } from "./decisions/service.js";
import { registerDecisionRoutes } from "./decisions/routes.js";
import { DecisionInsights } from "./decisions/collaboration.js";
import { GroupService } from "./groups/service.js";
import { registerGroupRoutes } from "./groups/routes.js";
import { WorkforceService } from "./workforce/service.js";
import { registerWorkforceRoutes } from "./workforce/routes.js";
import { ChatService } from "./chat/service.js";
import { openDatabase } from "./db/database.js";
import { dirname, join, resolve } from "node:path";
import { ApprovalRepository } from "./approvals/repository.js";
import { registerApprovalRoutes } from "./approvals/routes.js";
import { ActionGate } from "./approvals/service.js";
import { AuditLog } from "./audit/audit.js";
import { createBrowserConnector } from "./connectors/browser/browser.js";
import { createBusinessConnector } from "./business/connector.js";
import { registerBusinessRoutes, registerBusinessTeamRoutes } from "./business/routes.js";
import { BUSINESS_FLAG, BusinessService } from "./business/service.js";
import { registerIntegrationCatalog } from "./connectors/catalog.js";
import { AccessService } from "./access/service.js";
import { BotModes } from "./bot-studio/modes.js";
import { registerBotStudioRoutes } from "./bot-studio/routes.js";
import { hashFileSync } from "./access/discovery.js";
import { HostBridge, type DesktopBridge } from "./desktop/bridge.js";
import { createDesktopConnector } from "./desktop/connector.js";
import { DesktopEngine, type Launcher } from "./desktop/engine.js";
import { registerDesktopRoutes } from "./desktop/routes.js";
import { getPlugin } from "./llm/plugins/index.js";
import { registerAccessRoutes } from "./access/routes.js";
import { PROGRAMS } from "./connectors/pc/policy.js";
import { registerGuardianRoutes, type GuardianGate } from "./guardian-link.js";
import { createGmailConnector, registerGmailOAuthRoutes, registerGmailTestRoute, registerGoogleOAuthRoutes, type GoogleUrls } from "./connectors/gmail.js";
import { createGithubConnector, createGoogleWorkspaceConnector, createMcpConnector, createN8nConnector, createNotionConnector, GWS_REFRESH_TOKEN, GWS_SCOPES } from "./connectors/integrations.js";
import { createMemoryConnector } from "./memory/connector.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { MemoryService } from "./memory/service.js";
import { IntegrationAccess, isIntegration, registerIntegrationRoutes } from "./connectors/integrations-access.js";
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
import { mergeDelegationLimits } from "./delegation/limits.js";
import { TaskRepository } from "./delegation/repository.js";
import { registerDelegationRoutes } from "./delegation/routes.js";
import { DelegationService } from "./delegation/service.js";
import { AppError } from "./errors.js";
import { ModelCatalogService } from "./llm/catalog.js";
import { LlmError } from "./llm/errors.js";
import { defaultProviderFactory, type ProviderFactory } from "./llm/factory.js";
import { LlmRepository } from "./llm/repository.js";
import { registerLlmRoutes } from "./llm/routes.js";
import { registerRegistryRoutes } from "./llm/registry-routes.js";
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
import { ModelRegistry } from "./llm/registry.js";
import { RecommendationEngine } from "./recommendations/engine.js";
import { registerCoreRecommendations } from "./recommendations/core.js";
import { registerWorkforceRecommendations } from "./recommendations/workforce.js";
import { registerRecommendationRoutes } from "./recommendations/routes.js";
import { cpus, totalmem } from "node:os";
import { DemoService } from "./demo/service.js";
import { registerDemoRoutes } from "./demo/routes.js";
import { WorkflowService } from "./workflows/service.js";
import { SkillService } from "./skills/service.js";
import { registerSkillRoutes } from "./skills/routes.js";
import { CapabilityService } from "./capabilities/service.js";
import { assessExecution } from "./capabilities/execution-policy.js";
import { VerificationService } from "./verification/service.js";
import { registerVerificationRoutes } from "./verification/routes.js";
import { resolveInRoots } from "./connectors/pc/paths.js";
import { registerCapabilityRoutes } from "./capabilities/routes.js";
import { ToolRegistry, realRunner, type CommandRunner } from "./tools/registry.js";
import { ModelRouter } from "./routing/router.js";
import { RoutingMaintenance, registerRoutingRoutes } from "./routing/routes.js";
import { autoRef, loadRouting, saveRouting } from "./routing/config.js";
import { PushService, PUSH_SECRET_NAME } from "./push/push.js";
import { registerPushRoutes } from "./push/routes.js";
import { InboundService } from "./inbound/service.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Recommended settings. A feature registers its own recommendations here: app.recommendations.register(def). */
    recommendations: RecommendationEngine;
    /** What is known about every model the providers list, and whether bots may use it. */
    modelRegistry: ModelRegistry;
    /** The owner's inbox: bots appear in it only for real events. */
    inbox: InboxService;
    /** Knowledge Center documents, chat attachments and their search. */
    knowledge: KnowledgeService;
    /** Projects: the owner's way to organise conversations, workflows, schedules and tasks. */
    projects: ProjectService;
    workspace: WorkspaceService;
    /** Decisions (the chalkboard). Present only once migration 019 exists in the database; absent until the owner approves it. */
    decisions?: DecisionService;
    /** Bot groups (migration 017). Switched OFF until the owner turns them on (NV-15). */
    groups: GroupService;
    /** The organisation (Central Manager, four divisions) and the Workforce Board, read from the real records. */
    workforce: WorkforceService;
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
    modelRouter: ModelRouter;
    tools: ToolRegistry;
    capabilities: CapabilityService;
    verification: VerificationService;
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
  /** Rescan the capability registry on this interval so changes are noticed and logged with nobody watching. 0/absent = only when asked (tests). */
  capabilityPollMs?: number;
  /** Tests: stands in for running 'git --version' and similar fixed checks on this PC. */
  toolRunner?: CommandRunner;
  /** Tests: add the memory connector to the connectors given above (the real app always has it). */
  includeMemory?: boolean;
  /** Tests: register the project workspace's read actions (always on in the real app). */
  includeWorkspace?: boolean;
  /** Tests: add the five integration connectors (GitHub, Notion, n8n, MCP, Google Workspace) to the connectors given above (the real app always has them). */
  includeIntegrations?: boolean;
  /** Tests: add the PC agent connector to the connectors given above (the real app always has it). */
  includePc?: boolean;
  /** The Guardian (Tier A or B). When given: no new task, schedule or approved action starts while it is not RUN, and owner-only changes made from this PC need its passphrase proof. Without it the app behaves as before. */
  guardian?: GuardianGate;
  /** Folder approvals decide what the PC agent and the document writer may touch (default deny). The real app always enforces them; tests turn it on when they test it. */
  enforceFolderGrants?: boolean;
  /** Tests: add the desktop connector to the connectors given above (the real app always has it), and stand in for the Windows host and the launcher. */
  includeDesktop?: boolean;
  /** Tests only: pretend this PC has this much memory and these cores, so recommendations can be tested on any machine. */
  hardware?: { ramGb: number; cores: number };
  desktop?: { bridge?: DesktopBridge; launcher?: Launcher; privateDir?: string; sleep?: (ms: number) => Promise<void> };
  /** Tests: stands in for the read-only application scan, the disk checks and the user folder used by the access module. */
  accessTesting?: { discover?: import("./access/discovery.js").DiscoveryRunner; fs?: import("./access/paths.js").FsProbe; home?: string; hashFile?: (path: string) => string | null };
  /** "off" = models are not required to be verified before automatic routing or bot assignment. TESTS ONLY; production always enforces it. */
  verification?: "enforced" | "off";
  /** Tests: add the Business Workforce connector to the connectors given above (the real app always has it). */
  includeBusiness?: boolean;
  /** Where the leads file lives. Default: workspace/business-workforce/leads/ inside the project folder. */
  businessDir?: string;
  /** Tests only: pretend network pieces for discovery and website checks (the real ones only run while the owner has switched outside requests on). */
  businessNet?: Pick<import("./business/service.js").BusinessDeps, "transport" | "lookup" | "post" | "get" | "sleep">;
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
  const guardian = options.guardian;
  const guardianHeld = (): string | null => guardian?.held() ?? null;
  registerAccess(app, { remoteHosts, devices, audit, ...(guardian ? { stepUp: { check: (t: string) => guardian.checkProof(t) } } : {}) });
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
  // The model registry: kinds, verification, retirement. In production a model is used by automatic routing or given to a bot only when it is VERIFIED.
  // Tests that are about something else switch verification off (options.verification = "off"); the registry's own tests leave it on.
  const modelRegistry = new ModelRegistry({ repo: llmRepo, now });
  modelRegistry.enforce = options.verification !== "off";
  catalog.setRegistry(modelRegistry);
  const llm = new LlmService(llmRepo, usageRepo, catalog, factory, {
    now,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });

  // ---- Agent Manager (a bot's model is checked against the catalog) ----
  // Stage 1: universal model routing. "auto/<kind of task>" bots get an explicit free model chosen per call, with failover.
  if (options.routingDefaults) saveRouting(llmRepo, options.routingDefaults, new Date(now()).toISOString());
  const router = new ModelRouter(catalog, llmRepo, llm);
  router.clock = now;
  router.onSwitch = (r) => audit.record("routing.switched", { class: r.class, botId: r.botId, answeredBy: r.answeredBy, attempts: r.attempts });
  llm.setRouter(router);
  llm.setRegistry(modelRegistry);
  app.decorate("modelRegistry", modelRegistry);
  app.decorate("modelRouter", router);
  const agentService = new AgentManagerService(
    new AgentManagerRepository(db),
    (ref) => catalog.validateModelRef(ref),
    () => {
      const cfg = loadRouting(llmRepo);
      if (!cfg.enabled || !cfg.autoAssignNewBots) return null;
      // The default chosen in the AI setup assistant, while it is still a valid choice; otherwise Automatic (general) when a free model exists.
      if (cfg.defaultModel) {
        try {
          catalog.validateModelRef(cfg.defaultModel);
          return cfg.defaultModel;
        } catch {
          /* no longer valid: fall back to Automatic */
        }
      }
      return router.candidates("general", cfg).length > 0 ? autoRef("general") : null;
    },
  );
  // A bot that is switched off, paused or archived never reaches a model, whichever way it was asked to run.
  llm.setBotGate((botId) => {
    const reason = agentService.runRefusal(botId);
    return reason ? new LlmError("bot_not_active", reason) : null;
  });
  await registerAgentManagerRoutes(app, agentService);
  await registerLlmRoutes(app, { catalog, llm, usage: usageRepo, now });
  await registerRegistryRoutes(app, { registry: modelRegistry, catalog, usage: usageRepo, llm, audit });
  await registerRoutingRoutes(app, {
    router,
    catalog,
    repo: llmRepo,
    now,
    breakerWaitMs: (id) => llm.breakerWaitMs(id),
    cooldowns: () => llm.modelCooldowns(),
    audit,
    switchLog: (limit) => audit.listPrefix("routing.switched", limit).map((e) => ({ createdAt: e.createdAt, detail: e.detail })),
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
  const chatRepo = new ChatRepository(db);
  // ---- Projects: links to conversations, workflows, schedules, tasks and notes (never copies). Group chats cannot be linked while groups are off. ----
  const projectLookup = (kind: ItemKind, id: string): { title: string } | null => {
    const q: Record<ItemKind, string> = {
      conversation: "SELECT title AS t FROM conversations WHERE id = ?",
      workflow: "SELECT name AS t FROM workflows WHERE id = ?",
      schedule: "SELECT name AS t FROM schedules WHERE id = ?",
      task: "SELECT substr(instruction, 1, 80) AS t FROM tasks WHERE id = ?",
      note: "SELECT title AS t FROM memory_notes WHERE id = ?",
    };
    const r = db.prepare(q[kind]).get(id) as { t?: string } | undefined;
    return r ? { title: String(r.t ?? "") } : null;
  };
  const projects = new ProjectService({ db, audit, lookup: projectLookup, now });
  app.decorate("projects", projects);
  const knowledge = new KnowledgeService({ db, audit, now });
  app.decorate("knowledge", knowledge);
  await registerKnowledgeRoutes(app, knowledge);
  const chat = new ChatService(chatRepo, (id) => agentService.getBot(id), createRuntimeRegistry(llm, async (botId) => (skillService ? await skillService.promptFor(botId) : "")), llm, now, {
    contextFor: (conversationId) => projects.contextFor(conversationId),
    contextForProject: (projectId) => projects.contextForProject(projectId),
    attach: (projectId, conversationId) => void projects.link(projectId, "conversation", conversationId),
    projectIdOf: (conversationId) => projects.projectOf("conversation", conversationId)?.id ?? null,
  }, knowledge);
  await registerChatRoutes(app, chat);
  await registerProjectRoutes(app, projects);
  let decisionsRef: DecisionService | undefined; // set below once the decisions tables exist
  let groupsRef: GroupService | undefined; // set below, after the task engine
  let inbox: InboxService | undefined; // created once the task and approval stores exist; events that arrive earlier are ignored

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
  const memory = new MemoryService(db, audit, now);
  let workspaceRef: WorkspaceService | undefined; // created once the task store exists; its connector reads it lazily
  // The Business Workforce: discovery, website checks and the leads file. Its outside-requests lock lives in the approval settings and is OFF by default.
  const approvalRepo = new ApprovalRepository(db);
  const business = new BusinessService({
    dir: options.businessDir ?? join(process.cwd(), "workspace", "business-workforce", "leads"),
    now,
    audit,
    getFlag: () => approvalRepo.getSetting(BUSINESS_FLAG) === "true",
    setFlag: (on) => approvalRepo.setSetting(BUSINESS_FLAG, on ? "true" : "false", new Date(now()).toISOString()),
    getEndpoint: () => approvalRepo.getSetting("business.map_endpoint"),
    setEndpoint: (id) => approvalRepo.setSetting("business.map_endpoint", id, new Date(now()).toISOString()),
    ...(options.businessNet ?? {}),
  });
  const access = new AccessService({
    kv: { get: (k) => approvalRepo.getSetting(k), set: (k, v) => approvalRepo.setSetting(k, v, new Date(now()).toISOString()) },
    audit,
    now,
    guardHeld: guardianHeld,
    appFolders: () => [process.cwd(), ...(options.dbPath === ":memory:" ? [] : [dirname(resolve(options.dbPath))])],
    existingIntegrations: () => [{ label: "PC agent (approved developer programs)", programs: [...PROGRAMS] }],
    ...(options.accessTesting ?? {}),
  });
  const desktopDir = options.dbPath === ":memory:" ? join(tmpdir(), "awp-desktop-app") : join(dirname(resolve(options.dbPath)), "desktop");
  const desktopBridge = options.desktop?.bridge ?? new HostBridge(join(desktopDir, "host"));
  const desktopEngine = new DesktopEngine({
    bridge: desktopBridge,
    access,
    audit,
    now,
    guardHeld: guardianHeld,
    privateDir: options.desktop?.privateDir ?? join(desktopDir, "private"),
    ...(options.desktop?.launcher ? { launcher: options.desktop.launcher } : {}),
    ...(options.desktop?.sleep ? { sleep: options.desktop.sleep } : {}),
    hashFile: options.accessTesting?.hashFile ?? hashFileSync,
  });
  let desktopReady: Promise<void> | null = null;
  const prepareDesktop = (): Promise<void> => (desktopReady ??= desktopEngine.prepare().catch((e) => {
    desktopReady = null;
    throw e;
  }));
  const CLOUD_TEXT = "desktop.cloud_screen_text";
  app.addHook("onClose", async () => {
    await desktopEngine.shutdown(false);
    desktopBridge.stop();
  });
  const folderGate = options.enforceFolderGrants ?? options.connectors === undefined ? access : undefined;
  const registry = new ConnectorRegistry([
    ...(options.connectors ?? [createTelegramConnector(), createBrowserConnector(), createGmailConnector(options.googleUrls ? { urls: options.googleUrls, now } : { now })]),
    ...(options.connectors === undefined || options.includePc ? [createPcConnector(pcService, folderGate), createDocumentsConnector(pcService, folderGate)] : []),
    ...(options.connectors === undefined || options.includeDesktop
      ? [
          createDesktopConnector({
            engine: desktopEngine,
            access,
            pc: pcService,
            modelIsLocal: (botId) => {
              try {
                const [prov] = String(agentService.getBot(botId).model ?? "").split("/");
                return !!prov && getPlugin(prov)?.kind === "local";
              } catch {
                return false;
              }
            },
            cloudScreenText: () => approvalRepo.getSetting(CLOUD_TEXT) === "true",
            guardHeld: guardianHeld,
            prepare: prepareDesktop,
          }),
        ]
      : []),
    ...(options.connectors === undefined || options.includeMemory ? [createMemoryConnector(memory)] : []),
    ...(options.connectors === undefined || options.includeWorkspace ? [createWorkspaceConnector(() => workspaceRef!)] : []),
    ...(options.connectors === undefined || options.includeBusiness ? [createBusinessConnector(business)] : []),
    ...(options.connectors === undefined || options.includeIntegrations ? [createGithubConnector(), createNotionConnector(), createN8nConnector(), createMcpConnector(), createGoogleWorkspaceConnector(options.googleUrls ? { urls: options.googleUrls, now } : { now })] : []),
  ]);
  const vault = new VaultService(db, vaultKey, audit, () => [...registry.list().flatMap((c) => c.secrets ?? []), { name: PUSH_SECRET_NAME, description: "Phone alerts signing key (made automatically, do not paste)" }], now);
  setSecretLookup((name) => vault.getStored(name));
  app.addHook("onClose", async () => setSecretLookup(null));
  await registerVaultRoutes(app, vault);
  if (registry.get("gmail")) await registerGmailOAuthRoutes({ app, vault, audit, now, ...(options.googleUrls ? { urls: options.googleUrls } : {}) });
  const integrationAccess = new IntegrationAccess(db, audit, now);
  if (registry.get("gworkspace")) await registerGoogleOAuthRoutes({ app, vault, audit, now, ...(options.googleUrls ? { urls: options.googleUrls } : {}) }, { slug: "gworkspace", label: "Google Workspace", scopes: GWS_SCOPES, refreshToken: GWS_REFRESH_TOKEN });
  // Who may READ through which connector. Business discovery and website checks are public-web reads, so they follow the
  // agent's existing "browser" switch (no new permission table is needed).
  const botModes = new BotModes({ get: (k) => approvalRepo.getSetting(k), set: (k, v) => approvalRepo.setSetting(k, v, new Date(now()).toISOString()) });
  const readEnabled = (botId: string, connector: string): boolean => {
    const asConnector = connector === "business" ? "browser" : connector;
    return asConnector === "pc" || asConnector === "desktop" || asConnector === "documents" || asConnector === "memory" || asConnector === "workspace" || (isIntegration(asConnector) ? integrationAccess.has(botId, asConnector) : false) || agentService.getBot(botId).permissions.some((p) => p.connector === asConnector && p.readEnabled);
  };
  const gate = new ActionGate({
    repo: approvalRepo,
    registry,
    audit,
    vault,
    getBot: (id) => agentService.getBot(id),
    // The PC agent has its own five permissions (checked by the connector); the generic read switch does not apply to it.
    readEnabled,
    now,
    startGuard: guardianHeld,
    modeBlock: (botId, connectorId, kind) => botModes.block(botId, connectorId, kind),
    onPending: (approvalId, botId) => void inbox?.postFromEvent(botId, "approval_needed", { kind: "approval", id: approvalId }),
  });
  await registerApprovalRoutes(app, gate, audit, () => workflows.tick()); // a decided approval lets a waiting workflow continue at once
  await registerGuardianRoutes(app, guardian);
  await registerAccessRoutes(app, access, audit);
  await registerBotStudioRoutes(app, { agents: agentService, modes: botModes, audit, complete: (input) => llm.complete(input) });
  await registerDesktopRoutes(app, { bridge: desktopBridge, engine: desktopEngine, audit, getCloudText: () => approvalRepo.getSetting(CLOUD_TEXT) === "true", setCloudText: (on) => approvalRepo.setSetting(CLOUD_TEXT, on ? "true" : "false", new Date(now()).toISOString()) });
  await registerBusinessRoutes(app, business);
  // Recommended settings: one shared engine. Features register their own recommendations on it (app.recommendations); nothing is applied without the owner naming it.
  const recommendations = new RecommendationEngine({ get: (k) => llmRepo.getSetting(k), set: (k, v) => llmRepo.setSetting(k, v, new Date(now()).toISOString()) }, now);
  const recHardware = () => ({ ramGb: Math.round((options.hardware?.ramGb ?? totalmem() / 1024 ** 3) * 10) / 10, cores: options.hardware?.cores ?? cpus().length });
  registerCoreRecommendations(recommendations, {
    routing: { get: () => loadRouting(llmRepo), set: (patch) => void saveRouting(llmRepo, patch, new Date(now()).toISOString()) },
    limits: { get: () => llm.limits(), set: (u) => void llm.updateLimits(u) },
    providers: () => catalog.listProviders(),
    models: () => catalog.listModels(),
    hardware: recHardware,
    desktopCloudText: { get: () => approvalRepo.getSetting(CLOUD_TEXT) === "true", set: (on) => approvalRepo.setSetting(CLOUD_TEXT, on ? "true" : "false", new Date(now()).toISOString()) },
    guardianConfigured: () => guardian !== undefined,
    integrations: () => registry.list().filter((c) => (c.secrets?.length ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, notReady: c.notReady ? c.notReady({ secret: (n) => vault.resolve(n) }) : null })),
  });
  app.decorate("recommendations", recommendations);
  await registerRecommendationRoutes(app, recommendations, {
    audit,
    environment: () => {
      const hw = recHardware();
      const real = catalog.listProviders().filter((p) => !p.simulated && p.enabled && p.status === "connected").length;
      return { ramGb: hw.ramGb, cores: hw.cores, realProvidersConnected: real, guardian: guardian !== undefined };
    },
  });
  await registerIntegrationCatalog({
    app,
    registry,
    vault,
    audit,
    gate,
    agentsFor: (connector) => {
      if (connector === "pc" || connector === "desktop" || connector === "documents" || connector === "memory" || connector === "workspace") return null;
      return agentService
        .listBots(false)
        .filter((b) => readEnabled(b.id, connector))
        .map((b) => ({ id: b.id, name: b.name }));
    },
  });
  if (registry.get("gmail")) await registerGmailTestRoute({ app, vault, gate, now, ...(options.googleUrls ? { urls: options.googleUrls } : {}) });
  await registerMemoryRoutes(app, memory, (id) => {
    try {
      agentService.getBot(id);
      return true;
    } catch {
      return false;
    }
  });
  await registerIntegrationRoutes(app, integrationAccess, registry, (id) => { try { agentService.getBot(id); return true; } catch { return false; } });

  let capabilitiesRef: CapabilityService | undefined; // set once the capability registry is built (the Manager is created first)
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
  // ---- Shared project workspace: agents on the same project see and publish findings, files and progress. A view over memory notes, approvals and tasks (no new store). ----
  const workspace = new WorkspaceService({
    db,
    memory,
    projects,
    tasks: taskRepo,
    audit,
    bots: () => agentService.listBots(true).map((b) => ({ id: b.id, name: b.name, archived: b.archived })),
    // A required file is read FOR the agent through the gate's normal read path: its PC read permission, the folder grant, the daily read limit and the audit log all apply.
    readFile: async (botId, taskId, path) => {
      const r = await gate.request(botId, taskId, { connector: "pc", action: "read_file", args: { path } });
      if (r.status === "done") return { ok: true, text: r.text };
      return { ok: false, reason: r.status === "pending_approval" ? "Reading needs the owner's approval." : r.reason };
    },
    now,
  });
  workspaceRef = workspace;
  app.decorate("workspace", workspace);
  await registerWorkspaceRoutes(app, workspace);
  await registerHubRoutes(app, new HubService({ db }), db);
  // Independent result verification (M4): compares what a task's reply claims with the platform's own record. Files are checked through the folder gate.
  const verification = new VerificationService({
    db,
    audit,
    resultSupport: (connector, action) => {
      const spec = registry.action(connector, action);
      return spec?.kind === "write" ? spec.resultSupport : undefined;
    },
    probe: (abs) => {
      const r = resolveInRoots(pcService.roots(), abs, pcService.roots()[0] ?? ".");
      if (!r.ok) return { state: "unreadable", reason: r.reason };
      try {
        folderGate?.require({ subject: "workforce", path: r.abs, op: "read" });
      } catch (err) {
        return { state: "unreadable", reason: err instanceof Error ? err.message.slice(0, 120) : "not allowed to read" };
      }
      try {
        return statSync(r.abs).isFile() ? { state: "ok", size: statSync(r.abs).size } : { state: "missing" };
      } catch {
        return { state: "missing" };
      }
    },
  });
  app.decorate("verification", verification);
  await registerVerificationRoutes(app, verification);
  let automation: AutomationService | undefined; // created just below; the engine tells it when a chain ends
  const engine = new TaskEngine({
    tasks: taskRepo,
    preflight: (task, proceedAnyway) => assessExecution(capabilitiesRef, audit, { kind: "task", id: task.id, goal: task.instruction, source: task.parentId ? "delegated_child" : task.origin, proceedAnyway }),
    getBot: (id) => agentService.getBot(id),
    llm,
    now,
    actions: gate,
    promptExtras: async (botId) => [await skillService!.promptFor(botId), memory.promptFor(botId)].filter(Boolean).join("\n\n"),
    taskContext: (task) => workspace.contextFor(task),
    taskOutcome: (task, replies) => workspace.outcome(task, replies),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    onRootFinished: (task) => {
      verification.record(task.id); // records the verdict (never throws)
      automation?.onRootFinished(task);
      try {
        decisionsRef?.onRootFinished(task);
      } catch {
        /* a report problem never stops a task */
      }
      try {
        groupsRef?.onRootFinished(task);
      } catch {
        /* a group message problem never stops a task */
      }
      // The owner's inbox hears about the end of a chain. It checks the event itself; a problem here never stops a task from finishing.
      if (!inbox) return;
      try {
        if (task.status === "completed") inbox.postFromEvent(task.assigneeBotId, "task_result", { kind: "task", id: task.id });
        else if (task.status === "failed") {
          inbox.postFromEvent(task.assigneeBotId, "task_failed", { kind: "task", id: task.id });
          if ((task.origin === "schedule" || task.origin === "trigger") && task.originId) inbox.postFromEvent(task.assigneeBotId, "automation_failed", { kind: task.origin, id: `${task.originId}:${task.id}` });
        }
      } catch {
        /* the inbox must never break a task */
      }
    },
    startGuard: guardianHeld,
  });
  engine.recoverInterrupted();
  inbox = new InboxService({ db, chat: chatRepo, getBot: (id) => agentService.getBot(id), audit, now, verifySource: makeVerifySource({ db, getTask: (id) => taskRepo.getTask(id), getApproval: (id) => approvalRepo.get(id) }) });
  app.decorate("inbox", inbox);
  await registerInboxRoutes(app, inbox);
  // Decisions need migration 019, which the owner has NOT approved. Until the tables exist the feature simply is not there (no route, no error).
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'decisions'").get()) {
    decisionsRef = new DecisionService({
      db,
      audit,
      bots: () => agentService.listBots(false),
      getBot: (id) => agentService.getBot(id),
      complete: (input) => llm.complete(input),
      engine,
      projects,
      now,
    });
    app.decorate("decisions", decisionsRef);
    await registerDecisionRoutes(app, decisionsRef, new DecisionInsights(db, decisionsRef, now));
  }

  // ---- Bot groups: off until the owner switches them on. Work runs as ordinary tasks; a handoff needs the delegation allow-list that already exists. ----
  groupsRef = new GroupService({
    db,
    audit,
    kv: { get: (k) => approvalRepo.getSetting(k), set: (k, v) => approvalRepo.setSetting(k, v, new Date(now()).toISOString()) },
    getBot: (id) => agentService.getBot(id),
    engine,
    getTask: (id) => taskRepo.getTask(id),
    canDelegate: (from, to) => taskRepo.listTargets(from).some((t) => t.id === to),
    guardHeld: guardianHeld,
    validateModel: (ref) => catalog.validateModelRef(ref),
    now,
  });
  app.decorate("groups", groupsRef);
  await registerGroupRoutes(app, groupsRef, decisionsRef);

  // ---- The Manager AI (Stage 2): plans, uses specialist bots only when needed, checks and combines the result ----
  const manager = new ManagerService({
    db,
    preflight: (run, proceedAnyway) => assessExecution(capabilitiesRef, audit, { kind: "manager", id: run.id, goal: run.goal, source: run.requestedBy, proceedAnyway }),
    now,
    engine,
    getTask: (id) => taskRepo.getTask(id),
    complete: (input) => llm.complete(input),
    listBots: () => agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, role: b.role, responsibilities: b.responsibilities, archived: b.archived, model: b.model, runtime: b.runtime })),
    audit,
    validateModel: (ref) => catalog.validateModelRef(ref),
    // One source of truth: the capability registry (built below). Until it exists the older tool list answers.
    toolsSummary: () => (capabilitiesRef ? capabilitiesRef.planningSummary() : tools.summary()),
    ...(options.managerPollMs ? { pollMs: options.managerPollMs } : {}),
  });
  manager.recoverInterrupted();
  app.decorate("manager", manager);
  // ---- Capability registry and feasibility checker (M1, M2): read-only views over facts the services above already hold. ----
  const LOCAL_ONLY = new Set(["pc", "documents", "memory", "business"]);
  const capabilities = new CapabilityService({
    tools: (fresh) => (fresh ? tools.refresh() : tools.list()),
    kv: { get: (k) => approvalRepo.getSetting(k), set: (k, v) => approvalRepo.setSetting(k, v, new Date(now()).toISOString()) },
    probeFfmpeg: () => (options.toolRunner ?? realRunner)("ffmpeg", ["-version"]),
    // A file-exists check only (nothing is started or opened); tests that inject their own tool runner never look at the real machine.
    vmwareFound: () => (options.toolRunner ? null : ["C:/Program Files (x86)/VMware/VMware Workstation/vmware.exe", "C:/Program Files/VMware/VMware Workstation/vmware.exe"].some((f) => existsSync(f))),
    audit,
    now,
    facts: () => ({
      agents: (() => {
        const vCounts = verification.countsByBot();
        const done = new Map<string, { completed: number; failed: number }>();
        for (const row of db.prepare("SELECT assignee_bot_id AS b, status AS s, COUNT(*) AS n FROM tasks WHERE status IN ('completed', 'failed') GROUP BY assignee_bot_id, status").all()) {
          const e = done.get(String(row["b"])) ?? { completed: 0, failed: 0 };
          if (row["s"] === "completed") e.completed = Number(row["n"]);
          else e.failed = Number(row["n"]);
          done.set(String(row["b"]), e);
        }
        return agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, role: b.role, status: b.status, runtime: b.runtime, model: b.model, completedTasks: done.get(b.id)?.completed ?? 0, failedTasks: done.get(b.id)?.failed ?? 0, verifiedTasks: vCounts.get(b.id)?.verified ?? 0, contradictedTasks: vCounts.get(b.id)?.contradicted ?? 0 }));
      })(),
      workflows: (() => {
        const runs = new Map<string, { completed: number; failed: number }>();
        for (const row of db.prepare("SELECT workflow_id AS w, status AS s, COUNT(*) AS n FROM workflow_runs WHERE status IN ('completed', 'failed') GROUP BY workflow_id, status").all()) {
          const e = runs.get(String(row["w"])) ?? { completed: 0, failed: 0 };
          if (row["s"] === "completed") e.completed = Number(row["n"]);
          else e.failed = Number(row["n"]);
          runs.set(String(row["w"]), e);
        }
        return workflows.list(false).map((w) => ({
          id: w.id,
          name: w.name,
          enabled: w.enabled,
          problems: w.problems.length,
          botIds: w.graph.nodes.flatMap((n) => (n.type === "bot_task" || n.type === "integration" ? [n.botId] : [])),
          connectors: [...new Set(w.graph.nodes.flatMap((n) => (n.type === "integration" ? [n.connector] : [])))],
          usesManager: w.graph.nodes.some((n) => n.type === "manager"),
          lastRunStatus: w.lastRun?.status ?? null,
          completedRuns: runs.get(w.id)?.completed ?? 0,
          failedRuns: runs.get(w.id)?.failed ?? 0,
        }));
      })(),
      integrations: registry.list().map((c) => {
        const reason = c.notReady ? c.notReady({ secret: (n) => vault.resolve(n) }) : null;
        const check = audit.latest(["integration.verified", "integration.verify_failed"], [`"id":"${c.id}"`]);
        const used = audit.latest(["approval.executed"], [`"action":"${c.id}.`]);
        const read = audit.latest(["external.read"], [`"action":"${c.id}.`, `"ok":true`]);
        const acts = Object.values(c.actions);
        return {
          id: c.id,
          label: c.label,
          notReady: reason,
          lastCheck: check ? { ok: check.kind === "integration.verified", at: check.createdAt, text: String(check.detail["summary"] ?? check.detail["message"] ?? ""), local: check.detail["local"] === true } : null,
          lastUseAt: [used?.createdAt, read?.createdAt].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null,
          needsSignIn: !LOCAL_ONLY.has(c.id),
          readActions: acts.filter((a) => a.kind === "read").length,
          writeActions: acts.filter((a) => a.kind === "write").length,
        };
      }),
      providers: catalog.listProviders().map((p) => ({
        id: p.id, name: p.displayName, kind: p.kind, simulated: p.simulated, enabled: p.enabled, keyConfigured: p.keyConfigured, freeConfirmed: p.freeConfirmed,
        requiresFreeConfirmation: p.requiresFreeConfirmation, costClass: p.profile?.costClass ?? null, status: p.status, statusMessage: p.statusMessage,
        lastCheckedAt: p.lastCheckedAt, requestsToday: p.requestsToday, dailyRequestCap: p.dailyRequestCap,
      })),
      models: catalog.listModels().map((m) => ({ ref: m.ref, providerId: m.providerId, callable: m.callable, verification: m.verification, routable: m.routable, retired: m.retired })),
      environment: {
        guardian: (() => { const g = guardian?.view(); return { configured: g?.configured ?? false, reachable: g?.reachable ?? false, held: g?.held ?? null, tier: g?.tier ?? null, passphraseSet: g?.passphraseSet ?? null, protectsOwnerActions: g?.protectsOwnerActions ?? false }; })(),
        approvalsPaused: gate.isPaused(),
        groupsEnabled: groupsRef?.enabled() ?? false,
        pcRoots: pcService.roots().length,
        pcStopped: pcService.isStopped(),
      },
    }),
  });
  capabilitiesRef = capabilities;
  app.decorate("capabilities", capabilities);
  if (options.capabilityPollMs) capabilities.start(options.capabilityPollMs);
  app.addHook("onClose", async () => capabilities.stop());
  await registerCapabilityRoutes(app, capabilities, audit);
  await registerManagerRoutes(app, manager, capabilities, audit);
  const workforce = new WorkforceService({
    db,
    audit,
    kv: { get: (k) => approvalRepo.getSetting(k), set: (k, v) => approvalRepo.setSetting(k, v, new Date(now()).toISOString()) },
    groups: groupsRef,
    archiveBot: (id) => agentService.archiveBot(id),
    managerSpecialists: () => manager.settings().allowedBots,
    now,
  });
  app.decorate("workforce", workforce);
  await registerWorkforceRoutes(app, workforce);
  const delegation = new DelegationService(taskRepo, engine, (id) => agentService.getBot(id), now, projects, (rootId, save) => workspace.expect(rootId, save));
  await registerDelegationRoutes(app, delegation, engine, capabilities, audit);
  // The AI Assistant edits only through the existing services (projects, knowledge, agents, tasks). Restricted requests are refused and logged; nothing here can delete, approve, send or change permissions.
  await registerAssistantRoutes(app, new AssistantActions({ db, audit, projects, knowledge, agents: agentService, cancelTask: (id) => void delegation.cancel(id), complete: (input) => llm.complete(input), now }), db, now, guardian ? (token: string) => guardian.checkProof(token) : undefined, capabilities);

  // ---- Automation: schedules and text triggers. They start tasks through the engine above, so every
  // limit, the pause switches and the free-only gate apply. The clock is started by server.ts, not here. ----
  automation = new AutomationService({ repo: new AutomationRepository(db), engine, llm, getBot: (id) => agentService.getBot(id), now, startGuard: guardianHeld });
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
  // Recommendations about the workforce itself (read from the live services; only the teamwork limits can be applied, the rest is advice).
  registerWorkforceRecommendations(recommendations, {
    bots: () => agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, status: b.status, model: b.model, readConnectorsOn: b.permissions.filter((p) => p.readEnabled).length })),
    delegation: { get: () => engine.limits(), defaults: () => mergeDelegationLimits(null), set: (u) => void engine.updateLimits(u) },
    schedules: () => automation!.listSchedules().map((x) => ({ name: x.name, enabled: x.enabled, consecutiveFailures: x.consecutiveFailures, disabledReason: x.disabledReason })),
    automationPaused: () => automation!.isPaused(),
    phoneAlerts: () => ({ subscriptions: push.count() }),
    memory: () => {
      const bots = agentService.listBots(false);
      const st = bots.map((b) => memory.settings(b.id));
      return { totalBots: bots.length, botsUsingPrivate: st.filter((x) => x.usePrivate).length, botsUsingShared: st.filter((x) => x.useShared).length };
    },
  });
  // ---- Workflows (Stage 6): drawn as boxes and arrows, with a saved queue that survives restarts ----
  const workflows = new WorkflowService({
    actions: { request: (botId, taskId, req, link) => gate.request(botId, taskId, req, link), exists: (connector, action) => registry.action(connector, action) !== undefined },
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
    automationPaused: () => automation!.isPaused() || guardianHeld() !== null,
    ...(options.managerPollMs ? { pollMs: options.managerPollMs } : {}),
  });
  workflows.recover();
  workflows.reconcileApprovalsAfterRestart();
  automation.addEventListener((name, text) => workflows.onEvent(name, text));
  app.decorate("workflows", workflows);
  await registerWorkflowRoutes(app, workflows, { agents: () => agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, role: b.role })), complete: (input) => llm.complete(input), audit }, (workflowId) => capabilities.get(`workflow:${workflowId}`));
  // The built-in demonstration environment: a simulated AI provider plus editable sample agents and workflows. Makes no outside request.
  await registerDemoRoutes(app, new DemoService({
    catalog,
    audit,
    bots: {
      list: () => agentService.listBots(true).map((b) => ({ id: b.id, name: b.name, archived: b.archived, status: b.status })),
      create: (input) => agentService.createBot(input),
      update: (id, input) => agentService.updateBot(id, input),
    },
    workflows: { list: (a) => workflows.list(a), create: (i) => workflows.create(i) },
  }));
  await registerBusinessTeamRoutes(app, {
    bots: {
      list: () => agentService.listBots(false).map((b) => ({ id: b.id, name: b.name, archived: b.archived, status: b.status, model: b.model })),
      create: (input) => agentService.createBot(input),
      setWebRead: (id) => void agentService.setReadPermission(id, "browser", true),
    },
    skills: {
      list: () => skillService!.list(),
      create: (content) => skillService!.create(content),
      assignedTo: (id) => skillService!.assignedTo(id),
      assign: (id, skillIds) => void skillService!.setBotSkills(id, skillIds),
    },
    manager: { allowed: () => manager.settings().allowedBots, setAllowed: (ids) => void manager.updateSettings({ allowedBots: ids }) },
    workflows: { list: () => workflows.list(true), create: (name, graph) => workflows.create({ name, graph }) },
  });
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
    automationPaused: () => automation!.isPaused() || guardianHeld() !== null,
    remoteEnabled: remoteHosts.length > 0,
  });
  if (options.dashboardDir) registerDashboard(app, options.dashboardDir);

  return app;
}
