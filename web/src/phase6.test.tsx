import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

function renderApp(path: string) {
  vi.stubGlobal("fetch", createFakeApi().fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

describe("keyboard and screen reader basics", () => {
  it("the first Tab stop is a skip link to the main content, and the content area can receive focus", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("navigation", { name: "Main" });
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to the page content" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("every page of the nine sections has one level-1 heading", async () => {
    for (const path of ["/", "/agents", "/workflows", "/models", "/integrations", "/creative", "/knowledge", "/monitor", "/settings"]) {
      const { unmount } = (() => {
        renderApp(path);
        return { unmount: () => document.body.replaceChildren() };
      })();
      expect(await screen.findAllByRole("heading", { level: 1 }), path).toHaveLength(1);
      unmount();
    }
  });
});

describe("touch targets are pinned in the stylesheet", () => {
  const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
  it("buttons are 44 px tall on phones", () => {
    expect(css).toMatch(/@utility btn \{[^}]*max-md:min-h-11/);
  });
  it("form fields and section toggles are 44 px on phones, excluding checkboxes, radios, files and ranges", () => {
    const block = css.slice(css.indexOf("@media (max-width: 767px) {\n  select,"));
    expect(block).toMatch(/min-height: 2\.75rem/);
    for (const t of ["checkbox", "radio", "file", "range"]) expect(block).toContain(`:not([type="${t}"])`);
    expect(block).toMatch(/summary \{\s*padding-block: 0\.75rem/);
  });
  it("switches keep their look but get an invisible 44 px hit area", () => {
    expect(css).toMatch(/button\[role="switch"\]::after \{[^}]*inset: -0\.5rem -0\.25rem/);
  });
});
