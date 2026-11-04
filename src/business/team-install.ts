import type { SkillContent } from "../skills/service.js";
import { AGENT_TEMPLATES, SKILL_TEMPLATES, WORKFLOW_NAME, workflowGraph, type AgentTemplate } from "./team.js";

/**
 * Installing the Business team. It only calls the same services the dashboard already uses, and it is safe to repeat:
 * - an agent, skill or workflow that already exists (by name) is reused and NOT changed;
 * - a NEW agent is created switched off, and gets only its role's skills and (where its role needs it) the web-reading switch;
 * - the Manager's list of specialists only ever grows by these agents; nobody is removed;
 * - the workflow is created switched OFF.
 * Nothing is run, sent or contacted by installing.
 */
export interface TeamDeps {
  bots: {
    list(): { id: string; name: string; archived: boolean; status: string; model: string | null }[];
    create(input: { name: string; role: string; personality: string; instructions: string; responsibilities: string[]; changeNote: string }): { id: string; name: string };
    setWebRead(botId: string): void;
  };
  skills: {
    list(): Promise<{ id: string; name: string; archived: boolean }[]>;
    create(content: SkillContent): Promise<{ id: string; name: string }>;
    assignedTo(botId: string): string[];
    assign(botId: string, skillIds: string[]): void;
  };
  manager: { allowed(): string[]; setAllowed(ids: string[]): void };
  workflows: { list(): { id: string; name: string; archived: boolean }[]; create(name: string, graph: unknown): { id: string; name: string } };
}

export interface TeamStatus {
  agents: { key: AgentTemplate["key"]; name: string; role: string; webRead: boolean; skills: string[]; exists: boolean; id: string | null; status: string | null; hasModel: boolean }[];
  skills: { name: string; exists: boolean }[];
  workflow: { name: string; exists: boolean };
  managerAllowsAll: boolean;
}

export interface InstallResult {
  agents: { key: string; name: string; id: string; created: boolean }[];
  skills: { name: string; created: boolean }[];
  workflow: { name: string; created: boolean };
  managerAdded: number;
  notes: string[];
}

const live = <T extends { archived: boolean }>(list: T[]) => list.filter((x) => !x.archived);

export async function teamStatus(d: TeamDeps): Promise<TeamStatus> {
  const bots = live(d.bots.list());
  const skills = live(await d.skills.list());
  const allowed = new Set(d.manager.allowed());
  const agents = AGENT_TEMPLATES.map((t) => {
    const b = bots.find((x) => x.name === t.name);
    return { key: t.key, name: t.name, role: t.role, webRead: t.webRead, skills: t.skills, exists: !!b, id: b?.id ?? null, status: b?.status ?? null, hasModel: !!b?.model };
  });
  return {
    agents,
    skills: SKILL_TEMPLATES.map((s) => ({ name: s.name, exists: skills.some((x) => x.name === s.name) })),
    workflow: { name: WORKFLOW_NAME, exists: live(d.workflows.list()).some((w) => w.name === WORKFLOW_NAME) },
    managerAllowsAll: agents.every((a) => a.id !== null && allowed.has(a.id)),
  };
}

export async function installTeam(d: TeamDeps): Promise<InstallResult> {
  const notes: string[] = [];
  const bots = live(d.bots.list());

  // Skills first, so a new agent can be given its skills straight away.
  const skillIds = new Map<string, string>();
  const skillResult: InstallResult["skills"] = [];
  const existingSkills = live(await d.skills.list());
  for (const s of SKILL_TEMPLATES) {
    const found = existingSkills.find((x) => x.name === s.name);
    if (found) {
      skillIds.set(s.name, found.id);
      skillResult.push({ name: s.name, created: false });
    } else {
      const made = await d.skills.create(s);
      skillIds.set(s.name, made.id);
      skillResult.push({ name: s.name, created: true });
    }
  }

  const agentResult: InstallResult["agents"] = [];
  for (const t of AGENT_TEMPLATES) {
    const found = bots.find((b) => b.name === t.name);
    if (found) {
      agentResult.push({ key: t.key, name: t.name, id: found.id, created: false });
      notes.push(`${t.name} already exists, so it was left exactly as it is (its permissions and skills were not touched).`);
      continue;
    }
    const made = d.bots.create({ name: t.name, role: t.role, personality: t.personality, instructions: t.instructions, responsibilities: t.responsibilities, changeNote: "Created from the Business team template" });
    if (t.webRead) d.bots.setWebRead(made.id);
    d.skills.assign(
      made.id,
      [...new Set([...d.skills.assignedTo(made.id), ...t.skills.map((n) => skillIds.get(n)).filter((id): id is string => !!id)])],
    );
    agentResult.push({ key: t.key, name: t.name, id: made.id, created: true });
  }

  // The Manager may hand steps to these agents. The list only grows.
  const current = d.manager.allowed();
  const wanted = agentResult.map((a) => a.id);
  const missing = wanted.filter((id) => !current.includes(id));
  if (missing.length > 0) d.manager.setAllowed([...current, ...missing]);

  const idOf = (key: string) => agentResult.find((a) => a.key === key)!.id;
  const hasWorkflow = live(d.workflows.list()).some((w) => w.name === WORKFLOW_NAME);
  if (!hasWorkflow) d.workflows.create(WORKFLOW_NAME, workflowGraph({ lead_scout: idOf("lead_scout"), site_auditor: idOf("site_auditor"), proposal_writer: idOf("proposal_writer") }));

  if (agentResult.some((a) => a.created)) notes.push("New agents are switched OFF. Choose a model for each one (or leave it on Automatic) and switch it on when you are ready.");
  notes.push("Outside requests for discovery and website checks stay OFF until you switch them on in the Business Workforce page.");
  return { agents: agentResult, skills: skillResult, workflow: { name: WORKFLOW_NAME, created: !hasWorkflow }, managerAdded: missing.length, notes };
}
