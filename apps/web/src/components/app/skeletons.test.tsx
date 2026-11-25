import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DataTableSkeleton, ListSkeleton } from "./skeleton-lists";
import {
  CardActionsSkeleton,
  CardSkeleton,
  DisclosureSkeleton,
  FactListSkeleton,
  FormFieldSkeleton,
  LoadingPage,
  NoteSkeleton,
  PageHeaderSkeleton,
  PanelSkeleton,
} from "./skeletons";

const pieces = {
  PageHeaderSkeleton: <PageHeaderSkeleton back lead status actions={2} />,
  PanelSkeleton: <PanelSkeleton />,
  CardSkeleton: <CardSkeleton description />,
  CardActionsSkeleton: <CardActionsSkeleton buttons={2} />,
  FactListSkeleton: <FactListSkeleton rows={4} />,
  FormFieldSkeleton: <FormFieldSkeleton hint />,
  NoteSkeleton: <NoteSkeleton lines={2} />,
  DisclosureSkeleton: <DisclosureSkeleton />,
  DataTableSkeleton: <DataTableSkeleton columns={4} toolbar={2} countBar />,
  ListSkeleton: <ListSkeleton rows={3} boxed trailing />,
};

describe("LoadingPage", () => {
  test("announces what is loading and hides the placeholders", () => {
    const { container } = render(
      <LoadingPage label="agents">
        <PageHeaderSkeleton actions={1} />
        <DataTableSkeleton columns={3} rows={2} />
      </LoadingPage>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading agents…");
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    // Only the status is exposed; no table, rows or headings leak through.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });
});

describe("skeleton pieces", () => {
  test.each(Object.entries(pieces))("%s is aria-hidden", (_, piece) => {
    const { container } = render(piece);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root?.querySelector("[data-slot=skeleton]")).not.toBeNull();
  });

  test("DataTableSkeleton has the asked-for columns and rows", () => {
    const { container } = render(
      <DataTableSkeleton columns={5} rows={7} actions={1} />,
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(6);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(7);
  });
});
