import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "./App";
import { ModelSelect } from "./components/ModelSelect";
import type { ModelView } from "./api/types";
import { createFakeApi } from "./test/fakeApi";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TESTS = (done: string[]) =>
  ["connectivity", "instruction", "json_output", "identity_instruction", "history", "action_format"].map((test) => ({
    test,
    label: { connectivity: "Connectivity", instruction: "Follows a simple instruction", json_output: "Structured JSON output", identity_instruction: "Keeps its identity and the owner's rule (system instructions)", history: "Remembers the conversation", action_format: "Writes a valid outside-action block" }[test]!,
    core: ["connectivity", "instruction", "json_output"].includes(test),
    ...(done.includes(test) ? { result: "pass", source: "real", at: "2026-11-04T22:47:46Z", detail: "ok", latencyMs: 594 } : { result: "untested", source: null, at: null, detail: "Not tested yet", latencyMs: null }),
  }));
const base = {
  chatCapable: true,
  inCatalog: true,
  enabled: true,
  availability: "available",
  modalities: { input: ["text"], output: ["text"] },
  basis: "x",
  maxOutputTokens: null,
  providerOperations: null,
  limitations: [] as string[],
  failures: {},
  usage: { requests: 0, ok: 0, errors: 0, avgLatencyMs: null, lastAt: null },
  cooldownSeconds: 0,
  lastSeenAt: null,
  suggestedReplacement: null,
  retired: null,
  missingTests: [] as string[],
  suitability: [{ task: "General chat and tasks", ok: true, basis: "Reasoning" }, { task: "Structured JSON output", ok: true, basis: "tested" }, { task: "Bot instructions and identity (system prompt)", ok: false, basis: "not tested" }],
};
const sample = () => [
  { ...base, ref: "groq/openai/gpt-oss-20b", providerId: "groq", providerName: "Groq", modelId: "openai/gpt-oss-20b", displayName: "gpt-oss-20b", kind: "reasoning", kindLabel: "Reasoning", status: "verified", reasons: [], routable: true, contextWindow: 131072, tests: TESTS(["connectivity", "instruction", "json_output"]), lastVerifiedAt: "2026-11-04T22:47:55Z", usage: { requests: 2, ok: 2, errors: 0, avgLatencyMs: 577, lastAt: "2026-11-04T22:47:55Z" }, limitations: ["System-role / identity, history and action-block tests have not been run for this model yet"] },
  { ...base, ref: "gemini/gemini-flash-x", providerId: "gemini", providerName: "Google Gemini", modelId: "gemini-flash-x", displayName: "gemini-flash-x", kind: "vision_chat", kindLabel: "Chat with picture input", status: "unverified", reasons: ["Not tested yet: Connectivity, Follows a simple instruction, Structured JSON output."], routable: false, contextWindow: 1000000, tests: TESTS([]), lastVerifiedAt: null, missingTests: ["connectivity", "instruction", "json_output"] },
  { ...base, ref: "gemini/gemini-2.5-flash", providerId: "gemini", providerName: "Google Gemini", modelId: "gemini-2.5-flash", displayName: "gemini-2.5-flash", kind: "vision_chat", kindLabel: "Chat with picture input", status: "unavailable", reasons: ["Retired: Google answered (HTTP 404): this model is no longer available to new users. Please use models/gemini-3.8-flash. It returns only after a refresh lists it again and a real connectivity test passes."], routable: false, retired: { at: "2026-11-04T22:47:33Z", reason: "Google answered (HTTP 404)" }, suggestedReplacement: "gemini-3.8-flash", tests: TESTS([]), lastVerifiedAt: null },
  { ...base, ref: "gemini/gemini-3.5-transcribe", providerId: "gemini", providerName: "Google Gemini", modelId: "gemini-3.5-transcribe", displayName: "gemini-3.5-transcribe", kind: "transcription", kindLabel: "Transcription", chatCapable: false, inCatalog: false, status: "unavailable", reasons: ["Not a chat model: Transcription (id names a transcription model)."], routable: false, tests: TESTS([]) },
];

