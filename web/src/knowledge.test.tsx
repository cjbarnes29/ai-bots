import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("Knowledge page", () => {
  it("adds a shared note, finds it by search, pins, archives and restores it", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api, "/knowledge");
    await userEvent.type(await screen.findByLabelText("Note title"), "Brand colours");
    await userEvent.type(screen.getByLabelText("Note text"), "Deep blue and orange");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    const row = within(await screen.findByRole("listitem", { name: "Note Brand colours" }));
    expect(row.getByText("written by you")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search notes"), "zebra");
    expect(await screen.findByText("No notes here.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search notes"));
    await userEvent.click(await screen.findByRole("button", { name: "Pin Brand colours" }));
    await waitFor(() => expect(api.ext.memory.notes[0].pinned).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: "Archive Brand colours" }));
    await waitFor(() => expect(api.ext.memory.notes[0].archived).toBe(true));
    await userEvent.click(screen.getByLabelText("Show archived"));
    await userEvent.click(await screen.findByRole("button", { name: "Restore Brand colours" }));
    await waitFor(() => expect(api.ext.memory.notes[0].archived).toBe(false));
  });

  it("shows the backend's refusal when a note looks like a secret", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api, "/knowledge");
    await userEvent.type(await screen.findByLabelText("Note title"), "Oops");
    await userEvent.type(screen.getByLabelText("Note text"), "ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Memory never stores secrets/);
    expect(api.ext.memory.notes).toHaveLength(0);
  });

  it("private notes need a bot, and can be copied to the shared knowledge", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    api.ext.memory.notes.push({ id: "n1", scope: "bot", botId: "b1", title: "Tone", content: "Friendly", tags: [], source: "bot", pinned: false, archived: false, createdAt: "", updatedAt: "" });
    renderApp(api, "/knowledge");
    await userEvent.selectOptions(await screen.findByLabelText("Which notes"), "bot");
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Bot"), "b1");
    const row = within(await screen.findByRole("listitem", { name: "Note Tone" }));
    expect(row.getByText("saved by the bot (approved)")).toBeInTheDocument();
    await userEvent.click(row.getByRole("button", { name: "Share Tone" }));
    await waitFor(() => expect(api.ext.memory.notes.some((n: any) => n.scope === "shared" && n.title === "Tone")).toBe(true));
  });
});

describe("Bot permissions: memory", () => {
  it("shared knowledge is off by default and can be switched on for one bot", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api, "/bots/b1");
    await userEvent.click(await screen.findByRole("tab", { name: /Permissions/ }));
    const sec = within(await screen.findByRole("region", { name: "Memory" }));
    expect(sec.getByRole("checkbox", { name: "Use this bot's own notes" })).toBeChecked();
    expect(sec.getByRole("checkbox", { name: "Use the shared knowledge" })).not.toBeChecked();
    await userEvent.click(sec.getByRole("checkbox", { name: "Use the shared knowledge" }));
    await waitFor(() => expect(api.ext.memory.settings.get("b1")).toEqual({ usePrivate: true, useShared: true }));
  });
});
