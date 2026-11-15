import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./components/ConfirmDialog";

function Harness({ busy = false, confirm = () => {} }: { busy?: boolean; confirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Review request</button>{open && <ConfirmDialog title="Review synthetic request" confirmLabel="Confirm request" busy={busy} onCancel={() => setOpen(false)} onConfirm={confirm}><a href="#details">Read details</a><p>{"Synthetic exact content. ".repeat(300)}</p></ConfirmDialog>}</>;
}
describe("confirmation keyboard and viewport contract", () => {
  it("focuses Cancel, traps both Tab directions and restores the opener", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Review request" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Review synthetic request" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    within(dialog).getByRole("button", { name: "Confirm request" }).focus();
    await user.tab();
    expect(within(dialog).getByRole("link")).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Confirm request" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  it("does not confirm by opening or cancelling, and keeps busy buttons disabled", async () => {
    const confirm = vi.fn();
    render(<Harness busy confirm={confirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Review request" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Confirm request" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}"); // retains existing Escape/cancel policy
    expect(confirm).not.toHaveBeenCalled();
  });
  it("does not reset focus when the parent rerenders with a fresh cancel callback", async () => {
    const confirm = vi.fn();
    const view = render(<Harness confirm={confirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Review request" }));
    const button = screen.getByRole("button", { name: "Confirm request" });
    button.focus();
    view.rerender(<Harness confirm={confirm} />);
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("yields keyboard events to an owner-proof modal without cancelling the underlying request", async () => {
    const cancel = vi.fn();
    render(<><div role="dialog" aria-modal="true" aria-label="Owner proof"><input aria-label="Proof input" /><button>Proof next</button></div><ConfirmDialog title="Underlying confirmation" confirmLabel="Do it" onCancel={cancel} onConfirm={() => {}}>Synthetic request</ConfirmDialog></>);
    screen.getByRole("textbox", { name: "Proof input" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Proof next" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Underlying confirmation" })).toBeInTheDocument();
  });
});
