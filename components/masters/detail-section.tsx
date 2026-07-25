import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bordered "card" wrapper — groups related fields under a small uppercase label.
 * Used throughout the masters Sheet editors. Defaults to a single column (safe
 * for sections with inner grids / rate rows / textareas / child grids). Pass
 * `cols={2}` for a dense 2-per-row layout (per DESIGN.md) on sections whose
 * children are all simple `<Label/> + <Input|Select|Picker/>` fields; full-width
 * children in a 2-col section carry `className="sm:col-span-2"`.
 *
 * `cols={12}` is the density mode: a 12-column track where each child is a
 * `<Field size>` that sizes itself to its data instead of stretching to fill a
 * half-width cell (client 2026-07-24 #3). It is deliberately opt-in — ~80
 * existing children carry `sm:col-span-2` meaning "full width of a 2-col
 * section", which would silently become one sixth of the row here.
 */
export function DetailSection({
  label,
  children,
  cols = 1,
}: {
  label: ReactNode;
  children: ReactNode;
  cols?: 1 | 2 | 3 | 12;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "grid gap-x-3 gap-y-2.5",
          cols === 2 && "sm:grid-cols-2",
          cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
          cols === 12 && "sm:grid-cols-12",
        )}
      >
        {children}
      </div>
    </div>
  );
}
