import type { ReactNode } from "react";
import { FIELD_TRACK } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Bordered "card" wrapper — groups related fields under a small uppercase label.
 * Used throughout the masters editors. Defaults to a single column (safe for
 * sections with inner grids / rate rows / textareas / child grids). Pass
 * `cols={2}` for a dense 2-per-row layout (per DESIGN.md) on sections whose
 * children are all simple `<Label/> + <Input|Select|Picker/>` fields;
 * full-width children in a 2-col section carry `className="sm:col-span-2"`.
 *
 * `cols={12}` is the density mode: a 12-column track where each child is a
 * `<Field size>` that sizes itself to its data instead of stretching to fill a
 * half-width cell (client 2026-07-24 #3).
 *
 * ## Why the 12-col track is a container query
 *
 * It used to be `sm:grid-cols-12`, and `Field`'s spans were `sm:col-span-*`.
 * That collided head-on with the ~80 children already carrying
 * `sm:col-span-2` to mean "full width of a 2-col section" — the same class
 * meaning one sixth of a row in one mode and the whole row in the other. The
 * collision is why `cols={12}` stayed opt-in and why `Field` had exactly one
 * adopter in 92 screens: nobody could migrate without silently shredding those
 * 80 fields.
 *
 * Moving the density mode to a NAMED container query (`@container/section` +
 * `@lg/section:*`) removes the collision outright — `@lg/section:col-span-2`
 * and `sm:col-span-2` are different classes and cannot be confused. It also
 * makes the section respond to its OWN width, so a section sitting in a
 * half-width `SectionGrid` column correctly stays single-column instead of
 * cramming 12 tracks into 560px. `child-grid.tsx` already uses this idiom.
 *
 * Static class strings only, never interpolated — Tailwind v4 scans source
 * text, so a computed `@lg/section:col-span-${n}` would produce no CSS at all.
 */
export function DetailSection({
  label,
  children,
  cols = 1,
  span = 1,
  action,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  cols?: 1 | 2 | 3 | 12;
  /**
   * How many columns of the parent `SectionGrid` this section occupies. `2`
   * makes it claim the full row — for a section that is genuinely wide (a child
   * grid, a long notes field) rather than one half of a pair.
   */
  span?: 1 | 2;
  /**
   * Right-aligned slot in the section header — a running total, a count, a
   * small "+ Add" button. The mixing-percentage badge ("83% of 100%") in the
   * Material mockup lives here.
   */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // The `@2xl/editor:` classes here and below are compact density: a
        // section's own chrome (padding + header + the gap under it) costs real
        // vertical space before a single field renders, and on a laptop-height
        // form that is screen spent on borders. Compact trims it on the wide
        // editor surfaces. This element declares `@container/section` AND
        // queries the ancestor `@container/editor` — a container can do both.
        //
        // Tightened one step across the board (client 2026-07-28). Only the
        // VERTICAL rhythm moved; `gap-x-3` below is deliberately untouched,
        // because that gutter is what stops two adjacent controls on the 12-col
        // track from reading as one control.
        "@container/section space-y-2 @2xl/editor:space-y-1.5 rounded-lg border border-border p-2.5 @2xl/editor:p-2",
        span === 2 && "@4xl/sections:col-span-2",
        className,
      )}
    >
      <div className="flex min-h-5 @2xl/editor:min-h-4 items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {action}
      </div>
      <div
        className={cn(
          // `cols={12}` IS `FIELD_TRACK` — the same string `FieldGrid` uses, so
          // a card body and a section can never lay fields out differently.
          cols === 12 ? FIELD_TRACK : "grid gap-x-3 gap-y-2 @2xl/editor:gap-y-1.5",
          cols === 2 && "sm:grid-cols-2",
          cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </div>
  );
}
