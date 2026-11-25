import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "@nodrail/web-shared/logo";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

describe("Logo", () => {
  it("names the horizontal logo", () => {
    render(<Logo />);
    expect(screen.getByRole("img", { name: "nodrail" })).toHaveAttribute(
      "src",
      "/brand/horizontal-primary.svg",
    );
  });

  it("treats the symbol as decorative unless given alt text", () => {
    const { container, rerender } = render(<Logo variant="symbol" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    rerender(<Logo variant="symbol" alt="Nodrail symbol" />);
    expect(screen.getByAltText("Nodrail symbol")).toBeInTheDocument();
  });

  it("forwards image props", () => {
    render(<Logo className="logo" width="10" />);
    const logo = screen.getByRole("img");
    expect(logo).toHaveClass("logo");
    expect(logo).toHaveAttribute("width", "10");
  });
});

describe("Button", () => {
  it("defaults to the default variant and size", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveAttribute("data-size", "default");
  });

  it("merges custom classes over variant classes", () => {
    render(<Button className="px-9">Save</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("px-9");
    expect(button).not.toHaveClass("px-4");
  });

  it("renders its child element with asChild", () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute(
      "data-slot",
      "button",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Input", () => {
  it("forwards native attributes", () => {
    render(<Input type="email" aria-label="Email" disabled />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toBeDisabled();
  });
});
