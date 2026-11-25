import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  activityQuery,
  type ActivityQuery,
} from "@/contracts/v1/activity-query";
import {
  ActivityFilters,
  SEARCH_DELAY_MS,
  filterCount,
} from "./activity-filters";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const base: ActivityQuery = activityQuery.parse({});
const show = (query: ActivityQuery = base) => (
  <ActivityFilters path="/a" query={query} agents={["billing", "support"]} />
);
const search = () => screen.getByLabelText("Search activity");

beforeEach(() => replace.mockClear());

describe("ActivityFilters", () => {
  test("the list follows typing once it pauses, or at once on Enter", () => {
    vi.useFakeTimers();
    try {
      render(show());
      fireEvent.change(search(), { target: { value: "  deploy " } });
      expect(replace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(SEARCH_DELAY_MS);
      });
      expect(replace).toHaveBeenCalledWith("/a?q=deploy");
      replace.mockClear();
      fireEvent.change(search(), { target: { value: "release" } });
      fireEvent.submit(screen.getByRole("search"));
      expect(replace).toHaveBeenCalledWith("/a?q=release");
    } finally {
      vi.useRealTimers();
    }
  });

  test("counts the filters that narrow the list, for the phone's button", () => {
    expect(filterCount(base, "events")).toBe(0);
    expect(
      filterCount(
        { ...base, agent: "a", outcome: "denied", kind: "reports", q: "x" },
        "events",
      ),
    ).toBe(3);
    expect(filterCount({ ...base, kind: "reports", run: "r" }, "runs")).toBe(0);
  });

  test("a dropdown keeps the other filters and drops the page", () => {
    render(show({ ...base, q: "x", outcome: "denied", cursor: "c" }));
    fireEvent.change(screen.getByLabelText("Event kind"), {
      target: { value: "reports" },
    });
    expect(replace).toHaveBeenCalledWith("/a?kind=reports&outcome=denied&q=x");
  });

  test("clear empties the search and the URL", () => {
    render(show({ ...base, q: "x", kind: "changes", agent: "support" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(search()).toHaveValue("");
    expect(replace).toHaveBeenCalledWith("/a");
  });

  test("a slow reply to clear doesn't erase what was typed since", () => {
    const { rerender } = render(show({ ...base, q: "old" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.change(search(), { target: { value: "next" } });
    act(() => rerender(show(base)));
    expect(search()).toHaveValue("next");
  });

  test("follows the URL when it changes from elsewhere", () => {
    const { rerender } = render(show({ ...base, q: "old" }));
    act(() => rerender(show({ ...base, q: "new" })));
    expect(search()).toHaveValue("new");
  });

  test("keeps unsaved typing when only the dropdowns change", () => {
    const { rerender } = render(show());
    fireEvent.change(search(), { target: { value: "typing" } });
    act(() => rerender(show({ ...base, kind: "changes" })));
    expect(search()).toHaveValue("typing");
  });

  test("each shared filter goes into the URL", () => {
    render(show());
    fireEvent.change(screen.getByLabelText("Agent"), {
      target: { value: "support" },
    });
    expect(replace).toHaveBeenLastCalledWith("/a?agent=support");
    fireEvent.change(screen.getByLabelText("Outcome"), {
      target: { value: "held" },
    });
    expect(replace).toHaveBeenLastCalledWith("/a?outcome=held");
    fireEvent.change(screen.getByLabelText("Time range"), {
      target: { value: "24h" },
    });
    expect(replace).toHaveBeenLastCalledWith("/a?range=24h");
  });

  test("an agent in the link is offered even if it isn't listed", () => {
    render(show({ ...base, agent: "ghost" }));
    expect(screen.getByLabelText("Agent")).toHaveValue("ghost");
  });

  test("the run filter shows the run by name and can be removed", () => {
    render(
      <ActivityFilters
        path="/a"
        query={{ ...base, run: "r1", outcome: "denied" }}
        runKey="feat/x"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run feat/x: show every run" }),
    );
    expect(replace).toHaveBeenCalledWith("/a?outcome=denied");
  });

  test("runs have no kind or run filter, and stay on runs", () => {
    render(
      <ActivityFilters path="/a" view="runs" query={{ ...base, run: "r1" }} />,
    );
    expect(screen.queryByLabelText("Event kind")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Run / })).toBeNull();
    fireEvent.change(screen.getByLabelText("Outcome"), {
      target: { value: "held" },
    });
    expect(replace).toHaveBeenCalledWith("/a?view=runs&outcome=held");
  });
});
