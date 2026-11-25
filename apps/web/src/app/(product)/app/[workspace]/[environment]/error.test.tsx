import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import PageError from "./error";

test("offers a retry and is announced", () => {
  const retry = vi.fn();
  render(<PageError retry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("didn't load");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});
