import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { YamlLegend } from "@/features/policies/components/yaml-legend";
import { legendLooks } from "@/features/policies/entry-looks";
import { CheckboxField, ChoiceRow } from "./choice-field";
import { DataTable, DataActionsHeading, NoMatches } from "./data-table";
import { FormFooter, SaveRow, SubmitButton } from "./form-feedback";
import { CountChip, ItemList, ItemRow, ItemText } from "./item-list";
import { Callout, Note } from "./note";
import { SectionHeading } from "./section-heading";
import { StatusBadge } from "./status-badge";
import { focusRing } from "./styles";
import { TextLink } from "./text-link";
import { toneLooks } from "./tones";
import { useListSearch } from "./use-list-search";

describe("tones", () => {
  test("a badge, a note and a callout take the same tone classes", () => {
    render(
      <>
        <StatusBadge tone="info">Info</StatusBadge>
        <Note tone="info">A note</Note>
        <Callout tone="info" title="A callout">
          <p>Body</p>
        </Callout>
      </>,
    );
    for (const element of [
      screen.getByText("Info"),
      screen.getByText("A note"),
      screen.getByText("A callout").closest("[data-slot=callout]")!,
    ]) {
      expect(element).toHaveAttribute("data-tone", "info");
      expect(element).toHaveClass(...toneLooks.info.soft.split(" "));
    }
  });

  test("a note is an info box by default and plain text when asked", () => {
    render(
      <>
        <Note>Default</Note>
        <Note tone="plain">Plain</Note>
      </>,
    );
    expect(screen.getByText("Default")).toHaveAttribute("data-tone", "info");
    expect(screen.getByText("Plain")).not.toHaveClass("border");
  });
});

describe("TextLink", () => {
  test("is a link with the product's focus ring", () => {
    render(
      <TextLink href="/x" size="xs">
        See all
      </TextLink>,
    );
    const link = screen.getByRole("link", { name: "See all" });
    expect(link).toHaveAttribute("href", "/x");
    expect(link).toHaveClass(...focusRing.split(" "), "text-xs", "text-forest");
  });
});

describe("forms", () => {
  test("a submit button says what is happening while pending", () => {
    const { rerender } = render(
      <SubmitButton pending={false} pendingLabel="Saving…">
        Save
      </SubmitButton>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    rerender(
      <SubmitButton pending pendingLabel="Saving…">
        Save
      </SubmitButton>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  test("a footer shows the server's error with its buttons", () => {
    render(
      <FormFooter state={{ status: "error", message: "Taken." }}>
        <button type="submit">Go</button>
      </FormFooter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Taken.");
  });

  test("SaveRow is a footer with the save button", () => {
    render(<SaveRow state={{ status: "idle" }} pending={false} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  test("a checkbox and a radio choice are labelled by their words", async () => {
    render(
      <>
        <CheckboxField name="a" title="Email me" detail="Once a day" />
        <ChoiceRow name="b" value="x" title="Claude Code" detail="Hooks" />
      </>,
    );
    const box = screen.getByRole("checkbox", { name: /Email me/ });
    await userEvent.click(screen.getByText("Once a day"));
    expect(box).toBeChecked();
    expect(screen.getByRole("radio", { name: /Claude Code/ })).toHaveAttribute(
      "value",
      "x",
    );
  });
});

describe("lists", () => {
  test("an item list holds rows of a title and a quiet line", () => {
    render(
      <ItemList aria-label="People">
        <ItemRow>
          <ItemText title="Ada" meta="Admin" />
        </ItemRow>
      </ItemList>,
    );
    expect(screen.getByRole("list", { name: "People" })).toHaveTextContent(
      "AdaAdmin",
    );
  });

  test("a section heading shows its count only when there is one", () => {
    const { rerender } = render(<SectionHeading title="Runs" count={0} />);
    expect(screen.getByRole("heading", { name: "Runs" })).toBeInTheDocument();
    rerender(<SectionHeading title="Runs" count={3} />);
    expect(screen.getByRole("heading", { name: "Runs 3" })).toBeInTheDocument();
    render(<CountChip data-slot="x" count={2} />);
    expect(screen.getByText("2")).toHaveAttribute("data-slot", "x");
  });

  test("the actions column is named for screen readers", () => {
    render(
      <DataTable>
        <thead>
          <tr>
            <DataActionsHeading label="Decision and actions" />
          </tr>
        </thead>
      </DataTable>,
    );
    expect(
      screen.getByRole("columnheader", { name: "Decision and actions" }),
    ).toBeInTheDocument();
  });

  test("no matches says what found nothing", () => {
    render(<NoMatches noun="rules" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No matching rulesTry a different search or filter.",
    );
  });

  test("a list search keeps rows by their text and the list's filters", () => {
    const items = [
      { name: "Allow status", on: true },
      { name: "Deny push", on: true },
      { name: "Allow log", on: false },
    ];
    const text = (item: (typeof items)[number]) => [item.name];
    const keep = (item: (typeof items)[number]) => item.on;
    const { result } = renderHook(() => useListSearch(items, text, keep));
    expect(result.current.visible.map((item) => item.name)).toEqual([
      "Allow status",
      "Deny push",
    ]);
    act(() => result.current.setQuery(" allow "));
    expect(result.current.visible.map((item) => item.name)).toEqual([
      "Allow status",
    ]);
  });
});

describe("YAML legend", () => {
  test("draws each swatch in the editor's own colour and word", () => {
    render(<YamlLegend />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(
      legendLooks.map((look) => look.label),
    );
    expect(items[0]!.querySelector("span")!.getAttribute("style")).toContain(
      legendLooks[0]!.fill,
    );
  });
});
