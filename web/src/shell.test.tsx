import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { routes } from "./App";
import { NAV, sectionFor } from "./components/shell/nav";
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
  it("has one Main navigation with the nine sections, and marks the current one", async () => {
    renderApp(createFakeApi(), "/automation");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const name of ["Dashboard", "AI Agents", "Workflows", "AI Models", "Apps & Integrations", "Creative Studio", "Knowledge Center", "Monitoring", "Settings"]) {
      expect(nav.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(nav.getAllByRole("link").filter((l) => l.getAttribute("aria-label") !== "AI Workforce Studio home")).toHaveLength(9);
    // Schedules is a page of the Workflows section
    expect(nav.getByRole("link", { name: "Workflows" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("keeps a section highlighted on its inner pages (a task belongs to Monitoring)", async () => {
    renderApp(createFakeApi(), "/tasks/00000000-0000-4000-8000-000000000000");
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Monitoring" })).toHaveAttribute("aria-current", "page");
  });

  it("the longest match wins: /settings/ai-models is AI Models while the rest of Settings is Settings", () => {
    expect(sectionFor("/settings/ai-models")?.label).toBe("AI Models");
    expect(sectionFor("/usage")?.label).toBe("AI Models");
    expect(sectionFor("/settings/security")?.label).toBe("Settings");
    expect(sectionFor("/settings")?.label).toBe("Settings");
    expect(sectionFor("/bots/abc")?.label).toBe("AI Agents");
    expect(sectionFor("/nope")).toBeUndefined();
  });

  it("every page that existed before the redesign is still reachable from a section, and every tab lies inside its section", () => {
    const old = ["/agents", "/studio", "/knowledge", "/workflows", "/business", "/integrations", "/inbox", "/decisions", "/groups", "/workforce", "/projects", "/automation", "/approvals", "/pc", "/access", "/monitor", "/tasks", "/settings", "/settings/ai-models"];
    for (const path of old) expect(sectionFor(path), path).toBeDefined();
    for (const entry of NAV) {
      for (const tab of entry.tabs) {
        expect(sectionFor(tab.to), tab.to).toBe(entry);
      }
    }
  });

  it("shows the pages of the current section as tabs, and a breadcrumb", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/workflows");
    const tabs = within(await screen.findByRole("navigation", { name: "Workflows sections" }));
    expect(tabs.getAllByRole("link").map((l) => l.textContent)).toEqual(["Workflow Studio", "Schedules", "Decisions", "Projects"]);
    expect(tabs.getByRole("link", { name: "Workflow Studio" })).toHaveAttribute("aria-current", "page");
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(crumbs.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/workflows");
    expect(crumbs.getByText("Workflow Studio")).toHaveAttribute("aria-current", "page");
    await user.click(tabs.getByRole("link", { name: "Projects" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Projects")).toHaveAttribute("aria-current", "page");
  });

  it("the dashboard has no breadcrumb or tabs", async () => {
    renderApp(createFakeApi(), "/");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /sections$/ })).not.toBeInTheDocument();
  });

  it("shows no waiting badge when nothing waits (the count itself is tested with the Approvals page)", async () => {
    const quiet = createFakeApi();
    renderApp(quiet);
    expect(await screen.findByRole("link", { name: "Monitoring" })).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it("opens a More sheet on the phone with the other sections, and closes it with Escape or after choosing", async () => {
    const user = userEvent.setup();
    const router = renderApp(createFakeApi());
    await user.click(await screen.findByRole("button", { name: "More" }));
    const sheet = within(await screen.findByRole("dialog", { name: "More" }));
    for (const name of ["AI Models", "Apps & Integrations", "Creative Studio", "Knowledge Center", "Settings"]) {
      expect(sheet.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(sheet.queryByRole("link", { name: "Monitoring" })).not.toBeInTheDocument(); // already in the bottom bar
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

  it("every section in the menu opens a page with a heading", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    for (const [link, heading] of [
      ["AI Agents", "Agents & Teams"],
      ["Workflows", "Workflow Studio"],
      ["Apps & Integrations", "Integrations Center"],
      ["Creative Studio", "Creative Studio"],
      ["Knowledge Center", "Knowledge"],
      ["Monitoring", "Activity & Logs"],
    ] as const) {
      await user.click(nav.getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });

  it("the sidebar can be folded to icons and the choice is remembered in this browser only", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    const fold = await screen.findByRole("button", { name: "Collapse the sidebar" });
    expect(fold).toHaveAttribute("aria-pressed", "false");
    await user.click(fold);
    expect(await screen.findByRole("button", { name: "Expand the sidebar" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("awp-sidebar-collapsed")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Expand the sidebar" }));
    expect(localStorage.getItem("awp-sidebar-collapsed")).toBe("0");
  });

  it("open workspaces appear as tabs, can be closed, and are kept for this browser tab only", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/workflows");
    await user.click(within(await screen.findByRole("navigation", { name: "Workflows sections" })).getByRole("link", { name: "Schedules" }));
    const strip = within(await screen.findByRole("navigation", { name: "Open workspaces" }));
    expect(strip.getAllByRole("link").map((l) => l.textContent)).toEqual(["Workflow Studio", "Schedules"]);
    expect(strip.getByRole("link", { name: "Schedules" })).toHaveAttribute("aria-current", "page");
    expect(JSON.parse(sessionStorage.getItem("awp-open-workspaces")!)).toEqual([
      { path: "/workflows", label: "Workflow Studio" },
      { path: "/automation", label: "Schedules" },
    ]);
    expect(localStorage.getItem("awp-open-workspaces")).toBeNull();
    await user.click(strip.getByRole("button", { name: "Close Schedules" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workflow Studio" })).toBeInTheDocument();
  });

  it("the Creative Studio says what works and what is not connected, and offers no button for a feature that does not exist", async () => {
    renderApp(createFakeApi(), "/creative");
    expect(await screen.findByRole("heading", { level: 1, name: "Creative Studio" })).toBeInTheDocument();
    for (const name of ["Image generation", "Video editing", "Audio and music"]) {
      const card = screen.getByText(name).closest("li") as HTMLElement;
      expect(within(card).getByText("Not connected")).toBeInTheDocument();
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    }
  });
});

describe("motion", () => {
  const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
  it("turns movement and looping animation off for people who ask for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/animation-duration: 0\.01ms !important/);
    expect(block).toMatch(/transition-duration: 0\.01ms !important/);
    expect(block).toMatch(/animation-iteration-count: 1 !important/);
  });
  it("uses the durations from the design brief and animates only transform and opacity", () => {
    for (const name of ["micro", "hover", "panel", "workspace"]) expect(css).toContain("--awp-dur-" + name);
    // read each @keyframes block up to its own closing brace (counting braces, so one-line and multi-line blocks both work)
    const frames: string[] = [];
    for (const m of css.matchAll(/@keyframes awp-[\w-]+\s*\{/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      while (depth > 0 && i < css.length) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0, i++;
      frames.push(css.slice(m.index, i));
    }
    expect(frames.length).toBeGreaterThan(4);
    for (const fr of frames) expect(fr).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
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
