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

describe("Knowledge Center", () => {
  it("has four areas (Documents added in Phase 4) and the tabs drive the same note scope as the selector", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi([makeBot({ id: "b1", name: "Helper" })]), "/knowledge");
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "Knowledge areas" }));
    expect(tabs.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Shared notes", "Agent knowledge", "Documents", "Files & documents"]);
    expect(screen.getByLabelText("Which notes")).toHaveValue("shared");
    await user.click(tabs.getByRole("tab", { name: "Agent knowledge" }));
    expect(screen.getByLabelText("Which notes")).toHaveValue("bot");
    expect(screen.getByLabelText("Bot")).toBeInTheDocument();
    await user.click(tabs.getByRole("tab", { name: "Shared notes" }));
    expect(screen.getByLabelText("Which notes")).toHaveValue("shared");
  });

  it("the Files & documents tab says there is no file browser and points to where files are handled", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/knowledge");
    await user.click(await screen.findByRole("tab", { name: "Files & documents" }));
    const panel = within(await screen.findByRole("region", { name: "Files and documents" }));
    expect(panel.getByText(/never lists files on your PC/)).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Open Access" })).toHaveAttribute("href", "/access");
    expect(panel.getByRole("link", { name: "Open Projects" })).toHaveAttribute("href", "/projects");
    expect(panel.getByRole("link", { name: "Open Creative Studio" })).toHaveAttribute("href", "/creative");
    // the note form is gone on this tab (it is not a notes view)
    expect(screen.queryByRole("region", { name: "Add a note" })).not.toBeInTheDocument();
  });

  it("adding a note still works from the Shared notes tab", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/knowledge");
    await user.type(await screen.findByLabelText("Note title"), "Price list");
    await user.type(screen.getByLabelText("Note text"), "Coffee is 12 AED");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("Price list")).toBeInTheDocument();
  });
});

describe("Creative Studio workspaces", () => {
  it("opens on the overview and gives each function its own tab", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/creative");
    const tabs = within(await screen.findByRole("tablist", { name: "Creative areas" }));
    expect(tabs.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Documents", "Content drafting", "Image, video & audio"]);
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeInTheDocument();
    await user.click(tabs.getByRole("tab", { name: "Documents" }));
    const doc = within(await screen.findByRole("region", { name: "Make a document today" }));
    expect(doc.getAllByRole("listitem")).toHaveLength(4);
    expect(doc.getByRole("link", { name: "Open Access" })).toHaveAttribute("href", "/access");
    expect(doc.getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
    await user.click(tabs.getByRole("tab", { name: "Content drafting" }));
    expect(within(await screen.findByRole("region", { name: "Draft content today" })).getByRole("link", { name: "Open Projects" })).toHaveAttribute("href", "/projects");
  });

  it("the media tab lists only the three unconnected functions, with no button or link on any of them", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi(), "/creative");
    await user.click(await screen.findByRole("tab", { name: "Image, video & audio" }));
    const panel = within(await screen.findByRole("tabpanel", { name: "Image, video & audio" }));
    const cards = panel.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(within(c).getByText("Not connected")).toBeInTheDocument();
      expect(within(c).queryByRole("link")).not.toBeInTheDocument();
      expect(within(c).queryByRole("button")).not.toBeInTheDocument();
    }
    expect(panel.getByText(/nothing is bought for you/)).toBeInTheDocument();
  });
});

describe("Settings", () => {
  it("a category fades in when chosen and the list stays reachable", async () => {
    const { container } = (() => {
      renderApp(createFakeApi(), "/settings/general");
      return { container: document.body };
    })();
    expect(await screen.findByRole("heading", { level: 2, name: "General" })).toBeInTheDocument();
    expect(container.querySelector(".awp-fade-in")).not.toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Settings categories" })).getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
  });
});
