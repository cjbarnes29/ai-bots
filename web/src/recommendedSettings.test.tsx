import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

function mount(fetchImpl: typeof fetch, path: string) {
  vi.stubGlobal("fetch", fetchImpl);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
function renderApp(api = createFakeApi(), path = "/settings/recommended") {
  const router = mount(api.fetch, path);
  return { api, router };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("Recommended Settings page", () => {
  it("is a Settings category, loads the recommendations and says what was checked", async () => {
    const { router } = renderApp(createFakeApi(), "/settings");
    const nav = within(await screen.findByRole("navigation", { name: "Settings categories" }));
    await userEvent.setup().click(nav.getByRole("link", { name: "Recommended Settings" }));
    expect(router.state.location.pathname).toBe("/settings/recommended");
    expect(await screen.findByRole("region", { name: "Recommended settings" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Automatic model choice" })).toBeInTheDocument();
    expect(screen.getByLabelText("What was checked")).toHaveTextContent("8 GB memory and 4 cores");
    expect(screen.getByLabelText("Summary")).toHaveTextContent("1 can be applied");
  });

  it("is found by the settings search", async () => {
    renderApp(createFakeApi(), "/settings");
    const box = await screen.findByRole("searchbox", { name: "Search settings" });
    await userEvent.setup().type(box, "restore");
    expect(within(await screen.findByRole("region", { name: "Search results" })).getByRole("link", { name: /Recommended settings/ })).toHaveAttribute("href", "/settings/recommended");
  });

  it("switches between the three modes, changing only what is shown", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await screen.findByRole("listitem", { name: "Automatic model choice" });
    expect(screen.queryByRole("listitem", { name: "Retries after a failure" })).toBeNull();
    expect(screen.getByLabelText("What was checked")).toHaveTextContent("1 more recommendation is shown in a higher mode");
    await user.click(screen.getByRole("radio", { name: "Advanced" }));
    expect(await screen.findByRole("listitem", { name: "Retries after a failure" })).toBeInTheDocument();
    expect(api.rec.mode).toBe("advanced");
    await user.click(screen.getByRole("radio", { name: "Beginner" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Retries after a failure" })).toBeNull());
    expect(api.rec.mode).toBe("beginner");
    expect(api.writes().every((w) => w.path === "/api/recommendations/mode")).toBe(true);
    expect(api.rec.items.find((i) => i.id === "routing.strategy")!.current).toBe("Off");
  });

  it("shows more detail in a higher mode", async () => {
    const user = userEvent.setup();
    renderApp();
    const card = await screen.findByRole("listitem", { name: "Automatic model choice" });
    await user.click(within(card).getByText("Why is this recommended?"));
    expect(within(card).getByText(/Benefits:/)).toBeInTheDocument();
    expect(within(card).queryByText(/What was checked:/)).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Beginner" }));
    await waitFor(() => expect(within(screen.getByRole("listitem", { name: "Automatic model choice" })).queryByText(/Benefits:/)).toBeNull());
    await user.click(screen.getByRole("radio", { name: "Advanced" }));
    const adv = await screen.findByRole("listitem", { name: "Automatic model choice" });
    await user.click(within(adv).getByText("Why is this recommended?"));
    expect(within(adv).getByText(/What was checked:/)).toBeInTheDocument();
  });

  it("applies one recommendation, reports the change, records history and updates the card", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    const card = await screen.findByRole("listitem", { name: "Automatic model choice" });
    await user.click(within(card).getByRole("button", { name: "Apply the recommendation for Automatic model choice" }));
    const report = await screen.findByRole("status", { name: "What was changed" });
    expect(report).toHaveTextContent("Automatic model choice: changed from Off to On");
    expect(api.writes().at(-1)).toMatchObject({ method: "POST", path: "/api/recommendations/apply", body: { ids: ["routing.strategy"] } });
    expect(screen.getByRole("region", { name: "Changes made by recommendations" })).toHaveTextContent("Automatic model choice: Off → On");
    expect(within(screen.getByRole("listitem", { name: "Automatic model choice" })).queryByRole("button", { name: /Apply the recommendation/ })).toBeNull();
  });

  it("applies several selected recommendations at once, and never offers Apply where nothing can be recommended", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole("radio", { name: "Advanced" }));
    await screen.findByRole("listitem", { name: "Retries after a failure" });
    const unavailable = screen.getByRole("listitem", { name: "Local model for screen text" });
    expect(within(unavailable).queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(within(unavailable).queryByRole("checkbox")).toBeNull();
    expect(unavailable).toHaveTextContent("Connect a local model first.");
    expect(screen.getByLabelText("Summary")).toHaveTextContent("2 can be applied");
    expect(screen.getByRole("button", { name: "Apply selected (0)" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Select all that can be applied" }));
    await user.click(screen.getByRole("button", { name: "Apply selected (2)" }));
    await screen.findByRole("status", { name: "What was changed" });
    expect(api.writes().at(-1)?.body).toEqual({ ids: ["routing.strategy", "limits.retries"] });
    expect(api.rec.history).toHaveLength(2);
  });

  it("restores a change from the history and from the card", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();
    await user.click(await screen.findByRole("button", { name: "Apply the recommendation for Automatic model choice" }));
    await screen.findByRole("status", { name: "What was changed" });
    await user.click(await screen.findByRole("button", { name: "Restore Automatic model choice to Off" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "What was changed" })).toHaveTextContent("changed from On to Off"));
    expect(api.rec.items.find((i) => i.id === "routing.strategy")!.current).toBe("Off");
    expect(screen.getByRole("region", { name: "Changes made by recommendations" })).toHaveTextContent("(restored)");
    expect(screen.queryByRole("button", { name: "Restore Automatic model choice to Off" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apply the recommendation for Automatic model choice" }));
    await user.click(await screen.findByRole("button", { name: "Restore the previous value of Automatic model choice" }));
    await waitFor(() => expect(api.rec.items.find((i) => i.id === "routing.strategy")!.current).toBe("Off"));
  });

  it("shows a clear message when applying is refused (a phone is owner-only) and changes nothing", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    api.rec.forbidApply = true;
    renderApp(api);
    await user.click(await screen.findByRole("button", { name: "Apply the recommendation for Automatic model choice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This can only be done from the PC itself.");
    expect(api.rec.history).toHaveLength(0);
    expect(api.rec.items.find((i) => i.id === "routing.strategy")!.current).toBe("Off");
  });

  it("says so when the recommendations cannot be loaded", async () => {
    const real = createFakeApi().fetch;
    mount(
      ((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/recommendations")
          ? Promise.resolve(new Response(JSON.stringify({ error: "x", message: "boom" }), { status: 500, headers: { "content-type": "application/json" } }))
          : real(input, init)) as typeof fetch,
      "/settings/recommended",
    );
    expect(await screen.findByText("Could not load the recommendations.")).toBeInTheDocument();
  });
});
