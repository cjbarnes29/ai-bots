import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderApp(api: { fetch: typeof fetch }, path = "/access") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

describe("Access > Folders", () => {
  it("starts with nothing approved and says so", async () => {
    renderApp(createFakeApi());
    expect(await screen.findByText(/can touch no folder until you approve it here/i)).toBeInTheDocument();
    expect(await screen.findByText(/cannot read, create, change or delete anything on this PC/i)).toBeInTheDocument();
  });

  it("shows exactly what a folder approval allows and does not allow before anything is approved", async () => {
    const api = createFakeApi();
    const user = userEvent.setup();
    renderApp(api);
    await user.type(await screen.findByLabelText("Folder path"), "D:\\Projects\\app");
    await user.click(screen.getByLabelText("Edit"));
    await user.click(screen.getByRole("button", { name: /show me exactly what this allows/i }));
    const box = await screen.findByLabelText("What this allows");
    expect(box).toHaveTextContent(/read, edit in D:\\Projects\\app/);
    expect(box).toHaveTextContent(/not the parent folder, not neighbouring folders, not other drives/);
    expect(api.ext.access.grants).toHaveLength(0); // previewing grants nothing
    await user.click(within(box).getByRole("button", { name: "Approve this folder" }));
    await waitFor(() => expect(api.ext.access.grants).toHaveLength(1));
    expect(api.ext.access.grants[0]).toMatchObject({ subject: "workforce", path: "D:\\Projects\\app", ops: ["read", "edit"], inherit: false, expiresAt: expect.any(String) });
    expect(await screen.findByLabelText("Folder D:\\Projects\\app")).toHaveTextContent(/this folder only \(not sub-folders\)/);
  });

  it("refuses a bad path in plain words", async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi());
    await user.type(await screen.findByLabelText("Folder path"), "projects");
    await user.click(screen.getByRole("button", { name: /show me exactly/i }));
    expect(await screen.findByText(/full path starting with a drive letter/)).toBeInTheDocument();
  });

  it("makes a secrets folder a deliberate, confirmed, short decision", async () => {
    const api = createFakeApi();
    const user = userEvent.setup();
    renderApp(api);
    await user.type(await screen.findByLabelText("Folder path"), "D:\\me\\.ssh");
    await user.click(screen.getByRole("button", { name: /show me exactly/i }));
    const box = await screen.findByLabelText("What this allows");
    const approve = within(box).getByRole("button", { name: "Approve this folder" });
    expect(approve).toBeDisabled();
    await user.click(within(box).getByRole("checkbox"));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() => expect(api.ext.access.grants[0]).toMatchObject({ sensitive: "ssh_keys" }));
    // a "never expires" choice is turned into 24 hours
    expect(api.ext.access.grants[0].expiresAt).not.toBeNull();
  });

  it("takes access back with one click and the check box then says no", async () => {
    const api = createFakeApi();
    api.ext.access.grants.push({ id: "g1", subject: "workforce", path: "D:\\work", ops: ["read"], inherit: true, sensitive: null, createdAt: new Date().toISOString(), expiresAt: null, revokedAt: null, status: "active", note: "" });
    const user = userEvent.setup();
    renderApp(api);
    await user.type(await screen.findByLabelText("Path to test"), "D:\\work\\a.txt");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Allowed.");
    await user.click(screen.getByRole("button", { name: "Take back D:\\work" }));
    await waitFor(() => expect(api.ext.access.grants[0].status).toBe("revoked"));
    await user.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Not allowed\. No folder has been approved/));
  });
});

describe("Access > Applications", () => {
  const open = async (api: ReturnType<typeof createFakeApi>) => {
    const user = userEvent.setup();
    renderApp(api);
    await user.click(await screen.findByRole("tab", { name: "Applications" }));
    await user.click(await screen.findByRole("button", { name: /scan applications \(read-only\)/i }));
    return user;
  };

  it("scans read-only, shows each program's level, and states that approval is not file access", async () => {
    const api = createFakeApi();
    await open(api);
    const notes = await screen.findByLabelText("Notes Pro");
    expect(notes).toHaveTextContent("Not approved");
    expect(notes).toHaveTextContent("Running (1)");
    expect(screen.getByText(/does not approve it, and approving a program never gives it access to your files/i)).toBeInTheDocument();
    expect(api.ext.access.calls.some((c) => c.method === "POST" && c.path.endsWith("/scan"))).toBe(true);
  });

  it("offers no approval at all for a protected program", async () => {
    await open(createFakeApi());
    const uv = await screen.findByLabelText("UltraViewer");
    expect(uv).toHaveTextContent("Protected");
    expect(uv).toHaveTextContent(/cannot be approved here/);
    expect(within(uv).queryByRole("button")).toBeNull();
  });

  it("lets the owner allow a program for this session with exactly the ticked abilities", async () => {
    const api = createFakeApi();
    const user = await open(api);
    const card = await screen.findByLabelText("Notes Pro");
    await user.click(within(card).getByRole("button", { name: /allow for this session only/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/does NOT give the program or the AI access to any files, accounts, passwords or personal data/);
    await user.click(within(dialog).getByLabelText(/operate the program/));
    await user.click(within(dialog).getByRole("button", { name: "Allow for this session" }));
    await waitFor(() => expect(api.ext.access.apps[0].session).toBeTruthy());
    expect(api.ext.access.apps[0].session.capabilities).toEqual(["open", "view", "control"]);
    expect(api.ext.access.apps[0].level).toBe("unknown");
  });

  it("trusting needs a review period, and taking back returns the program to not approved", async () => {
    const api = createFakeApi();
    const user = await open(api);
    const card = await screen.findByLabelText("Notes Pro");
    await user.click(within(card).getByRole("button", { name: "Trust..." }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Trust" }));
    expect(api.ext.access.apps[0].level).toBe("unknown"); // no review days yet: nothing was sent
    await user.type(within(dialog).getByLabelText("Days until review"), "30");
    await user.click(within(dialog).getByRole("button", { name: "Trust" }));
    await waitFor(() => expect(api.ext.access.apps[0].level).toBe("trusted"));
    expect(await screen.findByLabelText("Notes Pro")).toHaveTextContent(/Review by/);
    await user.click(within(screen.getByLabelText("Notes Pro")).getByRole("button", { name: "Take back" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Take back" }));
    await waitFor(() => expect(api.ext.access.apps[0].level).toBe("unknown"));
  });
});

describe("Access in the menu", () => {
  it("has its own entry", async () => {
    renderApp(createFakeApi(), "/integrations");
    expect(await within(await screen.findByRole("navigation", { name: "Apps & Integrations sections" })).findByRole("link", { name: "Access" })).toHaveAttribute("href", "/access");
  });
});

describe("Access > Desktop control", () => {
  it("states the rules in plain words, shows the engine status and record, and keeps screen text away from cloud models by default", async () => {
    const api = createFakeApi();
    const user = userEvent.setup();
    renderApp(api);
    await user.click(await screen.findByRole("tab", { name: "Desktop control" }));
    expect(await screen.findByText(/UI Automation:/)).toHaveTextContent(/available/);
    expect(screen.getByText(/only programs it starts itself/i)).toBeInTheDocument();
    expect(screen.getByText(/never touches your other windows/i)).toBeInTheDocument();
    expect(await screen.findByText(/launch · Notes/)).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: /Allow text read from the screen to be given to workers that use cloud models/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(api.ext.desktop.cloudScreenText).toBe(true));
  });
});
