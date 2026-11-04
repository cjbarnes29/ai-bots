import { spawn, type ChildProcess } from "node:child_process";
import type { Program } from "./policy.js";

/**
 * Starts an approved program. Never a shell string: a program name and a list of arguments that already passed the rules in policy.ts.
 * The program gets a small clean environment (no API keys or tokens from this app), a time limit, an output limit, and can be stopped,
 * together with everything it started.
 */
export const RUN_LIMITS = { defaultTimeoutMs: 120_000, maxTimeoutMs: 300_000, maxOutputChars: 16_000, maxServerMs: 30 * 60_000, maxServers: 3 };

const ENV_ALLOW = ["PATH", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "LANG", "TERM", "NODE_ENV"];

export function cleanEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_ALLOW) if (source[name] !== undefined) env[name] = source[name];
  env["CI"] = "1"; // tools should not wait for a person to answer a question
  env["npm_config_update_notifier"] = "false";
  return env;
}

export interface RunSpec {
  program: Program;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  /** Which argument positions are free text that must be quoted. */
  messageIndexes?: number[];
}
export interface RunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  stopped: boolean;
  durationMs: number;
}

const isWindows = process.platform === "win32";
/** On Windows these are script launchers (.cmd): they need the command interpreter. The arguments were already restricted to plain characters. */
const NEEDS_SHELL: Program[] = ["npm", "code"];

function launch(spec: RunSpec): { command: string; args: string[]; shell: boolean } {
  const quote = (a: string, i: number) => (spec.messageIndexes?.includes(i) || /\s/.test(a) ? `"${a}"` : a);
  if (isWindows && NEEDS_SHELL.includes(spec.program)) return { command: `${spec.program}.cmd`, args: spec.argv.map(quote), shell: true };
  if (isWindows && spec.program === "git" && spec.messageIndexes?.length) return { command: "git", args: spec.argv, shell: false };
  return { command: spec.program, args: spec.argv, shell: false };
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (isWindows) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

export interface PcProcess {
  child: ChildProcess;
  done: Promise<RunResult>;
  stop: () => void;
}

export function startProcess(spec: RunSpec, env: NodeJS.ProcessEnv = cleanEnvironment()): PcProcess {
  const { command, args, shell } = launch(spec);
  const started = Date.now();
  const child = spawn(command, args, { cwd: spec.cwd, env, shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let timedOut = false;
  let stopped = false;
  const take = (chunk: Buffer) => {
    if (output.length < RUN_LIMITS.maxOutputChars) output += chunk.toString("utf8");
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, Math.min(spec.timeoutMs, RUN_LIMITS.maxTimeoutMs));
  const done = new Promise<RunResult>((resolve) => {
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode, output: output.slice(0, RUN_LIMITS.maxOutputChars), timedOut, stopped, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      output += `\n[could not start: ${e.message}]`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
  return {
    child,
    done,
    stop: () => {
      stopped = true;
      killTree(child);
    },
  };
}
