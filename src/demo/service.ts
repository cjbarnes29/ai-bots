import type { ModelCatalogService, ModelView, ProviderView } from "../llm/catalog.js";
import type { WorkflowView } from "../workflows/service.js";
import { CAPABILITY_MAP, DEMO_PREFIX, SAMPLE_BOTS, SAMPLE_WORKFLOWS, type SampleBot, type SampleIds } from "./samples.js";

export interface DemoDeps {
  catalog: ModelCatalogService;
  bots: {
    list(): { id: string; name: string; archived: boolean; status: string }[];
    create(input: { name: string; role: string; instructions: string; changeNote: string }): { id: string };
    update(id: string, input: { model: string; status: "active"; changeNote: string }): unknown;
  };
  workflows: { list(includeArchived: boolean): WorkflowView[]; create(input: { name: string; graph: unknown }): unknown };
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void };
}

export interface DemoStatus {
  provider: Pick<ProviderView, "enabled" | "status" | "statusMessage" | "modelCount" | "enabledModelCount">;
  ready: boolean;
  bots: { key: string; name: string; id: string | null; status: string | null }[];
  workflows: { name: string; id: string | null; summary: string }[];
  capabilities: typeof CAPABILITY_MAP;
}

/** Sets up and describes the demonstration environment. Everything it creates is an ordinary, editable agent or workflow with no permissions; nothing is sent anywhere. */
export class DemoService {
  constructor(private readonly d: DemoDeps) {}

  private demoModels(): ModelView[] {
    return this.d.catalog.listModels("demo");
  }

  status(): DemoStatus {
    const p = this.d.catalog.getProviderView("demo");
    const bots = this.d.bots.list();
    const wfs = this.d.workflows.list(false);
    const ready = p.enabled && this.demoModels().some((m) => m.enabled && m.callable);
    return {
      provider: { enabled: p.enabled, status: p.status, statusMessage: p.statusMessage, modelCount: p.modelCount, enabledModelCount: p.enabledModelCount },
      ready,
      bots: SAMPLE_BOTS.map((s) => {
        const b = bots.find((x) => x.name === s.name && !x.archived);
        return { key: s.key, name: s.name, id: b?.id ?? null, status: b?.status ?? null };
      }),
      workflows: SAMPLE_WORKFLOWS.map((w) => ({ name: w.name, id: wfs.find((x) => x.name === w.name)?.id ?? null, summary: w.summary })),
      capabilities: CAPABILITY_MAP,
    };
  }

  /** Idempotent: anything that already exists (by name) is left exactly as the owner edited it. */
  async setup(): Promise<DemoStatus> {
    this.d.catalog.updateProvider("demo", { enabled: true });
    const { models } = await this.d.catalog.refreshModels("demo");
    for (const m of models) if (!m.enabled && m.callable) this.d.catalog.setModelEnabled(m.id, true);

    const ids = {} as SampleIds;
    for (const s of SAMPLE_BOTS) ids[s.key] = this.ensureBot(s);
    const known = this.d.workflows.list(true);
    for (const w of SAMPLE_WORKFLOWS) {
      if (!known.some((x) => x.name === w.name)) this.d.workflows.create({ name: w.name, graph: w.build(ids) });
    }
    this.d.audit.record("demo.setup", {}, { actor: "owner" });
    return this.status();
  }

  private ensureBot(s: SampleBot): string {
    const existing = this.d.bots.list().find((b) => b.name === s.name && !b.archived);
    if (existing) return existing.id;
    const bot = this.d.bots.create({ name: s.name, role: s.role, instructions: s.instructions, changeNote: `${DEMO_PREFIX}sample agent` });
    // The same two steps the owner takes by hand: choose a model, then switch the agent on. Permissions stay off.
    this.d.bots.update(bot.id, { model: s.model, status: "active", changeNote: "Uses the built-in simulated model" });
    return bot.id;
  }
}
