import { describe, expect, it } from "vitest";
import { canYouAnswer, canYouGoal, isOverviewQuestion, overviewAnswer } from "./explain.js";
import { buildCapabilities, type AgentFact, type Capability, type CapabilityFacts, type ModelFact, type ProviderFact, type WorkflowFact } from "./registry.js";
import { CapabilityService, diffSnapshots, type CapabilityDeps } from "./service.js";
import type { ToolInfo } from "../tools/registry.js";

/* Simulated discovery scenarios: a mutable fake world, no real service, key, program or network. */
const provider = (o: Partial<ProviderFact> & { id: string }): ProviderFact => ({ name: o.id, kind: "cloud", simulated: false, enabled: true, keyConfigured: true, freeConfirmed: true, requiresFreeConfirmation: true, costClass: "free_with_limits", status: "connected", statusMessage: null, lastCheckedAt: "t", requestsToday: 1, dailyRequestCap: 50, ...o });
const model = (ref: string, o: Partial<ModelFact> = {}): ModelFact => ({ ref, providerId: ref.split("/")[0]!, callable: true, verification: "verified", routable: true, retired: false, ...o });
const agent = (id: string, o: Partial<AgentFact> = {}): AgentFact => ({ id, name: `Agent ${id}`, role: "Helper", status: "active", runtime: "builtin", model: "groq/a", completedTasks: 0, failedTasks: 0, ...o });
const workflow = (id: string, o: Partial<WorkflowFact> = {}): WorkflowFact => ({ id, name: `Flow ${id}`, enabled: true, problems: 0, botIds: [], usesManager: false, lastRunStatus: null, completedRuns: 0, failedRuns: 0, ...o });
const tool = (id: string, status: ToolInfo["status"], detail = "ok", category: ToolInfo["category"] = "coding"): ToolInfo => ({ id, name: id, category, description: id, status, detail, requiresAssignment: false });

interface World {
  tools: ToolInfo[];
  providers: ProviderFact[];
  models: ModelFact[];
  agents: AgentFact[];
  workflows: WorkflowFact[];
  integrations: CapabilityFacts["integrations"];
  guardianHeld: string | null;
  ffmpeg: string | null;
}
function world(): World {
  return { tools: [tool("node", "available", "v24")], providers: [provider({ id: "groq" })], models: [model("groq/a")], agents: [], workflows: [], integrations: [], guardianHeld: null, ffmpeg: null };
}
const kvStore = () => {
  const m = new Map<string, string>();
  return { map: m, kv: { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) } };
};
function setup(w: World, kv?: CapabilityDeps["kv"]) {
  const events: { kind: string; detail: Record<string, unknown> }[] = [];
  const svc = new CapabilityService({
    tools: async () => w.tools,
    probeFfmpeg: async () => w.ffmpeg,
    facts: () => ({
      integrations: w.integrations,
      providers: w.providers,
      models: w.models,
      agents: w.agents,
      workflows: w.workflows,
      environment: { guardian: { configured: true, reachable: true, held: w.guardianHeld, tier: "A", passphraseSet: true, protectsOwnerActions: true }, approvalsPaused: false, groupsEnabled: false, pcRoots: 1, pcStopped: false },
    }),
    audit: { record: (kind, detail = {}) => void events.push({ kind, detail }), recent: (kinds, limit) => events.filter((e) => kinds.includes(e.kind)).slice(-limit).reverse().map((e, i) => ({ id: i, createdAt: "t", kind: e.kind, detail: e.detail })) },
    ...(kv ? { kv } : {}),
    now: () => 0,
  });
  return { svc, events };
}
const find = (caps: Capability[], id: string) => caps.find((c) => c.id === id);
const changed = (events: { kind: string; detail: Record<string, unknown> }[]) => events.filter((e) => e.kind === "capability.changed");

