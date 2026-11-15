import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { Tabs, TabPanel } from "./components/ui/Tabs";
import { Panel, StackedBar, StatCard, StatusDot } from "./components/ui/Stats";
import { createFakeApi } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path: string) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

function Demo() {
  const [v, setV] = useState<"a" | "b" | "c">("a");
  return (
    <>
      <Tabs
        label="Demo"
        value={v}
        onChange={setV}
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta", badge: 3 },
          { id: "c", label: "Gamma" },
        ]}
      />
      <TabPanel label={v}>panel {v}</TabPanel>
    </>
  );
}

describe("shared UI: Tabs", () => {
  it("selects with click and with arrow keys, wraps, and keeps one tab in the tab order", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveAttribute("tabindex", "-1");
    alpha.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    await user.keyboard("{ArrowRight}"); // wraps to the first
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}"); // wraps to the last
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "c" })).toHaveTextContent("panel c");
    await user.click(screen.getByRole("tab", { name: "Alpha" }));
    expect(screen.getByRole("tabpanel", { name: "a" })).toBeInTheDocument();
  });
});

describe("shared UI: StatCard, StackedBar, StatusDot, Panel", () => {
  it("StatCard is one link with plain-text value and hint", () => {
    render(
      <MemoryRouter>
        <StatCard title="Agents" value={4} hint="1 archived" to="/agents" tone="warn" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/agents");
    expect(within(link).getByText("4")).toBeInTheDocument();
    expect(within(link).getByText("1 archived")).toBeInTheDocument();
  });

  it("StackedBar describes itself in words, hides empty parts and says so when there is nothing", () => {
    const { rerender } = render(
      <StackedBar
        label="Tasks"
        parts={[
          { label: "finished", value: 3, tone: "ok" },
          { label: "failed", value: 0, tone: "bad" },
          { label: "running", value: 1, tone: "idle" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Tasks: 3 finished, 0 failed, 1 running" })).toBeInTheDocument();
    expect(screen.getByRole("img").children).toHaveLength(2); // the zero part draws nothing
    expect(screen.getByText("failed")).toBeInTheDocument(); // but it is still written out
    rerender(<StackedBar label="Tasks" empty="Nothing ran." parts={[{ label: "finished", value: 0, tone: "ok" }]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing ran.")).toBeInTheDocument();
  });

  it("StatusDot is decorative and Panel labels its region", () => {
    const { container } = render(
      <Panel id="p-h" title="Box" action={<a href="/x">More</a>}>
        <StatusDot tone="ok" live />
      </Panel>,
    );
    expect(container.querySelector("[aria-hidden='true']")).toHaveClass("awp-live");
    expect(screen.getByRole("region", { name: "Box" })).toBeInTheDocument();
  });
});

describe("Dashboard overview boxes", () => {
  it("shows task execution as a bar with the real numbers and says when tasks are working", async () => {
    const api = createFakeApi();
    Object.assign(api.ext.monitor, { tasks: { running: 2, completed24h: 5, failed24h: 1 } });
    renderApp(api, "/");
    const box = within(await screen.findByRole("region", { name: "Task execution (24 h)" }));
    expect(await box.findByRole("img", { name: "Tasks created in the last 24 hours, with current running count: 5 finished, 1 failed, 2 running now" })).toBeInTheDocument();
    expect(box.getByText("2 tasks are working right now.")).toBeInTheDocument();
    expect(box.getByRole("link", { name: "All tasks" })).toHaveAttribute("href", "/tasks");
  });

  it("lists application connections with a word for each state, and links to the Integrations Center", async () => {
    renderApp(createFakeApi(), "/");
    const box = within(await screen.findByRole("region", { name: "Application connections" }));
    expect(box.getByRole("link", { name: "Integrations Center" })).toHaveAttribute("href", "/integrations");
    expect(await box.findAllByText(/^(Set up|Not set up)$/)).not.toHaveLength(0);
  });
});

describe("Monitoring tabs", () => {
  it("opens on the overview and switches to the activity log with filters", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    Object.assign(api.ext.monitor, {
      activity: [
        { at: new Date().toISOString(), kind: "task", level: "error", summary: "Helper failed a task", link: null },
        { at: new Date().toISOString(), kind: "approval", level: "info", summary: "An approval was done", link: null },
        { at: new Date().toISOString(), kind: "security", level: "warn", summary: "A security note", link: null },
      ],
    });
    renderApp(api, "/monitor");
    expect(await screen.findByRole("tabpanel", { name: "Overview" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Activity log/ }));
    const panel = within(await screen.findByRole("tabpanel", { name: "Activity log" }));
    expect(panel.getAllByRole("listitem")).toHaveLength(3);
    await user.click(panel.getByRole("button", { name: "Tasks" }));
    expect(panel.getAllByRole("listitem")).toHaveLength(1);
    expect(panel.getByText("Helper failed a task")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Everything" }));
    await user.click(panel.getByRole("checkbox", { name: "Problems and warnings only" }));
    expect(panel.getAllByRole("listitem")).toHaveLength(2);
    expect(panel.queryByText("An approval was done")).not.toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Approvals" }));
    expect(panel.getByText("Nothing matches these filters.")).toBeInTheDocument();
  });

  it("shows running work and resources, and is honest that CPU and memory are not measured", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    Object.assign(api.ext.monitor, { ai: { callsToday: 10, tokensToday: 2500, errorsToday: 2, blockedToday: 1, paused: false } });
    renderApp(api, "/monitor");
    await user.click(await screen.findByRole("tab", { name: "Running work" }));
    const run = within(await screen.findByRole("tabpanel", { name: "Running work" }));
    expect(await run.findByText("No task is running.")).toBeInTheDocument();
    expect(await run.findByText("No workflow is running.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    const res = within(await screen.findByRole("tabpanel", { name: "Resources" }));
    expect(res.getByRole("img", { name: "AI calls today: 8 worked, 2 failed, 1 refused by limits or safety rules" })).toBeInTheDocument();
    expect(res.getByText(/2,500 tokens today/)).toBeInTheDocument();
    expect(res.getByText(/CPU, memory\) is not measured/)).toBeInTheDocument();
  });
});
