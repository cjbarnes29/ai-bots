import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }) {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/settings"] })} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
});

describe("Settings: alerts on this device", () => {
  it("says plainly when the browser cannot do alerts (for example the PC's plain http page)", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByText(/Alerts need the installed app opened over HTTPS/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on alerts" })).not.toBeInTheDocument();
  });

  it("turns alerts on: asks permission, subscribes with the PC's public key, and registers only the address", async () => {
    const api = createFakeApi();
    const subscribe = vi.fn(async (opts: any) => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", unsubscribe: async () => true, opts }));
    let sub: any = null;
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async (o: any) => (sub = await subscribe(o)) } };
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: async () => reg, ready: Promise.resolve(reg) }, configurable: true });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => "granted" });
    const base = api.fetch;
    const calls: string[] = [];
    const wrapped = (async (url: any, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url) === "/api/push/key") return new Response(JSON.stringify({ publicKey: "BAUC_w" }), { status: 200, headers: { "content-type": "application/json" } });
      if (String(url) === "/api/push/subscribe") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      return base(url, init);
    }) as typeof fetch;
    renderApp({ fetch: wrapped });
    await userEvent.click(await screen.findByRole("button", { name: "Turn on alerts" }));
    expect(await screen.findByText("Alerts are on for this device.")).toBeInTheDocument();
    expect(subscribe.mock.calls[0]![0].userVisibleOnly).toBe(true);
    expect(calls).toContain("POST /api/push/subscribe");
  });

  it("explains when notifications are blocked", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: async () => null }, configurable: true });
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { permission: "denied", requestPermission: async () => "denied" });
    renderApp(createFakeApi());
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
  });
});
