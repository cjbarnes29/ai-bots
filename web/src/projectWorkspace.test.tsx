import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/** The shared fake API does not know the workspace routes, so these tests answer them and pass everything else on (same pattern as inboxProjects.test.tsx). */
function setup(path: string, handler: (method: string, url: string, body: unknown) => unknown | undefined, bots: Parameters<typeof createFakeApi>[0] = []) {
  const base = createFakeApi(bots);
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const project = { id: "p1", name: "Cafe", description: "", instructions: "", archived: false, createdAt: "x", updatedAt: "x", counts: { task: 3 } };
const entry = (over: Record<string, unknown>) => ({
  id: "e0", ref: "W-e0000000", kind: "finding", title: "t", text: "x", source: null, authorBotId: "b1", authorName: "Researcher", taskId: "t1", forBotId: null, forName: null,
  replaces: null, replacedBy: null, checkedByOwner: false, withdrawn: false, platformNote: null, warnings: [], createdAt: "2026-11-05T10:00:00Z", ...over,
});
const workspace = {
  project: { id: "p1", name: "Cafe" },
  entries: [
    entry({ id: "e1", ref: "W-11111111", kind: "fact", title: "Licence fee", text: "AED 15,000 a year.", source: "Fee table 2026" }),
    entry({ id: "e2", ref: "W-22222222", kind: "assumption", title: "Foot traffic", text: "Marina is busiest.", platformNote: "Sent as a fact without a source, so the platform stored it as an assumption." }),
    entry({ id: "e6", ref: "W-66666666", kind: "assumption", title: "Small-unit rent", text: "AED 750,000-1,250,000 a year.", source: "general knowledge", warnings: ["Large unsupported amount (AED 1,250,000): no checkable source; check it before relying on it"] }),
    entry({ id: "e3", ref: "W-33333333", kind: "recommendation", title: "Old advice", text: "Open in Marina.", authorName: "Analyst", replacedBy: "e4" }),
    entry({ id: "e4", ref: "W-44444444", kind: "recommendation", title: "Open in Marina (with costs)", text: "About AED 195,000 a year.", authorName: "Writer", replaces: "e3" }),
    entry({ id: "e5", ref: "W-55555555", kind: "handover", title: "Write the brief", text: "Use the CSV.", authorName: "Analyst", forName: "Writer" }),
  ],
  files: [
    { approvalId: "a1", path: "C:\\work\\marina-cafes.csv", action: "documents.create_spreadsheet", status: "created", ownerBotId: "b2", ownerName: "Analyst", taskId: "t2", at: "2026-11-05T10:05:00Z" },
    { approvalId: "a2", path: "brief.pdf", action: "documents.create_document", status: "waiting_for_approval", ownerBotId: "b3", ownerName: "Writer", taskId: "t3", at: "2026-11-05T10:06:00Z" },
  ],
  tasks: [{ id: "t1", rootId: "t1", botId: "b1", botName: "Researcher", instruction: "Research", status: "completed", finishedAt: "x", createdAt: "x" }],
  contributions: [
    { botId: "b1", name: "Researcher", entries: 2, byKind: { fact: 1, assumption: 1 }, files: 0, tasksCompleted: 1, lastAt: "2026-11-05T10:00:00Z" },
    { botId: "b2", name: "Analyst", entries: 2, byKind: { recommendation: 1, handover: 1 }, files: 1, tasksCompleted: 1, lastAt: "2026-11-05T10:05:00Z" },
  ],
  activity: [{ at: "2026-11-05T10:05:00Z", kind: "file.created", botName: "Analyst", text: "C:\\work\\marina-cafes.csv", ref: null }],
};
const handler = (m: string, u: string) => {
  if (m === "GET" && u === "/api/projects/p1/workspace") return workspace;
  if (m === "POST" && u === "/api/projects/p1/workspace/entries/e1/check") return { entry: { ...workspace.entries[0], checkedByOwner: true } };
  if (m === "PUT" && u === "/api/projects/p1/workspace/entries/e2/withdrawn") return { entry: { ...workspace.entries[1], withdrawn: true } };
  if (m === "GET" && u.startsWith("/api/projects/p1")) return { project, items: [] };
  if (m === "GET" && u.startsWith("/api/projects?")) return { projects: [project] };
  return undefined;
};

describe("Project workspace panel", () => {
  it("shows findings with their labels apart (fact with source, assumption with the platform's note, recommendation); replaced entries are hidden until asked", async () => {
    setup("/projects", handler);
    await userEvent.click(await screen.findByRole("button", { name: "Open Cafe" }));
    const panel = await screen.findByRole("region", { name: "Shared workspace" });
    const fact = await within(panel).findByRole("listitem", { name: "Entry Licence fee" });
    expect(within(fact).getByText("Fact (agent cites a source)")).toBeInTheDocument();
    expect(within(fact).getByText(/Source given by the agent: Fee table 2026/)).toBeInTheDocument();
    const assumption = within(panel).getByRole("listitem", { name: "Entry Foot traffic" });
    expect(within(assumption).getByText("Assumption (not verified)")).toBeInTheDocument();
    expect(within(assumption).getByText(/stored it as an assumption/)).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { name: "Entry Open in Marina (with costs)" })).toHaveTextContent(/Corrects W-33333333/);
    expect(within(panel).queryByRole("listitem", { name: "Entry Old advice" })).toBeNull();
    await userEvent.click(within(panel).getByLabelText("Show withdrawn and replaced entries"));
    expect(within(panel).getByRole("listitem", { name: "Entry Old advice" })).toHaveTextContent(/Replaced by W-44444444/);
  });

  it("shows task notes, shared files with their owner and state, contributions and recent updates", async () => {
    setup("/projects", handler);
    await userEvent.click(await screen.findByRole("button", { name: "Open Cafe" }));
    const panel = await screen.findByRole("region", { name: "Shared workspace" });
    await userEvent.click(await within(panel).findByRole("tab", { name: /Task notes/ }));
    expect(within(panel).getByRole("listitem", { name: "Entry Write the brief" })).toHaveTextContent(/For: Writer/);
    await userEvent.click(within(panel).getByRole("tab", { name: /Shared files \(2\)/ }));
    expect(within(panel).getByRole("listitem", { name: "File C:\\work\\marina-cafes.csv" })).toHaveTextContent(/Created · owner: Analyst/);
    expect(within(panel).getByRole("listitem", { name: "File brief.pdf" })).toHaveTextContent(/Waiting for your approval \(does not exist yet\) · owner: Writer/);
    await userEvent.click(within(panel).getByRole("tab", { name: /Agent contributions/ }));
    expect(within(panel).getByRole("row", { name: "Contribution Analyst" })).toHaveTextContent(/Analyst\s*2\s*1\s*1/);
    await userEvent.click(within(panel).getByRole("tab", { name: /Recent updates/ }));
    expect(within(panel).getByText(/file created/)).toBeInTheDocument();
  });

  it("the owner marks an entry as checked and withdraws one", async () => {
    const calls = setup("/projects", handler);
    await userEvent.click(await screen.findByRole("button", { name: "Open Cafe" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark Licence fee as checked" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdraw Foot traffic" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/projects/p1/workspace/entries/e1/check")).toBe(true);
      expect(calls.some((c) => c.method === "PUT" && c.url === "/api/projects/p1/workspace/entries/e2/withdrawn" && (c.body as { on: boolean }).on === true)).toBe(true);
    });
  });
});

