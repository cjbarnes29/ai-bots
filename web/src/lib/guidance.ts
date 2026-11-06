/**
 * Plain-language guides, shown above a screen at the Simple and Intermediate levels (hidden at Advanced). Written for a complete beginner: short sentences,
 * every term explained the first time it appears (an AI helper is called an "agent" in the app), and what to do first. Keyed by the first part of the address;
 * the longest match wins. These explain; they never promise anything the app does not do. `guidance.test.ts` pins the rules (length, reading level,
 * terms explained, every screen listed at Simple or Intermediate has a guide).
 */
const GUIDES: { prefix: string; text: string }[] = [
  { prefix: "/assistant", text: "This is the main place to talk to your AI Workforce, which is a team of AI helpers (called agents). Type what you want in everyday words, for example “open my latest project” or “show pending approvals”. The assistant can find things, open them and suggest improvements. If it wants to change something important, it shows you first and waits. It never deletes, sends or buys anything by itself." },
  { prefix: "/projects", text: "A project keeps everything about one piece of work in one place: its chats, tasks, files and decisions. Open a project to see what needs you." },
  { prefix: "/approvals", text: "Sometimes an AI helper (called an agent) wants to do something outside this app, such as saving a file or sending a message. It stops here and waits for you. Read what it will do, then choose Approve or Deny. Nothing happens until you choose." },
  { prefix: "/decisions", text: "Use a decision when there are several choices. The AI helpers (called agents) can suggest options. Only you choose and approve one." },
  { prefix: "/workflows", text: "A workflow is a list of steps that run one after another, drawn as boxes and arrows. A new workflow starts switched off and only runs when you press Run. The AI Assistant can draft one for you to read first." },
  { prefix: "/automation", text: "A schedule starts a job by itself at times you choose, for example every Monday. Nothing runs until you create a schedule and switch it on." },
  { prefix: "/agents", text: "An agent is an AI helper with a job, instructions and a model, which is the AI brain it uses. A new agent starts switched off and cannot do anything until you allow it." },
  { prefix: "/bots", text: "This is one agent, an AI helper. Its tabs hold its details, chat, history and permissions. Permissions say what it may do, and they start switched off." },
  { prefix: "/studio", text: "Bot Studio helps you create a new agent, an AI helper, from a template or from a description. A new agent starts switched off with no permissions." },
  { prefix: "/groups", text: "A group lets several agents (AI helpers) work together on one job. This feature is switched off until you turn it on." },
  { prefix: "/workforce", text: "This page shows your whole team of AI helpers (called agents). You can see who is responsible for what. You can also see what they are doing now." },
  { prefix: "/knowledge", text: "The Knowledge Center keeps your documents and notes. Add a file and you can ask the assistant questions about it. Every answer shows which document it came from." },
  { prefix: "/tasks", text: "A task is one job given to an AI helper (called an agent). Here you can see what is running, what finished and why something failed." },
  { prefix: "/monitor", text: "This is a record of what happened in the app. You do not need it for everyday use. It helps when something goes wrong." },
  { prefix: "/inbox", text: "Your AI helpers (called agents) write to you here. They only write when something real happened. For example, a task finished or failed." },
  { prefix: "/", text: "This is your overview: what is running, what needs you, and how your AI models are doing. A model is the AI brain that an AI helper uses." },
];

export const GUIDE_PREFIXES = GUIDES.map((g) => g.prefix);

export function guidanceFor(pathname: string): string | null {
  if (pathname === "/") return GUIDES.find((g) => g.prefix === "/")!.text;
  const hit = GUIDES.filter((g) => g.prefix !== "/" && (pathname === g.prefix || pathname.startsWith(`${g.prefix}/`))).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit?.text ?? null;
}
