import Link from "next/link";
import { Button } from "@/components/ui/button";
import { appPath } from "@/lib/product-path";
import { reportingEndpoint } from "@/features/reporting/endpoint";
import { EmptyState } from "@/components/app/card";
import { DataTable, DataTitle, ListSummary } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import type { InventoryDto, InventoryRowDto } from "@/contracts/v1/inventory";
import { LOCAL_SOURCE_LABEL } from "@/contracts/v1/reporting";
import { readForPage } from "@/features/shell/load-view";
import { timeAgo } from "@/lib/time";
import { listInventory } from "@/server/modules/inventory";
import {
  hostNames,
  rowStatus,
  shortRevision,
  unmanagedText,
} from "../presentation";

function Row({ row }: { row: InventoryRowDto }) {
  const status = rowStatus(row);
  return (
    <tr data-slot="inventory-row">
      <td>
        <DataTitle>{row.project}</DataTitle>
        <small>
          {hostNames[row.host] ?? row.host}
          {row.agent ? ` · starts as ${row.agent}` : ""}
          {row.projectBound ? "" : " · unbound: no project id"}
        </small>
        <small>{LOCAL_SOURCE_LABEL}</small>
      </td>
      <td>
        {row.mine ? "You" : row.person}
        <small>Machine {row.machine}</small>
      </td>
      <td>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <small>
          {row.drift === 0
            ? "Nothing changed since apply"
            : `${row.drift} changed since apply`}
        </small>
      </td>
      <td>
        <span title={row.names?.unmanaged.join("\n")}>
          {unmanagedText(row.unmanaged)}
        </span>
        {row.names && row.names.unmanaged.length > 0 ? (
          <small>{row.names.unmanaged.join(", ")}</small>
        ) : null}
      </td>
      <td>
        <code>{shortRevision(row.appliedRevision)}</code>
        {row.behind ? (
          <small>Team intends {shortRevision(row.intendedRevision)}</small>
        ) : row.lockedRevision && row.lockedRevision !== row.appliedRevision ? (
          <small>Lock at {shortRevision(row.lockedRevision)}</small>
        ) : null}
      </td>
      <td>Last reported {timeAgo(row.observedAt)}</td>
    </tr>
  );
}

function summaryText({ summary, seesEveryone }: InventoryDto) {
  const whose = seesEveryone ? "on your team's machines" : "on your machines";
  return `${summary.reports} setups ${whose}. Reported, not attested: ${summary.verified} with activation verified by local check, ${summary.configured} with the hook configured (coverage unknown), ${summary.inactive} with the hook not running, ${summary.unknown} unknown, ${summary.disconnected} disconnected, ${summary.stale} stale; ${summary.drifted} drifted, ${summary.behind} behind the intended revision.`;
}

/** What each machine last reported, project by project. */
export async function InventoryTable({
  workspace,
  environment,
}: {
  workspace: string;
  environment: string;
}) {
  const inventory = await readForPage(workspace, (context) =>
    listInventory(context, environment),
  );
  if (inventory.rows.length === 0)
    return (
      <EmptyState
        title="No machine has reported yet"
        action={
          <Button asChild variant="outline">
            <Link href={`${appPath(workspace, environment)}/agents/connect`}>
              Open project setup
            </Link>
          </Button>
        }
      >
        Run <code>nodrail apply</code> in a connected project to send this
        machine’s first setup report. Session starts refresh the report. To send
        reports from an external OpenTelemetry collector, use{" "}
        <code>{reportingEndpoint(environment)}</code> with an Inventory
        reporting token.
      </EmptyState>
    );
  return (
    <>
      <ListSummary data-tour="inventory-summary">
        {summaryText(inventory)}
      </ListSummary>
      <DataTable aria-label="Machines" data-tour="inventory-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Person</th>
            <th scope="col">Status</th>
            <th scope="col">Not set up by nodrail</th>
            <th scope="col" data-tour="inventory-revision">
              Revision
            </th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {inventory.rows.map((row) => (
            <Row
              key={`${row.project}/${row.person}/${row.machine}/${row.host}`}
              row={row}
            />
          ))}
        </tbody>
      </DataTable>
    </>
  );
}
