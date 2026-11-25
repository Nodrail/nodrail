import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LiveRefresh, isBusy } from "./live";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a live page", () => {
  test("refreshes every 20 seconds and when the window regains focus", () => {
    render(<LiveRefresh />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("waits while a decision is under way", () => {
    render(
      <>
        <LiveRefresh />
        <div role="dialog" aria-label="Request" />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("is busy while someone types or a row leaves", () => {
    document.body.innerHTML = `<input id="field" /><ul><li data-leaving></li></ul>`;
    expect(isBusy()).toBe(true);
    document.body.innerHTML = `<input id="field" />`;
    expect(isBusy()).toBe(false);
    document.getElementById("field")?.focus();
    expect(isBusy()).toBe(true);
  });
});