describe("Number warnings on entries", () => {
  it("shows the platform's warnings next to the entry, without changing its value", async () => {
    setup("/projects", handler);
    await userEvent.click(await screen.findByRole("button", { name: "Open Cafe" }));
    const item = await screen.findByRole("listitem", { name: "Entry Small-unit rent" });
    expect(within(item).getByText("AED 750,000-1,250,000 a year.")).toBeInTheDocument();
    expect(within(item).getByRole("list", { name: "Number warnings for Small-unit rent" })).toHaveTextContent(/! Large unsupported amount \(AED 1,250,000\)/);
    expect(screen.queryByRole("list", { name: "Number warnings for Licence fee" })).toBeNull();
  });
});

describe("Starting a task inside a project", () => {
  it("lets the owner turn off the save requirement", async () => {
    const bot = { id: "b1", name: "Researcher", role: "", model: "gemini/x", runtime: "builtin" };
    const calls = setup(
      "/tasks",
      (m, u) => {
        if (m === "GET" && u.startsWith("/api/projects?")) return { projects: [project] };
        if (m === "POST" && u === "/api/bots/b1/tasks") return { task: { id: "t9", rootId: "t9", parentId: null, status: "pending", instruction: "go", assigneeBotId: "b1", assigneeName: "Researcher" } };
        return undefined;
      },
      [bot] as never,
    );
    await screen.findByRole("option", { name: "Cafe" });
    await userEvent.selectOptions(screen.getByLabelText("Project (optional)"), "p1");
    await userEvent.click(screen.getByLabelText(/The bot must save its result to the project workspace/));
    await userEvent.type(screen.getByLabelText("What should it do?"), "Quick question");
    await userEvent.click(screen.getByRole("button", { name: "Start task" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/api/bots/b1/tasks")?.body).toEqual({ instruction: "Quick question", projectId: "p1", saveToWorkspace: false }));
  });

  it("sends the chosen project with the task", async () => {
    const bot = { id: "b1", name: "Researcher", role: "", model: "gemini/x", runtime: "builtin" };
    const calls = setup(
      "/tasks",
      (m, u) => {
        if (m === "GET" && u.startsWith("/api/projects?")) return { projects: [project] };
        if (m === "POST" && u === "/api/bots/b1/tasks") return { task: { id: "t9", rootId: "t9", parentId: null, status: "pending", instruction: "go", assigneeBotId: "b1", assigneeName: "Researcher" } };
        return undefined;
      },
      [bot] as never,
    );
    await screen.findByRole("option", { name: "Cafe" });
    await userEvent.selectOptions(screen.getByLabelText("Project (optional)"), "p1");
    await userEvent.type(screen.getByLabelText("What should it do?"), "Research the market");
    await userEvent.click(screen.getByRole("button", { name: "Start task" }));
    expect(screen.getByLabelText(/The bot must save its result to the project workspace/)).toBeChecked();
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url === "/api/bots/b1/tasks")?.body).toEqual({ instruction: "Research the market", projectId: "p1", saveToWorkspace: true }));
  });
});
