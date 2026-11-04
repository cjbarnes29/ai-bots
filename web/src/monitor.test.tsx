import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/monitor") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("the Monitor page", () => {
  it("says everything is fine when nothing needs attention, and that nothing has happened yet", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByText(/Everything looks fine/)).toBeInTheDocument();
    expect(screen.getByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("shows what needs attention first, with links, and the numbers and recent activity", async () => {
    const api = createFakeApi();
    Object.assign(api.ext.monitor, {
      bots: { total: 3, active: 1, archived: 2 },
      tasks: { running: 1, completed24h: 5, failed24h: 2 },
      approvals: { pending: 2, executed24h: 4, denied24h: 1, failed24h: 0 },
      ai: { callsToday: 17, tokensToday: 12345, errorsToday: 1, blockedToday: 3, paused: true },
      devices: { remoteEnabled: true, paired: 1 },
      attention: [
        { level: "warn", text: "2 actions are waiting for your approval", link: "/approvals" },
        { level: "error", text: "2 tasks failed in the last 24 hours", link: "/tasks" },
      ],
      activity: [{ at: new Date().toISOString(), kind: "task", level: "error", summary: 'Helper: failed "Summarise inbox" (provider down)', link: "/tasks/t1" }],
    });
    renderApp(api);
    const attention = within(await screen.findByRole("region", { name: "Needs your attention" }));
    expect(attention.getByRole("link", { name: "2 actions are waiting for your approval" })).toHaveAttribute("href", "/approvals");
    expect(attention.getByRole("link", { name: "2 tasks failed in the last 24 hours" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByText("12,345 tokens · 1 failed · PAUSED")).toBeInTheDocument();
    expect(screen.getByText("Phone access is on")).toBeInTheDocument();
    const feed = within(screen.getByRole("region", { name: "Recent activity" }));
    expect(feed.getByRole("link", { name: /failed "Summarise inbox"/ })).toHaveAttribute("href", "/tasks/t1");
    expect(feed.getByText("Problem")).toBeInTheDocument();
  });

  it("is in the main menu", async () => {
    renderApp(createFakeApi(), "/");
    expect(await screen.findByRole("link", { name: "Activity & Logs" })).toHaveAttribute("href", "/monitor");
  });
});
