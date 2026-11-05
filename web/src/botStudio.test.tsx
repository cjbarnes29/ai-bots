import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/studio") {
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

describe("Bot Studio", () => {
  it("is in the menu and says that new bots start switched off with every permission off", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByText(/starts switched off, with no model and every permission off/i)).toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: "Bot Studio" })).length).toBeGreaterThan(0);
  });

  it("creates a bot from a template and opens it; nothing is granted", async () => {
    const api = createFakeApi();
    const router = renderApp(api);
    const user = userEvent.setup();
    const card = await screen.findByRole("listitem", { name: "Researcher" });
    expect(card).toHaveTextContent(/Nothing is allowed automatically/);
    await user.click(within(card).getByRole("button", { name: "Create from this template" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/bots\//));
    expect([...api.bots.values()].some((b) => b.name === "Researcher" && b.status === "disabled" && b.model === null)).toBe(true);
  });

  it("drafts a bot from a description, saves nothing until the owner presses Save, then saves a disabled bot", async () => {
    const api = createFakeApi();
    const router = renderApp(api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Describe a bot" }));
    await user.type(screen.getByLabelText("Describe the bot's job"), "A helper that tidies my meeting notes");
    await user.click(screen.getByRole("button", { name: "Draft this bot" }));
    const draft = await screen.findByLabelText("Draft");
    expect(draft).toHaveTextContent(/not saved/i);
    expect(api.bots.size).toBe(0);
    await user.clear(screen.getByLabelText("Draft name"));
    await user.type(screen.getByLabelText("Draft name"), "Note Tidier");
    await user.click(within(draft).getByRole("button", { name: /Save as a new bot/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/bots\//));
    const saved = [...api.bots.values()].find((b) => b.name === "Note Tidier")!;
    expect(saved.status).toBe("disabled");
  });

  it("checks an import file first and refuses one that carries permissions", async () => {
    const api = createFakeApi();
    const user = userEvent.setup();
    renderApp(api);
    await user.click(await screen.findByRole("tab", { name: "Import / export" }));
    const box = screen.getByLabelText("Bot file");
    await user.click(box);
    await user.paste(JSON.stringify({ format: "awp-bot", version: 1, permissions: ["gmail"], bot: { name: "X", role: "" } }));
    await user.click(screen.getByRole("button", { name: "Check the file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/must never contain/);
    expect(screen.queryByRole("button", { name: /Import as a new bot/ })).toBeNull();
  });

  it("exports a bot and imports the file back as a disabled bot", async () => {
    const api = createFakeApi();
    const b = makeBot({ name: "Original", role: "Does things" });
    api.bots.set(b.id, b);
    const user = userEvent.setup();
    renderApp(api);
    await user.click(await screen.findByRole("tab", { name: "Import / export" }));
    await user.click(await screen.findByRole("button", { name: "Export Original" }));
    await waitFor(() => expect((screen.getByLabelText("Bot file") as HTMLTextAreaElement).value).toContain('"format": "awp-bot"'));
    await user.click(screen.getByRole("button", { name: "Check the file" }));
    await user.click(await screen.findByRole("button", { name: /Import as a new bot/ }));
    await waitFor(() => expect([...api.bots.values()].filter((x) => x.name === "Original")).toHaveLength(2));
  });

  it("sets an operating mode as a limit, and says it never grants anything", async () => {
    const api = createFakeApi();
    const b = makeBot({ name: "Talker" });
    api.bots.set(b.id, b);
    const user = userEvent.setup();
    renderApp(api);
    await user.click(await screen.findByRole("tab", { name: "Operating modes" }));
    expect(await screen.findByText(/never gives a bot a permission/i)).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Mode for Talker"), "research");
    await waitFor(() => expect(api.ext.studio.assignments[b.id]).toBe("research"));
  });
});
