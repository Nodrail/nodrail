import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DecisionField } from "./decision-field";
import { PublishPreview } from "./publish-preview";
import { Suggestions, stepAgentHint } from "./suggestions";
import { YamlGroupBar } from "./yaml-group-bar";

describe("DecisionField", () => {
  test("a new rule has no decision until one is chosen, each explained", () => {
    render(
      <form>
        <DecisionField />
      </form>,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([
      "allow",
      "deny",
    ]);
    for (const radio of radios) {
      expect(radio).not.toBeChecked();
      expect(radio).toBeRequired();
    }
    // A rule only allows or denies: nothing waits for a person.
    expect(screen.queryByRole("radio", { name: /review/i })).toBeNull();
    expect(
      screen.getByRole("radio", { name: "Deny" }),
    ).toHaveAccessibleDescription("Each call is refused. Nobody is asked.");
  });

  test("an existing rule keeps its decision", () => {
    render(<DecisionField initial="deny" />);
    expect(screen.getByRole("radio", { name: "Deny" })).toBeChecked();
  });
});

describe("PublishPreview", () => {
  test("says it publishes at once, the rule's sentence, and its impact", () => {
    render(
      <PublishPreview
        kind="rule"
        environmentName="Production"
        summary="Allows every agent to run a.b on c in Production, until revoked."
        state={{
          status: "ready",
          impact: {
            days: 7,
            actions: 5,
            sampled: false,
            matched: 2,
            changed: 1,
            runs: 0,
            withoutRun: 0,
          },
        }}
      />,
    );
    expect(screen.getByText(/publishes to Production at once/)).toBeVisible();
    expect(screen.getByText(/^Allows every agent/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Of 5 actions in the last 7 days, it would have matched 2; 1 action would have been decided differently.",
    );
  });

  test("asks for a decision first, and says when the check is running", () => {
    render(
      <PublishPreview
        kind="rule"
        environmentName="Development"
        summary={null}
        state={{ status: "checking" }}
      />,
    );
    expect(screen.getByText(/Choose a decision/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/Checking/);
  });
});

describe("suggestions", () => {
  test("offers names in a datalist, and none when there are none", () => {
    const { container, rerender } = render(
      <Suggestions id="ops" values={["github.issues.list"]} />,
    );
    expect(container.querySelector("datalist#ops option")).toHaveAttribute(
      "value",
      "github.issues.list",
    );
    rerender(<Suggestions id="ops" values={[]} />);
    expect(container.querySelector("datalist")).toBeNull();
  });

  test("warns about step agents that never reported, without blocking", () => {
    expect(stepAgentHint("qa", ["qa", "dev"], "Hint")).toBe("Hint");
    render(<p>{stepAgentHint("qa-agent", ["qa"])}</p>);
    expect(screen.getByText(/No step agent called/)).toHaveTextContent(
      "No step agent called “qa-agent” has reported in this environment.",
    );
  });
});

describe("YamlGroupBar", () => {
  test("a button per group that says whether it is open and folds it", () => {
    const onToggle = vi.fn();
    render(
      <YamlGroupBar
        controls="editor"
        onToggle={onToggle}
        groups={[
          { kind: "rule", label: "Rules", count: 2, folded: false },
          { kind: "gate", label: "Gates", count: 1, folded: true },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "Fold groups" });
    expect(group).toBeVisible();
    const rules = screen.getByRole("button", { name: "Rules · 2" });
    expect(rules).toHaveAttribute("aria-expanded", "true");
    expect(rules).toHaveAttribute("aria-controls", "editor");
    expect(screen.getByRole("button", { name: "Gates · 1" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(rules);
    expect(onToggle).toHaveBeenCalledWith("rule");
  });
});
