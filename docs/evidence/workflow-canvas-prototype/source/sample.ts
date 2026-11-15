import type { WfGraph } from "../api/types";
export const SAMPLE: WfGraph = {
  nodes: [
    { id: "start", type: "trigger", label: "Start", x: 40, y: 200, kind: "manual", extraUnknown: { keep: [1, 2] } },
    { id: "s1", type: "bot_task", label: "Writer", x: 300, y: 200, botId: "b1", instruction: "Research {{input}}", retries: 2 },
    { id: "c1", type: "condition", label: "Good enough?", x: 560, y: 200, expr: "{{s1}} contains ok" },
    { id: "ask", type: "checkpoint", label: "Ask me", x: 820, y: 80, message: "Approve?" },
    { id: "end", type: "end", label: "Done", x: 820, y: 320 },
  ],
  edges: [
    { id: "e1", from: "start", to: "s1", when: "always" },
    { id: "e2", from: "s1", to: "c1", when: "always" },
    { id: "e3", from: "c1", to: "ask", when: "true" },
    { id: "e4", from: "c1", to: "end", when: "false" },
  ],
};
