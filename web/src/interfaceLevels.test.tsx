import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { shownAt, KEY } from "./lib/interfaceLevel";
import { guidanceFor } from "./lib/guidance";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** Interface levels (D-079): what is listed in the menu, that nothing is removed, and that moving between levels loses nothing. */
function setup(path: string, extra?: (m: string, u: string, b: unknown) => unknown | undefined) {
  const base = createFakeApi([makeBot({ name: "Atlas", status: "active", model: "demo/simulated-echo" })]);
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const out = extra?.(method, url, body);
    if (out !== undefined) return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }));
    if (url.startsWith("/api/assistant/")) return Promise.resolve(new Response(JSON.stringify(url.includes("suggestions") ? { suggestions: [] } : { actions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    return base.fetch(input, init);
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, calls, ...view };
}
const menu = () => within(screen.getByRole("navigation", { name: "Main" }));
const menuNames = () =>
  menu()
    .getAllByRole("link")
    .map((l) => l.getAttribute("aria-label") ?? l.textContent ?? "")
    .filter((n) => n !== "AI Workforce Studio home")
    .map((n) => n.replace(/, \d+ waiting$/, "").trim());
const choose = (name: string) => userEvent.click(screen.getByRole("button", { name: `${name} level` }));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("interface levels", () => {
  it("the default is Advanced: the menu is exactly what it was before, and no guide is shown", async () => {
    setup("/projects");
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(menuNames()).toEqual(["AI Assistant", "Dashboard", "Projects", "Workflows", "AI Agents", "Knowledge Center", "Tasks & history", "Decisions & approvals", "AI Models", "Apps & Integrations", "Creative Studio", "Settings"]);
    expect(screen.getByRole("button", { name: "Advanced level" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("note", { name: "Plain-language guide" })).toBeNull();
  });

  it("Simple lists only the essentials; Intermediate adds workflows, agents, knowledge and tasks; the choice is remembered", async () => {
    const a = setup("/projects");
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    await choose("Simple");
    expect(menuNames()).toEqual(["AI Assistant", "Dashboard", "Projects", "Decisions & approvals"]);
    expect(localStorage.getItem(KEY)).toBe("simple");
    await choose("Intermediate");
    expect(menuNames()).toEqual(["AI Assistant", "Dashboard", "Projects", "Workflows", "AI Agents", "Knowledge Center", "Tasks & history", "Decisions & approvals"]);
    await choose("Simple");
    a.unmount();
    // a fresh page load in the same browser keeps it
    setup("/projects");
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(screen.getByRole("button", { name: "Simple level" })).toHaveAttribute("aria-pressed", "true");
    expect(menuNames()).toEqual(["AI Assistant", "Dashboard", "Projects", "Decisions & approvals"]);
  });

  it("nothing is removed: a screen the level does not list still opens by address, says so, and can be added to the menu", async () => {
    localStorage.setItem(KEY, "simple");
    setup("/models");
    await screen.findByRole("heading", { level: 1 });
    // the section you are in stays visible, so you always know where you are
    expect(menuNames()).toContain("AI Models");
    const notice = screen.getByRole("note", { name: "Hidden screen" });
    expect(notice).toHaveTextContent(/AI Models.*Advanced level.*not in the menu at Simple/);
    await userEvent.click(within(notice).getByRole("button", { name: "Show it in the menu" }));
    expect(localStorage.getItem(KEY)).toBe("advanced");
    expect(screen.queryByRole("note", { name: "Hidden screen" })).toBeNull();
  });

  it("the things that need the owner are listed at EVERY level, with the waiting count", async () => {
    for (const level of ["simple", "intermediate", "advanced"]) {
      localStorage.setItem(KEY, level);
      const api = createFakeApi();
      api.ext.approvals.push({ id: "a1", botId: "b", botName: "Atlas", connector: "documents", connectorLabel: "Documents", action: "create_docx", summary: "Create a file", args: {}, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e6).toISOString(), decidedAt: null, decidedBy: null, result: null, error: null, taskId: null } as never);
      vi.stubGlobal("fetch", (i: RequestInfo | URL, init?: RequestInit) => api.fetch(i, init));
      const view = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
        </QueryClientProvider>,
      );
      expect(await screen.findByRole("link", { name: /^Decisions & approvals, 1 waiting$/ }), level).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "AI Assistant" })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("plain-language guides appear at Simple and Intermediate, never at Advanced", async () => {
    localStorage.setItem(KEY, "simple");
    setup("/assistant");
    const guide = await screen.findByRole("note", { name: "Plain-language guide" });
    expect(guide).toHaveTextContent(/never deletes, sends or buys anything by itself/);
    await choose("Intermediate");
    expect(screen.getByRole("note", { name: "Plain-language guide" })).toBeInTheDocument();
    await choose("Advanced");
    expect(screen.queryByRole("note", { name: "Plain-language guide" })).toBeNull();
    expect(guidanceFor("/projects/abc")).toMatch(/project keeps everything/);
    expect(guidanceFor("/nowhere")).toBeNull();
  });

  it("moving between levels loses nothing: an unsent message and the page itself stay as they are", async () => {
    const { router } = setup("/assistant");
    const box = await screen.findByLabelText(/Your message/i);
    await userEvent.type(box, "half a thought");
    const before = router.state.location.key;
    await choose("Simple");
    await choose("Intermediate");
    await choose("Advanced");
    expect(screen.getByLabelText(/Your message/i)).toBe(box); // the very same element: no remount, no reload
    expect(box).toHaveValue("half a thought");
    expect(router.state.location.key).toBe(before);
  });

  it("choosing a level also sets the Recommended Settings detail level to the same word (Simple = Beginner)", async () => {
    const { calls } = setup("/assistant");
    await screen.findByRole("heading", { level: 1, name: "AI Assistant" });
    await choose("Simple");
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url === "/api/recommendations/mode" && (c.body as { mode: string }).mode === "beginner")).toBe(true));
    await choose("Intermediate");
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && (c.body as { mode: string }).mode === "intermediate")).toBe(true));
  });

  it("a failed sync never blocks the change, and broken storage falls back to Advanced", async () => {
    localStorage.setItem(KEY, "nonsense");
    setup("/projects", (m, u) => (m === "PUT" && u === "/api/recommendations/mode" ? undefined : undefined));
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    expect(screen.getByRole("button", { name: "Advanced level" })).toHaveAttribute("aria-pressed", "true");
    expect(shownAt("simple", "advanced")).toBe(true);
    expect(shownAt("advanced", "simple")).toBe(false);
    expect(shownAt("intermediate", "intermediate")).toBe(true);
  });

  it("a project page lists five tabs at Simple and all eight from Intermediate; a tab opened by address stays listed", async () => {
    const PID = "11111111-1111-4111-8111-111111111111";
    const project = { id: PID, name: "Cafe", description: "", instructions: "", archived: false, createdAt: "x", updatedAt: "x", counts: {} };
    const hub = { project: { id: PID, name: "Cafe", description: "", archived: false }, conversations: [], tasks: [], agents: [], workflows: [], decisions: [], approvals: [], outputs: [], notes: [], attention: [], progress: { total: 0, completed: 0, running: 0, pending: 0, failed: 0 } };
    const api = (_m: string, u: string) => (u.startsWith(`/api/projects/${PID}/hub`) ? hub : u.startsWith(`/api/projects/${PID}`) ? { project, items: [] } : u.startsWith("/api/projects?") ? { projects: [project] } : undefined);
    localStorage.setItem(KEY, "simple");
    const a = setup(`/projects/${PID}`, api);
    const tabs = async () => (await screen.findAllByRole("tab", { name: /./ })).filter((el) => el.closest('[aria-label="Project sections"]')).map((el) => (el.textContent ?? "").replace(/d+$/, "").trim());
    expect(await tabs()).toEqual(["Overview", "Conversations", "Tasks & history", "Files & knowledge", "Decisions & approvals"]);
    await choose("Intermediate");
    expect(await tabs()).toEqual(["Overview", "Conversations", "Tasks & history", "Agents", "Files & knowledge", "Workflows", "Decisions & approvals", "Settings"]);
    a.unmount();
    setup(`/projects/${PID}?tab=settings`, api); // a deep link to a tab Simple does not list: it stays listed, so the page you opened is not lost
    localStorage.setItem(KEY, "simple");
    await waitFor(async () => expect(await tabs()).toContain("Settings"));
  });

  it("the Dashboard shows only the essentials at Simple (what needs you stays) and everything from Intermediate", async () => {
    localStorage.setItem(KEY, "simple");
    setup("/");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(screen.getByRole("heading", { name: "Needs your attention" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "At a glance" })).toBeInTheDocument();
    for (const technical of ["System health", "Quick actions", "Recent workflow runs", "Application connections", "Your AI right now"]) expect(screen.queryByRole("heading", { name: technical }), technical).toBeNull();
    expect(screen.queryByText("AI providers")).toBeNull();
    const note = screen.getByRole("note", { name: "Simple dashboard" });
    await userEvent.click(within(note).getByRole("button", { name: "Show more detail" }));
    expect(localStorage.getItem(KEY)).toBe("intermediate");
    for (const technical of ["System health", "Quick actions", "Recent workflow runs", "Application connections"]) expect(await screen.findByRole("heading", { name: technical }), technical).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Simple dashboard" })).toBeNull();
  });

  it("on a phone-sized menu, the More sheet says what is hidden and offers the switch", async () => {
    localStorage.setItem(KEY, "simple");
    setup("/");
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = await screen.findByRole("dialog", { name: "More" });
    expect(within(sheet).getByText(/hidden at this interface level/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("link", { name: "Settings" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Advanced level" }));
    expect(within(sheet).getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});
