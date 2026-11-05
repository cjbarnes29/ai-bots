import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/** The shared fake API does not know these routes yet, so this test answers them itself and passes everything else on. */
function setup(path: string, handler: (method: string, url: string, body: unknown) => unknown | undefined) {
  const base = createFakeApi([]);
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const out = handler(method, url, body);
    if (out === undefined) return base.fetch(input, init);
    calls.push({ method, url, body });
    const status = out instanceof Error ? 400 : 200;
    const json = out instanceof Error ? { error: { code: "bad", message: out.message } } : out;
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
  return calls;
}

const item = (over: Record<string, unknown> = {}) => ({
  conversationId: "c1", botId: "b1", botName: "Writer", title: "Weekly report", originalTitle: "Weekly report",
  pinned: false, muted: false, archived: false, unread: 2,
  lastMessage: { id: 5, role: "assistant", preview: "Done", createdAt: "2026-11-05T10:00:00Z" }, lastActivityAt: "2026-11-05T10:00:00Z", ...over,
});

describe("Inbox page", () => {
  it("lists conversations, opens one, and pins it", async () => {
    const calls = setup("/inbox", (m, u) => {
      if (u.startsWith("/api/inbox/c1/messages")) return { conversationId: "c1", botId: "b1", title: "Weekly report", messages: [{ id: 5, role: "assistant", content: "All finished", createdAt: "2026-11-05T10:00:00Z", sender: "bot", botId: "b1", initiated: true, kind: "task_result", importance: "normal", source: { kind: "task", id: "t1" } }] };
      if (u.startsWith("/api/inbox/c1/pin")) return { ok: true };
      if (u.startsWith("/api/inbox/preferences")) return { notify: "important", maxPerHour: 6, own: false };
      if (u.startsWith("/api/inbox?")) return { items: [item()], unreadTotal: 2, heldBack: 0 };
      return undefined;
    });
    expect(await screen.findByText("2 unread")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Weekly report" }));
    expect(await screen.findByText("All finished")).toBeInTheDocument();
    expect(screen.getByText(/Task result/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pin Weekly report" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url === "/api/inbox/c1/pin" && (c.body as { on: boolean }).on === true)).toBe(true));
  });

  it("shows an empty state", async () => {
    setup("/inbox", (_m, u) => (u.startsWith("/api/inbox?") ? { items: [], unreadTotal: 0, heldBack: 0 } : u.startsWith("/api/inbox/preferences") ? { notify: "all", maxPerHour: 6, own: false } : undefined));
    expect(await screen.findByText("Nothing here.")).toBeInTheDocument();
  });
});

describe("Projects page", () => {
  const project = { id: "p1", name: "Launch", description: "", instructions: "", archived: false, createdAt: "x", updatedAt: "x", counts: { task: 1 } };
  it("creates a project and requires the exact name to delete", async () => {
    const calls = setup("/projects", (m, u) => {
      if (m === "POST" && u === "/api/projects") return { project };
      if (m === "GET" && u.startsWith("/api/projects/p1")) return { project, items: [{ kind: "task", id: "t1", pinned: false, addedAt: "x", title: "Write copy" }] };
      if (m === "GET" && u.startsWith("/api/projects?")) return { projects: [project] };
      if (m === "DELETE" && u === "/api/projects/p1") return { ok: true };
      return undefined;
    });
    await userEvent.type(await screen.findByLabelText("New project name"), "Launch");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && (c.body as { name: string }).name === "Launch")).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: "Open Launch" }));
    expect(await screen.findByText(/Write copy/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Delete this project"));
    const del = screen.getByRole("button", { name: "Delete project" });
    expect(del).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type the project name to confirm"), "Launch");
    expect(del).toBeEnabled();
    await userEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && (c.body as { confirmName: string }).confirmName === "Launch")).toBe(true));
  });
});

describe("Decisions page", () => {
  const opt = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, position: 0, title, details: "", pros: "", cons: "", proposedBy: { botId: "b1", botName: "Writer" }, editedByOwner: false, views: [], disagreement: false, ...over });
  const detail = (status: string, chosen: string | null) => ({
    id: "d1", projectId: null, title: "Pick a name", question: "Which name should we use?", status, chosenOptionId: chosen, ownerNote: "", approvedAt: null, createdAt: "x", updatedAt: "x",
    project: null, options: [opt("o1", "Alpha", { disagreement: true, views: [{ id: 1, optionId: "o1", botId: "b2", botName: "Critic", stance: "concern", reasoning: "Too generic", round: 1 }] }), opt("o2", "Beta")],
    participants: [], assignments: [], reports: [], history: [],
  });

  it("asks, saves the draft, chooses and approves; shows disagreement", async () => {
    let status = "open";
    let chosen: string | null = null;
    const calls = setup("/decisions", (m, u) => {
      if (u === "/api/decisions/inquire") return { draft: { draftId: "dr1", question: "q", notice: null, bots: [{ botId: "b1", botName: "Writer", reason: "fits", problem: null, options: [{ title: "Alpha", details: "", pros: "", cons: "" }] }] } };
      if (m === "POST" && u === "/api/decisions") return { decision: detail("open", null) };
      if (m === "PUT" && u === "/api/decisions/d1/choice") { status = "chosen"; chosen = "o2"; return { decision: detail(status, chosen) }; }
      if (m === "POST" && u === "/api/decisions/d1/approve") { status = "approved"; return { decision: detail(status, chosen), started: [] }; }
      if (m === "GET" && u === "/api/decisions/d1") return { decision: detail(status, chosen) };
      if (m === "GET" && u.startsWith("/api/decisions")) return { decisions: [{ ...detail(status, chosen), options: 2, assignments: 0, done: 0 }] };
      return undefined;
    });
    await userEvent.type(await screen.findByLabelText("Your question"), "Which name should we use?");
    await userEvent.click(screen.getByRole("button", { name: "Ask the agents for options" }));
    expect(await screen.findByText("Options offered (not saved yet)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Put these on the board" }));
    expect(await screen.findByText(/Your agents disagree/)).toBeInTheDocument();
    expect(screen.getByText(/Too generic/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve "/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Choose Beta" }));
    await userEvent.click(await screen.findByRole("button", { name: 'Approve "Beta"' }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/decisions/d1/approve")).toBe(true));
    expect(JSON.stringify(calls.map((c) => c.body))).not.toMatch(/actor|approvedBy/);
  });
});
