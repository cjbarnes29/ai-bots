import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/** The project hub and the context links, with a stubbed API (no real service). */
function setup(path: string, handler: (url: string) => unknown | undefined) {
  const base = createFakeApi([]);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const out = handler(String(input));
    if (out === undefined) return base.fetch(input, init);
    return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PID = "11111111-1111-4111-8111-111111111111";
const project = { id: PID, name: "Website", description: "Build the site", instructions: "", archived: false, createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", counts: {} };
const hub = {
  project: { id: PID, name: "Website", description: "Build the site", archived: false },
  conversations: [{ id: "c1", botId: "b1", botName: "Writer", title: "Home page copy", createdAt: "2026-11-06T09:00:00Z", lastAt: "2026-11-06T10:00:00Z" }],
  tasks: [{ id: "t1", rootId: "t1", botId: "b1", botName: "Writer", instruction: "Write the home page", status: "failed", errorMessage: "Model unavailable", createdAt: "2026-11-06T09:00:00Z", finishedAt: null }],
  agents: [{ botId: "b1", name: "Writer", archived: false, roles: ["works on its tasks"], tasks: 1, conversations: 1, lastAt: "2026-11-06T10:00:00Z" }],
  workflows: [],
  decisions: [],
  approvals: [{ id: "a1", botId: "b1", botName: "Writer", taskId: "t1", connector: "documents", action: "create_docx", summary: "Create home.docx", status: "pending", createdAt: "2026-11-06T09:30:00Z" }],
  outputs: [],
  notes: [],
  attention: [
    { kind: "approval", id: "a1", text: "Writer is waiting for your approval: Create home.docx" },
    { kind: "failed_task", id: "t1", text: "Writer's task failed: Model unavailable" },
  ],
  progress: { total: 1, completed: 0, running: 0, pending: 0, failed: 1 },
};
const api = (url: string): unknown | undefined => {
  if (url.startsWith(`/api/projects/${PID}/hub`)) return hub;
  if (url.startsWith(`/api/projects/${PID}`)) return { project, items: [] };
  if (url.startsWith("/api/projects?")) return { projects: [project] };
  return undefined;
};

describe("Project hub", () => {
  it("shows what needs attention with links to the approval and the failed task", async () => {
    setup(`/projects/${PID}`, api);
    expect(await screen.findByRole("tablist", { name: "Project sections" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /waiting for your approval/ })).toHaveAttribute("href", "/approvals?focus=a1");
    expect(screen.getByRole("link", { name: /task failed: Model unavailable/ })).toHaveAttribute("href", "/tasks/t1");
  });

  it("opens a conversation in the agent's chat, and keeps the tab in the address", async () => {
    const router = setup(`/projects/${PID}?tab=conversations`, api);
    const link = await screen.findByRole("link", { name: "Home page copy" });
    expect(link).toHaveAttribute("href", "/bots/b1?tab=chat&conversation=c1");
    await userEvent.click(screen.getByRole("tab", { name: /Agents/ }));
    expect(router.state.location.search).toBe("?tab=agents");
    expect(await screen.findByRole("link", { name: "Writer" })).toHaveAttribute("href", "/bots/b1");
  });

  it("keeps the project editor reachable under Settings (one settings screen)", async () => {
    setup(`/projects/${PID}?tab=settings`, api);
    expect(await screen.findByLabelText("Project name")).toHaveValue("Website");
  });
});
