import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Problem } from "../yaml-lint";
import { PolicyProblems, problemSummary } from "./policy-problems";

const error: Problem = {
  line: 4,
  column: 3,
  message: 'Unknown list "nope".',
  severity: "error",
  from: "editor",
};
const warning: Problem = {
  line: 1,
  column: 3,
  message: 'List "tools" is not used.',
  severity: "warning",
  from: "server",
};

describe("PolicyProblems", () => {
  test("counts errors and warnings", () => {
    expect(problemSummary([])).toBe("No problems");
    expect(problemSummary([error])).toBe("1 error");
    expect(problemSummary([error, error, warning])).toBe("2 errors, 1 warning");
  });

  test("lists each problem with its line, and says none when clean", () => {
    const { rerender } = render(
      <PolicyProblems id="p" problems={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Problems · No problems",
    );
    expect(screen.queryByRole("list")).toBeNull();

    rerender(
      <PolicyProblems id="p" problems={[error, warning]} onSelect={vi.fn()} />,
    );
    const items = screen.getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Line 4:3Unknown list "nope".');
    expect(items[1]).toHaveTextContent("· review");
    expect(screen.getByRole("region", { name: "Problems" })).toHaveAttribute(
      "id",
      "p",
    );
  });

  test("choosing a problem jumps to it", () => {
    const onSelect = vi.fn();
    render(<PolicyProblems id="p" problems={[error]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Line 4:3/ }));
    expect(onSelect).toHaveBeenCalledWith(error);
  });
});
