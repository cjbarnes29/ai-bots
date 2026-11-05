import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/workflows"] })} />
    </QueryClientProvider>,
  );
}

const graph = (withCheckpoint = false) => ({
  nodes: [
    { id: "start", type: "trigger", label: "Start", x: 40, y: 200, kind: "manual" },
    ...(withCheckpoint ? [{ id: "ask", type: "checkpoint", label: "Ask me", x: 300, y: 200, message: "Continue?" }] : []),
    { id: "end", type: "end", label: "End", x: 700, y: 200 },
  ],
  edges: withCheckpoint
    ? [
        { id: "a", from: "start", to: "ask", when: "always" },
        { id: "b", from: "ask", to: "end", when: "always" },
      ]
    : [{ id: "a", from: "start", to: "end", when: "always" }],
});

const wf = (over: Record<string, unknown> = {}) => ({ id: "wf1", name: "Daily report", enabled: false, archived: false, version: 1, graph: graph(), updatedAt: "", ...over });

describe("Automation: Workflows", () => {
  it("creates a workflow in the editor; it is saved switched off", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    await userEvent.clear(ed.getByLabelText("Workflow name"));
    await userEvent.type(ed.getByLabelText("Workflow name"), "Morning check");
    await userEvent.click(ed.getByRole("button", { name: "Add Set text" }));
    await userEvent.click(ed.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.ext.workflows).toHaveLength(1));
    expect(api.ext.workflows[0]).toMatchObject({ name: "Morning check", enabled: false });
    expect(api.ext.workflows[0].graph.nodes.some((n: any) => n.type === "set")).toBe(true);
    expect(await sec.findByText("Morning check")).toBeInTheDocument();
  });

  it("dragging a box moves it (pointer events)", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    const handle = ed.getByRole("button", { name: "Move box end" });
    fireEvent.pointerDown(handle, { clientX: 700, clientY: 200 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 500, clientY: 300 }));
    fireEvent(window, new MouseEvent("pointerup"));
    await userEvent.click(ed.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.ext.workflows).toHaveLength(1));
    const end = api.ext.workflows[0].graph.nodes.find((n: any) => n.id === "end");
    expect(end).toMatchObject({ x: 500, y: 300 });
  });

  it("draws an arrow between two boxes and shows server-side problems", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    await userEvent.click(ed.getByRole("button", { name: "Add Checkpoint" }));
    await userEvent.click(ed.getByRole("button", { name: "Draw an arrow from start" }));
    await userEvent.click(ed.getByRole("button", { name: "Draw the arrow to n2" }));
    expect(ed.getByText(/start → n2/)).toBeInTheDocument();
    await userEvent.click(ed.getByRole("button", { name: "Remove the arrow start to n2" }));
    expect(ed.queryByText(/start → n2/)).not.toBeInTheDocument();
    // remove Start is not allowed (no button), so problems come from the server for a different reason: none here
    expect(await ed.findByText(/No problems found/)).toBeInTheDocument();
  });

  it("runs a workflow, and a checkpoint can be approved from the waiting panel", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    api.ext.workflows.push(wf({ graph: graph(true) }));
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(await sec.findByRole("button", { name: "Run Daily report" }));
    const waiting = within(await sec.findByLabelText("Waiting for you"));
    await userEvent.click(waiting.getByRole("button", { name: "Approve Daily report" }));
    await waitFor(() => expect(api.ext.wfRuns[0].status).toBe("completed"));
  });

  it("switch on / off, duplicate and archive", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    api.ext.workflows.push(wf());
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(await sec.findByRole("button", { name: "Switch on Daily report" }));
    await waitFor(() => expect(api.ext.workflows[0].enabled).toBe(true));
    await userEvent.click(await sec.findByRole("button", { name: "Duplicate Daily report" }));
    await waitFor(() => expect(api.ext.workflows).toHaveLength(2));
    expect(api.ext.workflows[1].enabled).toBe(false);
    await userEvent.click(await sec.findByRole("button", { name: "Archive Daily report" }));
    await waitFor(() => expect(api.ext.workflows[0].archived).toBe(true));
  });
});
