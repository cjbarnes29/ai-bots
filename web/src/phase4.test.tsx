import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import type { WfGraph, WfRun } from "./api/types";
import { WorkflowRunMap, stateOfStep } from "./components/WorkflowRunMap";
import { runOrder } from "./components/WorkflowEditor";
import { SplitPane } from "./components/ui/SplitPane";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/workflows") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

const graph: WfGraph = {
  nodes: [
    { id: "start", type: "trigger", label: "Start", x: 40, y: 40, kind: "manual" },
    { id: "ask", type: "checkpoint", label: "Ask me", x: 260, y: 40, message: "Continue?" },
    { id: "end", type: "end", label: "End", x: 480, y: 40 },
    { id: "lost", type: "set", label: "Unlinked", x: 480, y: 160, value: "x" },
  ] as WfGraph["nodes"],
  edges: [
    { id: "a", from: "start", to: "ask", when: "always" },
    { id: "b", from: "ask", to: "end", when: "always" },
  ],
};

const run = (over: Partial<WfRun> = {}): WfRun => ({
  id: "r1",
  workflowId: "wf1",
  workflowName: "Daily report",
  workflowVersion: 1,
  status: "running",
  trigger: "manual",
  input: "",
  error: null,
  createdAt: new Date().toISOString(),
  finishedAt: null,
  steps: [
    { nodeId: "start", label: "Start", type: "trigger", status: "completed", output: null, error: null, attempts: 1, refKind: null, refId: null, decidedBy: null },
    { nodeId: "ask", label: "Ask me", type: "checkpoint", status: "waiting", output: null, error: null, attempts: 1, refKind: null, refId: null, decidedBy: null },
  ],
  ...over,
});

describe("SplitPane", () => {
  it("is a labelled separator that moves with the arrow keys, stays between 25 and 75, and jumps with Home and End", async () => {
    const user = userEvent.setup();
    render(<SplitPane label="Demo panels" first={<p>left</p>} second={<p>right</p>} initial={60} />);
    const sep = screen.getByRole("separator", { name: "Resize Demo panels" });
    expect(sep).toHaveAttribute("aria-valuenow", "60");
    sep.focus();
    await user.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "65");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(sep).toHaveAttribute("aria-valuenow", "55");
    await user.keyboard("{End}");
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    await user.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    await user.keyboard("{Home}");
    expect(sep).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("left")).toBeInTheDocument();
    expect(screen.getByText("right")).toBeInTheDocument();
  });

  it("follows a pointer drag, measured from the container", () => {
    render(<SplitPane label="Drag panels" first={<p>a</p>} second={<p>b</p>} initial={50} />);
    const group = screen.getByRole("group", { name: "Drag panels" });
    vi.spyOn(group, "getBoundingClientRect").mockReturnValue({ left: 100, width: 1000, top: 0, right: 1100, bottom: 10, height: 10, x: 100, y: 0, toJSON: () => ({}) });
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientX: 600 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 800 }));
    expect(sep).toHaveAttribute("aria-valuenow", "70");
    fireEvent(window, new MouseEvent("pointermove", { clientX: 5000 })); // far right: clamped
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    fireEvent(window, new MouseEvent("pointerup"));
    fireEvent(window, new MouseEvent("pointermove", { clientX: 300 })); // after release nothing follows
    expect(sep).toHaveAttribute("aria-valuenow", "75");
  });
});

