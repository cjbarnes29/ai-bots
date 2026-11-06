import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** Phase 4 screens with a stubbed API: the Assistant's lookups and edits, and the Knowledge Center documents. */
function setup(path: string, handler: (method: string, url: string, body: unknown) => unknown | undefined) {
  const base = createFakeApi([makeBot({ name: "Atlas", status: "active", model: "demo/simulated-echo" })]);
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const out = handler(method, url, body);
    if (out === undefined) return base.fetch(input, init);
    return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, calls };
}

const PID = "11111111-1111-4111-8111-111111111111";
const quiet = (u: string) => (u.startsWith("/api/assistant/suggestions") ? { suggestions: [] } : u.startsWith("/api/assistant/actions") ? { actions: [] } : undefined);

async function say(text: string) {
  const box = await screen.findByLabelText(/Your message/i);
  await userEvent.type(box, text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("AI Assistant: lookups and edits", () => {
  it("answers 'open my latest project' from the lookup and opens the real project", async () => {
    const { router, calls } = setup("/assistant", (m, u) => {
      if (m === "POST" && u === "/api/assistant/interpret") return { kind: "locate", handled: true, entity: "project", resolution: "single", openNow: true, candidates: [{ kind: "project", id: PID, title: "Tea shop", subtitle: "Project" }], message: 'Your latest project is "Tea shop".', understood: "project · latest" };
      return quiet(u);
    });
    await say("Open my latest project");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PID}`));
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/chat"))).toBe(false); // not sent to the model
  });

  it("lists several matches without opening anything, and 'ask:' sends the text to the model instead", async () => {
    const { router, calls } = setup("/assistant", (m, u, b) => {
      if (m === "POST" && u === "/api/assistant/interpret") return { kind: "locate", handled: true, entity: "project", resolution: "multiple", openNow: false, candidates: [{ kind: "project", id: PID, title: "Cafe one", subtitle: "Project" }, { kind: "project", id: "p2", title: "Cafe two", subtitle: "Project" }], message: "I found 2 projects. Which one do you mean?", understood: "project" };
      void b;
      return quiet(u);
    });
    await say("show my projects");
    const results = await screen.findByRole("region", { name: "Assistant results" });
    expect(within(results).getByText(/Which one do you mean/)).toBeInTheDocument();
    expect(within(results).getAllByRole("link", { name: /^Open Cafe/ })).toHaveLength(2);
    expect(router.state.location.pathname).toBe("/assistant");
    await userEvent.type(screen.getByLabelText(/Your message/i), "ask: tell me a story");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(JSON.stringify(calls.filter((c) => c.method === "POST"))).toContain('"message":"tell me a story"'), { timeout: 8000 });
    expect(calls.filter((c) => c.url === "/api/assistant/interpret")).toHaveLength(1); // "ask:" skipped the lookup
  }, 20000);

  it("shows a refusal for a restricted request, with no way to do it here", async () => {
    setup("/assistant", (m, u) => (m === "POST" && u === "/api/assistant/interpret" ? { kind: "action", handled: true, message: "I will not do that myself. Deleting or erasing something always needs your own explicit action, so I have not changed anything. You can do it yourself here:", link: { label: "Open Projects", to: "/projects" } } : quiet(u)));
    await say("delete the project Cafe");
    const results = await screen.findByRole("region", { name: "Assistant results" });
    expect(within(results).getByText(/I will not do that myself/)).toBeInTheDocument();
    expect(within(results).getByRole("link", { name: "Open Projects" })).toHaveAttribute("href", "/projects");
    expect(within(results).queryByRole("button", { name: /Apply|Undo/ })).toBeNull();
  });

  it("a proposed change shows before and after and only applies when the owner presses the button", async () => {
    const action = { id: "a1", kind: "agent.instructions", level: "review", status: "proposed", targetKind: "agent", targetId: "b1", summary: "Improved instructions for the agent Atlas.", before: { instructions: "Find facts." }, after: { instructions: "Find verified facts and cite sources." }, error: null, createdAt: "x", decidedAt: null, undoable: false };
    const { calls } = setup("/assistant", (m, u) => {
      if (m === "POST" && u === "/api/assistant/interpret") return { kind: "action", handled: true, message: "Improved instructions. I have only proposed this: nothing has changed yet.", action };
      if (m === "POST" && u === "/api/assistant/actions/a1/confirm") return { handled: true, message: "Applied", action: { ...action, status: "applied", undoable: true } };
      if (u.startsWith("/api/assistant/actions")) return { actions: [action] };
      if (u.startsWith("/api/assistant/suggestions")) return { suggestions: [] };
      return undefined;
    });
    await say("improve the instructions of agent Atlas");
    const results = await screen.findByRole("region", { name: "Assistant results" });
    expect(within(results).getByText(/Before \(instructions\)/)).toBeInTheDocument();
    expect(within(results).getByText("Find verified facts and cite sources.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/confirm"))).toBe(false);
    await userEvent.click(within(results).getByRole("button", { name: "Apply this change" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/assistant/actions/a1/confirm")).toBe(true));
  });

  it("an edit the owner checks refuse (a phone) is SHOWN as not done, and the text is not quietly sent to the model", async () => {
    const base = createFakeApi([makeBot({ name: "Atlas", status: "active", model: "demo/simulated-echo" })]);
    const calls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/assistant/interpret") return Promise.resolve(new Response(JSON.stringify({ error: "owner_only", message: "This can only be changed on the PC." }), { status: 403, headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/assistant/")) return Promise.resolve(new Response(JSON.stringify(url.includes("suggestions") ? { suggestions: [] } : { actions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
      return base.fetch(input, init);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/assistant"] })} />
      </QueryClientProvider>,
    );
    await say("rename project Cafe to Shop");
    const results = await screen.findByRole("region", { name: "Assistant results" });
    expect(within(results).getByText(/Nothing was changed\. This can only be changed on the PC\./)).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("POST") && /\/chat$/.test(c))).toBe(false);
  });

  it("after a revision the card says what changed, or that nothing changed", async () => {
    const n = (id: string, type: string, x: Record<string, unknown> = {}) => ({ id, type, label: type === "bot_task" ? "Writer" : id, x: 0, y: 0, ...x });
    const first = { name: "Notes", graph: { nodes: [n("start", "trigger", { kind: "manual" }), n("s1", "bot_task", { botId: "b1", instruction: "Write a note", retries: 0 }), n("end", "end")], edges: [] } };
    const withQuestion = { name: "Notes", graph: { nodes: [n("start", "trigger", { kind: "manual" }), n("s1", "bot_task", { botId: "b1", instruction: "Write a note", retries: 0 }), n("s2", "checkpoint", { message: "Archive the result?" }), n("end", "end")], edges: [] } };
    let calls = 0;
    setup("/assistant", (m, u, b) => {
      if (m === "POST" && u === "/api/workflows/draft") {
        calls++;
        const revise = (b as { revise?: unknown }).revise;
        return { draft: !revise ? first : calls === 2 ? first : withQuestion, warnings: [], saved: false, model: "x/y" };
      }
      if (u.startsWith("/api/assistant/")) return u.includes("suggestions") ? { suggestions: [] } : { actions: [] };
      return undefined;
    });
    await userEvent.type(await screen.findByLabelText("What should the workflow do?"), "Write a note for a customer");
    await userEvent.click(screen.getByRole("button", { name: "Draft a workflow" }));
    const card = await screen.findByLabelText("Workflow draft");
    expect(within(card).queryByRole("status", { name: "What changed" })).toBeNull();
    await userEvent.type(within(card).getByLabelText("Change this draft"), "ask me to archive it");
    await userEvent.click(within(card).getByRole("button", { name: "Revise the draft" }));
    expect(await within(card).findByRole("status", { name: "What changed" })).toHaveTextContent(/Nothing changed: the assistant returned the same steps/);
    await userEvent.type(within(card).getByLabelText("Change this draft"), "ask me to archive it, please");
    await userEvent.click(within(card).getByRole("button", { name: "Revise the draft" }));
    await waitFor(() => expect(within(card).getByRole("status", { name: "What changed" })).toHaveTextContent(/added “Ask you: Archive the result\?”/));
  }, 20000);

  it("works without any ready agent: a lookup box is offered", async () => {
    const base = createFakeApi([]);
    const calls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "POST" && url === "/api/assistant/interpret") return Promise.resolve(new Response(JSON.stringify({ kind: "overview", handled: true, message: "Right now: 0 tasks.", links: [{ label: "Dashboard", to: "/" }] }), { status: 200, headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/assistant/")) return Promise.resolve(new Response(JSON.stringify(url.includes("suggestions") ? { suggestions: [] } : { actions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
      return base.fetch(input, init);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/assistant"] })} />
      </QueryClientProvider>,
    );
    await userEvent.type(await screen.findByLabelText("Find or open something"), "what is the status");
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByText("Right now: 0 tasks.")).toBeInTheDocument();
  });
});

const doc = (over: Record<string, unknown> = {}) => ({ id: "d1", title: "Pricing", filename: "pricing.md", mime: "text/markdown", ext: "md", size: 1200, sha256: "abcdef0123456789", status: "ready", statusDetail: "", extractor: "text", scope: "global", projectId: null, projectName: null, collectionId: null, collectionName: null, folder: "Research", category: "Costs", tags: ["pricing"], conversationId: null, textChars: 80, chunkCount: 1, isImage: false, createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z", processedAt: "2026-11-06T10:00:00Z", ...over });
const facets = { folders: ["Research"], categories: ["Costs"], tags: ["pricing"], status: { ready: 1, failed: 1 }, total: 2, duplicates: [], collections: [{ id: "c1", name: "Market", description: "", documents: 1, createdAt: "x" }] };

describe("Knowledge Center documents", () => {
  const api = (m: string, u: string) => {
    if (u.startsWith("/api/knowledge/facets")) return facets;
    if (u.startsWith("/api/knowledge/docs/d1")) return { doc: doc(), text: "# Pricing\nThe licence costs AED 15,000.", truncated: false };
    if (u.startsWith("/api/knowledge/docs/d2")) return { doc: doc({ id: "d2", title: "Broken", filename: "broken.docx", ext: "docx", status: "failed", statusDetail: "The file could not be read: not a zip file", tags: [] }), text: "", truncated: false };
    if (u.startsWith("/api/knowledge/docs")) return { documents: [doc(), doc({ id: "d2", title: "Broken", filename: "broken.docx", ext: "docx", status: "failed", statusDetail: "The file could not be read: not a zip file", tags: [] })] };
    if (u.startsWith("/api/knowledge/search")) return { query: "licence", hits: [{ docId: "d1", title: "Pricing", chunkIdx: 0, snippet: "The licence costs AED 15,000", scope: "global", projectId: null }] };
    void m;
    return undefined;
  };
  it("lists documents with status, metadata and tags, and explains a failure", async () => {
    setup("/knowledge?status=ready", api);
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(await within(list).findByText("Pricing")).toBeInTheDocument();
    const broken = within(list).getByRole("listitem", { name: "Document row Broken" });
    expect(within(broken).getByText("Failed")).toBeInTheDocument();
    expect(within(broken).getByText(/not a zip file/)).toBeInTheDocument();
    const pricing = within(list).getByRole("listitem", { name: "Document row Pricing" });
    expect(within(pricing).getByText(/pricing\.md · 1\.2 KB/)).toBeInTheDocument();
    expect(within(pricing).getByText("Ready")).toBeInTheDocument();
  });
  it("opens a document with preview and metadata, and removing needs the exact title", async () => {
    const { calls } = setup("/knowledge?doc=d1", api);
    const detail = await screen.findByRole("region", { name: "Document Pricing" });
    expect(await within(detail).findByText(/The licence costs AED 15,000/)).toBeInTheDocument();
    expect(within(detail).getByText("Fingerprint")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Download the original" })).toHaveAttribute("href", "/api/knowledge/docs/d1/original");
    await userEvent.click(within(detail).getByText("Remove this document"));
    const remove = within(detail).getByRole("button", { name: "Remove document" });
    expect(remove).toBeDisabled();
    await userEvent.type(within(detail).getByLabelText("Type the document title to confirm"), "Pricing");
    expect(remove).toBeEnabled();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
  it("searches inside the documents and shows the passage", async () => {
    setup("/knowledge?status=ready", api);
    const box = await screen.findByLabelText("Search inside the documents");
    await userEvent.type(box, "licence");
    const section = screen.getByRole("region", { name: "Search the documents" });
    expect(await within(section).findByText(/The licence costs AED 15,000/)).toBeInTheDocument();
  });
});
