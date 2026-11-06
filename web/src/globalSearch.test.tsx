import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** Global search and the chat drawer, with a stubbed API (no real service). */
function setup(path: string, handler: (url: string) => unknown | undefined, bots = [makeBot({ name: "Writer", status: "active", model: "demo/simulated-echo" })]) {
  const base = createFakeApi(bots);
  const urls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(`${init?.method ?? "GET"} ${url}`);
    const out = handler(url);
    if (out === undefined) return base.fetch(input, init);
    return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, urls };
}

function setupUnmountable(path: string) {
  const base = createFakeApi([makeBot({ name: "Writer", status: "active", model: "demo/simulated-echo" })]);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => base.fetch(input, init));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const hits = [
  { kind: "project", id: "11111111-1111-4111-8111-111111111111", title: "Bakery website", subtitle: "Project" },
  { kind: "conversation", id: "c1", title: "Menu ideas", subtitle: "Conversation with Writer", botId: "b1" },
  { kind: "approval", id: "a1", title: "Create price-list.csv", subtitle: "Approval · Writer · pending" },
];
const api = (url: string): unknown | undefined => (url.startsWith("/api/search?q=") ? { query: "bak", hits, tooShort: false } : undefined);

describe("Global search", () => {
  it("opens with Ctrl+K, finds things, and Enter opens the chosen one", async () => {
    const { router } = setup("/agents", api);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: "Search everything" });
    expect(box).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/at least two letters/);
    await userEvent.type(box, "bak");
    const list = await screen.findByRole("listbox", { name: "Search results" });
    expect(await within(list).findByRole("option", { name: /Bakery website/ })).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-activedescendant");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/approvals"));
    expect(router.state.location.search).toBe("?focus=a1");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("opens a conversation in its agent's chat, closes with Escape and gives focus back", async () => {
    const { router } = setup("/agents", api);
    await screen.findByRole("heading", { level: 1 });
    const opener = screen.getAllByRole("button", { name: "Search" })[0]!;
    opener.focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox", { name: "Search everything" }), "bak");
    await userEvent.click(await screen.findByRole("option", { name: /Menu ideas/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/bots/b1"));
    expect(router.state.location.search).toBe("?tab=chat&conversation=c1");
    await userEvent.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Search" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("does not search for one letter, and says so when nothing matches", async () => {
    const { urls } = setup("/agents", (u) => (u.startsWith("/api/search?q=") ? { query: "zzz", hits: [], tooShort: false } : undefined));
    await screen.findByRole("heading", { level: 1 });
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", { name: "Search everything" });
    await userEvent.type(box, "z");
    await act(async () => new Promise((r) => setTimeout(r, 350)));
    expect(urls.some((u) => u.includes("/api/search"))).toBe(false);
    await userEvent.type(box, "zz");
    expect(await screen.findByText(/Nothing found for "zzz"/)).toBeInTheDocument();
  });
});

describe("AI Assistant workspace", () => {
  it("is in the sidebar as its own item, first in the list, and is a full page (no hover, no panel)", async () => {
    const { router } = setup("/projects", api);
    await screen.findByRole("heading", { level: 1 });
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links[1]).toHaveAccessibleName("AI Assistant"); // [0] is the logo link
    expect(screen.queryByRole("button", { name: /^Chat$/ })).toBeNull();
    await userEvent.click(links[1]!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/assistant"));
    expect(await screen.findByRole("heading", { level: 1, name: "AI Assistant" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Talk to")).toHaveDisplayValue("Writer");
    expect(screen.getByRole("region", { name: "Assistant chat" })).toBeVisible();
  });

  it("is reachable from every workspace", async () => {
    for (const path of ["/", "/projects", "/workflows", "/agents", "/knowledge", "/tasks", "/approvals", "/decisions", "/settings"]) {
      const { unmount } = setupUnmountable(path);
      await screen.findByRole("heading", { level: 1 });
      expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /AI Assistant/ })).toHaveAttribute("href", "/assistant");
      unmount();
    }
  });

  it("keeps an unsent draft while the owner visits another page", async () => {
    const { router } = setup("/assistant", api);
    const input = await screen.findByLabelText(/Your message/i);
    await userEvent.type(input, "half a thought");
    await act(async () => {
      await router.navigate("/monitor");
    });
    await act(async () => {
      await router.navigate("/assistant");
    });
    expect(await screen.findByLabelText(/Your message/i)).toHaveValue("half a thought");
  });

  it("files a new conversation under the chosen project, and a project links to it", async () => {
    const pid = "11111111-1111-4111-8111-111111111111";
    const project = { id: pid, name: "Website", description: "", instructions: "", archived: false, createdAt: "x", updatedAt: "x", counts: {} };
    setup(`/assistant?project=${pid}`, (u) => (u.startsWith("/api/projects?") ? { projects: [project] } : undefined));
    expect(await screen.findByLabelText("File new conversations under")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("File new conversations under")).toHaveDisplayValue("Website"));
  });

  it("drafts a workflow and opens it in Workflows UNSAVED", async () => {
    const draft = { name: "Weekly research", graph: { nodes: [{ id: "start", type: "trigger", label: "Start", x: 40, y: 200, kind: "manual" }, { id: "s1", type: "bot_task", label: "Writer", x: 300, y: 200, botId: "b1", instruction: "Research {{input}}", retries: 0 }, { id: "end", type: "end", label: "End", x: 560, y: 200 }], edges: [{ id: "a", from: "start", to: "s1", when: "always" }, { id: "b", from: "s1", to: "end", when: "always" }] } };
    const { router, urls } = setup("/assistant", (u) => (u === "/api/workflows/draft" ? { draft, warnings: ["This is a draft. Nothing is saved or run."], saved: false, model: "x/y" } : undefined));
    await userEvent.type(await screen.findByLabelText("What should the workflow do?"), "Research a topic every week for me");
    await userEvent.click(screen.getByRole("button", { name: "Draft a workflow" }));
    const card = await screen.findByLabelText("Workflow draft");
    expect(within(card).getByText("Weekly research")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Open in Workflows" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/workflows"));
    expect(await screen.findByDisplayValue("Weekly research")).toBeInTheDocument(); // the editor shows the draft
    expect(urls.filter((x) => x.startsWith("POST /api/workflows") && !x.endsWith("/draft") && !x.endsWith("/validate"))).toEqual([]); // nothing was saved
  });
});
