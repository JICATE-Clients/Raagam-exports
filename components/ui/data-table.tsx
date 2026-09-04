import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * Dense, presentational table. Server-renderable (no client state) unless the
 * optional `selectable` row-selection props are supplied (which come from a
 * client parent). Numerics should use align:"right" + tabular-nums in the cell.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty = "No records.",
  onRowHref,
  selectable = false,
  selectedKeys,
  onToggle,
  onToggleAll,
  bare = false,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  empty?: ReactNode;
  /** Optional: makes each row a link target (rendered client-side elsewhere). */
  onRowHref?: (row: T) => string | undefined;
  /** Show a leading checkbox column + header select-all. Requires the handlers below. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (key: string) => void;
  onToggleAll?: () => void;
  /**
   * Drop the table's own border/background/radius. Use when nesting inside a
   * `<Card>`, which already draws all three — otherwise the table's `rounded-lg`
   * sits visibly inset inside the Card's `rounded-xl`.
   */
  bare?: boolean;
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };
  const selected = selectedKeys ?? new Set<string>();
  const allSelected = rows.length > 0 && rows.every((r, i) => selected.has(getKey(r, i)));

  return (
    <div
      className={cn(
        "overflow-x-auto",
        !bare && "rounded-lg border border-border bg-surface",
      )}
    >
      {/* `hidden md:table`, with the stacked cards below taking over — see the
          note above that block. Desktop is unchanged: `md:table` restores the
          element's own default display. */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            {selectable && (
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={allSelected}
                  onChange={() => onToggleAll?.()}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  // BOLD, NOT SEMIBOLD (operator request, 2026-09-04: "globally
                  // make the each table title label as bold") — the same move
                  // `child-grid.tsx`'s `GRID_HEADER_TEXT` makes, so a
                  // `ChildGrid` row and a `DataTable` header read the same
                  // weight.
                  "px-3 py-2 text-xs font-bold text-muted-foreground",
                  align[c.align ?? "left"],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-3 py-8 text-center text-sm text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => {
              const href = onRowHref?.(row);
              const key = getKey(row, ri);
              return (
                <tr
                  key={key}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-surface-muted/60",
                    href && "cursor-pointer",
                    selected.has(key) && "bg-primary/5",
                  )}
                  data-href={href}
                >
                  {selectable && (
                    <td className="w-10 px-3 py-2 align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer"
                        checked={selected.has(key)}
                        onChange={() => onToggle?.(key)}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((c, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "px-3 py-2 align-middle",
                        align[c.align ?? "left"],
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/*
        * THE SAME ROWS AS STACKED CARDS BELOW `md`, because a table on a phone
        * is a table the operator drags sideways to read. Style's list put
        * Serial No / Style / Customer / Season into ~330px and Season was
        * already off-screen (client 2026-08-27); every column after it was
        * reachable only by scrolling, with the identifier scrolled out of sight
        * by the time you got there.
        *
        * IT BELONGS HERE AND NOT ON THE SCREEN. `MasterListShell` has paired a
        * desktop table with a `MobileCardList` for a while, but a screen
        * reaching for a bare `<DataTable>` got nothing — and 209 files use this
        * component. That is the remainder a per-screen fix always leaves, so
        * the fallback goes in the primitive and every one of them is correct
        * without being edited.
        *
        * IT CANNOT DOUBLE UP WITH `MobileCardList`. That shell renders its
        * table inside `hidden … md:block` (master-list-shell.tsx), so this
        * block is inside an already-hidden container there and never paints.
        * A shell screen keeps its curated card — title, subtitle, pill,
        * row actions — and this is only the fallback for everyone else.
        *
        * Label-left / value-right rather than the label-above-control stacking
        * `ChildGrid` uses in cards mode: these cells are READ, not typed, so a
        * pair costs one line where stacking costs two, and a six-column row
        * becomes six lines instead of twelve.
        *
        * The divider is `border-t-2 border-border-strong`, the same two-pixel
        * rule `child-grid.tsx` draws between records and for the same reason —
        * at 1px in `--border` it reads as one more field edge rather than as
        * the start of a new record.
        *
        * A column with a BLANK header is the row-action cluster (LAYOUT.md
        * §6a): it gets no label, and sits at the foot of the card where its
        * `<th>` sits at the end of the row.
        *
        * Nothing here is `truncate`, deliberately — a value that needs the room
        * wraps onto a second line. The §14 exemption that lets a table cell cut
        * a value off is paid for by the table scrolling, and this does not
        * scroll, so a `…` here would be the dead end §14 forbids.
        */}
      <div className="md:hidden">
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          rows.map((row, ri) => {
            const key = getKey(row, ri);
            const href = onRowHref?.(row);
            return (
              <div
                key={key}
                data-href={href}
                className={cn(
                  "space-y-1.5 px-3 py-3",
                  ri > 0 && "border-t-2 border-border-strong",
                  selected.has(key) && "bg-primary/5",
                )}
              >
                {selectable && (
                  <label className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer"
                      checked={selected.has(key)}
                      onChange={() => onToggle?.(key)}
                      aria-label="Select row"
                    />
                    Select
                  </label>
                )}
                {columns.map((c, ci) =>
                  c.header ? (
                    <div
                      key={ci}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.header}
                      </span>
                      <span className="min-w-0 text-right text-sm">
                        {c.cell(row)}
                      </span>
                    </div>
                  ) : (
                    <div key={ci} className="flex justify-end pt-0.5">
                      {c.cell(row)}
                    </div>
                  ),
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
