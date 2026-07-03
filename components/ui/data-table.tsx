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
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };
  const selected = selectedKeys ?? new Set<string>();
  const allSelected = rows.length > 0 && rows.every((r, i) => selected.has(getKey(r, i)));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
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
                  "px-3 py-2 text-xs font-semibold text-muted-foreground",
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
    </div>
  );
}
