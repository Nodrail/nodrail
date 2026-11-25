"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { Table } from "@/components/ui/table";

/** A heading's text as it shows on screen: screen-reader-only words left out. */
function shownText(node: Node): string {
  if (node instanceof Element && node.classList.contains("sr-only")) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes, shownText).join("");
}

const roles: Record<string, string> = {
  TABLE: "table",
  THEAD: "rowgroup",
  TBODY: "rowgroup",
  TFOOT: "rowgroup",
  TR: "row",
  TD: "cell",
};

/**
 * Restates the table's structure in ARIA, which browsers stop exposing once
 * CSS stacks the rows on phones, and gives each body cell its column's name
 * in `data-label` for the stacked layout to show. The first column, the
 * row's name, and columns with no visible heading, such as Actions, get none.
 */
export function describeTable(table: HTMLTableElement) {
  const headings = Array.from(table.tHead?.rows[0]?.cells ?? [], (cell) =>
    shownText(cell).trim(),
  );
  for (const element of table.querySelectorAll("thead, tbody, tfoot, tr, td"))
    element.setAttribute("role", roles[element.tagName] ?? "");
  table.setAttribute("role", "table");
  for (const th of table.querySelectorAll("th"))
    th.setAttribute(
      "role",
      th.closest("thead") || th.scope === "col" ? "columnheader" : "rowheader",
    );
  for (const body of table.tBodies)
    for (const row of body.rows)
      for (const cell of row.cells) {
        const label = cell.cellIndex > 0 ? headings[cell.cellIndex] : "";
        if (label) cell.dataset.label = label;
        else delete cell.dataset.label;
      }
}

/**
 * The Table under DataTable, kept described as rows come and go. A client
 * part on its own, so DataTable and its rows stay server components.
 */
export function StackedTable(props: ComponentProps<"table">) {
  const ref = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    describeTable(table);
    // Attributes set here are not child changes, so this never loops.
    const observer = new MutationObserver(() => describeTable(table));
    observer.observe(table, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  return <Table ref={ref} {...props} />;
}
