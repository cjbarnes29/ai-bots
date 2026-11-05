import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
// A stubbed fetch answers the routes under test; everything else falls through to the shared fake API.
function setup(path: string, handler: (method: string, url: string, body: any) => unknown | undefined) {
  const base = createFakeApi([]);
  const calls: { method: string; url: string; body: any }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const out = handler(method, url, body);
    if (out === undefined) return base.fetch(input, init);
    calls.push({ method, url, body });
    const err = out instanceof Error;
    return Promise.resolve(new Response(JSON.stringify(err ? { error: "bad", message: out.message } : out), { status: err ? 409 : 200, headers: { "content-type": "application/json" } }));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
  return calls;
}

describe("Groups page", () => {
  it("is off until the owner switches it on, then creates a group and writes to it", async () => {
    let enabled = false;
    const group = { id: "g1", name: "Launch crew", description: "", avatar: "", kind: "general", division: null, projectId: null, coordinatorBotId: null, participationMode: "mention_only", maxRounds: 6, paused: false, archived: false, members: [{ botId: "b1", botName: "Alpha", role: "member", responsibility: null }] };
    const calls = setup("/groups", (m, u, b) => {
      if (u === "/api/groups/status") return { enabled, participationModes: [], divisions: [{ key: "personal_office", name: "Personal Office" }] };
      if (m === "PUT" && u === "/api/groups/enabled") { enabled = b.on; return { enabled }; }
      if (m === "POST" && u === "/api/groups") return { group };
      if (u.startsWith("/api/groups?")) return { groups: enabled ? [group] : [] };
      if (u === "/api/groups/g1") return { group };
      if (u === "/api/groups/g1/messages" && m === "GET") return { messages: [{ id: 1, senderKind: "bot", senderName: "Alpha", visibility: "group", kind: "task_result", content: "All finished", taskId: "t1", createdAt: "2026-11-06T10:00:00Z" }] };
      if (u === "/api/groups/g1/messages" && m === "POST") return { messageId: 2, started: [], skipped: null };
      if (u === "/api/groups/g1/activity") return { events: [], tasks: [] };
      return undefined;
    });
    expect(await screen.findByText("Groups are switched off.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Switch groups on" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.body.on === true)).toBe(true));
    await userEvent.type(await screen.findByLabelText("New group name"), "Launch crew");
    await userEvent.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/groups" && c.body.name === "Launch crew")).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: "Open group Launch crew" }));
    expect(await screen.findByText("All finished")).toBeInTheDocument();
    expect(screen.getByText(/Joining a group gives a bot no permission/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Group message"), "@Alpha status?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/groups/g1/messages" && c.method === "POST" && c.body.content === "@Alpha status?")).toBe(true));
  });

  it("shows a refused handoff's reason", async () => {
    const group = { id: "g1", name: "Crew", description: "", avatar: "", kind: "general", division: null, projectId: null, coordinatorBotId: null, participationMode: "mention_only", maxRounds: 6, paused: false, archived: false, members: [{ botId: "a", botName: "Alpha", role: "member", responsibility: null }, { botId: "b", botName: "Beta", role: "member", responsibility: null }] };
    setup("/groups", (m, u) => {
      if (u === "/api/groups/status") return { enabled: true, participationModes: [], divisions: [] };
      if (u.startsWith("/api/groups?")) return { groups: [group] };
      if (u === "/api/groups/g1") return { group };
      if (u === "/api/groups/g1/messages") return { messages: [] };
      if (u === "/api/groups/g1/activity") return { events: [], tasks: [] };
      if (m === "POST" && u === "/api/groups/g1/handoffs") return new Error("Alpha is not allowed to hand work to Beta.");
      return undefined;
    });
    await userEvent.click(await screen.findByRole("button", { name: "Open group Crew" }));
    await userEvent.selectOptions(await screen.findByLabelText("Handoff from"), "a");
    await userEvent.selectOptions(screen.getByLabelText("Handoff to"), "b");
    await userEvent.type(screen.getByLabelText("Handoff instruction"), "Write the pitch");
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed to hand work/);
  });
});

