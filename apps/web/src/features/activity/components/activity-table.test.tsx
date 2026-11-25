import { render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/app/toast";
import type { ActivityEventDto } from "@/contracts/v1/activity";
import { ActivityTable } from "./activity-table";

const decided: ActivityEventDto = {
  id: "e1",
  occurredAt: new Date().toISOString(),
  code: "denied_by_rule",
  group: "decision",
  outcome: "denied",
  label: "Denied by rule",
  actor: { kind: "runtime", name: null },
  agentKey: "support",
  action: {
    toolKey: "github",
    operationKey: "issues.delete",
    resourceKind: "issue",
    resource: "acme/support#1",
    installationName: "support-dev",
    run: null,
    reference: "REQ-ABCDEF12",
  },
  environment: "Development",
  rule: null,
  subject: null,
  detail: null,
  latestReport: null,
};

const change: ActivityEventDto = {
  ...decided,
  id: "e2",
  code: "rule_create",
  group: "change",
  outcome: "informational",
  label: "Rule created",
  action: null,
  agentKey: null,
  rule: { kind: "rule", id: "r1", name: "Read issues", revision: 4 },
};

const hrefFor = (id: string) => `/a?event=${id}`;

const row = (name: string) => {
  const cell = screen.getByRole("link", { name }).closest("tr");
  if (!cell) throw new Error("no row");
  return within(cell);
};

describe("ActivityTable", () => {
  test("a click on the title or the row opens the panel", () => {
    const onOpen = vi.fn();
    render(
      <ActivityTable hrefFor={hrefFor} items={[decided]} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByRole("link", { name: "github.issues.delete" }));
    fireEvent.click(screen.getByText("acme/support#1"));
    expect(onOpen.mock.calls).toEqual([["e1"], ["e1"]]);
  });

  test("a modified click keeps the link's own behaviour", () => {
    const onOpen = vi.fn();
    // jsdom cannot open another document, so the browser's part stops here.
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop);
    render(
      <ActivityTable hrefFor={hrefFor} items={[decided]} onOpen={onOpen} />,
    );
    fireEvent.click(
      screen.getByRole("link", { name: "github.issues.delete" }),
      { metaKey: true },
    );
    window.removeEventListener("click", stop);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("links each event to its panel", () => {
    render(<ActivityTable hrefFor={hrefFor} items={[decided]} />);
    expect(
      screen.getByRole("link", { name: "github.issues.delete" }),
    ).toHaveAttribute("href", "/a?event=e1");
  });

  test("a report sits beside the decision, never replacing it", () => {
    render(
      <ActivityTable
        hrefFor={hrefFor}
        items={[
          {
            ...decided,
            latestReport: {
              outcome: "success",
              receivedAt: new Date().toISOString(),
              mismatch: false,
            },
          },
        ]}
      />,
    );
    const cells = row("github.issues.delete");
    expect(cells.getByText("Denied by rule")).toBeInTheDocument();
    expect(cells.getByText("Client reported success")).toBeInTheDocument();
    expect(cells.getByText("From integration")).toBeInTheDocument();
    expect(
      cells.queryByText("Report doesn't match decision"),
    ).not.toBeInTheDocument();
  });

  test("flags a report of an action Nodrail never allowed", () => {
    render(
      <ActivityTable
        hrefFor={hrefFor}
        items={[
          {
            ...decided,
            latestReport: {
              outcome: "success",
              receivedAt: new Date().toISOString(),
              mismatch: true,
            },
          },
        ]}
      />,
    );
    expect(
      row("github.issues.delete").getByText("Report doesn't match decision"),
    ).toBeInTheDocument();
  });

  test("says when an action has no report", () => {
    render(<ActivityTable hrefFor={hrefFor} items={[decided]} />);
    expect(
      row("github.issues.delete").getByText("Not reported"),
    ).toBeInTheDocument();
  });

  test("each row's ⋯ menu leads on from the event, without opening it", async () => {
    const onOpen = vi.fn();
    render(
      <ToastProvider>
        <ActivityTable
          hrefFor={hrefFor}
          items={[decided]}
          onOpen={onOpen}
          menu={{
            base: "/app/acme/development",
            agentHref: (agent) =>
              `/app/acme/development/activity?agent=${agent}`,
          }}
        />
      </ToastProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Actions for github.issues.delete",
      }),
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "View details",
      "Filter by this agent",
      "Copy request ID",
    ]);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "View details" }),
    );
    expect(onOpen).toHaveBeenCalledWith("e1");
  });

  test("a change names its rule and needs no report", () => {
    render(<ActivityTable hrefFor={hrefFor} items={[change]} />);
    const cells = row("Read issues");
    expect(cells.getByText("Policy set v4")).toBeInTheDocument();
    expect(cells.queryByText("Not reported")).not.toBeInTheDocument();
  });
});
