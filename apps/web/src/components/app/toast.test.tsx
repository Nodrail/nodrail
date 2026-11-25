import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ToastProvider,
  toastDuration,
  useToast,
  type ToastTone,
} from "./toast";

let show: (message: string, tone?: ToastTone) => void = () => undefined;

function Grab() {
  show = useToast();
  return null;
}

const region = () => screen.getByRole("status");
const say = (message: string, tone?: ToastTone) =>
  act(() => show(message, tone));
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const closing = () => region().querySelectorAll("[data-state=closed]").length;

describe("toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
  });
  afterEach(() => vi.useRealTimers());

  test("a longer message stays longer", () => {
    expect(toastDuration("Saved.")).toBeLessThan(
      toastDuration("Exported the newest 1000 events. Narrow the filters."),
    );
    expect(toastDuration("x".repeat(1000))).toBe(15000);
  });

  test("leaves on its own once read", () => {
    say("Saved.");
    wait(toastDuration("Saved.") - 1);
    expect(closing()).toBe(0);
    wait(1);
    expect(closing()).toBe(1);
  });

  test("waits while the pointer or focus is on it", () => {
    say("Saved.");
    fireEvent.mouseEnter(region());
    wait(60_000);
    expect(closing()).toBe(0);
    fireEvent.mouseLeave(region());
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).focus();
    });
    wait(60_000);
    expect(closing()).toBe(0);
  });

  test("an error stays until dismissed", () => {
    say("Couldn't copy.", "error");
    wait(60_000);
    expect(region()).toHaveTextContent("Couldn't copy.");
    expect(closing()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(closing()).toBe(1);
  });

  test("messages stack instead of replacing each other", () => {
    say("Allowed once.");
    say("Denied.");
    expect(region()).toHaveTextContent("Allowed once.");
    expect(region()).toHaveTextContent("Denied.");
    say("Denied.");
    expect(region().querySelectorAll("[data-state=open]")).toHaveLength(2);
    say("Paused.");
    say("Resumed.");
    expect(region().querySelectorAll("[data-state=open]")).toHaveLength(3);
  });
});