const node = (id: string, kind: string, label: string, status: string, lane: number, extra: any = {}) => ({ id, kind, refId: id.split(":")[1], label, status, lane, divisions: [], detail: {}, link: null, ...extra });
const board = {
  nodes: [
    node("manager:central", "manager", "Central Manager", "active", 0),
    node("division:personal_office", "division", "Personal Office", "idle", 1, { divisions: ["personal_office"] }),
    node("bot:b1", "bot", "Alpha", "failed", 3, { divisions: ["personal_office"], detail: { model: "auto/general", failedLast24h: 1 }, link: "/bots/b1" }),
    node("task:t1", "task", "Write the weekly summary", "completed", 5, { divisions: ["personal_office"] }),
    node("task:t2", "task", "Broken job", "failed", 5, { divisions: ["personal_office"] }),
    node("approval:a1", "approval", "Send an email", "blocked", 6),
  ],
  edges: [
    { id: "e1", from: "manager:central", to: "division:personal_office", kind: "coordinates" },
    { id: "e2", from: "division:personal_office", to: "bot:b1", kind: "dedicated" },
    { id: "e3", from: "task:t1", to: "bot:b1", kind: "assigned" },
  ],
  counts: { active: 0, completed: 1, blocked: 1, failed: 1, idle: 0, cancelled: 0 },
  truncated: [],
  groupsEnabled: false,
  generatedAt: "x",
  note: "Every node and line is read from the real records. Nothing here is estimated or invented.",
};
const org = {
  manager: { name: "Central Manager", note: "The Manager AI plans.", specialists: [] },
  groupsEnabled: false,
  divisions: [
    { key: "personal_office", name: "Personal Office", groupId: null, dedicated: [{ id: "b1", name: "Alpha" }], shared: [], temporary: [] },
    { key: "business_operations", name: "Business Operations", groupId: null, dedicated: [], shared: [], temporary: [] },
    { key: "ai_digital_agency", name: "AI Digital Agency", groupId: null, dedicated: [], shared: [], temporary: [] },
    { key: "research_innovation", name: "Research & Innovation", groupId: null, dedicated: [], shared: [], temporary: [] },
  ],
  unplaced: [{ id: "b2", name: "Beta", status: "active" }],
};

