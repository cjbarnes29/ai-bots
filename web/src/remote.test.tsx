import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { SessionGate } from "./components/SessionGate";
import { createFakeApi } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/pc") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
    </QueryClientProvider>,
  );
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("on the PC: Settings > Devices", () => {
  it("explains how to switch phone access on when it is off", async () => {
    const api = createFakeApi();
    api.ext.session.remoteEnabled = false;
    api.ext.session.remoteHosts = [];
    renderApp(api);
    expect(await screen.findByText(/Phone access is/)).toHaveTextContent("off");
    expect(screen.getByText(/REMOTE_HOSTS=/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pair a phone" })).not.toBeInTheDocument();
  });

  it("shows a one-time code and link when you press Pair a phone", async () => {
    const api = createFakeApi();
    renderApp(api);
    await userEvent.click(await screen.findByRole("button", { name: "Pair a phone" }));
    expect(await screen.findByText("ABCDE23456")).toBeInTheDocument();
    expect(screen.getByText("https://pc.tail1.ts.net/?pair=ABCDE23456")).toBeInTheDocument();
    expect(screen.getByText(/Works once/)).toBeInTheDocument();
    expect(api.writes().every((w) => w.headers["x-awp-client"] === "dashboard")).toBe(true);
  });

  it("lists paired phones and revokes one only after you confirm", async () => {
    const api = createFakeApi();
    api.ext.devices.push({ id: "d1", name: "Pixel 8", userAgent: null, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null });
    renderApp(api);
    const row = within(await screen.findByRole("listitem", { name: "Device Pixel 8" }));
    await userEvent.click(row.getByRole("button", { name: "Revoke" }));
    expect(api.writes().filter((w) => w.method === "DELETE")).toHaveLength(0); // only asking so far
    await userEvent.click(screen.getAllByRole("button", { name: "Revoke" }).at(-1)!);
    await waitFor(() => expect(api.ext.devices[0]!.revokedAt).not.toBeNull());
    expect(await screen.findByText(/Revoked: Pixel 8/)).toBeInTheDocument();
  });
});

describe("on the phone", () => {
  it("an unpaired phone sees only the pairing screen, not the dashboard", async () => {
    const api = createFakeApi();
    api.ext.session = { ...api.ext.session, mode: "remote", paired: false, device: null };
    renderApp(api, "/");
    expect(await screen.findByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.path.startsWith("/api/bots"))).toBe(false);
  });

  it("pairs with the code typed in, then shows the dashboard", async () => {
    const api = createFakeApi();
    api.ext.session = { ...api.ext.session, mode: "remote", paired: false, device: null };
    renderApp(api, "/");
    await userEvent.type(await screen.findByLabelText("Pairing code"), "abcde-23456");
    const name = screen.getByLabelText("Device name");
    await userEvent.clear(name);
    await userEvent.type(name, "Pixel");
    await userEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(api.ext.session.device?.name).toBe("Pixel");
  });

  it("opens with the code already filled in when the link from the PC is used", async () => {
    window.history.replaceState(null, "", "/?pair=ABCDE23456");
    const api = createFakeApi();
    api.ext.session = { ...api.ext.session, mode: "remote", paired: false, device: null };
    renderApp(api, "/");
    expect(await screen.findByLabelText("Pairing code")).toHaveValue("ABCDE23456");
  });

  it("a wrong code shows a clear message and stays on the pairing screen", async () => {
    const api = createFakeApi();
    api.ext.session = { ...api.ext.session, mode: "remote", paired: false, device: null };
    renderApp(api, "/");
    await userEvent.type(await screen.findByLabelText("Pairing code"), "WRONGWRONG");
    await userEvent.click(screen.getByRole("button", { name: "Pair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid/);
    expect(screen.getByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
  });

  it("a paired phone sees its own name in Settings, can sign out, and has no pairing controls", async () => {
    const api = createFakeApi();
    api.ext.session = { ...api.ext.session, mode: "remote", paired: true, device: { id: "dev1", name: "Pixel" } };
    renderApp(api);
    expect(await screen.findByText("Pixel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pair a phone" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out of this device" }));
    expect(await screen.findByRole("heading", { name: "Pair this device" })).toBeInTheDocument();
  });
});
