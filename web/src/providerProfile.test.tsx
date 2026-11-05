import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeProvider } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/settings/ai-models"] })} />
    </QueryClientProvider>,
  );
}
const gemini = async () => within(await screen.findByRole("listitem", { name: "Google Gemini" }));

describe("provider cost, privacy and capability panel (existing Settings > AI Models)", () => {
  it("shows the cost class, the date it was checked, the privacy warning and that images are not possible yet", async () => {
    renderApp(createFakeApi());
    const card = await gemini();
    expect(card.getByText("Free with usage limits")).toBeInTheDocument();
    expect(card.getByText(/Checked \d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(card.getByText("Cost, privacy and what it can do"));
    expect(card.getByText(/used to improve Google products/)).toBeInTheDocument();
    expect(card.getByText(/this app cannot send images or tool calls yet/)).toBeInTheDocument();
    expect(card.getByText("Reading screenshots").closest("tr")).toHaveTextContent("Partly");
  });

  it("says plainly when today's allowance is used up and that nothing switches to a paid model", async () => {
    const api = createFakeApi();
    api.llm.providers.set("gemini", makeProvider({ quota: { dailyCap: 50, requestsToday: 50, exhausted: true } }));
    renderApp(api);
    const card = await gemini();
    expect(card.getByRole("alert")).toHaveTextContent(/allowance is used up \(50 of 50 requests\).*nothing switches to a paid model/);
  });

  it("application automation is off by default, needs the provider switched on, and is a plain choice with no hidden effect", async () => {
    const api = createFakeApi();
    api.llm.providers.set("gemini", makeProvider({ enabled: true, freeConfirmed: true }));
    const user = userEvent.setup();
    renderApp(api);
    const card = await gemini();
    const box = card.getByRole("checkbox", { name: /Allow Google Gemini to be used for operating desktop applications/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(api.llm.providers.get("gemini")!.appAutomation).toBe(true));
    expect(api.writes().at(-1)!.body).toEqual({ appAutomation: true });
    expect(card.getByText(/approving a provider never approves a program or a folder/)).toBeInTheDocument();
  });

  it("the switch is unavailable while the provider is off", async () => {
    renderApp(createFakeApi());
    const card = await gemini();
    expect(card.getByRole("checkbox", { name: /operating desktop applications/ })).toBeDisabled();
  });
});
