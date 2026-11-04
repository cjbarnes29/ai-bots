import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { ActionContext, ActionSpec, ConnectorDefinition } from "../types.js";
import { resolveInRoots } from "./paths.js";
import { ACTION_GRANT, PROGRAMS, checkCommand, checkInstall } from "./policy.js";
import { RUN_LIMITS } from "./runner.js";
import type { PcService } from "./service.js";

/**
 * The PC agent as a connector (Stage 4). It lives behind the same approval gate as Gmail and Telegram:
 *  - READ actions (list a folder, read a file, see system status) run straight away for a bot that holds the READ permission.
 *  - Everything that changes something (MODIFY: write, create, delete to a trash folder; EXECUTE: run an approved command, start a dev server;
 *    INSTALL: add packages) waits for YOUR approval, shows exactly what will run, and runs once.
 *  - Each of the five permissions is separate per bot. ADMIN does not exist in this build.
 *  - Work happens only inside the workspace folders you list. Secrets files are off limits. Everything is logged. One switch stops it all.
 */
const MAX_READ_CHARS = 16_000;
const MAX_FILE_BYTES = 200_000;
const MAX_LIST = 200;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function createPcConnector(pc: PcService): ConnectorDefinition {
  const firstRoot = () => pc.roots()[0] ?? ".";
  const needPath = (p: string, relativeTo = firstRoot(), options: { allowSecretNames?: boolean } = {}): string => {
    const r = resolveInRoots(pc.roots(), p, relativeTo, options);
    if (!r.ok) throw new Error(r.reason);
    return r.abs;
  };
  const pathArg = z.string().min(1).max(400).superRefine((v, ctx) => {
    const r = resolveInRoots(pc.roots(), v, firstRoot());
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.reason });
  });
  const cwdArg = pathArg;

  /** Checks a command for real: the rules in policy.ts, and every path-like argument must lie inside the workspace. */
  const checkRun = (cwd: string, program: string, args: string[]) => {
    const c = checkCommand(program, args);
    if (!c.ok) return c;
    const base = resolveInRoots(pc.roots(), cwd, firstRoot());
    if (!base.ok) return { ok: false as const, reason: base.reason };
    for (const p of c.pathArgs) {
      const r = resolveInRoots(pc.roots(), p, base.abs);
      if (!r.ok) return { ok: false as const, reason: `${p}: ${r.reason}` };
    }
    return c;
  };

  const logged = async (ctx: ActionContext, action: string, cwd: string | null, command: string, work: () => Promise<{ text: string; status: "ok" | "failed" | "timeout" | "stopped"; exitCode?: number | null; durationMs?: number; output?: string }>): Promise<string> => {
    const started = Date.now();
    try {
      const r = await work();
      pc.log({ botId: ctx.botId, action, cwd, command, status: r.status, exitCode: r.exitCode ?? null, durationMs: r.durationMs ?? Date.now() - started, output: r.output ?? r.text });
      if (r.status !== "ok") throw new Error(r.text);
      return r.text;
    } catch (e) {
      if (!(e instanceof Error && /^Exit |timed out|stopped/.test(e.message))) {
        pc.log({ botId: ctx.botId, action, cwd, command, status: "failed", durationMs: Date.now() - started, output: e instanceof Error ? e.message : "failed" });
      }
      throw e;
    }
  };

  const outcome = (r: { exitCode: number | null; output: string; timedOut: boolean; stopped: boolean; durationMs: number }, what: string) => {
    const secs = (r.durationMs / 1000).toFixed(1);
    const tail = r.output.trim().slice(-450);
    if (r.stopped) return { status: "stopped" as const, text: `Stopped by the emergency stop after ${secs} s.\n${tail}`.trim(), exitCode: r.exitCode, durationMs: r.durationMs, output: r.output };
    if (r.timedOut) return { status: "timeout" as const, text: `${what} timed out after ${secs} s and was ended.\n${tail}`.trim(), exitCode: r.exitCode, durationMs: r.durationMs, output: r.output };
    if (r.exitCode !== 0) return { status: "failed" as const, text: `Exit code ${r.exitCode ?? "none"} after ${secs} s:\n${tail || "(no output)"}`, exitCode: r.exitCode, durationMs: r.durationMs, output: r.output };
    return { status: "ok" as const, text: `Finished (exit code 0, ${secs} s).\n${r.output.trim().slice(-3500) || "(no output)"}`, exitCode: 0, durationMs: r.durationMs, output: r.output };
  };

  const actions: Record<string, ActionSpec> = {
    // ---------- READ ----------
    list_dir: {
      kind: "read",
      description: "List the files and folders inside a workspace folder",
      args: z.strictObject({ path: pathArg }),
      summarize: (a) => `List the folder ${String(a["path"])}`,
      execute: async (a, ctx) =>
        logged(ctx, "list_dir", null, `list ${String(a["path"])}`, async () => {
          const dir = needPath(String(a["path"]));
          if (!statSync(dir).isDirectory()) throw new Error("That is a file, not a folder.");
          const entries = readdirSync(dir, { withFileTypes: true }).slice(0, MAX_LIST).map((e) => `${e.isDirectory() ? "[folder] " : ""}${e.name}`);
          return { status: "ok", text: entries.length === 0 ? "(empty folder)" : entries.join("\n") };
        }),
    },
    read_file: {
      kind: "read",
      description: `Read a text file inside a workspace (up to ${MAX_READ_CHARS} characters). Files that hold secrets are never readable`,
      args: z.strictObject({ path: pathArg }),
      summarize: (a) => `Read the file ${String(a["path"])}`,
      execute: async (a, ctx) =>
        logged(ctx, "read_file", null, `read ${String(a["path"])}`, async () => {
          const file = needPath(String(a["path"]));
          const st = statSync(file);
          if (!st.isFile()) throw new Error("That is a folder, not a file.");
          if (st.size > 2_000_000) throw new Error("That file is too big to read (2 MB at most).");
          const text = readFileSync(file, "utf8");
          if (text.includes("\u0000")) throw new Error("That looks like a binary file, not text.");
          return { status: "ok", text: clip(text, MAX_READ_CHARS) };
        }),
    },
    system_status: {
      kind: "read",
      description: "See how busy this PC is (CPU, memory, disk space of the workspaces, local AI)",
      args: z.strictObject({}),
      summarize: () => "Check CPU, memory and disk",
      execute: async (_a, ctx) =>
        logged(ctx, "system_status", null, "system status", async () => {
          const r = await pc.resources();
          const lines = [`CPU ${r.cpuPercent}% busy (${r.cpuThreads} threads)`, `Memory ${r.memoryUsedPercent}% used of ${r.memoryGb} GB`, `Up ${r.uptimeHours} h, ${r.os}`, ...r.disk.map((d) => `Disk ${d.path}: ${d.freeGb} GB free of ${d.totalGb} GB`)];
          if (r.localAi) lines.push(`Local AI: ${r.localAi.enabled ? `${r.localAi.usableModels} usable model(s)` : "switched off"}`);
          return { status: "ok", text: lines.join("\n") };
        }),
    },

    // ---------- MODIFY (every one needs your approval) ----------
    make_dir: {
      kind: "write",
      description: "Create a folder inside a workspace",
      args: z.strictObject({ path: pathArg }),
      summarize: (a) => `Create the folder ${String(a["path"])}`,
      execute: async (a, ctx) =>
        logged(ctx, "make_dir", null, `mkdir ${String(a["path"])}`, async () => {
          const dir = needPath(String(a["path"]));
          mkdirSync(dir, { recursive: true });
          return { status: "ok", text: `Created ${dir}` };
        }),
    },
    write_file: {
      kind: "write",
      description: `Create a text file inside a workspace (up to ${MAX_FILE_BYTES} characters). It will not replace an existing file unless overwrite is true`,
      args: z.strictObject({ path: pathArg, content: z.string().max(MAX_FILE_BYTES), overwrite: z.boolean().optional() }),
      summarize: (a) => `${a["overwrite"] ? "Create or REPLACE" : "Create"} the file ${String(a["path"])} (${String(a["content"]).length} characters)`,
      execute: async (a, ctx) =>
        logged(ctx, "write_file", null, `write ${String(a["path"])}`, async () => {
          const file = needPath(String(a["path"]));
          if (existsSync(file) && !a["overwrite"]) throw new Error("That file already exists. Ask again with overwrite set to true if you really want to replace it.");
          if (existsSync(file) && statSync(file).isDirectory()) throw new Error("That is a folder.");
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, String(a["content"]), "utf8");
          return { status: "ok", text: `Wrote ${String(a["content"]).length} characters to ${file}` };
        }),
    },
    delete_path: {
      kind: "write",
      description: "Remove a file or folder inside a workspace. It is MOVED to the .awp-trash folder, not erased, so it can be recovered",
      args: z.strictObject({ path: pathArg }).superRefine((v, ctx) => {
        const r = resolveInRoots(pc.roots(), v.path, firstRoot());
        if (r.ok && pc.roots().some((root) => root.toLowerCase() === r.abs.toLowerCase())) ctx.addIssue({ code: "custom", message: "A whole workspace folder cannot be removed." });
      }),
      summarize: (a) => `Move ${String(a["path"])} to the trash folder`,
      execute: async (a, ctx) =>
        logged(ctx, "delete_path", null, `trash ${String(a["path"])}`, async () => {
          const target = needPath(String(a["path"]));
          const root = pc.roots().find((r) => target.toLowerCase().startsWith(r.toLowerCase()));
          if (!root || target.toLowerCase() === root.toLowerCase()) throw new Error("A whole workspace folder cannot be removed.");
          if (!existsSync(target)) throw new Error("That does not exist.");
          const trash = join(root, ".awp-trash", `${new Date().toISOString().replace(/[:.]/g, "-")}`);
          mkdirSync(trash, { recursive: true });
          const dest = join(trash, basename(target));
          renameSync(target, dest);
          return { status: "ok", text: `Moved to ${dest}` };
        }),
    },

    // ---------- EXECUTE (every one needs your approval) ----------
    run_command: {
      kind: "write",
      timeoutMs: RUN_LIMITS.maxTimeoutMs + 15_000,
      description: `Run an approved developer command in a workspace folder. program is one of ${PROGRAMS.join(", ")}; args is a list (not a shell line). Examples: node build.js, npm run test, git status`,
      args: z
        .strictObject({ cwd: cwdArg, program: z.string().max(20), args: z.array(z.string().max(300)).max(20) })
        .superRefine((v, ctx) => {
          const r = checkRun(v.cwd, v.program, v.args);
          if (!r.ok) ctx.addIssue({ code: "custom", message: r.reason });
        }),
      summarize: (a) => {
        const c = checkCommand(String(a["program"]), a["args"] as string[]);
        return `Run ${c.ok ? c.display : String(a["program"])} in ${String(a["cwd"])}`;
      },
      execute: async (a, ctx) => {
        const check = checkRun(String(a["cwd"]), String(a["program"]), a["args"] as string[]);
        if (!check.ok) throw new Error(check.reason);
        const cwd = needPath(String(a["cwd"]));
        return logged(ctx, "run_command", cwd, check.display, async () =>
          outcome(await pc.run({ program: check.program, argv: check.argv, cwd, timeoutMs: RUN_LIMITS.defaultTimeoutMs, messageIndexes: check.messageIndexes }), "The command"),
        );
      },
    },
    start_server: {
      kind: "write",
      description: `Start a package.json script that keeps running (for example a development server), for up to ${RUN_LIMITS.maxServerMs / 60000} minutes. Example: script "dev"`,
      args: z
        .strictObject({ cwd: cwdArg, script: z.string().regex(/^[A-Za-z0-9:_-]{1,60}$/) })
        .superRefine((v, ctx) => {
          const r = checkRun(v.cwd, "npm", ["run", v.script]);
          if (!r.ok) ctx.addIssue({ code: "custom", message: r.reason });
        }),
      summarize: (a) => `Start "npm run ${String(a["script"])}" in ${String(a["cwd"])} (keeps running up to ${RUN_LIMITS.maxServerMs / 60000} minutes)`,
      execute: async (a, ctx) => {
        const cwd = needPath(String(a["cwd"]));
        if (!existsSync(join(cwd, "package.json"))) throw new Error("There is no package.json in that folder.");
        const info = pc.startServer({ program: "npm", argv: ["run", String(a["script"])], cwd, timeoutMs: RUN_LIMITS.maxServerMs }, `npm run ${String(a["script"])}`, ctx.botId);
        pc.log({ botId: ctx.botId, action: "start_server", cwd, command: `npm run ${String(a["script"])} (started)`, status: "ok", output: `id ${info.id}` });
        return `Started (id ${info.id}). It stops by itself at ${info.expiresAt}. You can stop it any time in the PC Control Center.`;
      },
    },

    // ---------- INSTALL (needs your approval) ----------
    install_dependencies: {
      kind: "write",
      timeoutMs: RUN_LIMITS.maxTimeoutMs + 15_000,
      description: "Install packages into a project folder from the public registries (npm, or pip). Install scripts are always switched off; global installs do not exist. With npm and no packages it runs a clean install from package-lock.json",
      args: z
        .strictObject({ cwd: cwdArg, manager: z.enum(["npm", "pip"]), packages: z.array(z.string().max(80)).max(10), dev: z.boolean().optional() })
        .superRefine((v, ctx) => {
          const r = checkInstall(v.manager, v.packages, v.dev ?? false);
          if (!r.ok) ctx.addIssue({ code: "custom", message: r.reason });
        }),
      summarize: (a) => {
        const c = checkInstall(a["manager"] as "npm" | "pip", a["packages"] as string[], Boolean(a["dev"]));
        return `INSTALL: ${c.ok ? c.display : String(a["manager"])} in ${String(a["cwd"])}`;
      },
      execute: async (a, ctx) => {
        const check = checkInstall(a["manager"] as "npm" | "pip", a["packages"] as string[], Boolean(a["dev"]));
        if (!check.ok) throw new Error(check.reason);
        const cwd = needPath(String(a["cwd"]));
        if (a["manager"] === "npm" && !existsSync(join(cwd, "package.json"))) throw new Error("There is no package.json in that folder.");
        return logged(ctx, "install_dependencies", cwd, check.display, async () => outcome(await pc.run({ program: check.program, argv: check.argv, cwd, timeoutMs: RUN_LIMITS.maxTimeoutMs }), "The install"));
      },
    },
  };

  return {
    id: "pc",
    label: "PC (PowerShell tools)",
    actions,
    notReady: () => {
      if (pc.isStopped()) return "the PC agent is stopped (emergency stop). Resume it in the PC Control Center.";
      if (pc.roots().length === 0) return "choose a workspace folder in the PC Control Center first.";
      return null;
    },
    /** Each bot needs the matching permission: read for the read actions, modify, execute, install. Checked when asked and again when approved. */
    authorize: (botId, action) => {
      const need = ACTION_GRANT[action];
      if (!need) return "That is not a PC action.";
      if (need === "admin") return "Administrator access is not available.";
      return pc.hasGrant(botId, need) ? null : `This bot does not have the PC "${need}" permission. The owner can give it on the bot's Permissions tab.`;
    },
  };
}

