import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";

/**
 * The Tool Registry (Stage 3). One honest list of what this platform can and cannot do right now.
 *
 * "available"   = it works now (checked, not assumed).
 * "needs_setup" = it exists but something is missing (a key, a sign-in, a program), and the reason says what.
 * "unavailable" = it does not exist in this build, or could not be found on this PC.
 *
 * Nothing here runs anything a model wrote. Checks run FIXED commands with fixed arguments (for example "git --version") with a short timeout.
 * The Manager and the bots are told what is missing so that nothing is ever pretended.
 */
export type ToolCategory = "communication" | "research" | "coding" | "pc" | "documents" | "graphics" | "video" | "audio" | "integration" | "ai";
export type ToolStatus = "available" | "needs_setup" | "unavailable";

export interface ToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  status: ToolStatus;
  /** Plain-language: why it is in this state, or its version. */
  detail: string;
  /** Needs the owner to give a bot explicit access (connectors use each bot's Permissions tab instead). */
  requiresAssignment: boolean;
}

export interface ToolProbeResult {
  status: ToolStatus;
  detail: string;
}

interface ToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  requiresAssignment: boolean;
  probe: () => Promise<ToolProbeResult>;
}

/** Runs a FIXED command and reports the first line of its output. Never given anything from a model or a user. */
export type CommandRunner = (command: string, args: string[]) => Promise<string | null>;

export const realRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    // On Windows several developer tools are .cmd files, which need a shell. The command and arguments here are constants written in this file.
    execFile(command, args, { timeout: 4000, windowsHide: true, shell: process.platform === "win32" }, (err, stdout) => {
      resolve(err ? null : (String(stdout).split(/\r?\n/).find((l) => l.trim()) ?? "").trim() || "found");
    });
  });

export interface ToolProbeDeps {
  run: CommandRunner;
  /** Connector readiness as the approval gate sees it: reasons keyed by connector id (null/undefined = ready). */
  connectors: () => { id: string; label: string; notReady: string | null }[];
  /** Local AI (Ollama) as the model catalog sees it. */
  ollama: () => { enabled: boolean; status: string | null; usableModels: number };
  /** Cloud providers that are switched on and have a key. */
  providersReady: () => number;
  /** The PC agent: workspace folders chosen, and whether it is stopped. */
  pc: () => { roots: number; stopped: boolean };
}

const ok = (detail: string): ToolProbeResult => ({ status: "available", detail });
const setup = (detail: string): ToolProbeResult => ({ status: "needs_setup", detail });
const missing = (detail: string): ToolProbeResult => ({ status: "unavailable", detail });
const NOT_BUILT = (stage: string) => missing(`Not built yet (${stage}). Nothing can use it, and the platform will not pretend otherwise.`);
const NOT_VERIFIED = (what: string) => missing(`No free, verified service for ${what} is connected. It needs a decision from the owner before it can exist.`);

