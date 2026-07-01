import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * Dense, presentational table. Server-renderable (no client state).
 * Numerics should use align:"right" + tabular-nums in the cell.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty = "No records.",
  onRowHref,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  empty?: ReactNode;
  /** Optional: makes each row a link target (rendered client-side elsewhere). */
  onRowHref?: (row: T) => string | undefined;
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
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
                colSpan={columns.length}
                className="px-3 py-8 text-center text-sm text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => {
              const href = onRowHref?.(row);
              return (
                <tr
                  key={getKey(row, ri)}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-surface-muted/60",
                    href && "cursor-pointer",
                  )}
                  data-href={href}
                >
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
