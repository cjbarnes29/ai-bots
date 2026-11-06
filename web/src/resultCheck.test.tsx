import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultCheck } from "./components/ResultCheck";

function show(body: unknown, status = 200, finished = true) {
  vi.stubGlobal("fetch", (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ResultCheck taskId="t1" finished={finished} />
    </QueryClientProvider>,
  );
}
const v = (status: string, summary: string, checks: unknown[] = [], evidence = 0) => ({ verification: { status, summary, evidence, tasks: 1, checks } });

describe("Result check panel", () => {
  it("says a text answer is NOT checked (never 'verified')", async () => {
    show(v("unverified", "Finished, but there is nothing the platform can check."));
    expect(await screen.findByText("Not checked: the agent's own words")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed by the platform")).not.toBeInTheDocument();
  });
  it("shows confirmed results with what was checked", async () => {
    show(v("verified", "Checked against the platform's own record.", [{ kind: "action_executed", outcome: "pass", detail: "telegram.send_message was approved and ran" }], 1));
    expect(await screen.findByText("Confirmed by the platform")).toBeInTheDocument();
    expect(screen.getByText("What was checked (1)")).toBeInTheDocument();
    expect(screen.getByText(/telegram.send_message was approved and ran/)).toBeInTheDocument();
  });
  it("warns loudly when the record contradicts the reply", async () => {
    show(v("contradicted", "Do not rely on this result: the reply says it sent an email but no send action was recorded.", [{ kind: "claim_unsupported", outcome: "fail", detail: "no send action was recorded" }]));
    expect(await screen.findByText("Contradicted: do not rely on it")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Do not rely on this result/);
  });
  it("shows waiting for approval", async () => {
    show(v("waiting", "An outside action is still waiting for your approval."));
    expect(await screen.findByText("Waiting for your approval")).toBeInTheDocument();
  });
  it("shows nothing while the task is running, when there is nothing to check, or when the check cannot load", async () => {
    show(v("unverified", "x"), 200, false);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: "Result check" })).not.toBeInTheDocument();
  });
  it("shows nothing when the check fails to load", async () => {
    show({ error: "x" }, 500);
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByRole("region", { name: "Result check" })).not.toBeInTheDocument();
  });
});
