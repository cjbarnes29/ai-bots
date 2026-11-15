import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** Workflow drawing: zoom, fit and pan change only how the drawing LOOKS; saved box positions stay in actual-size units (plan option A, D-110). */
async function open() {
  const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
  vi.stubGlobal("fetch", api.fetch);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/workflows"] })} /></QueryClientProvider>);
  const sec = within(await screen.findByRole("region", { name: "Workflows" }));
  await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
  return { api, ed: within(await screen.findByRole("group", { name: "Workflow editor" })) };
}
const savedEnd = async (api: Awaited<ReturnType<typeof open>>["api"], ed: Awaited<ReturnType<typeof open>>["ed"]) => {
  await userEvent.click(ed.getByRole("button", { name: /Save/ }));
  await waitFor(() => expect(api.ext.workflows).toHaveLength(1));
  return api.ext.workflows[0].graph.nodes.find((n: any) => n.id === "end");
};

describe("Workflow drawing zoom and pan", () => {
  it("starts at 100% and zooms in and out within limits", async () => {
    const { ed } = await open();
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("100%");
    await userEvent.click(ed.getByRole("button", { name: "Zoom in" }));
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("110%");
    for (let i = 0; i < 12; i++) if (!(ed.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled) await userEvent.click(ed.getByRole("button", { name: "Zoom in" }));
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("150%"); expect(ed.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    for (let i = 0; i < 20; i++) if (!(ed.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled) await userEvent.click(ed.getByRole("button", { name: "Zoom out" }));
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("60%"); expect(ed.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    await userEvent.click(ed.getByRole("button", { name: "Actual size" }));
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("100%");
  });
  it("scales the drawing visually without changing box coordinates", async () => {
    const { api, ed } = await open();
    const inner = ed.getByLabelText("Canvas");
    await userEvent.click(ed.getByRole("button", { name: "Zoom out" })); await userEvent.click(ed.getByRole("button", { name: "Zoom out" }));
    expect(inner.style.transform).toBe("scale(0.8)");
    expect(await savedEnd(api, ed)).toMatchObject({ x: 700, y: 200 });
  });
  it("dragging a box while zoomed saves positions in actual-size units", async () => {
    const { api, ed } = await open();
    await userEvent.click(ed.getByRole("button", { name: "Zoom out" })); await userEvent.click(ed.getByRole("button", { name: "Zoom out" })); // 80%
    const handle = ed.getByRole("button", { name: "Move box end" });
    fireEvent.pointerDown(handle, { clientX: 560, clientY: 160 }); // box at (700,200) shows at (560,160) when scaled to 80%
    fireEvent(window, new MouseEvent("pointermove", { clientX: 400, clientY: 240 })); // moved by (-160,+80) on screen = (-200,+100) in the drawing
    fireEvent(window, new MouseEvent("pointerup"));
    expect(await savedEnd(api, ed)).toMatchObject({ x: 500, y: 300 });
  });
  it("Fit to window picks a zoom inside the allowed range and Actual size restores 100%", async () => {
    const { ed } = await open();
    await userEvent.click(ed.getByRole("button", { name: "Fit to window" }));
    const pct = parseInt(ed.getByRole("status", { name: "Zoom level" }).textContent ?? "0", 10);
    expect(pct).toBeGreaterThanOrEqual(60); expect(pct).toBeLessThanOrEqual(150);
    await userEvent.click(ed.getByRole("button", { name: "Actual size" }));
    expect(ed.getByRole("status", { name: "Zoom level" })).toHaveTextContent("100%");
  });
  it("keeps every existing control: add box, arrows, list view, 44 px zoom buttons", async () => {
    const { ed } = await open();
    expect(ed.getByRole("button", { name: "Add Set text" })).toBeInTheDocument();
    expect(ed.getByRole("button", { name: "Draw an arrow from start" })).toBeInTheDocument();
    expect(ed.getByRole("button", { name: "Show as a list" })).toBeInTheDocument();
    for (const n of ["Zoom in", "Zoom out", "Fit to window", "Actual size"]) expect(ed.getByRole("button", { name: n }).className).toContain("min-h-11");
    expect(ed.getByLabelText("Workflow drawing, scrollable")).toHaveAttribute("tabindex", "0");
  });
});
