"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Excel-like vertical movement inside the desktop grid (checklist "Better Table
 * Navigation"): Enter / ArrowDown move to the same column one row down; ArrowUp
 * moves up. On Enter in the last row we call `onAdd` and focus the same column
 * in the freshly-added row. Horizontal movement stays on native Tab (and the
 * Sheet's row-major Enter-advance, which this overrides via stopPropagation for
 * the keys it handles). Only fires for text-like inputs, so selects/pickers keep
 * their native Enter (e.g. opening a picker dialog).
 */
function gridKeyNav(e: React.KeyboardEvent<HTMLElement>, addRow: () => void) {
  if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (/^(button|submit|reset|checkbox|radio)$/.test(el.type)) return;
  const cell = el.closest("td");
  const row = el.closest("tr");
  const body = row?.parentElement;
  if (!cell || !row || !body) return;
  const col = cell.cellIndex;
  const rows = Array.from(body.children) as HTMLTableRowElement[];
  const idx = rows.indexOf(row);

  const focusColIn = (tr: HTMLTableRowElement | undefined) => {
    const target = tr?.cells[col]?.querySelector<HTMLElement>(
      'input:not([type="button"]):not([type="hidden"]), select, textarea',
    );
    if (target) {
      target.focus();
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const len = target.value.length;
        try {
          target.setSelectionRange(len, len);
        } catch {
          /* number/email inputs reject selection ranges */
        }
      }
      return true;
    }
    return false;
  };

  if (e.key === "ArrowUp") {
    if (idx > 0) {
      e.preventDefault();
      e.stopPropagation();
      focusColIn(rows[idx - 1]);
    }
    return;
  }
  // Enter or ArrowDown
  if (idx < rows.length - 1) {
    e.preventDefault();
    e.stopPropagation();
    focusColIn(rows[idx + 1]);
  } else if (e.key === "Enter") {
    // Last row + Enter → add a new row and land in the same column.
    e.preventDefault();
    e.stopPropagation();
    addRow();
    const owner = body;
    window.setTimeout(() => {
      const fresh = Array.from(owner.children) as HTMLTableRowElement[];
      focusColIn(fresh[fresh.length - 1]);
    }, 30);
  }
}

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
  maxBodyHeight,
  forceCards = false,
  frameless = false,
  keyboardNav = true,
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
  /** Tailwind max-height class (e.g. "max-h-56") — caps the ROW area with an
   *  internal scroll so a growing grid never pushes the content below it
   *  (client 2026-07-23: Attributes above UOM must not displace UOM). The
   *  label and "+ Add" button stay pinned outside the scroll. */
  maxBodyHeight?: string;
  /** Always render the stacked row-cards, never the wide table — for grids
   *  living inside a half-width column (Fabric organized layout 2026-07-23). */
  forceCards?: boolean;
  /** Drop the outer bordered card so the grid can nest INSIDE a DetailSection
   *  (e.g. Attributes (Mixing) under Composition) without a double border. */
  frameless?: boolean;
  /** Excel-like Enter/↑/↓ vertical cell navigation on the desktop table (on by
   *  default). Set false for grids where Enter should keep its native meaning. */
  keyboardNav?: boolean;
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };
  return (
    <div className={cn("@container space-y-3", !frameless && "rounded-lg border border-border p-3")}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        {badge}
      </div>

      {/* wide-container table */}
      {!forceCards && (
      <div className={cn("hidden overflow-x-auto rounded-lg border border-border @lg:block", maxBodyHeight && cn("overflow-y-auto", maxBodyHeight))}>
        <table
          className="w-full min-w-[420px] border-collapse text-sm"
          onKeyDown={keyboardNav ? (e) => gridKeyNav(e, onAdd) : undefined}
        >
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
      )}

      {/* stacked row-cards — the only rendering when forceCards is set */}
      <div className={cn("space-y-2", !forceCards && "@lg:hidden", maxBodyHeight && cn("overflow-y-auto", maxBodyHeight))}>
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
