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

describe("Tasks: Ask the Manager", () => {
  it("explains what it does and that it works alone until you allow specialists", async () => {
    renderApp(createFakeApi(), "/tasks");
    const panel = within(await screen.findByRole("region", { name: "Manager" }));
    expect(panel.getByText(/answers directly when it can/)).toBeInTheDocument();
    expect(panel.getByText(/No specialist bots are allowed yet/)).toBeInTheDocument();
    expect(panel.getByText("No Manager requests yet.")).toBeInTheDocument();
  });

  it("starts a request, clears the box, and shows the run with its budget use and steps", async () => {
    const api = createFakeApi();
    renderApp(api, "/tasks");
    const panel = within(await screen.findByRole("region", { name: "Manager" }));
    const box = panel.getByLabelText("What should the Manager do?");
    expect(panel.getByRole("button", { name: "Start" })).toBeDisabled();
    await userEvent.type(box, "Write a short report");
    await userEvent.click(panel.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.ext.manager.runs).toHaveLength(1));
    expect(api.writes().find((w) => w.path === "/api/manager/runs")?.body).toMatchObject({ goal: "Write a short report" });
    await waitFor(() => expect(box).toHaveValue(""));
    const card = within(await screen.findByRole("listitem", { name: "Manager run: Write a short report" }));
    expect(card.getByText("Working…")).toBeInTheDocument();
    expect(card.getByText(/1 of 12 model calls/)).toBeInTheDocument();
    expect(card.getByText(/Research/)).toBeInTheDocument();
  });

  it("can change the budget for one request, and cancel a running one", async () => {
    const api = createFakeApi();
    renderApp(api, "/tasks");
    const panel = within(await screen.findByRole("region", { name: "Manager" }));
    await userEvent.click(panel.getByRole("button", { name: "Change the budget for this request" }));
    await userEvent.type(panel.getByLabelText("Most model calls"), "5");
    await userEvent.type(panel.getByLabelText("What should the Manager do?"), "Quick job");
    await userEvent.click(panel.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.writes().find((w) => w.path === "/api/manager/runs")?.body).toMatchObject({ budget: { maxModelCalls: 5 } }));
    const card = within(await screen.findByRole("listitem", { name: "Manager run: Quick job" }));
    await userEvent.click(card.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.ext.manager.runs[0].status).toBe("cancelled"));
  });

  it("shows results, a stop reason and a corrected note for finished runs", async () => {
    const api = createFakeApi();
    api.ext.manager.runs.push({ id: "r1", goal: "Done job", status: "budget_exhausted", mode: "plan", result: "Partial: step one", error: "The budget for this request was used up.", modelCalls: 12, inputTokens: 30000, outputTokens: 9000, budget: { maxModelCalls: 12, maxTokens: 40000, maxSteps: 6 }, revisions: 1, createdAt: new Date().toISOString(), finishedAt: null, steps: [{ id: "s1", title: "Find facts", specialistId: "b1", specialistName: "Researcher", dependsOn: [], status: "completed", taskId: "t1", output: "x", error: null, attempts: 1 }] });
    renderApp(api, "/tasks");
    const card = within(await screen.findByRole("listitem", { name: "Manager run: Done job" }));
    expect(card.getByText("Stopped: budget used up")).toBeInTheDocument();
    expect(card.getByText("Partial: step one")).toBeInTheDocument();
    expect(card.getByText(/corrected once/)).toBeInTheDocument();
    expect(card.getByRole("link", { name: "task" })).toHaveAttribute("href", "/tasks/t1");
    expect(card.getByText(/Researcher/)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("says when the Manager is switched off", async () => {
    const api = createFakeApi();
    api.ext.manager.settings.enabled = false;
    renderApp(api, "/tasks");
    expect(await screen.findByText("The Manager is switched off in Settings → Agents & Permissions.")).toBeInTheDocument();
  });
});

describe("Settings: Manager", () => {
  it("lets you allow specialist bots and switch the Manager off", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Coder", model: "groq/x" }), makeBot({ id: "b2", name: "NoModel", model: null })]);
    renderApp(api, "/settings/agents");
    const section = within(await screen.findByRole("region", { name: "Manager settings" }));
    expect(section.queryByLabelText("NoModel")).not.toBeInTheDocument(); // only bots that can run are offered
    await userEvent.click(await section.findByRole("checkbox", { name: "Coder" }));
    await waitFor(() => expect(api.ext.manager.settings.allowedBots).toEqual(["b1"]));
    await userEvent.click(section.getByRole("switch", { name: "The Manager is on" }));
    await waitFor(() => expect(api.ext.manager.settings.enabled).toBe(false));
  });
});
