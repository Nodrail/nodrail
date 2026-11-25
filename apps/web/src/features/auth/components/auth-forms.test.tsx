import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConfirmForm } from "./confirm-form";
import { SignInForm } from "./sign-in-form";

const state = vi.hoisted(() => ({ current: { status: "idle" } }));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => [state.current, vi.fn(), false],
}));
vi.mock("../actions", () => ({
  requestSignInLink: vi.fn(),
  confirmSignIn: vi.fn(),
}));

describe("SignInForm", () => {
  beforeEach(() => {
    state.current = { status: "idle" };
  });

  test("labels the field and carries the return path", () => {
    const { container } = render(
      <SignInForm next="/app/acme" submitLabel="Send" />,
    );
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(container.querySelector('input[name="next"]')).toHaveValue(
      "/app/acme",
    );
  });

  test("ties an error to the field", () => {
    state.current = { status: "invalid" };
    render(<SignInForm next="/app" submitLabel="Send" />);
    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter a valid email address.");
  });

  test("never says whether the address has an account", () => {
    state.current = { status: "sent" };
    render(<SignInForm next="/app" submitLabel="Send" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "If that address is eligible",
    );
  });

  test("the confirmation is a region from the start, and takes the focus", () => {
    const { rerender } = render(<SignInForm next="/app" submitLabel="Send" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    state.current = { status: "sent" };
    rerender(<SignInForm next="/app" submitLabel="Send" />);
    expect(screen.getByRole("status")).toHaveFocus();
  });
});

describe("ConfirmForm", () => {
  beforeEach(() => {
    state.current = { status: "idle" };
  });

  test("needs a deliberate click and submits the token", () => {
    const { container } = render(<ConfirmForm token="abc" />);
    expect(
      screen.getByRole("button", { name: "Continue to Nodrail" }),
    ).toBeEnabled();
    expect(container.querySelector('input[name="token"]')).toHaveValue("abc");
  });

  test("offers a new link when it fails", () => {
    state.current = { status: "failed" };
    render(<ConfirmForm token="abc" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "expired or was already used",
    );
    expect(
      screen.getByRole("link", { name: "Get a new link" }),
    ).toHaveAttribute("href", "/login");
  });
});