export function toolDefinitions(d: ToolProbeDeps): ToolDef[] {
  const connector = (id: string, name: string, description: string, category: ToolCategory = id === "browser" ? "research" : "communication"): ToolDef => ({
    id,
    name,
    category,
    description,
    requiresAssignment: false,
    probe: async () => {
      const c = d.connectors().find((x) => x.id === id);
      if (!c) return missing("This connection is not installed.");
      return c.notReady ? setup(c.notReady) : ok("Ready. Each bot still needs its Permissions switch for reading, and every write needs your approval.");
    },
  });
  const program = (id: string, name: string, category: ToolCategory, description: string, command: string, args: string[], hint: string): ToolDef => ({
    id,
    name,
    category,
    description,
    requiresAssignment: true,
    probe: async () => {
      const line = await d.run(command, args);
      return line ? ok(line.slice(0, 120)) : missing(`Not found on this PC. ${hint}`);
    },
  });
  return [
    connector("telegram", "Telegram", "Read and send Telegram messages (sending needs your approval)."),
    connector("gmail", "Gmail", "Search and read mail; send mail with your approval."),
    connector("memory", "Memory", "Search saved notes and your own past tasks; ask to save a private note (needs your approval).", "integration"),
    connector("github", "GitHub", "Read issues and files; open issues and comment with your approval.", "integration"),
    connector("notion", "Notion", "Search and read shared pages; create pages and add text with your approval.", "integration"),
    connector("n8n", "n8n", "Start one saved n8n workflow (needs your approval each time).", "integration"),
    connector("mcp", "MCP server", "List and run tools on one saved MCP server (running needs your approval).", "integration"),
    connector("gworkspace", "Google Workspace", "Read Drive files, Docs, Sheets, Slides, calendar and tasks; create docs, events and tasks with your approval.", "integration"),
    connector("browser", "Web pages (browser)", "Read public https pages; submit forms with your approval. No JavaScript."),
    {
      id: "ai-cloud",
      name: "Free cloud AI models",
      category: "ai",
      description: "Gemini, Groq, OpenRouter and OmniRoute, free models only.",
      requiresAssignment: false,
      probe: async () => (d.providersReady() > 0 ? ok(`${d.providersReady()} provider(s) switched on with a key.`) : setup("No cloud provider is switched on with a key yet (Settings → Providers).")),
    },
    {
      id: "ai-local",
      name: "Local AI (Ollama)",
      category: "ai",
      description: "Models running on this PC. Free and private; used as the backup in automatic routing.",
      requiresAssignment: false,
      probe: async () => {
        const o = d.ollama();
        if (!o.enabled) return setup("Ollama is switched off in Settings → Providers (or not installed).");
        return o.usableModels > 0 ? ok(`${o.usableModels} local model(s) ready.`) : setup(`Ollama is on but has no usable model (${o.status ?? "not checked"}).`);
      },
    },
    program("node", "Node.js", "coding", "Run JavaScript and TypeScript projects.", "node", ["--version"], "Install Node.js from nodejs.org."),
    program("npm", "npm", "coding", "Install and run JavaScript packages.", "npm", ["--version"], "It comes with Node.js."),
    program("git", "Git", "coding", "Version control for projects.", "git", ["--version"], "Install Git for Windows."),
    program("python", "Python", "coding", "Run Python scripts and projects.", "python", ["--version"], "Install Python from python.org."),
    program("vscode", "VS Code", "coding", "Open and edit projects in Visual Studio Code.", "code", ["--version"], "Install VS Code and tick 'Add to PATH'."),
    program("android", "Android tools (adb)", "coding", "Build and test Android apps.", "adb", ["version"], "Install Android Studio or the platform tools."),
    {
      id: "pc-agent",
      name: "PowerShell / PC agent",
      category: "pc",
      description: "Run approved commands on this PC with separate READ, EXECUTE, MODIFY, INSTALL and ADMIN permissions.",
      requiresAssignment: false, // controlled by each bot's five PC permissions, not by tool access
      probe: async () => {
        const p = d.pc();
        if (p.stopped) return setup("Stopped by the emergency stop. Resume it in Settings → PC agent.");
        if (p.roots === 0) return setup("Choose a workspace folder in Settings → PC agent. Until then bots cannot touch this PC.");
        return ok(`${p.roots} workspace folder(s). Each bot needs its own PC permissions; everything that changes something needs your approval.`);
      },
    },
    {
      id: "pc-resources",
      name: "PC resources (CPU, memory, disk)",
      category: "pc",
      description: "See how busy this PC is.",
      requiresAssignment: false,
      probe: async () => ok(`${cpus().length} CPU threads, ${Math.round(totalmem() / 1024 ** 3)} GB memory.`),
    },
    {
      id: "documents",
      name: "Documents, spreadsheets and slides",
      category: "documents",
      description: "Create Word, PDF, Excel, CSV, PowerPoint, web-page and Markdown files, SVG charts and diagrams, and summarise CSV data. Files are written into your workspace folders.",
      requiresAssignment: false, // uses the PC agent's folders and each bot's READ / MODIFY permissions
      probe: async () => {
        const p = d.pc();
        if (p.stopped) return setup("Stopped by the emergency stop (Settings → PC agent).");
        if (p.roots === 0) return setup("Choose a workspace folder in Settings → PC agent. Files are only ever written there.");
        return ok("Ready. A bot needs the PC MODIFY permission to create files (READ to summarise data), and every file waits for your approval. Word, Excel and PowerPoint files were opened in the real Microsoft Office during development; PDFs are checked structurally only.");
      },
    },
    { id: "image-generation", name: "Image and logo generation", category: "graphics", description: "Generate or edit pictures, logos, posters and thumbnails.", requiresAssignment: true, probe: async () => NOT_VERIFIED("image generation") },
    { id: "video-generation", name: "Video generation and editing", category: "video", description: "Generate or edit video and subtitles.", requiresAssignment: true, probe: async () => NOT_VERIFIED("video generation") },
    { id: "audio-generation", name: "Voice, audio and music", category: "audio", description: "Voiceovers and original audio.", requiresAssignment: true, probe: async () => NOT_VERIFIED("audio generation") },
  ];
}

const CACHE_MS = 30_000;

export class ToolRegistry {
  private cache: { at: number; tools: ToolInfo[] } | null = null;

  constructor(
    private readonly deps: ToolProbeDeps,
    private readonly now: () => number = Date.now,
  ) {}

  ids(): string[] {
    return toolDefinitions(this.deps).map((t) => t.id);
  }

  /** Checks every tool now (they run side by side, each with its own short timeout). */
  async refresh(): Promise<ToolInfo[]> {
    const defs = toolDefinitions(this.deps);
    const tools = await Promise.all(
      defs.map(async (t): Promise<ToolInfo> => {
        let result: ToolProbeResult;
        try {
          result = await t.probe();
        } catch {
          result = missing("The check failed.");
        }
        return { id: t.id, name: t.name, category: t.category, description: t.description, requiresAssignment: t.requiresAssignment, ...result };
      }),
    );
    this.cache = { at: this.now(), tools };
    return tools;
  }

  async list(): Promise<ToolInfo[]> {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.tools;
    return this.refresh();
  }

  async get(id: string): Promise<ToolInfo | undefined> {
    return (await this.list()).find((t) => t.id === id);
  }

  /** For the Manager's planning prompt: what exists and what does not. */
  async summary(): Promise<{ available: string[]; notAvailable: string[] }> {
    const tools = await this.list();
    return {
      available: tools.filter((t) => t.status === "available").map((t) => t.name),
      notAvailable: tools.filter((t) => t.status !== "available").map((t) => t.name),
    };
  }
}
