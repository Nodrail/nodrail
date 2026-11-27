import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FirstCheckWaiting } from "./first-check-waiting";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  vi.useRealTimers();
  router.refresh.mockClear();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

test("refreshes until the one-minute deadline and shows what to do next", () => {
  vi.useFakeTimers();
  render(<FirstCheckWaiting />);
  expect(screen.getByRole("status")).toHaveTextContent("Waiting");
  advance(2000);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  advance(58_000);
  expect(router.refresh).toHaveBeenCalledTimes(29);
  expect(screen.getByRole("status")).toHaveTextContent("refresh this page");
  advance(10_000);
  expect(router.refresh).toHaveBeenCalledTimes(29);
});

test("cleans up the timers when the matching decision replaces the waiting view", () => {
  vi.useFakeTimers();
  const { unmount } = render(<FirstCheckWaiting />);
  advance(2000);
  unmount();
  advance(60_000);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
