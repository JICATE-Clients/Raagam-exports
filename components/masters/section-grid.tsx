import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The PAGE-level layout for a master editor: an identity row across the top,
 * then `DetailSection`s flowing into two columns.
 *
 * This is the piece the editor surfaces were missing. `Sheet` and
 * `MasterFullScreen` both stacked sections in a single narrow column, so the
 * layout drawn in `doc/ui/New Material Fabric - Organized Layout.html` — 1180px
 * wide, "what it is" on the left and "how it's measured" on the right — could
 * not be expressed at all. Every screen that wanted it hand-rolled a
 * `grid-cols-2` and its own gaps, which is most of why 29 different grid
 * literals exist across `components/masters`.
 *
 * ## Why container queries and not `lg:`
 *
 * The column count depends on how much room the grid actually GOT, not on the
 * viewport. The same editor body renders at ~1180px in a full-screen sheet and
 * at ~440px inside a nested picker, at identical viewport widths. A viewport
 * breakpoint gets the second case wrong every time — which is exactly the bug
 * `ChildGrid`'s `forceCards` / `inlineCards` props were added to work around by
 * hand (see child-grid.tsx, which already uses `@container` + `@lg:`).
 *
 * The container is NAMED (`@container/sections`) so that `DetailSection`'s own
 * `@container/section` and `ChildGrid`'s unnamed `@container` can nest inside
 * without any of them accidentally answering each other's queries.
 *
 * `@4xl` = 56rem = 896px, i.e. two ~440px columns at the narrowest. Below that
 * it is a single column, so mobile and nested-in-a-picker both fall back
 * correctly with no prop.
 *
 * Sections are `items-start` — a short section next to a tall one keeps its own
 * height instead of stretching to match, which is what the mockup shows.
 */
export function SectionGrid({
  children,
  className,
}: {
  /** `DetailSection`s. Pass `span={2}` on one to make it claim the full row. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("@container/sections", className)}>
      <div className="grid items-start gap-3 @4xl/sections:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * The full-width band above the sections: the two or three fields that identify
 * the record (Item Class · Name · HSN in the Material mockup).
 *
 * Deliberately NOT a `DetailSection` — it carries no border and no caption,
 * because the record's identity is the one thing that needs no label. The
 * tracks are uneven (`0.85fr 1.4fr 0.85fr` in the mockup): the Name field earns
 * the extra width, the classifier and code beside it do not.
 *
 * Wrap the children in plain `<div>`s (or `<Field>` without a size) — this
 * component owns the track widths, not the children.
 */
export function IdentityRow({
  children,
  tracks = "1.4fr",
  className,
}: {
  children: ReactNode;
  /**
   * Grid tracks for the row, minus the leading/trailing `0.85fr`. Defaults to a
   * single wide middle column, giving the mockup's `0.85fr 1.4fr 0.85fr`. Pass
   * e.g. `"1.4fr 0.85fr"` for a four-field identity row.
   */
  tracks?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("@container/identity", className)}
      // Track widths are data, not design tokens — a static Tailwind class map
      // would need one entry per shape. The container query below is what makes
      // this safe: the custom tracks only ever apply once there is room for them.
      style={{ ["--identity-tracks" as string]: `0.85fr ${tracks} 0.85fr` }}
    >
      {/* `grid` is already one column; the tracks only switch on once there is
          room, so no explicit mobile fallback is needed. */}
      <div className="grid gap-3 @2xl/identity:[grid-template-columns:var(--identity-tracks)]">
        {children}
      </div>
    </div>
  );
}