describe("registration: things register themselves", () => {
  it("an agent that exists appears with all six levels; nobody maintains a list", async () => {
    const w = world();
    w.agents = [agent("1", { completedTasks: 3 })];
    const { svc } = setup(w);
    const a = find(await svc.list(), "agent:1")!;
    expect(a.group).toBe("agent");
    expect(Object.keys(a.levels)).toEqual(["installed", "configured", "authenticated", "operational", "tested", "verified"]);
    expect(a.levels.operational.state).toBe("yes");
    expect(a.levels.verified.state).toBe("no");
  });

  it("an agent that has never completed a task is 'unverified', not 'available'; tested and verified are not claimed", async () => {
    const w = world();
    w.agents = [agent("1")];
    const a = find(await setup(w).svc.list(), "agent:1")!;
    expect(a.state).toBe("unverified");
    expect(a.levels.operational.state).toBe("unknown");
    expect(a.levels.tested.state).toBe("unknown");
  });

  it("disabled, model-less and openclaw agents need setup; an agent whose model is unusable is partial", async () => {
    const w = world();
    w.agents = [agent("off", { status: "disabled" }), agent("nomodel", { model: null }), agent("claw", { runtime: "openclaw" }), agent("bad", { model: "groq/missing" })];
    const caps = await setup(w).svc.list();
    expect(find(caps, "agent:off")!.state).toBe("needs_setup");
    expect(find(caps, "agent:nomodel")!.state).toBe("needs_setup");
    expect(find(caps, "agent:claw")!.state).toBe("needs_setup");
    expect(find(caps, "agent:bad")!.levels.operational.state).toBe("no");
  });

  it("an agent on automatic routing depends on the aggregate model capability", async () => {
    const w = world();
    w.agents = [agent("auto", { model: "auto/general", completedTasks: 1 })];
    expect(find(await setup(w).svc.list(), "agent:auto")!.state).toBe("available");
    w.models = [];
    expect(find(await setup(w).svc.list(), "agent:auto")!.levels.operational.state).toBe("no");
  });

  it("each usable model appears individually; a provider's unusable and retired models do not", async () => {
    const w = world();
    w.models = [model("groq/a"), model("groq/b", { verification: "unverified", routable: false }), model("groq/off", { callable: false, verification: "unverified", routable: false }), model("groq/old", { retired: true })];
    const caps = await setup(w).svc.list();
    expect(find(caps, "model:groq/a")!.state).toBe("available");
    expect(find(caps, "model:groq/a")!.levels.verified.state).toBe("yes");
    expect(find(caps, "model:groq/b")!.state).toBe("partial");
    expect(find(caps, "model:groq/off")).toBeUndefined();
    expect(find(caps, "model:groq/old")).toBeUndefined();
  });

  it("a simulated model is never verified", async () => {
    const w = world();
    w.providers = [provider({ id: "demo", simulated: true, status: null })];
    w.models = [model("demo/x")];
    const m = find(await setup(w).svc.list(), "model:demo/x")!;
    expect(m.cost).toBe("simulated");
    expect(m.levels.verified.state).toBe("no");
  });

  it("a workflow registers, and is partial when an agent it uses cannot run", async () => {
    const w = world();
    w.agents = [agent("1", { completedTasks: 1 }), agent("2", { status: "disabled" })];
    w.workflows = [workflow("ok", { botIds: ["1"], completedRuns: 2, lastRunStatus: "completed" }), workflow("dep", { botIds: ["1", "2"] }), workflow("gone", { botIds: ["404"] }), workflow("mgr", { usesManager: true })];
    const caps = await setup(w).svc.list();
    expect(find(caps, "workflow:ok")!.state).toBe("available");
    expect(find(caps, "workflow:dep")!.state).toBe("partial");
    expect(find(caps, "workflow:dep")!.missing.join(" ")).toMatch(/Agent 2/);
    expect(find(caps, "workflow:gone")!.missing.join(" ")).toMatch(/no longer exists/);
    expect(find(caps, "workflow:mgr")!.state).not.toBe("partial");
  });

  it("an invalid or switched-off workflow needs setup; a failed last run is not operational", async () => {
    const w = world();
    w.workflows = [workflow("bad", { problems: 2 }), workflow("off", { enabled: false }), workflow("failed", { lastRunStatus: "failed", failedRuns: 1 })];
    const caps = await setup(w).svc.list();
    expect(find(caps, "workflow:bad")!.state).toBe("needs_setup");
    expect(find(caps, "workflow:off")!.state).toBe("needs_setup");
    expect(find(caps, "workflow:failed")!.levels.operational.state).toBe("no");
  });

  it("older callers that pass no agents or workflows still work", () => {
    const caps = buildCapabilities({ tools: [], integrations: [], providers: [], models: [], environment: { platform: "win32", nodeVersion: "v", cpuThreads: 1, ramGb: 1, guardian: { configured: false, reachable: false, held: null, tier: null, passphraseSet: null, protectsOwnerActions: false }, approvalsPaused: false, groupsEnabled: false, pcRoots: 0, pcStopped: false, ffmpeg: null } });
    expect(caps.some((c) => c.group === "agent")).toBe(false);
  });
});

