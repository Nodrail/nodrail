import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DataActionsCell,
  DataPanel,
  DataTable,
  DataToolbar,
} from "./data-table";
import {
  AvatarSkeleton,
  BadgeSkeleton,
  ButtonSkeleton,
  LineSkeleton,
  lineWidth,
  skeletonKeys,
} from "./skeletons";
import { boxedRow, boxedRowMain, boxedRowTrailing } from "./item-list";

const cellWidths = ["w-24", "w-16", "w-20", "w-28", "w-12"];
const controlWidths = ["w-20", "w-36", "w-32", "w-24"];

/** The table itself, built on DataTable so cell padding and phone stacking match. */
function TableSkeleton({
  columns,
  rows,
  actions,
}: {
  columns: number;
  rows: number;
  actions: number;
}) {
  return (
    <DataTable aria-hidden="true">
      <thead>
        <tr>
          {skeletonKeys(columns).map((column) => (
            <th key={column}>
              <LineSkeleton className="w-16 text-micro" />
            </th>
          ))}
          {actions ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {skeletonKeys(rows).map((row) => (
          <tr key={row}>
            {skeletonKeys(columns).map((column) =>
              column === 0 ? (
                <td key={column}>
                  <LineSkeleton className={row % 2 ? "w-36" : "w-44"} />
                  <LineSkeleton className="mt-0.75 w-28 text-xs" />
                </td>
              ) : (
                <td key={column}>
                  <LineSkeleton
                    className={cellWidths[(row + column) % cellWidths.length]}
                  />
                </td>
              ),
            )}
            {actions ? (
              <DataActionsCell>
                <span className="inline-flex gap-1">
                  {skeletonKeys(actions).map((index) => (
                    <ButtonSkeleton key={index} size="sm" />
                  ))}
                </span>
              </DataActionsCell>
            ) : null}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * DataTable's shape: `columns` headings and `rows` rows (the first cell has a
 * second line), in a DataPanel unless `panel` is false (a table inside a
 * Card). `toolbar` adds a DataToolbar with a search box and that many
 * controls; `countBar` the count line under it; `actions` row buttons.
 */
export function DataTableSkeleton({
  columns,
  rows = 5,
  toolbar,
  countBar = false,
  actions = 0,
  panel = true,
}: {
  columns: number;
  rows?: number;
  toolbar?: number;
  countBar?: boolean;
  actions?: number;
  panel?: boolean;
}) {
  const table = (
    <TableSkeleton columns={columns} rows={rows} actions={actions} />
  );
  if (!panel) return table;
  return (
    <DataPanel data-slot="data-table-skeleton" aria-hidden="true">
      {toolbar === undefined ? null : (
        <DataToolbar>
          <Skeleton className="h-9 min-w-55 flex-1 rounded-md phone:h-10 phone:min-w-full" />
          {skeletonKeys(toolbar).map((index) => (
            <ButtonSkeleton
              key={index}
              className={controlWidths[index % controlWidths.length]}
            />
          ))}
        </DataToolbar>
      )}
      {countBar ? (
        <div className="flex justify-between border-b px-3.25 py-2.25">
          <LineSkeleton className="w-24 text-xs" />
          <LineSkeleton className="w-20 text-xs" />
        </div>
      ) : null}
      {table}
    </DataPanel>
  );
}

/** A ruled list row: optional dot, a title and a quiet line, optional time. */
function DividedRow({
  index,
  dot,
  trailing,
}: {
  index: number;
  dot: boolean;
  trailing: boolean;
}) {
  return (
    <li className="flex items-center gap-3.5 px-1 py-3.25">
      {dot ? <Skeleton className="size-1.75 shrink-0 rounded-full" /> : null}
      <span className="grid min-w-0 flex-1 gap-0.75">
        <LineSkeleton className={cn(lineWidth(index), "max-w-80")} />
        <LineSkeleton className="w-48 text-xs" />
      </span>
      {trailing ? <LineSkeleton className="w-12 shrink-0 text-xs" /> : null}
    </li>
  );
}

/** A bordered list row like AgentRow: avatar, name and badge, meta lines, a count. */
function BoxedRow({
  index,
  lines,
  trailing,
}: {
  index: number;
  lines: number;
  trailing: boolean;
}) {
  return (
    <li className={boxedRow}>
      <span className={boxedRowMain}>
        <AvatarSkeleton />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex items-center gap-2">
            <LineSkeleton className="w-32 text-sm" />
            <BadgeSkeleton />
          </span>
          {skeletonKeys(lines - 1).map((line) => (
            <LineSkeleton
              key={line}
              className={cn("max-w-96 text-xs", lineWidth(index + line))}
            />
          ))}
        </span>
      </span>
      {trailing ? (
        <span className={boxedRowTrailing}>
          <LineSkeleton className="w-20 text-xs" />
        </span>
      ) : null}
    </li>
  );
}

/**
 * List rows. `boxed` rows are bordered cards with an avatar (the agent list);
 * otherwise rows are ruled, with an optional `dot` (recent decisions).
 * `lines` counts a boxed row's lines; `trailing` adds the right-hand time or count.
 */
export function ListSkeleton({
  rows,
  boxed = false,
  dot = false,
  lines = 2,
  trailing = false,
}: {
  rows: number;
  boxed?: boolean;
  dot?: boolean;
  lines?: number;
  trailing?: boolean;
}) {
  return (
    <ul
      data-slot="list-skeleton"
      aria-hidden="true"
      className={boxed ? "grid gap-1.75" : "divide-y divide-border/70"}
    >
      {skeletonKeys(rows).map((index) =>
        boxed ? (
          <BoxedRow
            key={index}
            index={index}
            lines={lines}
            trailing={trailing}
          />
        ) : (
          <DividedRow key={index} index={index} dot={dot} trailing={trailing} />
        ),
      )}
    </ul>
  );
}
