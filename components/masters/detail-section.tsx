import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bordered "card" wrapper — groups related fields under a small uppercase label.
 * Used throughout the masters Sheet editors. Defaults to a single column (safe
 * for sections with inner grids / rate rows / textareas / child grids). Pass
 * `cols={2}` for a dense 2-per-row layout (per DESIGN.md) on sections whose
 * children are all simple `<Label/> + <Input|Select|Picker/>` fields; full-width
 * children in a 2-col section carry `className="sm:col-span-2"`.
 */
export function DetailSection({
  label,
  children,
  cols = 1,
}: {
  label: ReactNode;
  children: ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("grid gap-x-4 gap-y-3", cols === 2 && "sm:grid-cols-2")}>{children}</div>
    </div>
  );
}
