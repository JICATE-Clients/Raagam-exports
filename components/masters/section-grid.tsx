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
  /**
   * `DetailSection`s — auto-placed, so use this when the sections are peers and
   * reading order left-to-right is fine. Pass `span={2}` on one to make it claim
   * the full row.
   *
   * When column MEMBERSHIP is meaningful, wrap each side in a `SectionColumn`
   * instead; auto-placement would interleave them.
   */
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
 * One column of a `SectionGrid`, holding a fixed set of sections.
 *
 * `SectionGrid` on its own auto-places its children, which is right when the
 * sections are peers and wrong when the split carries meaning. On a Material
 * editor it carries a lot: LEFT is *what the material is* (class fields,
 * attribute questions, composition) and RIGHT is *how it's measured* (UOM,
 * conversions, status) — a standing rule for every item class. Auto-placement
 * would deal those sections alternately into the two columns and destroy it,
 * which is why the screen hand-rolled `lg:grid-cols-2` with two `space-y-4`
 * wrappers instead and this file had no adopters at all.
 *
 * Two `SectionColumn`s land in the grid's two cells, so the rule survives and
 * the screen still writes no `grid-cols-*`, `col-span-*` or `gap-*` of its own.
 * The internal `space-y-3` matches `SectionGrid`'s `gap-3`, so the vertical
 * rhythm between stacked sections equals the horizontal gutter between columns.
 */
export function SectionColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // A column is always ONE cell. There was briefly a `span?: 1 | 2` here, so a
  // column could claim the whole row and stack its sections full width — added
  // for Material ▸ Fabric, whose Classification holds three fields that would
  // not fit two-per-row. Fabric got the three on one row by sizing its fields
  // `md` inside the column instead (client 2026-08-04), no call site ever
  // passed the prop, and a prop nothing uses reads as a sanctioned option — it
  // would invite exactly the stacking that was tried and reverted. A screen
  // that genuinely wants full-width sections uses `SectionGrid` without
  // columns, the way `applicant` / `bank` / `courier-delivery` / `notify` do.
  return <div className={cn("space-y-3", className)}>{children}</div>;
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
  tracks = "0.85fr 1.4fr 0.85fr",
  className,
}: {
  children: ReactNode;
  /**
   * The COMPLETE `grid-template-columns` for the row — one track per child.
   * Defaults to the mockup's `0.85fr 1.4fr 0.85fr`.
   *
   * This used to be the middle tracks only, with a `0.85fr` welded on at each
   * end. That could not express the screen it was written for: Material's
   * identity row ends in an 8-digit HSN code, which wants a fixed `10rem`, not
   * a proportional share — and a fractional trailing track is exactly how HSN
   * ended up occupying a quarter of the row (client 2026-07-24 #3). Taking the
   * whole list costs one longer default and buys every real shape.
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
      style={{ ["--identity-tracks" as string]: tracks }}
    >
      {/* `grid` is already one column; the tracks only switch on once there is
          room, so no explicit mobile fallback is needed. */}
      <div className="grid gap-3 @2xl/identity:[grid-template-columns:var(--identity-tracks)]">
        {children}
      </div>
    </div>
  );
}