describe("discovery: additions, removals and changes are noticed and logged", () => {
  it("the first listing sets a baseline and records no change", async () => {
    const { svc, events } = setup(world());
    await svc.list();
    expect(events.map((e) => e.kind)).toEqual(["capability.baseline"]);
  });

  it("a new agent is reported as added, then an archived agent as removed", async () => {
    const w = world();
    const { svc, events } = setup(w);
    await svc.list();
    w.agents = [agent("1")];
    await svc.list();
    expect(changed(events)[0]!.detail).toMatchObject({ added: 1, removed: 0 });
    expect((changed(events)[0]!.detail["changes"] as { id: string; kind: string }[])[0]).toMatchObject({ id: "agent:1", kind: "added" });
    w.agents = [];
    await svc.list();
    expect(changed(events)[1]!.detail).toMatchObject({ removed: 1 });
    expect(find(await svc.list(), "agent:1")).toBeUndefined();
  });

  it("a new workflow and a deleted model are noticed", async () => {
    const w = world();
    const { svc, events } = setup(w);
    await svc.list();
    w.workflows = [workflow("w")];
    w.models = [];
    await svc.list();
    const ids = (changed(events)[0]!.detail["changes"] as { id: string; kind: string }[]).map((c) => `${c.kind}:${c.id}`);
    expect(ids).toEqual(expect.arrayContaining(["added:workflow:w", "removed:model:groq/a"]));
  });

  it("authentication changes are named: a provider that starts rejecting its key", async () => {
    const w = world();
    const { svc, events } = setup(w);
    await svc.list();
    w.providers = [provider({ id: "groq", status: "auth_failed", statusMessage: "refused" })];
    await svc.list();
    const c = (changed(events)[0]!.detail["changes"] as { id: string; aspects: string[]; from: string; to: string }[]).find((x) => x.id === "model-provider:groq")!;
    expect(c.aspects).toContain("authentication");
    expect(c.to).toBe("needs_setup");
  });

  it("configuration changes are named: a provider switched off", async () => {
    const w = world();
    const { svc, events } = setup(w);
    await svc.list();
    w.providers = [provider({ id: "groq", enabled: false })];
    await svc.list();
    const c = (changed(events)[0]!.detail["changes"] as { id: string; aspects: string[] }[]).find((x) => x.id === "model-provider:groq")!;
    expect(c.aspects).toContain("configuration");
  });

  it("operational changes are named: a connector gets its first successful use, then a program disappears", async () => {
    const w = world();
    w.tools = [tool("node", "available", "v24"), tool("telegram", "available", "Ready", "communication")];
    w.integrations = [{ id: "telegram", label: "Telegram", notReady: null, lastCheck: { ok: true, at: "t", text: "ok", local: false }, lastUseAt: null, needsSignIn: true, readActions: 1, writeActions: 1 }];
    const { svc, events } = setup(w);
    await svc.list();
    w.integrations = [{ ...w.integrations[0]!, lastUseAt: "later" }];
    await svc.list();
    const first = (changed(events)[0]!.detail["changes"] as { id: string; aspects: string[] }[]).find((x) => x.id === "telegram")!;
    expect(first.aspects).toContain("verification");
    w.tools = [tool("telegram", "available", "Ready", "communication")];
    await svc.list();
    const gone = (changed(events)[1]!.detail["changes"] as { id: string; kind: string }[]).find((x) => x.id === "node")!;
    expect(gone.kind).toBe("removed");
  });

  it("a Guardian hold appears as a state change and clears again", async () => {
    const w = world();
    const { svc, events } = setup(w);
    await svc.list();
    w.guardianHeld = "the Windows session is locked";
    await svc.list();
    w.guardianHeld = null;
    await svc.list();
    const states = changed(events).map((e) => (e.detail["changes"] as { id: string; to: string }[]).find((c) => c.id === "env-guardian")?.to);
    expect(states[0]).toBe("partial");
    expect(states[1]).not.toBe("partial");
  });

  it("an unchanged world writes nothing", async () => {
    const { svc, events } = setup(world());
    await svc.list();
    await svc.list();
    await svc.list(true);
    expect(changed(events)).toHaveLength(0);
  });

  it("the baseline survives a restart through the settings store: changes made while the app was stopped are still reported", async () => {
    const w = world();
    const store = kvStore();
    await setup(w, store.kv).svc.list();
    expect(store.map.has("capabilities.snapshot")).toBe(true);
    w.agents = [agent("late")];
    const second = setup(w, store.kv);
    await second.svc.list();
    expect(second.events.map((e) => e.kind)).toEqual(["capability.changed"]);
    expect(second.events[0]!.detail).toMatchObject({ added: 1 });
  });

  it("a damaged stored baseline is rebuilt without error", async () => {
    const store = kvStore();
    store.map.set("capabilities.snapshot", "{not json");
    const { svc, events } = setup(world(), store.kv);
    await expect(svc.list()).resolves.toBeTruthy();
    expect(events[0]!.kind).toBe("capability.baseline");
  });

  it("the history comes back newest first from the audit log", async () => {
    const w = world();
    const { svc } = setup(w);
    await svc.list();
    w.agents = [agent("1")];
    await svc.list();
    w.agents = [];
    await svc.list();
    const h = svc.changes(10);
    expect(h[0]!.kind).toBe("capability.changed");
    expect(h.at(-1)!.kind).toBe("capability.baseline");
    expect(h).toHaveLength(3);
  });

  it("overlapping calls share one build", async () => {
    let probes = 0;
    const w = world();
    const svc = new CapabilityService({ tools: async () => (probes++, w.tools), probeFfmpeg: async () => null, facts: () => ({ integrations: [], providers: w.providers, models: w.models, environment: { guardian: { configured: false, reachable: false, held: null, tier: null, passphraseSet: null, protectsOwnerActions: false }, approvalsPaused: false, groupsEnabled: false, pcRoots: 0, pcStopped: false } }), audit: { record: () => undefined }, now: () => 0 });
    await Promise.all([svc.list(), svc.list(), svc.list()]);
    expect(probes).toBe(1);
  });

  it("diffSnapshots reports nothing for identical snapshots", () => {
    const s = { a: { n: "A", g: "tool" as const, s: "available" as const, l: "yyyyuu".replace(/u/g, "n") } };
    expect(diffSnapshots(s, { ...s })).toEqual([]);
  });
});

