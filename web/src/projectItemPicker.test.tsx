import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./pages/Projects";

/** Linking an item to a project by choosing it from a list of real items instead of typing an id. Fake fetch only. */
const PID = "11111111-1111-4111-8111-111111111111";
const project = { id: PID, name: "Demo Launch", description: "", instructions: "", archived: false, counts: {}, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z" };
const hub = { project, conversations: [], tasks: [], agents: [], workflows: [], decisions: [], approvals: [], outputs: [], notes: [], attention: [], progress: { total: 0, completed: 0, running: 0, pending: 0, failed: 0 } };
const body = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
type Call = { url: string; method: string; value: any };
type Linked = { kind: string; id: string; title: string | null; pinned: boolean };
const clients: QueryClient[] = [];
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
});
const wf = (id: string, name: string) => ({ id, name, enabled: false, archived: false, version: 1, graph: { nodes: [], edges: [] } });

function setup(over: (c: Call) => Response | undefined = () => undefined, linked: Linked[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", value: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const o = over(c);
    if (o) return o;
    if (c.url.startsWith(`/api/projects/${PID}/hub`)) return body(hub);
    if (c.url.startsWith(`/api/projects/${PID}/workspace`)) return body({ project, entries: [], tasks: [], files: [], contributions: [], activity: [] });
    if (c.url === `/api/projects/${PID}/items` && c.method === "POST") return body({ item: { kind: c.value.kind, id: c.value.id } }, 201);
    if (c.url === `/api/projects/${PID}`) return body({ project, items: linked });
    if (c.url.startsWith("/api/projects?")) return body({ projects: [project] });
    if (c.url.startsWith("/api/workflows")) return body({ workflows: [wf("w1", "Weekly report"), wf("w2", "Daily check")], runs: [], waiting: [] });
    if (c.url.startsWith("/api/schedules")) return body({ schedules: [{ id: "s1", name: "Morning run", botId: "b", botName: "Atlas" }] });
    if (c.url.startsWith("/api/tasks")) {
      return body({ tasks: [
        { id: "t-old", instruction: "Old job", assigneeName: "Atlas", status: "completed", createdAt: "2026-11-01T00:00:00Z" },
        { id: "t-new", instruction: "New job " + "x".repeat(100), assigneeName: "Atlas", status: "running", createdAt: "2026-11-14T00:00:00Z" },
      ] });
    }
    if (c.url.startsWith("/api/memory")) return body({ notes: [{ id: "n1", title: "Brand voice", scope: "shared", botId: null, content: "", tags: [], source: "owner", pinned: false }] });
    if (c.url.startsWith("/api/inbox")) return body({ items: [{ conversationId: "c1", botId: "b", botName: "Atlas", title: "Launch chat", originalTitle: "x", pinned: false, muted: false, archived: false, unread: 0, lastMessage: null, lastActivityAt: "t" }], unreadTotal: 0, heldBack: 0 });
    return body({ ok: true });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/${PID}?tab=settings`]}>
        <Routes>
          <Route path="/projects/:id" element={<Projects />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}
const ready = () => screen.findByLabelText("Project name");
const posted = (calls: Call[]) => calls.find((c) => c.method === "POST" && c.url.endsWith("/items"))!;

describe("project item picker", () => {
  it("offers real conversations by default and links the chosen one by its id", async () => {
    const calls = setup();
    await ready();
    const pick = await screen.findByLabelText("Choose a conversation");
    expect(within(pick).getByRole("option", { name: "Launch chat (Atlas)" })).toBeInTheDocument();
    await userEvent.selectOptions(pick, "Launch chat (Atlas)");
    await userEvent.click(screen.getByRole("button", { name: "Link item" }));
    expect(posted(calls).value).toEqual({ kind: "conversation", id: "c1" });
  });
  it.each([
    ["workflow", "Choose a workflow", "Weekly report", "w1"],
    ["schedule", "Choose a schedule", "Morning run (Atlas)", "s1"],
    ["note", "Choose a shared note", "Brand voice", "n1"],
  ])("lists %s items by name and sends the id", async (kind, label, option, id) => {
    const calls = setup();
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), kind);
    await userEvent.selectOptions(await screen.findByLabelText(label), option);
    await userEvent.click(screen.getByRole("button", { name: "Link item" }));
    expect(posted(calls).value).toEqual({ kind, id });
  });
  it("lists the newest tasks first with a clipped description and status", async () => {
    setup();
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), "task");
    const pick = await screen.findByLabelText("Choose a task");
    const options = within(pick).getAllByRole("option").map((o) => o.textContent);
    expect(options[1]).toMatch(/^New job x+… \(Atlas, running\)$/);
    expect(options[2]).toBe("Old job (Atlas, completed)");
  });
  it("leaves out items already linked, and says when everything is linked", async () => {
    setup(() => undefined, [{ kind: "workflow", id: "w1", title: "Weekly report", pinned: false }, { kind: "workflow", id: "w2", title: "Daily check", pinned: false }]);
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), "workflow");
    expect(await screen.findByText("Every workflow is already linked to this project.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose a workflow")).not.toBeInTheDocument();
  });
  it("says when none exist", async () => {
    setup((c) => (c.url.startsWith("/api/workflows") ? body({ workflows: [], runs: [], waiting: [] }) : undefined));
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), "workflow");
    expect(await screen.findByText("No workflow exists yet.")).toBeInTheDocument();
  });
  it("shows a failed read as a failure with Retry, never as 'none exists'", async () => {
    setup((c) => (c.url.startsWith("/api/workflows") ? body({ error: "x", message: "down" }, 503) : undefined));
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), "workflow");
    expect(await screen.findByText(/Could not load workflow list/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry workflow list" })).toBeEnabled();
    expect(screen.queryByText("No workflow exists yet.")).not.toBeInTheDocument();
  });
  it("keeps the raw id box as a fallback and still links by typed id", async () => {
    const calls = setup();
    await ready();
    await userEvent.click(screen.getByText("Enter an id instead"));
    await userEvent.type(screen.getByLabelText("Item id"), "typed-id");
    await userEvent.click(screen.getByRole("button", { name: "Link item" }));
    expect(posted(calls).value).toEqual({ kind: "conversation", id: "typed-id" });
  });
  it("clears the choice when the kind changes, and Link stays disabled until something is chosen", async () => {
    setup();
    await ready();
    expect(screen.getByRole("button", { name: "Link item" })).toBeDisabled();
    await userEvent.selectOptions(await screen.findByLabelText("Choose a conversation"), "Launch chat (Atlas)");
    expect(screen.getByRole("button", { name: "Link item" })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText("Item kind"), "workflow");
    expect(screen.getByRole("button", { name: "Link item" })).toBeDisabled();
  });
});
