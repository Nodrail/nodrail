import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { DataActionsCell, DataActionsHeading, DataTable } from "./data-table";

function Table({ rows }: { rows: string[] }) {
  return (
    <DataTable>
      <thead>
        <tr>
          <th scope="col">Agent</th>
          <th scope="col">Time</th>
          <DataActionsHeading />
        </tr>
      </thead>
      <tbody>
        {rows.map((name) => (
          <tr key={name}>
            <td>{name}</td>
            <td>just now</td>
            <DataActionsCell>
              <button type="button">Open</button>
            </DataActionsCell>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function Growing() {
  const [rows, setRows] = useState(["support"]);
  return (
    <>
      <button type="button" onClick={() => setRows([...rows, "deploy"])}>
        Add
      </button>
      <Table rows={rows} />
    </>
  );
}

describe("DataTable stacked on phones", () => {
  test("keeps table roles the stacked CSS would drop", () => {
    render(<Table rows={["support"]} />);
    expect(screen.getByRole("table")).toHaveAttribute("role", "table");
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("role", "row");
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "just now" })).toHaveAttribute(
      "role",
      "cell",
    );
  });

  test("labels each cell after the row's name with its column", () => {
    render(<Table rows={["support"]} />);
    const [name, time, actions] = screen.getAllByRole("cell");
    expect(name).not.toHaveAttribute("data-label");
    expect(time).toHaveAttribute("data-label", "Time");
    // The Actions heading is for screen readers only: nothing to show.
    expect(actions).not.toHaveAttribute("data-label");
  });

  test("labels rows added later", async () => {
    render(<Growing />);
    screen.getByRole("button", { name: "Add" }).click();
    await waitFor(() =>
      expect(screen.getAllByRole("cell", { name: "just now" })).toHaveLength(2),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("cell", { name: "just now" })[1],
      ).toHaveAttribute("data-label", "Time"),
    );
  });
});
