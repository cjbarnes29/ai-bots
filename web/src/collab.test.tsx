import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { TaskNode, TaskTree } from "./api/types";
import { createFakeApi, makeBot } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

const node = (over: Partial<TaskNode> = {}): TaskNode => ({
  id: crypto.randomUUID(),
  rootId: "root",
  parentId: null,
  assigneeBotId: "b1",
  assigneeName: "Manager",
  requestedBy: "user",
  requestedByName: "You",
  origin: "user",
  originId: null,
  originLabel: null,
  originDepth: 0,
  instruction: "Write a report",
  depth: 0,
  status: "completed",
  result: null,
  errorCode: null,
  errorMessage: null,
  llmCalls: 2,
  inputTokens: 100,
  outputTokens: 50,
  createdAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  children: [],
  ...over,
});
const tree = (task: TaskNode, events: TaskTree["events"] = []): TaskTree => ({
  task,
  events,
  totals: { tasks: 1 + task.children.length, llmCalls: 3, inputTokens: 150, outputTokens: 75 },
});
const withTree = (api: ReturnType<typeof createFakeApi>, t: TaskTree) => {
  api.collab.trees.set(t.task.id, t);
  return t.task.id;
};

describe("Team tab", () => {
  const setup = () => {
    const manager = makeBot({ name: "Manager", model: "groq/x" });
    const writer = makeBot({ name: "Writer", role: "Drafts text", model: "groq/x" });
    const noModel = makeBot({ name: "Idle" });
    const claw = makeBot({ name: "Claw", model: "groq/x", runtime: "openclaw" });
    const api = createFakeApi([manager, writer, noModel, claw]);
    return { manager, writer, noModel, claw, api };
  };
  const open = async (path: string) => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Team" }));
    return user;
  };

  it("says nobody may be delegated to by default, and lists the other bots (not itself)", async () => {
    const { manager, api } = setup();
    renderApp(api, `/bots/${manager.id}`);
    await open("");
    expect(await screen.findByText(/Nobody, by default/)).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /Allow Writer/ })).not.toBeChecked();
    expect(screen.getByText("Drafts text")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Allow Manager/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save team" })).toBeDisabled();
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("saves the chosen teammates and logs the change", async () => {
    const { manager, writer, api } = setup();
    renderApp(api, `/bots/${manager.id}`);
    const user = await open("");
    await user.click(await screen.findByRole("checkbox", { name: /Allow Writer/ }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save team" }));
    expect(await screen.findByText("Team saved.")).toBeInTheDocument();
    expect(api.writes()[0]).toMatchObject({ method: "PUT", path: `/api/bots/${manager.id}/delegation`, body: { targetBotIds: [writer.id] } });
    expect(await screen.findByText(/Writer was allowed/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Allow Writer/ })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: /Allow Writer/ }));
    await user.click(screen.getByRole("button", { name: "Save team" }));
    expect(await screen.findByText(/Writer was removed/)).toBeInTheDocument();
    expect(api.writes()[1]!.body).toEqual({ targetBotIds: [] });
  });

  it("warns about teammates that cannot take tasks, and about duplicate names", async () => {
    const { manager, api } = setup();
    api.bots.set("dup", makeBot({ id: "dup", name: "Writer", model: "groq/x" }));
    renderApp(api, `/bots/${manager.id}`);
    await open("");
    expect(await screen.findByText("Has no model yet, so it cannot take tasks.")).toBeInTheDocument();
    expect(screen.getByText("Uses OpenClaw, which is not installed.")).toBeInTheDocument();
    expect(screen.getAllByText(/Another bot has the same name/)).toHaveLength(2);
  });

  it("explains when there are no other bots", async () => {
    const lonely = makeBot({ name: "Solo" });
    renderApp(createFakeApi([lonely]), `/bots/${lonely.id}`);
    await open("");
    expect(await screen.findByText(/There are no other bots yet/)).toBeInTheDocument();
  });

  it("is read-only for an archived bot", async () => {
    const { writer, api } = setup();
    const old = makeBot({ name: "Old", archived: true });
    api.bots.set(old.id, old);
    renderApp(api, `/bots/${old.id}`);
    await open("");
    expect(await screen.findByText(/archived\. Unarchive it to change its team/)).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: /Allow Writer/ })).toBeDisabled();
    expect(writer.id).toBeTruthy();
  });

  it("shows the server's explanation if a teammate has disappeared", async () => {
    const { manager, writer, api } = setup();
    renderApp(api, `/bots/${manager.id}`);
    const user = await open("");
    await user.click(await screen.findByRole("checkbox", { name: /Allow Writer/ }));
    api.bots.delete(writer.id);
    await user.click(screen.getByRole("button", { name: "Save team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not exist/);
  });
});

describe("Tasks page", () => {
  it("only offers bots that have a model, and starts a task", async () => {
    const user = userEvent.setup();
    const ready = makeBot({ name: "Manager", role: "Leads", model: "groq/x" });
    const idle = makeBot({ name: "Idle" });
    const claw = makeBot({ name: "Claw", model: "groq/x", runtime: "openclaw" });
    const api = createFakeApi([ready, idle, claw]);
    const { router } = renderApp(api, "/tasks");

    const select = await screen.findByLabelText("Which bot");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(1));
    expect(within(select).getByRole("option", { name: "Manager: Leads" })).toBeInTheDocument();

    const start = screen.getByRole("button", { name: "Start task" });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("What should it do?"), "  Draft a plan  ");
    await user.click(start);

    expect(await screen.findByRole("heading", { name: /Task for Manager/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/tasks\/[0-9a-f-]{36}$/);
    expect(api.writes()[0]).toMatchObject({ method: "POST", path: `/api/bots/${ready.id}/tasks`, body: { instruction: "Draft a plan" } });
    expect(screen.getByRole("heading", { name: /Task for Manager/ })).toHaveTextContent("Waiting");
  });

  it("explains when no bot can take a task yet", async () => {
    renderApp(createFakeApi([makeBot({ name: "Idle" })]), "/tasks");
    expect(await screen.findByText(/No bot can take a task yet/)).toBeInTheDocument();
  });

  it("lists recent tasks, newest first, with their size", async () => {
    const api = createFakeApi([makeBot({ name: "Manager", model: "groq/x" })]);
    withTree(api, tree(node({ id: "t1", instruction: "older job", createdAt: "2026-01-01T00:00:00Z" })));
    withTree(api, tree(node({ id: "t2", instruction: "newer job", status: "running", children: [node({ id: "c" })] })));
    renderApp(api, "/tasks");
    const list = within(await screen.findByRole("region", { name: "Recent tasks" }));
    const items = await list.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("newer job");
    expect(items[0]).toHaveTextContent("Working");
    expect(items[0]).toHaveTextContent("2 tasks · 3 model calls");
    expect(items[1]).toHaveTextContent("older job");
    expect(items[1]).toHaveTextContent("Done");
  });

  it("shows an empty state", async () => {
    renderApp(createFakeApi(), "/tasks");
    expect(await screen.findByText("No tasks yet.")).toBeInTheDocument();
  });
});

describe("Task detail", () => {
  const chain = () => {
    const child = node({
      id: "c1",
      parentId: "root",
      assigneeName: "Researcher",
      requestedBy: "b1",
      requestedByName: "Manager",
      instruction: "Find two facts",
      depth: 1,
      result: "Fact 1. Fact 2.",
      llmCalls: 1,
    });
    const failed = node({ id: "c2", parentId: "root", assigneeName: "Writer", requestedByName: "Manager", depth: 1, status: "failed", errorMessage: "The provider rejected the API key.", llmCalls: 1 });
    const root = node({ id: "root", result: "Final report.", children: [child, failed] });
    return tree(root, [
      { id: 1, taskId: "root", kind: "created", detail: "{}", createdAt: new Date().toISOString() },
      { id: 2, taskId: "c1", kind: "delegated", detail: JSON.stringify({ from: "Manager", to: "Researcher" }), createdAt: new Date().toISOString() },
      { id: 3, taskId: "root", kind: "delegation_rejected", detail: JSON.stringify({ to: "Nobody", reason: "not one of your allowed teammates" }), createdAt: new Date().toISOString() },
      { id: 4, taskId: "c2", kind: "failed", detail: JSON.stringify({ code: "llm_auth_failed", message: "The provider rejected the API key." }), createdAt: new Date().toISOString() },
    ]);
  };

  it("shows the whole chain: who asked whom, answers, failures, totals and the log", async () => {
    const api = createFakeApi();
    const id = withTree(api, chain());
    renderApp(api, `/tasks/${id}`);
    expect(await screen.findByRole("heading", { name: /Task for Manager/ })).toBeInTheDocument();
    expect(screen.getByText(/3 tasks · 3 model calls · 225 tokens/)).toBeInTheDocument();

    const researcher = within(screen.getByLabelText("Task for Researcher"));
    expect(researcher.getByText(/asked by Manager/)).toBeInTheDocument();
    expect(researcher.getByText("Fact 1. Fact 2.")).toBeInTheDocument();
    const writer = within(screen.getByLabelText("Task for Writer"));
    expect(writer.getByText("Failed")).toBeInTheDocument();
    expect(writer.getByRole("alert")).toHaveTextContent("The provider rejected the API key.");
    expect(within(screen.getByLabelText("Task for Manager")).getByText("Final report.")).toBeInTheDocument();

    const log = within(screen.getByRole("region", { name: "Task log" }));
    expect(log.getByText("Handed to a teammate")).toBeInTheDocument();
    expect(log.getByText(/Manager → Researcher/)).toBeInTheDocument();
    expect(log.getByText("A hand-over was refused")).toBeInTheDocument();
    expect(log.getByText(/Nobody: not one of your allowed teammates/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel this task" })).not.toBeInTheDocument(); // it has finished
  });

  it("can cancel a task that is still working", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const id = withTree(api, tree(node({ id: "root", status: "running" })));
    renderApp(api, `/tasks/${id}`);
    expect(await screen.findByText(/Working… this page updates by itself/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel this task" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Task for Manager/ })).toHaveTextContent("Cancelled"));
    expect(api.writes()[0]).toMatchObject({ method: "POST", path: `/api/tasks/${id}/cancel` });
    expect(screen.queryByRole("button", { name: "Cancel this task" })).not.toBeInTheDocument();
  });

  it("updates by itself while a task is working", async () => {
    const api = createFakeApi();
    const running = tree(node({ id: "root", status: "running" }));
    const id = withTree(api, running);
    renderApp(api, `/tasks/${id}`);
    expect(await screen.findByText(/Working…/)).toBeInTheDocument();
    running.task.status = "completed"; // the "server" finishes the task
    running.task.result = "All done.";
    await waitFor(() => expect(screen.getByText("All done.")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText(/Working…/)).not.toBeInTheDocument();
  });

  it("explains a task that does not exist", async () => {
    renderApp(createFakeApi(), "/tasks/00000000-0000-4000-8000-000000000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("This task does not exist.");
  });
});

describe("navigation and teamwork limits", () => {
  it("reaches Tasks through Monitoring", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(createFakeApi(), "/");
    await user.click(within(await screen.findByRole("navigation", { name: "Main" })).getByRole("link", { name: "Monitoring" }));
    expect(router.state.location.pathname).toBe("/monitor");
    await user.click(within(await screen.findByRole("navigation", { name: "Monitoring sections" })).getByRole("link", { name: "Tasks" }));
    expect(router.state.location.pathname).toBe("/tasks");
  });

  it("shows the teamwork limits, saves only what changed, and rejects values past the ceiling", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    renderApp(api, "/settings/workflows");
    const field = (key: string) => document.getElementById(`delegation-${key}`) as HTMLInputElement;
    await waitFor(() => expect(field("maxDepth")).toHaveValue(2));
    expect(field("maxSubtasksPerTask")).toHaveValue(3);
    expect(field("maxTasksPerChain")).toHaveValue(5);
    expect(field("maxLlmCallsPerChain")).toHaveValue(8);
    const save = screen.getByRole("button", { name: "Save teamwork limits" });
    expect(save).toBeDisabled();

    await user.clear(field("maxDepth"));
    await user.type(field("maxDepth"), "9");
    await user.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent(/maxDepth.*at most 4/);

    await user.clear(field("maxDepth"));
    await user.type(field("maxDepth"), "3");
    await user.click(save);
    await waitFor(() => expect(api.writes().at(-1)!.body).toEqual({ maxDepth: 3 }));
    await user.click(screen.getByRole("button", { name: "Reset teamwork limits" }));
    await waitFor(() => expect(field("maxDepth")).toHaveValue(2));
  });
});
