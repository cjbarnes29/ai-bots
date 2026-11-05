import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path: string) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const SECRET_NAMES = ["GITHUB_TOKEN", "NOTION_TOKEN", "N8N_WEBHOOK_URL", "MCP_SERVER_URL", "MCP_SERVER_TOKEN", "GMAIL_REFRESH_TOKEN", "GOOGLE_WORKSPACE_REFRESH_TOKEN"];
/** A fake backend with the outside services installed, like the real one (same set-up as serviceWizard.test.tsx). */
function withServices() {
  const api = createFakeApi();
  for (const [id, label] of [["gworkspace", "Google Workspace"], ["github", "GitHub"], ["notion", "Notion"], ["n8n", "n8n"], ["mcp", "MCP server"], ["pc", "PC (PowerShell tools)"]] as const) api.ext.connectors.push({ id, label, actions: [], ...(id === "pc" ? {} : { notReady: "nothing saved yet." }) } as never);
  for (const name of SECRET_NAMES) if (!api.ext.secrets.some((x) => x.name === name)) api.ext.secrets.push({ name, description: name, inVault: false, inEnv: false, updatedAt: null });
  return api;
}

describe("the AI Models workspace", () => {
  it("is its own section with tabs, and shows the providers first", async () => {
    renderApp(createFakeApi(), "/models");
    expect(await screen.findByRole("heading", { level: 1, name: "AI Models" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "AI Models" })).toHaveAttribute("aria-current", "page");
    const tabs = within(screen.getByRole("tablist", { name: "AI model areas" }));
    expect(tabs.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Providers", "Models & testing", "Routing & fallback", "Usage", "Limits & safety"]);
    expect(await screen.findByRole("tabpanel", { name: "Providers" })).toBeInTheDocument();
  });

  it("opens each area in its own tab using the original sections", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/models");
    await user.click(await screen.findByRole("tab", { name: "Routing & fallback" }));
    const routing = within(await screen.findByRole("tabpanel", { name: "Routing & fallback" }));
    expect((await routing.findAllByText(/automatic/i)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: "Usage" }));
    expect(await screen.findByRole("tabpanel", { name: "Usage" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Limits & safety" }));
    expect(await screen.findByRole("tabpanel", { name: "Limits & safety" })).toBeInTheDocument();
  });

  it("Settings > AI Models still shows everything and points to the workspace", async () => {
    renderApp(createFakeApi(), "/settings/ai-models");
    expect(await screen.findByRole("link", { name: "AI Models workspace" })).toHaveAttribute("href", "/models");
    // still the section AI Models in the menu, and the old address keeps working
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "AI Models" })).toHaveAttribute("aria-current", "page");
  });
});

describe("the agent list", () => {
  it("searches by name or role and filters by status", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([makeBot({ name: "Alpha", role: "Researcher" }), makeBot({ name: "Beta", role: "Writer", status: "active" })]);
    renderApp(api, "/agents");
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search agents" }), "writ");
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search agents" }));
    await user.click(screen.getByRole("button", { name: "Disabled only" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Paused only" }));
    expect(screen.getByText("No agent matches these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paused only" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the agent workspace", () => {
  it("has a History tab, reachable by keyboard, that says when the agent has no tasks", async () => {
    const user = userEvent.setup();
    const bot = makeBot({ name: "Alpha" });
    renderApp(createFakeApi([bot]), `/bots/${bot.id}`);
    const tab = await screen.findByRole("tab", { name: "History" });
    await user.click(tab);
    const panel = within(await screen.findByRole("region", { name: "Execution history" }));
    expect(await panel.findByText("Alpha has not been given a task yet.")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Give a task" })).toHaveAttribute("href", "/tasks");
    // arrow keys move between the tabs (shared Tabs component)
    tab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the Integrations Center filters", () => {
  it("searches the services and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp(withServices(), "/integrations");
    expect(await screen.findByRole("heading", { level: 3, name: "GitHub" })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search services" }), "github");
    expect(screen.getByRole("heading", { level: 3, name: "GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Telegram" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search services" }));
    await user.type(screen.getByRole("searchbox", { name: "Search services" }), "zzzz");
    expect(screen.getByText("No service matches these filters.")).toBeInTheDocument();
  });

  it("filters by status with pressed buttons", async () => {
    const user = userEvent.setup();
    renderApp(withServices(), "/integrations");
    await screen.findByRole("heading", { level: 3, name: "GitHub" });
    await user.click(screen.getByRole("button", { name: "Problem" }));
    expect(screen.getByRole("button", { name: "Problem" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { level: 3, name: "GitHub" })).not.toBeInTheDocument(); // nothing has failed in a fresh fake
    expect(screen.getByText("No service matches these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("heading", { level: 3, name: "GitHub" })).toBeInTheDocument();
  });
});
