import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

/** The "Check result" workflow box in the editor: choose which Bot task it reads; it is read-only. Fake API only. */
async function open() {
  const api = createFakeApi([makeBot({ id: "b1", name: "Writer" })]);
  vi.stubGlobal("fetch", api.fetch);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/workflows"] })} /></QueryClientProvider>);
  const sec = within(await screen.findByRole("region", { name: "Workflows" }));
  await userEvent.click(sec.getByRole("button", { name: "New workflow" }));
  return { api, ed: within(await screen.findByRole("group", { name: "Workflow editor" })) };
}

describe("Check result box (editor)", () => {
  it("can be added, lists only Bot task boxes as targets, and saves the chosen target", async () => {
    const { api, ed } = await open();
    await userEvent.click(ed.getByRole("button", { name: "Add Bot task" }));
    await userEvent.click(ed.getByRole("button", { name: "Add Check result" }));
    const select = await ed.findByRole("combobox", { name: "Bot task to check" });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toMatch(/Choose a Bot task/);
    expect(options).toHaveLength(2); // the prompt and the one Bot task; not Start, End or the check itself
    await userEvent.selectOptions(select, within(select).getAllByRole("option")[1]!);
    expect(ed.getByText(/changes nothing and contacts nothing/)).toBeInTheDocument();
    await userEvent.click(ed.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(api.ext.workflows).toHaveLength(1));
    const nodes = api.ext.workflows[0].graph.nodes;
    const check = nodes.find((n: any) => n.type === "check_result");
    const task = nodes.find((n: any) => n.type === "bot_task");
    expect(check.target).toBe(task.id);
  }, 20000);
});
