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

describe("Settings: Google Workspace", () => {
  it("is hidden unless the connector is installed, and the button needs the saved Google client", async () => {
    const hidden = createFakeApi();
    renderApp(hidden, "/settings");
    await screen.findByRole("heading", { name: "Gmail" });
    expect(screen.queryByRole("heading", { name: "Google Workspace" })).not.toBeInTheDocument();
  });

  it("the button needs the saved Google client; with one it opens Google's page", async () => {
    const noClient = createFakeApi();
    noClient.ext.connectors.push({ id: "gworkspace", label: "Google Workspace", actions: [] });
    renderApp(noClient, "/settings");
    const sec = within(await screen.findByRole("region", { name: "Google Workspace" }));
    expect(await sec.findByText("Not set up")).toBeInTheDocument();
    expect(sec.getByRole("button", { name: "Connect Google Workspace" })).toBeDisabled();
  });

  it("opens Google's own sign-in page when a client is saved", async () => {
    const api = createFakeApi();
    api.ext.connectors.push({ id: "gworkspace", label: "Google Workspace", actions: [] });
    for (const n of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) api.ext.secrets.find((x: any) => x.name === n)!.inVault = true;
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderApp(api, "/settings");
    const sec = within(await screen.findByRole("region", { name: "Google Workspace" }));
    await waitFor(() => expect(sec.getByRole("button", { name: "Connect Google Workspace" })).toBeEnabled());
    await userEvent.click(sec.getByRole("button", { name: "Connect Google Workspace" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining("accounts.example.test"), "_blank", "noopener"));
  });
});

describe("Bot permissions: integrations", () => {
  it("switches reading on and off per integration, and says writes still need approval", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Dev" })]);
    api.ext.integrations.available = [
      { id: "github", label: "GitHub", actions: [] },
      { id: "notion", label: "Notion", actions: [] },
    ];
    renderApp(api, "/bots/b1");
    await userEvent.click(await screen.findByRole("tab", { name: /Permissions/ }));
    const sec = within(await screen.findByRole("region", { name: "Integrations" }));
    expect(sec.getByText(/still waits for your approval/)).toBeInTheDocument();
    expect(sec.getByRole("checkbox", { name: "GitHub" })).not.toBeChecked();
    await userEvent.click(sec.getByRole("checkbox", { name: "GitHub" }));
    await waitFor(() => expect(api.ext.integrations.enabled.get("b1")).toEqual(["github"]));
    await waitFor(() => expect(sec.getByRole("checkbox", { name: "GitHub" })).toBeChecked());
    await userEvent.click(sec.getByRole("checkbox", { name: "GitHub" }));
    await waitFor(() => expect(api.ext.integrations.enabled.get("b1")).toEqual([]));
  });
});
