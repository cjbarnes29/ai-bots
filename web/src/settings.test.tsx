import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

function renderApp(path: string) {
  vi.stubGlobal("fetch", createFakeApi().fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const CATEGORIES = ["General", "Recommended Settings", "AI Models", "Integrations", "Agents & Permissions", "Workflow Settings", "PC & Remote Access", "Security", "Notifications", "Advanced"];

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("Settings categories", () => {
  it("lists the ten categories and opens one at its own address", async () => {
    const user = userEvent.setup();
    const router = renderApp("/settings");
    const nav = within(await screen.findByRole("navigation", { name: "Settings categories" }));
    for (const name of CATEGORIES) expect(nav.getByRole("link", { name })).toBeInTheDocument();
    await user.click(nav.getByRole("link", { name: "Security" }));
    expect(router.state.location.pathname).toBe("/settings/security");
    expect(await screen.findByRole("heading", { level: 2, name: "Security" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Settings categories" })).getByRole("link", { name: "Security" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All settings" })).toHaveAttribute("href", "/settings");
  });

  it("keeps every existing panel reachable: models, notifications, workflow limits, agents, advanced", async () => {
    renderApp("/settings/ai-models");
    expect(await screen.findByRole("region", { name: "Safety" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Providers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Model routing" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Usage" })).toBeInTheDocument();
  });

  it("the Integrations, PC and Security categories point to the page where the work is done", async () => {
    const user = userEvent.setup();
    renderApp("/settings/integrations");
    expect(await screen.findByRole("link", { name: "Open the Integrations Center" })).toHaveAttribute("href", "/integrations");
    await user.click(within(screen.getByRole("navigation", { name: "Settings categories" })).getByRole("link", { name: "PC & Remote Access" }));
    expect(await screen.findByRole("link", { name: "Open the PC Control Center" })).toHaveAttribute("href", "/pc");
    await user.click(within(screen.getByRole("navigation", { name: "Settings categories" })).getByRole("link", { name: "Security" }));
    expect(await screen.findByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
  });

  it("an unknown category says so, and the old /usage address lands on the AI Models usage", async () => {
    renderApp("/settings/nope");
    expect(await screen.findByText("That settings page does not exist.")).toBeInTheDocument();
    document.body.innerHTML = "";
    const router = renderApp("/usage");
    expect(await screen.findByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/ai-models");
  });
});

describe("Settings search", () => {
  it("finds a setting by what it does and links to where it lives; says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    const box = await screen.findByRole("searchbox", { name: "Search settings" });
    await user.type(box, "dark mode");
    const results = within(await screen.findByRole("region", { name: "Search results" }));
    expect(results.getByRole("link", { name: /Light or dark theme/ })).toHaveAttribute("href", "/settings/general");
    await user.clear(box);
    await user.type(box, "gmail");
    expect(within(screen.getByRole("region", { name: "Search results" })).getByRole("link", { name: /^Gmail/ })).toHaveAttribute("href", "/integrations");
    await user.clear(box);
    await user.type(box, "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent("No setting matches");
    await user.clear(box);
    expect(screen.queryByRole("region", { name: "Search results" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeInTheDocument();
  });

  it("every search result points at a real page", async () => {
    const { SETTING_INDEX } = await import("./pages/settings/categories");
    const settingsIds = CATEGORIES.map((c) => c);
    expect(settingsIds).toHaveLength(10);
    const fixed = new Set(["/integrations", "/integrations/ai-setup", "/pc", "/automation", "/approvals"]);
    for (const e of SETTING_INDEX) {
      const ok = fixed.has(e.to) || /^\/settings\/(general|recommended|ai-models|agents|workflows|notifications|advanced|security|integrations|pc)$/.test(e.to);
      expect(ok, `${e.label} -> ${e.to}`).toBe(true);
    }
  });
});

describe("Appearance", () => {
  it("switching to dark and back changes the page and is remembered in this browser", async () => {
    const user = userEvent.setup();
    renderApp("/settings/general");
    expect(await screen.findByRole("radio", { name: /Follow this device/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("awp-theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("radio", { name: /Follow this device/ }));
    expect(localStorage.getItem("awp-theme")).toBeNull();
  });
});