let api: ReturnType<typeof createFakeApi>;
function renderPage() {
  api = createFakeApi();
  api.llm.registry = sample();
  vi.stubGlobal("fetch", api.fetch);
  const router = createMemoryRouter(routes, { initialEntries: ["/settings/ai-models"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("Model registry (Settings > AI Models)", () => {
  it("shows every discovered model with its provider, exact id, kind and status, and the counts", async () => {
    renderPage();
    const region = within(await screen.findByRole("region", { name: "Model registry" }));
    expect(await region.findByRole("button", { name: "All (4)" })).toBeInTheDocument();
    expect(region.getByRole("button", { name: "Verified (1)" })).toBeInTheDocument();
    expect(region.getByRole("button", { name: "Unverified (1)" })).toBeInTheDocument();
    expect(region.getByRole("button", { name: "Unavailable (2)" })).toBeInTheDocument();
    expect(region.getByRole("button", { name: "Not chat models (1)" })).toBeInTheDocument();
    const card = region.getByRole("listitem", { name: "groq/openai/gpt-oss-20b" });
    expect(within(card).getByText("Verified")).toBeInTheDocument();
    expect(within(card).getByText("Reasoning")).toBeInTheDocument();
    expect(within(card).getByText("131,072 tokens")).toBeInTheDocument();
    expect(within(card).getByText(/2 ok, 0 failed · about 0.6 s/)).toBeInTheDocument();
  });

  it("says why a model is not usable: unverified (what is missing), retired (and the suggested replacement), not a chat model", async () => {
    renderPage();
    const region = within(await screen.findByRole("region", { name: "Model registry" }));
    expect(await region.findByLabelText("Why gemini/gemini-flash-x is unverified")).toHaveTextContent(/Not tested yet: Connectivity/);
    const retired = region.getByRole("listitem", { name: "gemini/gemini-2.5-flash" });
    expect(within(retired).getByText("Unavailable")).toBeInTheDocument();
    expect(within(retired).getByLabelText("Why gemini/gemini-2.5-flash is unavailable")).toHaveTextContent(/Retired: Google answered/);
    expect(within(retired).getByText("gemini-3.8-flash")).toBeInTheDocument();
    const nonChat = region.getByRole("listitem", { name: "gemini/gemini-3.5-transcribe" });
    expect(within(nonChat).getByText("Transcription")).toBeInTheDocument();
    expect(within(nonChat).getByLabelText(/Why gemini\/gemini-3.5-transcribe is unavailable/)).toHaveTextContent(/Not a chat model: Transcription/);
    expect(within(nonChat).queryByRole("button", { name: /Run tests/ })).toBeNull(); // a speech model is never tested as a chat model
  });

  it("filters by status, by non-chat models and by provider", async () => {
    const user = userEvent.setup();
    renderPage();
    const region = within(await screen.findByRole("region", { name: "Model registry" }));
    await region.findByRole("button", { name: "All (4)" });
    await user.click(region.getByRole("button", { name: "Verified (1)" }));
    expect(region.getAllByRole("listitem", { name: /\// })).toHaveLength(1);
    await user.click(region.getByRole("button", { name: "Unavailable (2)" }));
    expect(region.getByRole("listitem", { name: "gemini/gemini-2.5-flash" })).toBeInTheDocument();
    await user.click(region.getByRole("button", { name: "Not chat models (1)" }));
    expect(region.queryByRole("listitem", { name: "gemini/gemini-2.5-flash" })).toBeNull();
    expect(region.getByRole("listitem", { name: "gemini/gemini-3.5-transcribe" })).toBeInTheDocument();
    await user.click(region.getByRole("button", { name: "All (4)" }));
    await user.selectOptions(region.getByRole("combobox", { name: "Provider" }), "groq");
    expect(region.getAllByRole("listitem", { name: /\// })).toHaveLength(1);
  });

  it("lists each test with its result and source, what the model is suitable for, and its recorded limits", async () => {
    const user = userEvent.setup();
    renderPage();
    const region = within(await screen.findByRole("region", { name: "Model registry" }));
    const card = within(await region.findByRole("listitem", { name: "groq/openai/gpt-oss-20b" }));
    await user.click(card.getByText("Tests, suitability and limits"));
    const tests = within(card.getByLabelText("Tests for groq/openai/gpt-oss-20b"));
    expect(tests.getByText(/Structured JSON output/).closest("li")).toHaveTextContent(/passed · real/);
    expect(tests.getByText(/Writes a valid outside-action block/).closest("li")).toHaveTextContent(/not tested/);
    expect(within(card.getByLabelText("Suitable for groq/openai/gpt-oss-20b")).getByText(/Bot instructions and identity/).closest("li")).toHaveTextContent(/not tested/);
    expect(card.getByText(/have not been run for this model yet/)).toBeInTheDocument();
  });

  it("running tests asks first, says exactly how many real requests, sends only that count, and shows the results and the new status", async () => {
    const user = userEvent.setup();
    renderPage();
    const region = within(await screen.findByRole("region", { name: "Model registry" }));
    await user.click(await region.findByRole("button", { name: "Run tests on gemini/gemini-flash-x" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/5 short requests/)).toBeInTheDocument();
    expect(dialog.getByText(/use a little of the free allowance and no money/)).toBeInTheDocument();
    expect(api.llm.registryRuns).toEqual([]); // nothing was sent yet
    await user.click(dialog.getByRole("button", { name: "Send up to 5 real requests" }));
    const results = within(await screen.findByRole("status", { name: "Test results" }));
    expect(results.getByText(/5 of 5 approved requests used/)).toBeInTheDocument();
    expect(api.llm.registryRuns).toEqual([{ ref: "gemini/gemini-flash-x", tests: ["connectivity", "json_output", "identity_instruction", "history", "action_format"], approvedRequests: 5 }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Verified (2)" })).toBeInTheDocument());
  });

  it("cancelling the confirmation sends nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Run tests on gemini/gemini-flash-x" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.llm.registryRuns).toEqual([]);
  });

  it("an owner-only refusal (a phone) or a provider problem is shown, not hidden", async () => {
    const user = userEvent.setup();
    renderPage();
    api.llm.registryError = { status: 403, code: "owner_only", message: "This can only be changed on the PC." };
    await user.click(await screen.findByRole("button", { name: "Run tests on gemini/gemini-flash-x" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send up to 5 real requests" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This can only be changed on the PC.");
  });
});

describe("the bot model selector offers only models bots can use", () => {
  const mv = (over: Partial<ModelView>): ModelView => ({ id: 1, providerId: "gemini", providerName: "Google Gemini", modelId: "x", ref: "gemini/x", displayName: "x", freeStatus: "free_tier", freeSource: "", freeCheckedAt: "", contextWindow: null, enabled: true, availability: "available", isLlama: false, capabilities: {}, ownerVerified: false, ownerOverridable: false, callable: true, blockedReason: null, ...over });
  it("an unverified or retired model is greyed out with the reason; a verified one can be chosen; an existing assignment stays visible", () => {
    render(
      <MemoryRouter>
        <ModelSelect
          id="m"
          value={null}
          onChange={() => undefined}
          models={[mv({ ref: "gemini/ok", displayName: "ok", routable: true, verification: "verified" }), mv({ id: 2, ref: "gemini/new", displayName: "new", routable: false, verification: "unverified" }), mv({ id: 3, ref: "gemini/old", displayName: "old", routable: false, retired: true, callable: false, verification: "unavailable" })]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("option", { name: /^ok/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: /new.*not verified yet/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /old.*retired by the provider/ })).toBeDisabled();
  });
});
