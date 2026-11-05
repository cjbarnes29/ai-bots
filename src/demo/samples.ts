/**
 * The sample agents and workflows that "Set up the demo" creates. They are ordinary agents and workflows: edit, copy or delete them like any other.
 * They carry NO permissions, secrets, folders or applications. Their model is the built-in simulated one, so every answer they give is marked as simulated.
 */
export const DEMO_PREFIX = "Demo: ";
export const DEMO_ECHO = "demo/simulated-echo";
export const DEMO_FAIL = "demo/simulated-failing";

export interface SampleBot {
  key: "researcher" | "writer" | "reviewer" | "failing";
  name: string;
  role: string;
  instructions: string;
  model: string;
}

export const SAMPLE_BOTS: SampleBot[] = [
  { key: "researcher", name: `${DEMO_PREFIX}Researcher`, role: "Collects the key points about a topic", instructions: "You collect the key points about the topic you are given. Answer as a short bullet list. Say clearly when you are not sure.", model: DEMO_ECHO },
  { key: "writer", name: `${DEMO_PREFIX}Writer`, role: "Turns notes into a short, clear summary", instructions: "You turn notes into a clear summary of at most 150 words, in plain language. Do not invent facts that are not in the notes.", model: DEMO_ECHO },
  { key: "reviewer", name: `${DEMO_PREFIX}Reviewer`, role: "Checks a draft before it is used", instructions: "You review a draft. List anything unclear, unsupported or missing, then say APPROVE or REVISE on the last line.", model: DEMO_ECHO },
  { key: "failing", name: `${DEMO_PREFIX}Failing agent`, role: "Always fails, so you can see how a failure is shown", instructions: "This agent uses the simulated model that always fails. Use it to practise reading a failed workflow run.", model: DEMO_FAIL },
];

export type SampleIds = Record<SampleBot["key"], string>;

const at = (i: number) => ({ x: 40 + i * 230, y: 80 });

/** A research, write and review chain with a check and a human checkpoint. */
export function pipelineGraph(ids: SampleIds) {
  return {
    nodes: [
      { id: "start", type: "trigger", label: "Start (press Run)", kind: "manual", ...at(0) },
      { id: "research", type: "bot_task", label: "Research", botId: ids.researcher, instruction: "Collect the key points about: {{input}}", retries: 0, ...at(1) },
      { id: "write", type: "bot_task", label: "Write summary", botId: ids.writer, instruction: "Turn these notes into a short summary:\n{{research.output}}", retries: 0, ...at(2) },
      { id: "draft", type: "condition", label: "Is there a draft?", left: "{{write.output}}", op: "not_empty", value: "", ...at(3) },
      { id: "review", type: "bot_task", label: "Review", botId: ids.reviewer, instruction: "Review this draft:\n{{write.output}}", retries: 0, ...at(4) },
      { id: "decide", type: "checkpoint", label: "You decide", message: "Read the review. Approve to finish, or reject to stop here.", ...at(5) },
      { id: "done", type: "end", label: "Done", ...at(6) },
      { id: "nodraft", type: "end", label: "No draft", x: at(4).x, y: 240 },
    ],
    edges: [
      { id: "e1", from: "start", to: "research", when: "always" },
      { id: "e2", from: "research", to: "write", when: "always" },
      { id: "e3", from: "write", to: "draft", when: "always" },
      { id: "e4", from: "draft", to: "review", when: "true" },
      { id: "e5", from: "draft", to: "nodraft", when: "false" },
      { id: "e6", from: "review", to: "decide", when: "always" },
      { id: "e7", from: "decide", to: "done", when: "always" },
    ],
  };
}

/** One step works, the next fails on purpose: shows where a run broke and what the error says. */
export function failureGraph(ids: SampleIds) {
  return {
    nodes: [
      { id: "start", type: "trigger", label: "Start (press Run)", kind: "manual", ...at(0) },
      { id: "first", type: "bot_task", label: "Step that works", botId: ids.researcher, instruction: "Collect key points about: {{input}}", retries: 0, ...at(1) },
      { id: "broken", type: "bot_task", label: "Step that fails", botId: ids.failing, instruction: "Continue with: {{first.output}}", retries: 0, ...at(2) },
      { id: "done", type: "end", label: "Never reached", ...at(3) },
    ],
    edges: [
      { id: "e1", from: "start", to: "first", when: "always" },
      { id: "e2", from: "first", to: "broken", when: "always" },
      { id: "e3", from: "broken", to: "done", when: "always" },
    ],
  };
}

export const SAMPLE_WORKFLOWS: { name: string; build: (ids: SampleIds) => unknown; summary: string }[] = [
  { name: `${DEMO_PREFIX}Research, write, review`, build: pipelineGraph, summary: "Three agents in a row, a check, and a checkpoint where you decide. Run it with any topic as the input." },
  { name: `${DEMO_PREFIX}Where did it fail?`, build: failureGraph, summary: "The second step fails on purpose. Run it to see how a failed run and its error are shown." },
];

/** Honest map of what needs what. Static text, kept next to the features it describes. */
export const CAPABILITY_MAP = [
  {
    needs: "nothing" as const,
    title: "Works now, with no AI at all",
    items: [
      "Create, edit and version agents; switch them on and off; set what each may do",
      "Draw, check, save, copy and archive workflows (the checker finds loops and unconnected boxes)",
      "Schedules and triggers, the approvals queue, the usage and limits pages, backups",
      "Folder and application permissions (Access), the PC agent's workspace list, the encrypted key vault",
    ],
  },
  {
    needs: "demo" as const,
    title: "Works with the Demo AI (answers are simulated)",
    items: [
      "Chatting with an agent, giving it a task, agents handing work to each other",
      "Running a workflow from Start to End, a failed step, a checkpoint waiting for you",
      "Model routing screens, provider health and usage records (counted as calls, but no real model was involved)",
    ],
  },
  {
    needs: "real_ai" as const,
    title: "Needs a real AI provider (Gemini, Groq, OpenRouter or Ollama)",
    items: [
      "Real answers, summaries, research and code",
      "The Manager's planning (it uses automatic routing, which never picks the Demo AI, and the Demo AI cannot write a plan anyway: a Manager request fails with a clear message)",
      "Drafting a bot with AI, the AI setup assistant, trying a skill on a sample, Business lead scoring text",
    ],
  },
  {
    needs: "credentials" as const,
    title: "Needs your own accounts or tokens",
    items: ["Telegram, Gmail, Google Workspace, GitHub, Notion, n8n and MCP (each in the Integrations Center)", "Phone access over Tailscale"],
  },
];
