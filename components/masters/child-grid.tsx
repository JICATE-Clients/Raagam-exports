"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChildGridColumn<T> {
  header: string;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

/**
 * Reusable "repeating line items" editor for masters child grids (mixing
 * lines, attribute values, coordinates, description lines, sub-categories,
 * etc.) — a real table on desktop (`md:` and up), a stacked-card list on
 * mobile, a numbered `#` column, a per-row remove button, and a configurable
 * "+ Add {label}" button. Generalizes the desktop-table/mobile-card pattern
 * first built (four times) in `material-master-screen.tsx`.
 */
export function ChildGrid<T extends { key: string }>({
  label,
  badge,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel = "+ Add row",
  renderMobileRow,
}: {
  label: ReactNode;
  /** Optional trailing status next to the label, e.g. a "83% of 100%" running-total badge. */
  badge?: ReactNode;
  columns: ChildGridColumn<T>[];
  rows: T[];
  onAdd: () => void;
  onRemove: (row: T) => void;
  addLabel?: string;
  /** Custom mobile-card body per row; falls back to stacking every column's cell if omitted. */
  renderMobileRow?: (row: T, index: number) => ReactNode;
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };
  return (
    <div className="@container space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        {badge}
      </div>

      {/* wide-container table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border @lg:block">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="w-10 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">#</th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    "border-l border-border px-2 py-1.5 text-xs font-semibold text-muted-foreground",
                    align[c.align ?? "left"],
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              <th className="w-8 border-l border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{i + 1}</td>
                {columns.map((c, ci) => (
                  <td key={ci} className={cn("border-l border-border px-2 py-1.5", align[c.align ?? "left"], c.className)}>
                    {c.cell(row, i)}
                  </td>
                ))}
                <td className="border-l border-border px-1 py-1.5 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onRemove(row)}
                    aria-label="Remove row"
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* narrow-container stacked cards */}
      <div className="space-y-2 @lg:hidden">
        {rows.map((row, i) => (
          <div key={row.key} className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => onRemove(row)}>
                ✕
              </Button>
            </div>
            {renderMobileRow ? renderMobileRow(row, i) : columns.map((c, ci) => <div key={ci}>{c.cell(row, i)}</div>)}
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
}