describe("single source of truth: every consumer reads the same current list", () => {
  it("the Manager's planning summary comes from the registry and does not call unproven things working", async () => {
    const w = world();
    w.tools = [tool("node", "available", "v24"), tool("telegram", "available", "Ready", "communication"), tool("image-generation", "unavailable", "Not built yet (Stage 5).", "graphics")];
    w.integrations = [{ id: "telegram", label: "Telegram", notReady: null, lastCheck: null, lastUseAt: null, needsSignIn: true, readActions: 1, writeActions: 1 }];
    const s = await setup(w).svc.planningSummary();
    expect(s.available).toEqual(["node"]);
    expect(s.notAvailable.join(" | ")).toMatch(/telegram \(set up but unproven/);
    expect(s.notAvailable).toContain("image-generation");
  });

  it("the planning summary updates when the world changes (no stale copy)", async () => {
    const w = world();
    const { svc } = setup(w);
    expect((await svc.planningSummary()).available).toContain("node");
    w.tools = [];
    expect((await svc.planningSummary()).available).not.toContain("node");
  });

  it("get() returns undefined for something that was removed", async () => {
    const w = world();
    w.workflows = [workflow("x")];
    const { svc } = setup(w);
    expect(await svc.get("workflow:x")).toBeTruthy();
    w.workflows = [];
    expect(await svc.get("workflow:x")).toBeUndefined();
  });
});

describe("the Assistant's answers use the current list", () => {
  const caps = async (w: World) => setup(w).svc.list();
  it("recognises capability questions and nothing else", () => {
    for (const q of ["What can you do?", "what can you do right now", "what can't you do?", "What are your capabilities", "list your abilities", "what works right now?"]) expect(isOverviewQuestion(q), q).toBe(true);
    for (const q of ["What can you tell me about Rome?", "Write about what you can do for my bakery in three paragraphs please and make it long", "open the project"]) expect(isOverviewQuestion(q), q).toBe(false);
    expect(canYouGoal("Can you send an email to my team?")).toBe("send an email to my team");
    expect(canYouGoal("Can you send an email")).toBeNull();
  });

  it("the overview separates what works, what is partial or unproven, and what cannot be done", async () => {
    const w = world();
    w.tools = [tool("node", "available", "v24"), tool("python", "unavailable", "Not found"), tool("telegram", "available", "Ready", "communication"), tool("image-generation", "unavailable", "Not built yet (Stage 5).", "graphics")];
    w.integrations = [{ id: "telegram", label: "Telegram", notReady: null, lastCheck: null, lastUseAt: null, needsSignIn: true, readActions: 1, writeActions: 1 }];
    w.agents = [agent("1", { completedTasks: 1 }), agent("2", { status: "disabled" })];
    const a = overviewAnswer(await caps(w));
    expect(a.can.join("|")).toMatch(/node/);
    expect(a.can.join("|")).not.toMatch(/telegram/);
    expect(a.partly.join("|")).toMatch(/telegram: set up, but never seen working/);
    expect(a.cannot.join("|")).toMatch(/python/);
    expect(a.cannot.join("|")).toMatch(/image-generation/);
    expect(a.can.join("|")).toMatch(/2 agent\(s\): 1 ready to run, 1 not ready/);
    expect(a.message).toMatch(/supervision/);
  });

  it("the same question gets a different answer after the world changes", async () => {
    const w = world();
    w.tools = [tool("python", "unavailable", "Not found")];
    expect(overviewAnswer(await caps(w)).cannot.join("|")).toMatch(/python/);
    w.tools = [tool("python", "available", "Python 3.12")];
    const after = overviewAnswer(await caps(w));
    expect(after.cannot.join("|")).not.toMatch(/python/);
    expect(after.can.join("|")).toMatch(/python/);
  });

  it("'can you X?' is assessed against the live list; plain text questions fall through to chat", async () => {
    const w = world();
    const c = await caps(w);
    expect(canYouAnswer("explain recursion to me", c)).toBeNull();
    const logo = canYouAnswer("design a logo for my bakery", c)!;
    expect(logo.message).toMatch(/^No, not as asked/);
    expect(logo.assessment.classification).toBe("unsupported");
    const tests = canYouAnswer("run the tests with npm", await caps({ ...w, tools: [tool("node", "available"), tool("npm", "available")] }))!;
    expect(tests.message).toMatch(/^Yes/);
  });

  it("with no verified model the answer says nothing can run", async () => {
    const w = world();
    w.models = [];
    w.providers = [];
    const a = canYouAnswer("email my team", await caps(w))!;
    expect(a.message).toMatch(/^No/);
    expect(a.cannot.join(" ")).toMatch(/no verified AI model/);
  });
});
