import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { getThemeMode, setThemeMode } from "./lib/theme";
import { createFakeApi } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the application shell", () => {
  it("has one Main navigation with every place, and marks the current one", async () => {
    renderApp(createFakeApi(), "/workflows");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const name of ["Dashboard", "Agents & Teams", "Workflow Studio", "Approvals", "Business Workforce", "Integrations Center", "Schedules", "PC Control Center", "Activity & Logs", "Settings"]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(nav.getByRole("link", { name: "Workflow Studio" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("keeps a place highlighted on its inner pages (a task belongs to Activity & Logs, a bot to Agents & Teams)", async () => {
    renderApp(createFakeApi(), "/tasks/00000000-0000-4000-8000-000000000000");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Activity & Logs" })).toHaveAttribute("aria-current", "page");
  });

  it("shows no waiting badge when nothing waits (the count itself is tested with the Approvals page)", async () => {
    const quiet = createFakeApi();
    renderApp(quiet);
    expect(await screen.findByRole("link", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it("opens a More sheet on the phone with the other places, and closes it with Escape or after choosing", async () => {
    const user = userEvent.setup();
    const router = renderApp(createFakeApi());
    await user.click(await screen.findByRole("button", { name: "More" }));
    const sheet = within(await screen.findByRole("dialog", { name: "More" }));
    for (const name of ["Business Workforce", "Integrations Center", "Schedules", "PC Control Center", "Activity & Logs", "Settings"]) {
      expect(sheet.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(sheet.queryByRole("link", { name: "Approvals" })).not.toBeInTheDocument(); // already in the bottom bar
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(within(await screen.findByRole("dialog", { name: "More" })).getByRole("link", { name: "Settings" }));
    expect(router.state.location.pathname).toBe("/settings");
    expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
  });

  it("the safety note can be dismissed and stays dismissed", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    expect(await screen.findByText(/anything that sends or changes something waits for your approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/anything that sends or changes something waits for your approval/)).not.toBeInTheDocument();
    expect(localStorage.getItem("awp-safety-note-dismissed")).toBe("1");
  });

  it("an unknown page offers the way back to the dashboard", async () => {
    renderApp(createFakeApi(), "/nope");
    expect(await screen.findByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
  });

  it("every place in the menu opens a page with a heading", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const [link, heading] of [
      ["Agents & Teams", "Agents & Teams"],
      ["Workflow Studio", "Workflow Studio"],
      ["Integrations Center", "Integrations Center"],
      ["PC Control Center", "PC Control Center"],
      ["Activity & Logs", "Activity & Logs"],
    ] as const) {
      await user.click(nav.getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });
});

describe("theme", () => {
  it("light, dark and follow-the-device are remembered in this browser only", () => {
    expect(getThemeMode()).toBe("system");
    setThemeMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(getThemeMode()).toBe("dark");
    setThemeMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("awp-theme")).toBe("light");
    setThemeMode("system");
    expect(localStorage.getItem("awp-theme")).toBeNull();
  });
});

describe("the More sheet keeps focus", () => {
  it("moves focus into the sheet, keeps Tab and Shift+Tab inside it, and gives focus back to the More button when it closes", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    const more = await screen.findByRole("button", { name: "More" });
    await user.click(more);
    const sheet = within(await screen.findByRole("dialog", { name: "More" }));
    const close = sheet.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    const last = sheet.getByRole("link", { name: "Settings" });
    await user.tab({ shift: true }); // from the first control: wraps to the last
    expect(last).toHaveFocus();
    await user.tab(); // from the last control: wraps to the first
    expect(close).toHaveFocus();
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(screen.getByRole("dialog", { name: "More" })).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

});
