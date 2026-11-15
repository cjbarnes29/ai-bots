import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Projects } from "./pages/Projects";
import type { Hub } from "./api/hubHooks";
import { KEY } from "./lib/interfaceLevel";

const PID = "11111111-1111-4111-8111-111111111111";
const project = { id: PID, name: "Demo Launch", description: "Fictional launch", instructions: "Keep approvals", archived: false, counts: { task: 1 }, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z" };
const emptyHub = (): Hub => ({ project, conversations: [], tasks: [], agents: [], workflows: [], decisions: [], approvals: [], outputs: [], notes: [], attention: [], progress: { total: 0, completed: 0, running: 0, pending: 0, failed: 0 } });
const body = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
type Request = { url: string; method: string; value: Record<string, unknown> | undefined };
const clients: QueryClient[] = [];
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; localStorage.removeItem(KEY); });
function setup(path = "/projects", handler: (r: Request) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Request = { url: String(input), method: init?.method ?? "GET", value: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(request);
    const value = handler(request); if (value !== undefined) return value;
    if (request.url.startsWith(`/api/projects/${PID}/hub`)) return body(emptyHub());
    if (request.url.startsWith(`/api/projects/${PID}/workspace`)) return body({ project, entries: [], tasks: [], files: [], contributions: [], activity: [] });
    if (request.url === `/api/projects/${PID}`) return body({ project, items: [] });
    if (request.url.startsWith("/api/projects?")) return body({ projects: [project] });
    return body({ ok: true });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/projects" element={<Projects />} /><Route path="/projects/:id" element={<Projects />} /></Routes></MemoryRouter></QueryClientProvider>);
  return { calls, client };
}
const fail = () => body({ error: "synthetic_unavailable", message: "Synthetic read unavailable" }, 503);

describe("Projects read states", () => {
  it("shows an initial failure and retry without false empty/selection advice", async () => {
    const { calls } = setup("/projects", r => r.url.startsWith("/api/projects?") ? fail() : undefined);
    expect(await screen.findByText(/Could not load projects/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Retry projects" })).toBeEnabled();
    expect(screen.queryByText(/No projects here|Choose a project/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument(); expect(calls.every(r => r.method === "GET")).toBe(true);
  });
  it("recovers through read-only retry", async () => {
    let failed = true; const { calls } = setup("/projects", r => r.url.startsWith("/api/projects?") && failed ? fail() : undefined);
    await screen.findByRole("button", { name: "Retry projects" }); failed = false; await userEvent.click(screen.getByRole("button", { name: "Retry projects" }));
    expect(await screen.findByRole("button", { name: "Open Demo Launch" })).toBeInTheDocument(); expect(screen.queryByText(/Could not load projects/)).not.toBeInTheDocument(); expect(calls.every(r => r.method === "GET")).toBe(true);
  });
  it("distinguishes successful empty list from empty search", async () => {
    setup("/projects", r => r.url.startsWith("/api/projects?") ? body({ projects: [] }) : undefined);
    expect(await screen.findByText("No projects here yet.")).toBeInTheDocument(); await userEvent.type(screen.getByLabelText("Search projects"), "missing");
    expect(await screen.findByText("No projects match this search.")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Retry projects" })).not.toBeInTheDocument();
  });
  it("shows loading without empty or missing-project claims", async () => {
    let resolve!: (r: Response) => void; setup("/projects", r => r.url.startsWith("/api/projects?") ? new Promise(done => { resolve = done; }) : undefined);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument(); expect(screen.queryByText(/No projects here|Choose a project/)).not.toBeInTheDocument();
    await act(async () => resolve(body({ projects: [project] }))); await screen.findByRole("button", { name: "Open Demo Launch" });
  });
  it("keeps cached project cards dated and marked stale after failure", async () => {
    let failed = false; const { client } = setup("/projects", r => r.url.startsWith("/api/projects?") && failed ? fail() : undefined);
    await screen.findByRole("button", { name: "Open Demo Launch" }); failed = true; await act(async () => { await client.invalidateQueries({ queryKey: ["projects", "list"] }); });
    expect(await screen.findByText(/Showing the last available data from/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Open Demo Launch" })).toBeInTheDocument();
    expect(screen.queryByText(/No projects here/)).not.toBeInTheDocument();
  });
  it("does not turn an old empty list into a current empty result after failure", async () => {
    let failed = false; const { client } = setup("/projects", r => r.url.startsWith("/api/projects?") ? failed ? fail() : body({ projects: [] }) : undefined);
    await screen.findByText("No projects here yet."); failed = true; await act(async () => { await client.invalidateQueries({ queryKey: ["projects", "list"] }); });
    await screen.findByText(/Could not load projects/); expect(screen.queryByText("No projects here yet.")).not.toBeInTheDocument();
  });
  it("marks a pending refresh and suppresses an old empty-state claim", async () => {
    let pending = false, resolve!: (r: Response) => void;
    const { client } = setup("/projects", r => r.url.startsWith("/api/projects?") ? pending ? new Promise(done => { resolve = done; }) : body({ projects: [] }) : undefined);
    await screen.findByText("No projects here yet."); pending = true; act(() => { void client.invalidateQueries({ queryKey: ["projects", "list"] }); });
    await screen.findByText(/Refreshing projects/); expect(screen.queryByText("No projects here yet.")).not.toBeInTheDocument();
    await act(async () => resolve(body({ projects: [project] }))); await screen.findByRole("button", { name: "Open Demo Launch" });
  });
  it("keeps search and archived filter in the existing GET contract", async () => {
    const { calls } = setup(); await screen.findByRole("button", { name: "Open Demo Launch" });
    await userEvent.click(screen.getByLabelText("Show archived projects")); await userEvent.type(screen.getByLabelText("Search projects"), "demo");
    await waitFor(() => expect(calls.some(r => r.url.includes("archived=1") && r.url.includes("q=demo"))).toBe(true)); expect(calls.every(r => r.method === "GET")).toBe(true);
  });
  it("retains the exact project creation payload", async () => {
    const { calls } = setup("/projects", r => r.method === "POST" ? body({ project }) : undefined);
    await userEvent.type(screen.getByLabelText("New project name"), "Next project"); await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(calls.find(r => r.method === "POST")).toMatchObject({ url: "/api/projects", value: { name: "Next project" } }));
  });
});

describe("Project hub scope and priority", () => {
  it("shows an initial hub error without reassuring empty progress", async () => {
    setup(`/projects/${PID}`, r => r.url.endsWith("/hub") ? fail() : undefined);
    await screen.findByText(/Could not load project activity/); expect(screen.getByRole("button", { name: "Retry project activity" })).toBeInTheDocument(); expect(screen.queryByText("Nothing is waiting for you.")).not.toBeInTheDocument();
  });
  it("recovers the hub without performing a mutation", async () => {
    let failed = true; const { calls } = setup(`/projects/${PID}`, r => r.url.endsWith("/hub") && failed ? fail() : undefined);
    await screen.findByRole("button", { name: "Retry project activity" }); failed = false; await userEvent.click(screen.getByRole("button", { name: "Retry project activity" })); await screen.findByRole("region", { name: "Needs your attention" });
    expect(calls.every(r => r.method === "GET")).toBe(true);
  });
  it("marks cached empty attention/progress stale instead of currently clear", async () => {
    let failed = false; const { client } = setup(`/projects/${PID}`, r => r.url.endsWith("/hub") && failed ? fail() : undefined);
    await screen.findByText("Nothing is waiting for you."); failed = true; await act(async () => { await client.invalidateQueries({ queryKey: ["hub", PID] }); });
    await screen.findByText(/Showing the last available data from/); expect(screen.queryByText("Nothing is waiting for you.")).not.toBeInTheDocument(); expect(screen.queryByText("No tasks in this project yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/No attention items in the last available/)).toBeInTheDocument();
  });
  it("retains pending attention links while clearly marking cached data", async () => {
    let failed = false; const hub = emptyHub(); hub.attention = [{ kind: "approval", id: "a1", text: "Waiting for your approval" }];
    const { client, calls } = setup(`/projects/${PID}`, r => r.url.endsWith("/hub") ? failed ? fail() : body(hub) : undefined);
    await screen.findByRole("link", { name: "Waiting for your approval" }); failed = true; await act(async () => { await client.invalidateQueries({ queryKey: ["hub", PID] }); });
    await screen.findByText(/Could not load project activity/); expect(screen.getByRole("link", { name: "Waiting for your approval" })).toHaveAttribute("href", "/approvals?focus=a1"); expect(calls.some(r => r.url.includes("verification"))).toBe(false);
  });
  it("puts attention and the contextual Assistant link before progress without implying verification", async () => {
    const hub = emptyHub(); hub.progress = { total: 1, completed: 1, running: 0, pending: 0, failed: 0 }; setup(`/projects/${PID}`, r => r.url.endsWith("/hub") ? body(hub) : undefined);
    const attention = await screen.findByRole("region", { name: "Needs your attention" }), progress = screen.getByRole("region", { name: "Progress" });
    expect(attention.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const assistant = screen.getByRole("link", { name: "Talk to the AI Assistant about this project" }); expect(assistant).toHaveAttribute("href", `/assistant?project=${PID}`); expect(assistant.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Finished means the task stopped/)).toBeInTheDocument(); expect(screen.getByText(/not a global waiting count/)).toBeInTheDocument();
  });
  it("calls pending/approved outputs requests and links to the existing task check", async () => {
    const hub = emptyHub(); hub.outputs = ["pending", "approved", "executed"].map((status, i) => ({ approvalId: `a${i}`, connector: "documents", action: "create_spreadsheet", path: `demo${i}.csv`, status, botName: "Helper", taskId: `task${i}`, at: "2026-11-15T00:00:00Z" }));
    setup(`/projects/${PID}?tab=files`, r => r.url.endsWith("/hub") ? body(hub) : undefined);
    await screen.findByText("File requests from this project's tasks"); expect(screen.getByText(/Waiting for your approval; file not confirmed/)).toBeInTheDocument(); expect(screen.getByText(/Approved, awaiting execution; file not confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Execution recorded; current file existence not checked here/)).toBeInTheDocument(); expect(screen.getAllByRole("link", { name: "Open task result check" })[0]).toHaveAttribute("href", "/tasks/task0");
  });
  it.each([["simple", 5], ["intermediate", 8], ["advanced", 8]] as const)("retains %s tab rules and attention", async (level, count) => {
    localStorage.setItem(KEY, level); setup(`/projects/${PID}`); const tabs = await screen.findByRole("tablist", { name: "Project sections" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(count); expect(await screen.findByRole("region", { name: "Needs your attention" })).toBeInTheDocument();
  });
});

describe("Project settings compatibility", () => {
  it("keeps every existing owner control reachable at Simple by address", async () => {
    localStorage.setItem(KEY, "simple"); setup(`/projects/${PID}?tab=settings`);
    await screen.findByLabelText("Project name"); for (const name of ["Save project", "Archive", "Link item", "Delete project"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete project" })).toBeDisabled(); expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });
  it("keeps edited fields and actions available with a clearly stale settings warning", async () => {
    let failed = false; const { client } = setup(`/projects/${PID}?tab=settings`, r => r.url === `/api/projects/${PID}` && failed ? fail() : undefined);
    const input = await screen.findByLabelText("Project name"); await userEvent.clear(input); await userEvent.type(input, "Unsent edit"); failed = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ["projects", "one", PID] }); }); await screen.findByText(/Could not load project settings/);
    expect(input).toHaveValue("Unsent edit"); expect(screen.getByRole("button", { name: "Save project" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Retry project settings" })).toBeEnabled();
  });
  it("retains the existing save payload without permission or schema changes", async () => {
    const { calls } = setup(`/projects/${PID}?tab=settings`, r => r.method === "PATCH" ? body({ project }) : undefined);
    const description = await screen.findByLabelText("Project description"); await userEvent.clear(description); await userEvent.type(description, "Updated description"); await userEvent.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(calls.find(r => r.method === "PATCH")).toMatchObject({ url: `/api/projects/${PID}`, value: { name: "Demo Launch", description: "Updated description", instructions: "Keep approvals" } }));
  });
});
