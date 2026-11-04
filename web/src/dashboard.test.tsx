import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </QueryClientProvider>,
  );
}

const card = (title: string) => within(screen.getByText(title).closest("a") as HTMLElement);

describe("the Dashboard", () => {
  it("is the first page and says everything is fine when nothing needs attention", async () => {
    renderApp(createFakeApi([makeBot()]));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText(/Everything looks fine/)).toBeInTheDocument();
    expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("shows the numbers on cards that link to where the detail lives", async () => {
    const api = createFakeApi([makeBot()]);
    Object.assign(api.ext.monitor, {
      bots: { total: 3, active: 2, archived: 1 },
      tasks: { running: 4, completed24h: 5, failed24h: 2 },
      approvals: { pending: 1, executed24h: 4, denied24h: 1, failed24h: 1 },
      ai: { callsToday: 17, tokensToday: 12345, errorsToday: 1, blockedToday: 0, paused: false },
    });
    renderApp(api);
    await screen.findByText("17");
    expect(screen.getByText("Agents").closest("a")).toHaveAttribute("href", "/agents");
    expect(card("Agents").getByText("2")).toBeInTheDocument();
    expect(card("Tasks in progress").getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Tasks in progress").closest("a")).toHaveAttribute("href", "/tasks");
    expect(screen.getByText("Waiting for approval").closest("a")).toHaveAttribute("href", "/approvals");
    expect(card("Failures (24 h)").getByText("3")).toBeInTheDocument(); // 2 failed tasks + 1 failed outside action
    expect(screen.getByText("Integrations").closest("a")).toHaveAttribute("href", "/integrations");
    expect(screen.getByText("AI providers").closest("a")).toHaveAttribute("href", "/settings/ai-models");
  });

  it("counts waiting approvals from the same source as the menu badge", async () => {
    const api = createFakeApi([makeBot()]);
    api.ext.approvals.push(
      { id: "a1", botId: "b", botName: "B", connector: "gmail", action: "send_message", summary: "s", args: {}, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e6).toISOString(), decidedAt: null, result: null, error: null, taskId: null } as never,
    );
    renderApp(api);
    expect(await within((await screen.findByText("Waiting for approval")).closest("a") as HTMLElement).findByText("1")).toBeInTheDocument();
  });

  it("does not claim a provider is connected before a test succeeded", async () => {
    renderApp(createFakeApi([makeBot()]));
    const providers = await screen.findByText("AI providers");
    expect(await within(providers.closest("a") as HTMLElement).findByText(/^0 of \d+ connected$/)).toBeInTheDocument();
    expect(within(providers.closest("a") as HTMLElement).getByText("Connected only after a test call succeeds")).toBeInTheDocument();
  });

  it("offers a get-started checklist while there is no agent or no working model", async () => {
    renderApp(createFakeApi());
    const list = within(await screen.findByRole("region", { name: "Get started" }));
    expect(list.getByRole("link", { name: "Connect an AI model" })).toHaveAttribute("href", "/settings/ai-models");
    expect(list.getByRole("link", { name: "Create your first agent" })).toHaveAttribute("href", "/agents");
  });

  it("system health says paused states in words, and links to quick actions", async () => {
    const api = createFakeApi([makeBot()]);
    Object.assign(api.ext.monitor, { ai: { callsToday: 0, tokensToday: 0, errorsToday: 0, blockedToday: 0, paused: true } });
    renderApp(api);
    const health = within(await screen.findByRole("region", { name: "System health" }));
    expect(await health.findByText("Paused")).toBeInTheDocument();
    expect(health.getByText("On (locked)")).toBeInTheDocument();
    const quick = within(screen.getByRole("region", { name: "Quick actions" }));
    expect(quick.getByRole("link", { name: "New workflow" })).toHaveAttribute("href", "/workflows");
    expect(quick.getByRole("link", { name: "Connect a service" })).toHaveAttribute("href", "/integrations");
  });

  it("shows recent activity with links and a way to the full list", async () => {
    const api = createFakeApi([makeBot()]);
    Object.assign(api.ext.monitor, {
      activity: [{ at: new Date().toISOString(), kind: "task", level: "error", summary: "Helper failed a task", link: "/tasks/t1" }],
    });
    renderApp(api);
    expect(await screen.findByRole("link", { name: "Helper failed a task" })).toHaveAttribute("href", "/tasks/t1");
    expect(screen.getByRole("link", { name: "See all activity" })).toHaveAttribute("href", "/monitor");
  });
});