describe("Workforce page", () => {
  const handler = (calls: { push: (x: unknown) => void } | null = null) => (m: string, u: string, b: any) => {
    calls?.push({ m, u, b });
    if (u === "/api/workforce/organization") return org;
    if (u === "/api/workforce/board") return board;
    if (u === "/api/workforce/layouts" && m === "GET") return { layouts: { "My view": { positions: { "manager:central": { x: 300, y: 300 } }, filters: { status: "failed", division: "", hidden: "" } } } };
    if (u === "/api/workforce/layouts" && m === "PUT") return { layout: {} };
    if (u.startsWith("/api/workforce/activity")) return { history: [{ at: "2026-11-06T10:00:00Z", text: "Task completed: Write the weekly summary" }] };
    if (m === "PUT" && u === "/api/workforce/bots/b2") return { placement: {} };
    return undefined;
  };

  it("draws the real nodes and lines, counts work truthfully, and opens an inspector with the node's history", async () => {
    setup("/workforce", handler());
    const svg = await screen.findByRole("img", { name: "Workforce board graph" });
    expect(within(svg).getByRole("button", { name: "Bot Alpha Failed" })).toBeInTheDocument();
    expect(svg.querySelectorAll("[data-edge]")).toHaveLength(3);
    expect(screen.getByText(/1 completed · 1 blocked · 1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing here is estimated or invented/)).toBeInTheDocument();
    await userEvent.click(within(svg).getByRole("button", { name: "Task Write the weekly summary Completed" }));
    const inspector = await screen.findByRole("complementary", { name: /Inspector Write the weekly summary/ });
    expect(await within(inspector).findByText(/Task completed: Write the weekly summary/)).toBeInTheDocument();
    expect(within(inspector).getByText(/→ assigned Bot: Alpha/)).toBeInTheDocument();
  });

  it("filters by status and kind; the phone list shows the same nodes", async () => {
    setup("/workforce", handler());
    const svg = await screen.findByRole("img", { name: "Workforce board graph" });
    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "failed");
    expect(within(svg).queryByRole("button", { name: /Completed/ })).toBeNull();
    expect(within(svg).getByRole("button", { name: "Task Broken job Failed" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await userEvent.click(screen.getByLabelText("Show Approval"));
    expect(within(svg).queryByRole("button", { name: /Send an email/ })).toBeNull();
    // the list for narrow screens exists and is usable
    await userEvent.click(screen.getByRole("button", { name: "List Bot Alpha" }));
    expect(await screen.findByRole("complementary", { name: "Inspector Alpha" })).toBeInTheDocument();
  });

  it("saves and loads layouts, and places a bot without granting anything", async () => {
    const seen: any[] = [];
    setup("/workforce", handler({ push: (x) => seen.push(x) }));
    await screen.findByRole("img", { name: "Workforce board graph" });
    await userEvent.type(screen.getByLabelText("Layout name"), "Mine");
    await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(seen.some((s) => s.m === "PUT" && s.u === "/api/workforce/layouts" && s.b.name === "Mine" && s.b.positions["manager:central"])).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Saved layouts"), "My view");
    expect(await screen.findByRole("button", { name: "Bot Alpha Failed" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Bot to place"), "b2");
    await userEvent.click(screen.getByLabelText("In Business Operations"));
    await userEvent.click(screen.getByRole("button", { name: "Place bot" }));
    await waitFor(() => expect(seen.some((s) => s.m === "PUT" && s.u === "/api/workforce/bots/b2" && s.b.kind === "dedicated" && s.b.divisions[0] === "business_operations")).toBe(true));
    expect(screen.getByText(/Placing a bot grants it no permission/)).toBeInTheDocument();
  });
});

describe("Decisions: collaboration, versions, execution", () => {
  const opt = (id: string, title: string, over: any = {}) => ({ id, position: 1, title, details: "", pros: "", cons: "", proposedBy: { botId: "b1", botName: "Researcher" }, editedByOwner: false, views: [], disagreement: false, ...over });
  const mk = (status: string, chosen: string | null) => ({
    id: "d1", projectId: null, title: "Pick a market", question: "Which market?", status, chosenOptionId: chosen, ownerNote: "", approvedAt: status === "open" || status === "chosen" ? null : "2026-11-06T10:00:00Z", createdAt: "x", updatedAt: "x",
    project: null, options: [opt("o1", "Dubai", { details: "Research Dubai only." }), opt("o2", "Abu Dhabi", { proposedBy: { botId: "b2", botName: "Writer" } }), opt("o3", "Sharjah")],
    participants: [{ botId: "b1", botName: "Researcher", reason: "" }, { botId: "b2", botName: "Writer", reason: "" }], assignments: status === "approved" ? [{ botId: "b1", botName: "Researcher", duty: "d", startState: "started", taskId: "t1", stuck: false }] : [], reports: [], history: [],
  });
  const consensus = { state: "unresolved", optionId: null, optionTitle: null, supporters: ["Researcher"], objectors: [{ bot: "Writer", stance: "oppose", reasoning: "Too crowded for our budget.", optionId: "o1" }], missing: [], roundsDone: 1, recommendation: { optionId: "o1", title: "Dubai", reason: "1 bot(s) back it and 1 object. This is a rules-based count of the recorded views, not a bot's opinion and not a decision." }, note: "1 objection(s) remain unanswered. The owner decides." };

  it("edits wording as a new version, shows the exact change, the disagreement, the Manager's summary, and starts the Manager's loop", async () => {
    const calls = setup("/decisions", (m, u, b) => {
      if (u === "/api/decisions/d1/consensus") return { consensus, outcome: null };
      if (u === "/api/decisions/d1/options/o1/versions") return { versions: [{ version: 1, at: "2026-11-06T09:00:00Z", by: "bot", botName: "Researcher", text: { title: "Dubai", details: "Research Dubai.", pros: "", cons: "" }, changes: [], hash: "a".repeat(64) }, { version: 2, at: "2026-11-06T09:30:00Z", by: "owner", botName: null, text: { title: "Dubai", details: "Research Dubai only.", pros: "", cons: "" }, changes: [{ field: "details", before: "Research Dubai.", after: "Research Dubai only." }], hash: "b".repeat(64) }], approved: null };
      if (m === "PATCH" && u === "/api/decisions/d1/options/o1") return { ok: true };
      if (m === "POST" && u === "/api/decisions/d1/collaborate") return { rounds: 1, outcome: "escalated_to_owner" };
      if (m === "GET" && u === "/api/decisions/d1") return { decision: mk("open", null) };
      if (m === "GET" && u.startsWith("/api/decisions")) return { decisions: [{ ...mk("open", null), options: 3, assignments: 0, done: 0 }] };
      return undefined;
    });
    await userEvent.click(await screen.findByRole("button", { name: "Open Pick a market" }));
    expect(await screen.findByText("The bots have not reached agreement")).toBeInTheDocument();
    expect(screen.getByText(/Too crowded for our budget/)).toBeInTheDocument();
    expect(screen.getByText(/not a bot's view, not a decision/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Versions of Dubai" }));
    const list = await screen.findByRole("list", { name: "Versions of Dubai" });
    expect(within(list).getByText(/Version 2/)).toBeInTheDocument();
    expect(within(list).getByText("Research Dubai only.")).toBeInTheDocument();
    expect(within(list).getByText("Research Dubai.", { selector: "del" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit wording of Dubai" }));
    const field = screen.getByLabelText("Option details");
    await userEvent.clear(field);
    await userEvent.type(field, "Research Dubai only, five bullets.");
    await userEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/decisions/d1/options/o1" && c.body.details === "Research Dubai only, five bullets.")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Let the Manager run the discussion" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/decisions/d1/collaborate")).toBe(true));
  });

  it("approval carries the owner's duty per bot; comments are not part of it; the execution record shows what the bot received", async () => {
    let state = "chosen";
    const calls = setup("/decisions", (m, u, b) => {
      if (u === "/api/decisions/d1/consensus") return { consensus: { ...consensus, state: "consensus" }, outcome: null };
      if (u.startsWith("/api/decisions/d1/options/")) return { versions: [], approved: null };
      if (m === "POST" && u === "/api/decisions/d1/approve") { state = "approved"; return { decision: mk("approved", "o1"), started: [] }; }
      if (u === "/api/decisions/d1/execution") return { approved: { version: 2, hash: "b".repeat(64) }, execution: [{ botId: "b1", botName: "Researcher", duty: "Keep to budget", startState: "started", taskId: "t1", instructionSent: "Chosen option: Dubai\nResearch Dubai only.\n\nYour duty: Keep to budget", matchesApprovedVersion: true, approvedVersion: 2, approvedHash: "b".repeat(64), status: "completed", result: "Five bullet points.", error: null }] };
      if (m === "GET" && u === "/api/decisions/d1") return { decision: mk(state, "o1") };
      if (m === "GET" && u.startsWith("/api/decisions")) return { decisions: [{ ...mk(state, "o1"), options: 3, assignments: 0, done: 0 }] };
      return undefined;
    });
    await userEvent.click(await screen.findByRole("button", { name: "Open Pick a market" }));
    const planner = await screen.findByRole("region", { name: "Approve and assign" });
    await userEvent.type(within(planner).getByLabelText("Duty of Researcher"), "Keep to budget");
    await userEvent.click(within(planner).getByLabelText("Assign Writer"));
    await userEvent.click(within(planner).getByRole("button", { name: "Approve with these assignments" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/decisions/d1/approve")).toBe(true));
    const sent = calls.find((c) => c.url === "/api/decisions/d1/approve")!.body;
    expect(sent.assignments).toEqual([{ botId: "b1", duty: "Keep to budget" }, { botId: "b2", duty: "Carry out the chosen option: Dubai." }]);
    expect(JSON.stringify(sent)).not.toMatch(/note/i);
    const exec = await screen.findByRole("region", { name: "Execution record" });
    expect(within(exec).getByText("The bot received the approved wording.")).toBeInTheDocument();
    expect(within(exec).getByText("Five bullet points.")).toBeInTheDocument();
    expect(within(exec).getByText(/Your duty: Keep to budget/)).toBeInTheDocument();
  });
});
