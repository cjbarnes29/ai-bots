import type { BotRecord } from "../agent-manager/types.js";
import { AppError } from "../errors.js";
import type { ProjectService } from "../projects/service.js";
import type { TaskEngine } from "./engine.js";
import { DEFAULT_DELEGATION_LIMITS } from "./limits.js";
import type { DelegationAuditRecord, TaskEventRecord, TaskRecord, TaskRepository, TeamMember } from "./repository.js";

export interface TaskNode extends TaskRecord {
  children: TaskNode[];
}

export interface TaskTree {
  task: TaskNode;
  events: TaskEventRecord[];
  totals: { tasks: number; llmCalls: number; inputTokens: number; outputTokens: number };
}

export interface RootSummary extends TaskRecord {
  chainTasks: number;
  chainLlmCalls: number;
}

const MAX_TEAMMATES = 20;

export class DelegationService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly engine: TaskEngine,
    private readonly getBot: (id: string) => BotRecord,
    private readonly now: () => number = Date.now,
    /** Projects, so a task can be started inside one (its agents then share that project's workspace). */
    private readonly projects?: Pick<ProjectService, "get" | "link">,
    /** Tells the project workspace that this task must save its result there (checked when the task answers). */
    private readonly expectSave?: (rootTaskId: string, save: boolean) => void,
  ) {}

  // ---- the allow-list: who each bot may delegate to (empty by default) ----

  getTeam(botId: string): { targets: TeamMember[]; audit: DelegationAuditRecord[] } {
    this.getBot(botId);
    return { targets: this.repo.listTargets(botId), audit: this.repo.listAudit(botId) };
  }

  setTeam(botId: string, targetBotIds: string[]): { targets: TeamMember[]; audit: DelegationAuditRecord[] } {
    const bot = this.getBot(botId);
    if (bot.archived) throw new AppError(409, "bot_archived", "This bot is archived. Unarchive it first.");
    const ids = [...new Set(targetBotIds)];
    if (ids.length > MAX_TEAMMATES) {
      throw new AppError(400, "too_many_teammates", `A bot can have at most ${MAX_TEAMMATES} teammates.`);
    }
    const existing = new Set(this.repo.listTargets(botId).map((t) => t.id));
    for (const id of ids) {
      if (id === botId) throw new AppError(400, "invalid_teammate", "A bot cannot delegate to itself.");
      let target: BotRecord;
      try {
        target = this.getBot(id);
      } catch {
        throw new AppError(400, "invalid_teammate", "One of the chosen teammates does not exist.");
      }
      if (target.archived && !existing.has(id)) {
        throw new AppError(400, "invalid_teammate", `${target.name} is archived and cannot be added as a teammate.`);
      }
    }
    this.repo.transaction(() => this.repo.replaceTargets(botId, ids, new Date(this.now()).toISOString()));
    return this.getTeam(botId);
  }

  // ---- tasks ----

  /**
   * Starts a task. With a project, the task is linked to it before it can start running (the engine starts queued work on a later tick),
   * so its very first model call already gets the project's shared workspace.
   */
  submit(botId: string, instruction: string, projectId?: string, opts: { saveToWorkspace?: boolean; proceedAnyway?: boolean } = {}): TaskRecord {
    if (projectId) {
      if (!this.projects) throw new AppError(400, "projects_unavailable", "Projects are not available here.");
      const p = this.projects.get(projectId);
      if (p.archived) throw new AppError(409, "project_archived", "That project is archived. Unarchive it first.");
    }
    const task = this.engine.submit(botId, instruction, { type: "user", proceedAnyway: opts.proceedAnyway === true });
    if (projectId) {
      this.projects!.link(projectId, "task", task.id);
      // In a project the agent must save its result to the workspace unless the owner said otherwise (a task that saves nothing is then not finished).
      this.expectSave?.(task.id, opts.saveToWorkspace ?? true);
    }
    return task;
  }

  cancel(taskId: string): TaskRecord {
    return this.engine.cancel(taskId);
  }

  listRoots(limit = 50): RootSummary[] {
    return this.repo.listRoots(limit).map((root) => {
      const chain = this.repo.listChain(root.id);
      return { ...root, chainTasks: chain.length, chainLlmCalls: chain.reduce((n, t) => n + t.llmCalls, 0) };
    });
  }

  getTree(rootId: string): TaskTree {
    const root = this.repo.getTask(rootId);
    if (!root || root.parentId !== null) throw new AppError(404, "task_not_found", "Task not found");
    const chain = this.repo.listChain(rootId);
    const nodes = new Map<string, TaskNode>(chain.map((t) => [t.id, { ...t, children: [] }]));
    for (const node of nodes.values()) {
      if (node.parentId) nodes.get(node.parentId)?.children.push(node);
    }
    return {
      task: nodes.get(rootId)!,
      events: this.repo.listEvents(rootId),
      totals: {
        tasks: chain.length,
        llmCalls: chain.reduce((n, t) => n + t.llmCalls, 0),
        inputTokens: chain.reduce((n, t) => n + t.inputTokens, 0),
        outputTokens: chain.reduce((n, t) => n + t.outputTokens, 0),
      },
    };
  }

  limits() {
    return { limits: this.engine.limits(), defaults: { ...DEFAULT_DELEGATION_LIMITS } };
  }
}
