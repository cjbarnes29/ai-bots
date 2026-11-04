import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { createFakeApi, makeBot } from "./test/fakeApi";

function renderApp(api: { fetch: typeof fetch }, path = "/settings/ai-models") {
  vi.stubGlobal("fetch", api.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
}

async function loaded() {
  await screen.findByText("Automatic routing is on");
  return within(screen.getByRole("region", { name: "Model routing" }));
}

describe("Settings: model routing", () => {
  it("explains the rules in plain words and shows what would be chosen", async () => {
    const api = createFakeApi();
    api.llm.routingPreview = [
      { ref: "groq/llama-3.3-70b", providerId: "groq", displayName: "llama", score: 2, local: false },
      { ref: "ollama/llama3.2:3b", providerId: "ollama", displayName: "l", score: 1, local: true },
    ];
    renderApp(api);
    const section = await loaded();
    expect(section.getByText(/never uses a paid model, never goes around a limit/)).toBeInTheDocument();
    expect(section.getByText("groq/llama-3.3-70b → ollama/llama3.2:3b")).toBeInTheDocument();
    expect(section.getAllByText("no eligible free model yet", { selector: "span" })).toHaveLength(3); // the other kinds of task
  });

  it("changes a setting straight away and rejects nonsense from the server with a message", async () => {
    const api = createFakeApi();
    renderApp(api);
    const section = await loaded();
    const local = section.getByRole("switch", { name: /Prefer local Ollama models/ });
    expect(local).toHaveAttribute("aria-checked", "false");
    await userEvent.click(local);
    await waitFor(() => expect(api.llm.routing.preferLocal).toBe(true));
    await userEvent.selectOptions(section.getByLabelText("Models to try per task"), "5");
    await waitFor(() => expect(api.llm.routing.maxAttempts).toBe(5));
    expect(api.writes().every((w) => w.headers["x-awp-client"] === "dashboard")).toBe(true);
  });

  it("can limit routing to chosen providers", async () => {
    const api = createFakeApi();
    renderApp(api);
    const section = await loaded();
    await userEvent.click(section.getByRole("checkbox", { name: "Groq" }));
    await waitFor(() => expect(api.llm.routing.allowedProviders).toEqual(["groq"]));
  });

  it("one button gives automatic routing to bots without a model, and says how many", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "A", model: null }), makeBot({ id: "b2", name: "B", model: "groq/x" })]);
    renderApp(api);
    const section = await loaded();
    await userEvent.click(section.getByRole("button", { name: /Use automatic routing for bots that have no model/ }));
    expect(await section.findByText("1 bot now use automatic routing.")).toBeInTheDocument();
  });

  it("shows provider health", async () => {
    renderApp(createFakeApi());
    const health = await screen.findByRole("listitem", { name: "Health of Google Gemini" });
    expect(health).toHaveTextContent(/switched off|ready|no key/);
  });

  it("a bot can be set to Automatic from its Details tab", async () => {
    const api = createFakeApi([makeBot({ id: "b1", name: "A", model: null })]);
    renderApp(api, "/bots/b1");
    const select = await screen.findByLabelText(/Model/i);
    expect(within(select).getByRole("option", { name: "Automatic: coding" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "auto/coding");
    expect((select as HTMLSelectElement).value).toBe("auto/coding");
  });
});
