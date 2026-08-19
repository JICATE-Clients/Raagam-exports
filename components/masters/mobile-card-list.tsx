"use client";

import { type ReactNode } from "react";
import { Eye } from "lucide-react";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * The card list every master screen used to hand-roll — extracted, plus the
 * delete affordance mobile users never had (delete lived only in the desktop
 * table's row actions). The card body is a tap-to-edit button; the view and
 * delete controls render in a footer row as SIBLINGS of that button (never
 * nested inside it), so the two-step DeleteConfirmButton works without invalid
 * button-in-button markup.
 *
 * THE NAME IS HISTORICAL. This began as the `md:hidden` half of a master screen
 * and is no longer mobile-only: Orders ▸ Material BOM renders it as its ONLY
 * list, at every width, as a 3-across grid (operator request 2026-08-17). It is
 * still called `MobileCardList` because renaming touches 7 call sites for no
 * behaviour — worth doing, separately.
 *
 * `md:hidden` HAS ALWAYS LIVED AT THE CALL SITE, never in here, and that is the
 * whole reason the above cost nothing: a caller that wants cards on desktop
 * simply omits the wrapper, and no existing screen changes.
 */
/** One figure in a card's `stats` row. `value` is a node so a REFUSAL can print
 *  its sentence where a number would go — never a dash and never 0, the rule
 *  `requirement.ts` states and every screen showing its output repeats. */
export type CardStat = { label: string; value: ReactNode };

/**
 * The grid ladder, ONE STATIC LITERAL PER COLUMN COUNT.
 *
 * Never an interpolated `@7xl/cards:grid-cols-` + n: Tailwind v4 scans source
 * TEXT, so a computed class produces no CSS at all — the warning `FIELD_TRACK`
 * and `FIELD_TRACK_14` both carry, and the reason this is a table rather than a
 * function.
 *
 * Thresholds are CONTAINER widths (`@xl` 576, `@3xl` 768, `@5xl` 1024, `@7xl`
 * 1280), so six only ever appears with at least ~203px per card. Each step is a
 * superset of the one before, so a narrowing grid passes through every stage
 * instead of dropping from six straight to one.
 */
const COLUMN_LADDER: Record<number, string> = {
  1: "",
  2: "@xl/cards:grid-cols-2",
  3: "@xl/cards:grid-cols-2 @3xl/cards:grid-cols-3",
  4: "@xl/cards:grid-cols-2 @3xl/cards:grid-cols-3 @5xl/cards:grid-cols-4",
  6: "@xl/cards:grid-cols-2 @3xl/cards:grid-cols-3 @5xl/cards:grid-cols-4 @7xl/cards:grid-cols-6",
};

export function MobileCardList<Row>({
  rows,
  getKey,
  title,
  subtitle,
  pill,
  meta,
  onEdit,
  onView,
  canDelete = false,
  canDeleteRow,
  onDelete,
  isPending = false,
  empty = "No records yet.",
  stats,
  footerNote,
  columns = 1,
}: {
  rows: Row[];
  getKey: (r: Row) => string;
  /** Bold first line (usually name). */
  title: (r: Row) => ReactNode;
  /** Muted mono second line (usually code). */
  subtitle?: (r: Row) => ReactNode;
  /** Top-right StatusPill slot. */
  pill?: (r: Row) => ReactNode;
  /** Optional extra muted line under the subtitle. */
  meta?: (r: Row) => ReactNode;
  /** Tap-to-edit; omit to render cards non-tappable. */
  onEdit?: (r: Row) => void;
  /** Read-only view (eye icon in the footer row). Omit to hide it. Worth wiring
   *  wherever the desktop table has a view action — on a phone the tap target IS
   *  edit, so without this there is no way to just look at a record. */
  onView?: (r: Row) => void;
  canDelete?: boolean;
  /**
   * PER-ROW delete, on top of the permission-level `canDelete`.
   *
   * Some rows are not deletable for a reason that is about the ROW, not the
   * user: Material BOM's queue lists every confirmed order, and only the ones
   * that already have a BOM have anything to delete. Without this the button
   * renders on all of them and does nothing when pressed — a dead control is
   * worse than an absent one.
   *
   * Only the BUTTON is gated. The footer strip still renders across the list, so
   * cards in a grid row keep matching heights.
   */
  canDeleteRow?: (r: Row) => boolean;
  onDelete?: (r: Row) => void;
  isPending?: boolean;
  empty?: ReactNode;
  /**
   * A row of small figures across the card — "Styles 2 · Production 12,480 ·
   * Delivery 30/09/2026".
   *
   * IT IS A SLOT RATHER THAN CALL-SITE MARKUP BECAUSE THE SCREEN MAY NOT DRAW.
   * The layout skill's governing rule is that a screen composes primitives and
   * never writes `grid-cols-*` / `col-span-*` of its own, and
   * `audit_layout.py --check` enforces it on every editor screen. Material BOM
   * hand-rolled this strip as a `<dl>` of flex rows; three cards' worth of
   * stats is exactly the thing that ends up drawn three different ways.
   *
   * The row is FLEX, not a grid of equal columns: a delivery date needs ~70px
   * and a style count needs ~12, so content sizing beats any ratio guessed in
   * advance. Values truncate-and-reveal, so a refusal sentence in place of a
   * number cannot break the row.
   */
  stats?: (r: Row) => CardStat[];
  /**
   * A muted note on the LEFT of the footer strip, sharing the row with the view
   * and delete buttons.
   *
   * It exists so the Created Date / Created User line does not cost a card a
   * SECOND bordered row (client 2026-08-19, the 6-up card). AGENTS.md requires
   * that pair on every listing and requires it APPENDED to the screen's own meta
   * rather than substituted for it — putting it here keeps both true and buys
   * back a row, which at a sixth of the width is a real part of the card.
   */
  footerNote?: (r: Row) => ReactNode;
  /**
   * Cards per row at the widest CONTAINER width. **Defaults to 1**, which is the
   * single-column stack every existing caller renders inside its own
   * `md:hidden` — so this prop cannot change any of them.
   *
   * ## Container queries, not viewport breakpoints
   *
   * A card grid should size to the space it is IN, not to the window. This one
   * sits beside a ~280px sidebar the viewport knows nothing about, so a
   * `2xl:grid-cols-6` would put six cards into 1216px and clip them. Same
   * argument `field.tsx` spells out for `@container/section`, same idiom.
   *
   * ## 4 AND 6 ALSO TURN THE CARD DENSE
   *
   * The density IS the column count: a caller asking for six has already decided
   * a card is ~230px wide inside its padding, and there is no useful combination
   * of "six across" and "roomy". See `dense` in the body.
   */
  columns?: 1 | 2 | 3 | 4 | 6;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  const showDelete = canDelete && !!onDelete;
  const showFooter = showDelete || !!onView || !!footerNote;
  const grid = columns > 1;
  /**
   * FOUR OR MORE IS A DIFFERENT CARD, not the same card made narrower.
   *
   * At six across a card is ~230px inside its padding — less than the `p-4`, the
   * 15px title and a pill in its own column were ever drawn for. The three other
   * call sites pass no `columns` at all, so every branch guarded on this is
   * unreachable for them and their output is unchanged.
   */
  const dense = columns >= 4;

  return (
    // The named container the ladder queries. A plain wrapper, because an
    // element cannot be the container AND query it.
    <div className={grid ? "@container/cards" : undefined}>
    <div className={grid ? cn("grid gap-3", COLUMN_LADDER[columns]) : "space-y-2.5"}>
      {rows.map((r) => (
        <div
          key={getKey(r)}
          className={cn(
            // `min-w-0`: a grid track's default `min-width: auto` lets one long
            // unbroken value push its column WIDER rather than truncate, which
            // at six across drags the whole row out of shape. The dashboard's
            // own 6-up grid carries the same guard on its wrapper.
            "min-w-0 rounded-xl border border-border bg-surface",
            // EQUAL HEIGHTS, GRID ONLY. Cards along a row carry different amounts
            // of meta, so without this the shortest card's footer floats up and
            // the delete buttons do not line up. Guarded on `grid` so the
            // single-column stack every other caller renders is unchanged.
            grid && "flex h-full flex-col",
          )}
        >
          <button
            type="button"
            onClick={onEdit ? () => onEdit(r) : undefined}
            disabled={!onEdit}
            className={cn(
              "block w-full text-left enabled:active:bg-surface-muted disabled:cursor-default",
              dense ? "px-3.5 py-3" : "p-4",
              grid && "flex-1",
            )}
          >
            {dense ? (
              /**
               * THE PILL SITS ON A LINE, NOT IN A COLUMN — and that, rather than
               * a smaller font, is why this branch exists.
               *
               * The layout below makes the pill a SIBLING of the whole text
               * block, so an 88px "Recalculate" narrows the title, the subtitle
               * and every line of meta by 88px at once. At ~230px that is a third
               * of the card spent on a word belonging to one line. Here the title
               * takes the full width and only the subtitle row pays.
               *
               * NO `font-mono` ON THE SUBTITLE, unlike the branch below: at this
               * width that line carries a customer NAME as well as a code, and
               * the call site puts mono on the half that wants it.
               */
              <>
                <Truncated className="text-[13px] font-semibold text-foreground">
                  {title(r)}
                </Truncated>
                {(subtitle || pill) && (
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {subtitle?.(r)}
                    </div>
                    {pill && <span className="shrink-0">{pill(r)}</span>}
                  </div>
                )}
                <StatStrip stats={stats?.(r)} />
                {meta && <div className="mt-2 text-xs text-muted-foreground">{meta(r)}</div>}
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Truncated className="text-[15px] font-semibold text-foreground">{title(r)}</Truncated>
                  {subtitle && (
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{subtitle(r)}</div>
                  )}
                  {meta && <div className="mt-0.5 text-xs text-muted-foreground">{meta(r)}</div>}
                  <StatStrip stats={stats?.(r)} />
                </div>
                {pill && pill(r)}
              </div>
            )}
          </button>
          {showFooter && (
            <div className="flex items-center gap-1 border-t border-border px-3 py-1.5">
              {/* The note takes the slack so the buttons stay hard right whether
                  there is one or not. `min-w-0` because it is usually a date and
                  a name, and a long name must truncate rather than shove the
                  delete control off the card. */}
              <div className="min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground">
                {footerNote?.(r)}
              </div>
              {onView && (
                <Button variant="ghost" size="sm" aria-label="View" title="View" onClick={() => onView(r)}>
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {showDelete && (canDeleteRow?.(r) ?? true) && (
                <DeleteConfirmButton isPending={isPending} onConfirm={() => onDelete!(r)} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
    </div>
  );
}

/**
 * The figures row inside a card.
 *
 * FLEX, NOT EQUAL COLUMNS. Three even thirds of a ~230px card give each cell
 * ~72px, which fits "Styles / 2" three times over and clips "30/09/2026" — so
 * the cells size to their content and `justify-between` spreads them, first
 * hard left and last hard right. That also means it works unchanged for two
 * figures or four.
 *
 * VALUE ABOVE LABEL, and the value carries the weight: scanning thirty cards is
 * scanning the numbers, and a 10px label under each one is enough to say which
 * number it is.
 *
 * Every value goes through `Truncated`, which is doing real work here rather
 * than being defensive — Material BOM prints a REFUSAL SENTENCE where the
 * production quantity would be ("no approval quantity yet"), and without the
 * clip-and-reveal one unanswerable card would set the height of its whole row.
 */
function StatStrip({ stats }: { stats?: CardStat[] }) {
  if (!stats || stats.length === 0) return null;
  return (
    <dl className="mt-2 flex items-start justify-between gap-2">
      {stats.map((s, i) => (
        <div
          key={i}
          className={cn(
            "min-w-0",
            i === stats.length - 1 ? "text-right" : i > 0 ? "text-center" : undefined,
          )}
        >
          <dd className="text-[13px] font-semibold tabular-nums text-foreground">
            <Truncated>{s.value}</Truncated>
          </dd>
          <dt className="text-[10px] leading-tight text-muted-foreground">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