describe("run map", () => {
  it("colours each box by what happened and writes the state in words", () => {
    render(<WorkflowRunMap graph={graph} run={run()} />);
    const map = within(screen.getByRole("group", { name: "Map of the run of Daily report" }));
    expect(map.getByRole("group", { name: "Start: finished" })).toBeInTheDocument();
    expect(map.getByRole("group", { name: "Ask me: waiting for you" })).toBeInTheDocument();
    expect(map.getByRole("group", { name: "End: not reached" })).toBeInTheDocument();
    expect(map.getByRole("group", { name: "Unlinked: not reached" })).toBeInTheDocument();
  });

  it("animates only the arrows that were followed, and only while the run is alive", () => {
    const { container, rerender } = render(<WorkflowRunMap graph={graph} run={run()} />);
    const paths = () => [...container.querySelectorAll("svg path")];
    // start finished and ask reached: arrow a is followed and live; arrow b (ask -> end) is not
    expect(paths().map((p) => p.classList.contains("awp-flow"))).toEqual([true, false]);
    rerender(<WorkflowRunMap graph={graph} run={run({ status: "completed" })} />);
    expect(paths().map((p) => p.classList.contains("awp-flow"))).toEqual([false, false]); // finished run: still, not animated
    expect(paths()[0]!.getAttribute("stroke")).toBe("#10b981"); // but the path taken stays green
  });

  it("never shows an unknown step status as finished", () => {
    expect(stateOfStep("completed")).toBe("done");
    expect(stateOfStep("failed")).toBe("failed");
    expect(stateOfStep("waiting")).toBe("waiting");
    expect(stateOfStep("running")).toBe("running");
    expect(stateOfStep("skipped")).toBe("skipped");
    expect(stateOfStep("something-new")).toBe("idle");
    expect(stateOfStep(undefined)).toBe("idle");
  });

  it("is shown when a run is opened on the Workflow Studio page", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    api.ext.workflows.push({ id: "wf1", name: "Daily report", enabled: false, archived: false, version: 1, graph, problems: [], updatedAt: "", lastRun: null } as never);
    api.ext.wfRuns.push(run({ status: "completed" }) as never);
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await userEvent.click(await sec.findByRole("button", { name: /Daily report \(v1\)/ }));
    expect(await sec.findByRole("group", { name: "Map of the run of Daily report" })).toBeInTheDocument();
  });
});

describe("running order", () => {
  it("lists boxes from Start along the arrows and puts unreachable boxes last", () => {
    expect(runOrder(graph.nodes, graph.edges).map((n) => n.id)).toEqual(["start", "ask", "end", "lost"]);
  });
  it("does not loop forever on a drawing with a cycle", () => {
    const cyc = { nodes: graph.nodes, edges: [...graph.edges, { id: "c", from: "end", to: "start", when: "always" as const }] };
    expect(runOrder(cyc.nodes, cyc.edges).map((n) => n.id)).toEqual(["start", "ask", "end", "lost"]);
  });
});

describe("the workflow editor on a phone: list view", () => {
  it("switches between the drawing and a list, edits the same data, and draws an arrow with two taps", async () => {
    const user = userEvent.setup();
    const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
    renderApp(api);
    const sec = within(await screen.findByRole("region", { name: "Workflows" }));
    await user.click(sec.getByRole("button", { name: "New workflow" }));
    const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
    // wide by default: the drawing
    expect(ed.getByRole("button", { name: "Move box end" })).toBeInTheDocument();
    await user.click(ed.getByRole("button", { name: "Add Set text" }));
    await user.click(ed.getByRole("button", { name: "Show as a list" }));
    // list view: no canvas handles, boxes numbered in running order
    expect(ed.queryByRole("button", { name: "Move box end" })).not.toBeInTheDocument();
    const list = within(ed.getByRole("list", { name: "Boxes in running order" }));
    expect(list.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Box start", "Box end", "Box n2"]);
    expect(list.getByText(/then → End/)).toBeInTheDocument();
    // two taps draw an arrow (the same controls as the drawing)
    await user.click(list.getByRole("button", { name: "Draw an arrow from n2" }));
    await user.click(list.getByRole("button", { name: "Draw the arrow to end" }));
    expect(ed.getByText(/n2 → end/)).toBeInTheDocument();
    // picking a box opens its form (the same form as in the drawing)
    await user.click(list.getByRole("button", { name: "Edit box n2" }));
    expect(list.getByRole("button", { name: "Edit box n2" })).toHaveAttribute("aria-pressed", "true");
    expect(await ed.findByLabelText("Text to produce")).toBeInTheDocument();
    // back to the drawing: the same boxes
    await user.click(ed.getByRole("button", { name: "Show as a drawing" }));
    expect(ed.getByRole("button", { name: "Move box n2" })).toBeInTheDocument();
    // and it saves as one workflow with the new arrow
    await user.click(ed.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.ext.workflows).toHaveLength(1));
    expect(api.ext.workflows[0].graph.edges.some((e: any) => e.from === "n2" && e.to === "end")).toBe(true);
  });

  it("opens in list view when the screen is phone-sized", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width: 767px"), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as never;
    try {
      const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
      renderApp(api);
      const sec = within(await screen.findByRole("region", { name: "Workflows" }));
      await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
      const ed = within(await screen.findByRole("group", { name: "Workflow editor" }));
      expect(ed.getByRole("list", { name: "Boxes in running order" })).toBeInTheDocument();
      expect(ed.getByRole("button", { name: "Show as a drawing" })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
