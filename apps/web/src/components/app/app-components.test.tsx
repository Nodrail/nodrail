import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";
import { FormField } from "./form-field";
import { SecretReveal } from "./secret-reveal";
import { StatusBadge } from "./status-badge";
import { ToastProvider } from "./toast";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe("FormField", () => {
  test("connects its label, hint and error", () => {
    render(<FormField id="x" label="Agent ID" hint="Stable" error="Taken" />);
    const input = screen.getByLabelText("Agent ID");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Taken Stable");
  });

  test("is plain without one", () => {
    render(<FormField id="x" label="Name" />);
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});

describe("StatusBadge", () => {
  test("carries its meaning in text as well as colour", () => {
    render(<StatusBadge tone="warning">Stale</StatusBadge>);
    expect(screen.getByText("Stale")).toHaveAttribute("data-tone", "warning");
  });
});

describe("ConfirmDialog", () => {
  const setup = (
    action = vi.fn().mockResolvedValue({ status: "ok", message: "Done." }),
  ) => {
    const onSuccess = vi.fn();
    render(
      <ToastProvider>
        <ConfirmDialog
          title="Pause agent?"
          triggerLabel="Pause"
          confirmLabel="Confirm"
          action={action}
          onSuccess={onSuccess}
        >
          <p>Consequences</p>
        </ConfirmDialog>
      </ToastProvider>,
    );
    return { action, onSuccess };
  };

  test("does nothing until confirmed", async () => {
    const { action } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(action).not.toHaveBeenCalled();
  });

  test("closes and reports on success", async () => {
    const { action, onSuccess } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(action).toHaveBeenCalledOnce();
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  test("stays open and explains a failure", async () => {
    setup(
      vi.fn().mockResolvedValue({ status: "error", message: "No access." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByRole("alert", { hidden: true }),
    ).toHaveTextContent("No access.");
  });
});

describe("SecretReveal", () => {
  test("warns it is shown once and copies the value", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    render(<SecretReveal label="Key" secret="ndr_abc" />);
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();
    expect(screen.getByLabelText("Key")).toHaveTextContent("ndr_abc");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("ndr_abc");
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  test("says so when copying is not allowed", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("no"),
    );
    render(<SecretReveal label="Key" secret="x" />);
    await act(() => user.click(screen.getByRole("button", { name: "Copy" })));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });
});
