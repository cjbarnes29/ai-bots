import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/pc") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

describe("Settings: PC agent", () => {
  it("explains the rules and says bots cannot touch the PC until a folder is added", async () => {
    renderApp(createFakeApi());
    const section = within(await screen.findByRole("region", { name: "PC agent" }));
    expect(section.getByText(/Administrator access does not exist/)).toBeInTheDocument();
    expect(section.getByText(/None yet, so bots cannot touch this PC at all/)).toBeInTheDocument();
    expect(section.getByText("Running normally.")).toBeInTheDocument();
  });

  it("adds and removes a workspace folder, showing the server's reason when a folder is refused", async () => {
    const api = createFakeApi();
    renderApp(api);
    const section = within(await screen.findByRole("region", { name: "PC agent" }));
    await userEvent.type(await section.findByLabelText("Workspace folder path"), "relative-folder");
    await userEvent.click(section.getByRole("button", { name: "Add folder" }));
    expect(await section.findByRole("alert")).toHaveTextContent(/full path/);
    const box = section.getByLabelText("Workspace folder path");
    await userEvent.clear(box);
    await userEvent.type(box, "C:\\Projects\\app");
    await userEvent.click(section.getByRole("button", { name: "Add folder" }));
    expect(await section.findByText("C:\\Projects\\app")).toBeInTheDocument();
    expect(section.getByText(/Disk of C:\\Projects\\app: 100 GB free of 500 GB/)).toBeInTheDocument();
    await userEvent.click(section.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.ext.pc.roots).toEqual([]));
  });

  it("the emergency stop is one click, shows the stopped state clearly, and offers Resume", async () => {
    const api = createFakeApi();
    renderApp(api);
    const section = within(await screen.findByRole("region", { name: "PC agent" }));
    await userEvent.click(await section.findByRole("button", { name: "Emergency stop" }));
    expect(await section.findByText(/STOPPED: nothing can run on this PC until you resume/)).toBeInTheDocument();
    await userEvent.click(section.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(api.ext.pc.stopped).toBe(false));
    expect(await section.findByText("Running normally.")).toBeInTheDocument();
  });

  it("lists programs kept running with a Stop button, and the permanent log of what ran", async () => {
    const api = createFakeApi();
    api.ext.pc.servers.push({ id: "srv1", command: "npm run dev", cwd: "C:\\Projects\\app", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), botId: null });
    api.ext.pc.executions.push({ id: 1, startedAt: new Date().toISOString(), botName: "Coder", action: "run_command", cwd: "C:\\Projects\\app", command: "npm run build", status: "failed", exitCode: 2, durationMs: 900, output: "x" });
    renderApp(api);
    const section = within(await screen.findByRole("region", { name: "PC agent" }));
    expect(await section.findByText(/npm run dev ·/)).toBeInTheDocument();
    expect(section.getByText("npm run build")).toBeInTheDocument();
    expect(section.getByText("failed")).toBeInTheDocument();
    expect(section.getByText(/\(exit 2\)/)).toBeInTheDocument();
    await userEvent.click(section.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.ext.pc.servers).toHaveLength(0));
  });
});

describe("a bot Permissions tab: PC access", () => {
  it("shows five separate permissions, with ADMIN unavailable, and saves each one", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "Coder" })]);
    renderApp(api, "/bots/b1");
    await userEvent.click(await screen.findByRole("tab", { name: /Permissions/ }));
    const section = within(await screen.findByRole("region", { name: "Skills and tools" }));
    const read = await section.findByRole("checkbox", { name: /READ/ });
    expect(section.getByRole("checkbox", { name: /ADMIN/ })).toBeDisabled();
    await userEvent.click(read);
    await waitFor(() => expect(api.ext.pc.grants.get("b1")).toEqual(["read"]));
    await userEvent.click(section.getByRole("checkbox", { name: /EXECUTE/ }));
    await waitFor(() => expect(api.ext.pc.grants.get("b1")).toEqual(["read", "execute"]));
    for (const name of [/MODIFY/, /INSTALL/]) expect(section.getByRole("checkbox", { name })).not.toBeChecked();
    expect(api.writes().every((w) => w.headers["x-awp-client"] === "dashboard")).toBe(true);
  });
});
