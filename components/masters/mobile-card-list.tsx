"use client";

import { type ReactNode } from "react";
import { Eye, FileText } from "lucide-react";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Truncated } from "@/components/ui/truncated";
import type { StatusTone } from "@/lib/ui/tone";
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
export type CardStat = {
  label: string;
  value: ReactNode;
  /**
   * THE FIGURE THE CARD IS SCANNED BY, drawn at roughly 1.5× the others.
   *
   * Three figures at one weight is three figures nobody reads: a merchandiser
   * going down this queue is going down the QUANTITIES, and on Material BOM the
   * production quantity is the number the whole document multiplies. Opt-in, so
   * a screen that has no such figure keeps a flat strip and is unchanged.
   *
   * Only ONE stat should carry it. Nothing enforces that — two leads is simply
   * two big numbers, which is the same failure as none.
   */
  lead?: boolean;
};


/**
 * THE TRACK, ONE STATIC LITERAL PER DENSITY — and it names a card WIDTH, not a
 * column count.
 *
 * It was a ladder of fixed counts (`@5xl/cards:grid-cols-4 @7xl/cards:grid-cols-6`),
 * which is right for a full list and wrong for a short one: Material BOM's queue
 * holds three confirmed orders, and six fixed tracks drew three ~250px cards in
 * a 1560px pane — 46% filled, and the void read before the work did (client
 * 2026-08-21, screenshot 2440: "this screen look to normal").
 *
 * `auto-fit` fixed exactly that half and left the other half alone — until the
 * BOM queue's own short lists (Fabric BOM: 2 confirmed orders) made the OTHER
 * failure visible: two cards on a 1560px pane stretched past 30rem apiece
 * (client 2026-09-04, screenshot: "it now dynamically adjusting the size fo the
 * card but make it static as 6 card per row"). Both complaints are the same
 * root cause — a count-of-two decides a width nobody chose — read in opposite
 * directions, and only one call site (`bom-queue.tsx`) has ever passed `6`, so
 * fixing it here costs nothing else its ladder ever promised.
 *
 * `6` IS NOW A LITERAL COLUMN COUNT, responsive rather than width-driven: 1
 * column narrow, stepping to 6 only once the pane is wide enough to hold six
 * ~230px cards without squeezing them. A short queue leaves the remainder of
 * the row blank — the trade the client asked for explicitly, in these words.
 *
 * Never an interpolated `minmax(` + n + `rem,1fr)`: Tailwind v4 scans source
 * TEXT, so a computed class produces no CSS at all — the warning `FIELD_TRACK`
 * and `FIELD_TRACK_14` both carry, and the reason this is a table rather than a
 * function. Every literal below is scannable as written.
 */
const TRACK: Record<number, string> = {
  1: "",
  2: "grid-cols-[repeat(auto-fit,minmax(22rem,1fr))]",
  3: "grid-cols-[repeat(auto-fit,minmax(19rem,1fr))]",
  4: "grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]",
  /* SIX ACROSS WHEN SIX FIT, AND A CARD NEVER NARROWER THAN 15rem (operator,
     2026-09-18: order IDs, pills and figures "overlapping or misaligned").
     These were VIEWPORT breakpoints, so `2xl:` put six cards into whatever a
     1536px window left beside the sidebar — ~200px each, ~165px of content,
     against ~190px of "PRODUCTION · LINES · DELIVERY" and their values. The
     steps below are measured on the GRID's own width (`@container/cards`,
     which the list wraps round it for this track), at n × 15rem plus the
     gaps: six still appear on any pane that can hold six readable cards. */
  6: "grid-cols-1 @min-[30.75rem]/cards:grid-cols-2 @min-[46.5rem]/cards:grid-cols-3 @min-[62.25rem]/cards:grid-cols-4 @min-[78rem]/cards:grid-cols-5 @min-[93.75rem]/cards:grid-cols-6",
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
  onReports,
  canReportsRow,
  isPending = false,
  empty = "No records yet.",
  stats,
  footerNote,
  hint,
  tone,
  badge,
  columns = 1,
  queue = false,
  accent,
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
  /**
   * A document action reachable WITHOUT opening the row for edit — a printed
   * report, an export — beside View and Delete in the footer. Same shape as
   * `canDeleteRow`: only a row that already HAS the document behind it gets
   * the button, same guard, so nothing renders that opens on nothing.
   */
  onReports?: (r: Row) => void;
  canReportsRow?: (r: Row) => boolean;
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
   * ONE SENTENCE SAYING WHAT TO DO ABOUT THIS ROW — not what it is.
   *
   * A pill names a state; it does not say whether the state needs anything. On
   * Material BOM the sentence already existed — `bomStatusHint()` has been
   * returning "The order's quantities have changed since this plan was computed.
   * Open it and save again." since the screen was built — and the screen spent
   * it on a `title=` attribute, which is invisible on touch, invisible while
   * scanning, and invisible to anyone who does not know to hover.
   *
   * Return null for the rows where it would only repeat the pill. A hint on
   * every card is a hint on none: three "No material plan yet." beside three
   * Pending pills teaches the operator to stop reading the line, and then the
   * one card that says something else is not read either.
   *
   * DROPPED WHEN THE CARD IS NARROW (see the container query in the footer): at
   * a sixth of the width it truncates to three words, and a truncated
   * instruction is worse than the tooltip it replaced.
   */
  hint?: (r: Row) => ReactNode;
  /**
   * The row's status tone, drawn as a 3px stripe down the card's leading edge.
   *
   * The SAME tone the pill already carries, deliberately: the pill is read one
   * card at a time and the stripe is read down a whole grid at once. Material
   * BOM's queue is sorted by `BOM_STATUS_RANK` ("what needs doing, first") and
   * nothing on screen showed it — a sort you cannot see is a sort nobody
   * benefits from.
   *
   * Omit it and the card keeps its ordinary border, so no existing caller
   * changes.
   */
  tone?: (r: Row) => StatusTone | null | undefined;
  /**
   * A COLOURED MARK, PINNED SO IT POKES ABOVE THE CARD'S OWN TOP EDGE — opt-in,
   * and off by default so the six other `MobileCardList` screens are unchanged
   * (client 2026-09-04, from a reference screenshot of a project-tracker card:
   * "took this card for reference then design for us").
   *
   * IT REPLACES THE TONE STRIPE ON THE CARDS THAT TAKE IT, rather than sitting
   * beside it — `tone`'s own note says the stripe exists so a state "read down a
   * whole grid at once" is visible without opening a card, and a filled, coloured
   * circle at the same tone does that MORE visibly than 3px of border colour, so
   * running both would be the same claim made twice in one corner. A caller that
   * passes `badge` gets the stripe suppressed automatically; a caller that does
   * not is untouched.
   *
   * `icon` IS THE CALLER'S, deliberately not inferred from `tone`: two different
   * screens can both have a `warning`-toned row for a different REASON ("not
   * started" vs "needs your attention"), and a shared icon-per-tone table would
   * either pick the wrong glyph for one of them or force a third prop to override
   * it. The badge answers "what does this row need", the same question the state
   * dot on a BOM rail's own rail already answers one level down.
   */
  badge?: (r: Row) => { tone: StatusTone; icon: ReactNode } | null | undefined;
  /**
   * How narrow a card may get before the grid stops adding tracks — see `TRACK`.
   * **Defaults to 1**, which is the single-column stack every existing caller
   * renders inside its own `md:hidden`, so this prop cannot change any of them.
   *
   * ## The grid sizes to the space it is IN, not to the window
   *
   * A `2xl:grid-cols-6` would put six cards into the 1216px left beside a ~280px
   * sidebar the viewport knows nothing about, and clip them. That was the
   * argument for the container-query ladder this replaced; `auto-fit` needs no
   * query at all, since a track is measured against the grid's own width.
   *
   * ## DENSITY IS THE CARD'S BUSINESS NOW, NOT THE CALL SITE'S
   *
   * It used to be `dense = columns >= 4` — right while the count was fixed, and
   * impossible once `auto-fit` decides the count from the row COUNT as well as
   * the width. Six orders at 1560px are ~240px cards; three orders are ~500px
   * cards, from the same `columns={6}`. So the card declares `@container/card`
   * and upgrades itself at `@min-[22rem]`: same DOM, two densities, and the call
   * site keeps saying the one thing it knows.
   */
  columns?: 1 | 2 | 3 | 4 | 6;
  /**
   * THE BOM QUEUE'S CARD (operator, 2026-09-18, from a reference screenshot of
   * the Fabric BOM queue). Grid only, and opt-in, so no other caller changes.
   *
   * The title with its pill on the same line, the subtitle under it, the
   * figures (label ABOVE value, small caps), the `tone` stripe down the
   * leading edge, and a slim strip along the floor holding `footerNote` and
   * the View / Reports / Delete buttons. A TAP ON THE CARD OPENS THE RECORD —
   * `onEdit`, straight into the editor, exactly as before the redesign.
   *
   * NOTHING ELSE OPENS, AND NOTHING HAPPENS ON HOVER. The same day this layout
   * went in it carried a details drawer on hover, then on click, then a
   * slide-over; the operator had all three removed ("antha card a touch panna
   * intha mari visible aaganum" — a touch opens the BOM itself). The card has
   * no state, no overlay, no tooltip and no hover lift.
   *
   * `badge` is ignored here: the stripe is this layout's status mark.
   */
  queue?: boolean;
  /**
   * A `queue` card's left-edge colour as a class (`border-l-red-700`),
   * overriding the one `tone` picks. For a caller whose states need an exact
   * shade rather than the skin's tone — the BOM queue's dark-red Pending.
   * Return undefined to fall back to `tone`. Static literals only (Tailwind
   * scans source text).
   */
  accent?: (r: Row) => string | undefined;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  const showDelete = canDelete && !!onDelete;
  const showFooter = showDelete || !!onView || !!onReports || !!footerNote || !!hint;
  const grid = columns > 1;

  /** View · Reports · Delete — one definition, so every layout offers a row
   *  the same buttons.
   *
   *  ON A `queue` CARD THEY ARE NAMED, NOT TOOLTIPPED (operator, 2026-09-18:
   *  no title tooltips on these cards). An icon-only button with its `title=`
   *  taken away says nothing to a sighted user, so the word goes beside the
   *  icon instead; every other caller keeps the compact icon and its tooltip. */
  const actions = (r: Row) => (
    <>
      {onView && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={queue ? undefined : "View"}
          title={queue ? undefined : "View"}
          onClick={() => onView(r)}
        >
          <Eye className="h-4 w-4" />
          {queue && "View"}
        </Button>
      )}
      {onReports && (canReportsRow?.(r) ?? true) && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={queue ? undefined : "Reports"}
          title={queue ? undefined : "Reports"}
          onClick={() => onReports(r)}
        >
          <FileText className="h-4 w-4" />
          {queue && "Reports"}
        </Button>
      )}
      {showDelete && (canDeleteRow?.(r) ?? true) && (
        <DeleteConfirmButton
          isPending={isPending}
          onConfirm={() => onDelete!(r)}
        />
      )}
    </>
  );

  const list = (
    <div className={grid ? cn("grid gap-3", TRACK[columns]) : "space-y-2.5"}>
      {rows.map((r) => {
        const rowTone = tone?.(r);
        const rowHint = hint?.(r);
        const rowBadge = badge?.(r);
        if (grid && queue) {
          return (
            <QueueCard
              key={getKey(r)}
              tone={rowTone}
              accent={accent?.(r)}
              title={title(r)}
              subtitle={subtitle?.(r)}
              pill={pill?.(r)}
              stats={stats?.(r)}
              note={footerNote?.(r)}
              actions={showFooter ? actions(r) : null}
              onEdit={onEdit ? () => onEdit(r) : undefined}
            />
          );
        }
        return (
        <Card
          key={getKey(r)}
          /* THE APP'S SURFACE PRIMITIVE, not a hand-rolled copy of it. This was
             `rounded-xl border border-border bg-surface` — `Card`'s class string
             with the ground taken out — so every card in every list sat as a
             white rectangle on a #f6f7f9 canvas while `--smoke`, `--elev` and
             `--sheen` sat declared and unused. `globals.css` calls that trio
             "the cue that reads as a physical panel rather than a bordered
             rectangle", which is exactly the complaint. Composing the primitive
             also picks up its `data-card` print guard, which drops the wash and
             the shadow on paper. */
          interactive={grid && !!onEdit}
          className={cn(
            // `min-w-0`: a grid track's default `min-width: auto` lets one long
            // unbroken value push its column WIDER rather than truncate, which
            // at six across drags the whole row out of shape. The dashboard's
            // own 6-up grid carries the same guard on its wrapper.
            "min-w-0",
            // EQUAL HEIGHTS, GRID ONLY. Cards along a row carry different amounts
            // of meta, so without this the shortest card's footer floats up and
            // the delete buttons do not line up. Guarded on `grid` so the
            // single-column stack every other caller renders is unchanged.
            // `@container/card` is what the two densities below query.
            grid && "@container/card flex h-full flex-col",
            /* A CARD NEVER GROWS PAST 40rem. It only ever binds at one or two
               rows, where `auto-fit` would otherwise hand a single order the
               whole 1560px pane and call it a card. */
            grid && "max-w-[40rem]",
            // `relative` IS `badge`'s ONLY, so the six other callers — none of
            // which pass it — never pay for a positioning context they don't
            // use. The Card primitive itself sets no `overflow`, which is what
            // lets the badge poke past the top edge instead of being clipped.
            rowBadge && "relative overflow-visible",
            /* A DEEPER REST SHADOW, LIKE THE DASHBOARD'S KPI TILES (client
               2026-09-04: "look tto planed ... can add shadow effect how we
               used in dhashboard like for this card too").
               `Card` already carries `shadow-elev` at rest and lifts to
               `shadow-elev-hi` on hover via `interactive` — the SAME pair the
               dashboard's own cards use, since both compose this primitive.
               The skin's resting `--elev` is a deliberately quiet shadow
               (0.05/0.20 alpha, tuned for a full-width KPI tile with air
               around it), and at a sixth of that width, sitting flush beside
               five siblings, it reads as flat rather than lifted. Rather than
               darken `--elev` for every `data-card` in the skin, this one
               caller takes the HOVER tier as its resting state — the same
               shadow value the dashboard's cards already use, just always on
               instead of only on interaction. */
            rowBadge && "shadow-elev-hi",
            // The stripe. `border-l-*` is a different tailwind-merge group from
            // the `border`/`border-border` Card sets, so both survive the cn().
            // SUPPRESSED WHEN A BADGE IS PRESENT — see `badge`'s own note: the
            // two are the same claim ("this is what state the row is in") made
            // in two places, and the badge makes it more visibly than a 3px edge.
            !rowBadge && rowTone && "border-l-[3px]",
            !rowBadge && rowTone && TONE_EDGE[rowTone],
          )}
        >
          {rowBadge && (
            /* THE BADGE + ITS HALO — a coloured disc on a paler ring of the
               same hue, pinned so its top half sits OUTSIDE the card (client
               reference: a project-tracker card whose category icon does the
               same).
               THE MATH HAS TO CLEAR THE TITLE, NOT JUST LOOK CLEAR (client
               2026-09-04, screenshot: the badge sat directly over "HO/RE",
               only "/26-27/0001" showing) — AND THEN WANTED MORE AIR, FOUR
               TIMES OVER (client, same day: "move the icon litlbit top and
               move the card content litbit down", "move the content litlbit
               again bottom", "move again more bottom the card conte with
               enlarzing the card size", then "still that icn and card
               content sticked"). `-top-4` (-16px) plus a 36px halo puts its
               own bottom edge 20px below the card's top; the button's
               `pt-12` below is 48px, a 28px gap — roughly the height of the
               badge itself, which is deliberately generous after three
               smaller steps in a row each came back as "still too close".
               `px`/`pb` grow with `pt` — see the button's own note: past a
               point, more top padding alone just crowds everything else
               against the bottom of an unchanged box, which reads as
               "shoved down", not "more room". */
            <div
              className={cn(
                "pointer-events-none absolute -top-4 left-3 flex h-9 w-9 items-center justify-center rounded-full",
                BADGE_HALO[rowBadge.tone],
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-white shadow-elev",
                  BADGE_SOLID[rowBadge.tone],
                )}
              >
                {rowBadge.icon}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onEdit ? () => onEdit(r) : undefined}
            disabled={!onEdit}
            className={cn(
              "block w-full text-left enabled:active:bg-surface-muted disabled:cursor-default",
              /**
               * A BADGED CARD RUNS ROOMIER ALL ROUND, not just on top (client
               * 2026-09-04: "move again more bottom the card conte with
               * enlarzing the card size"). Pushing the title down without
               * giving the rest of the card more room would crowd the stats
               * and footer against it instead — so `px`/`pb` grow one step
               * with `pt`, and the card reads as genuinely larger rather than
               * as the same box with its content shoved to the bottom of it.
               */
              grid && (rowBadge ? "flex-1 px-4 @min-[22rem]/card:px-5" : "flex-1 px-3.5 @min-[22rem]/card:px-4"),
              !grid && "p-4",
              /**
               * `pt-*`/`pb-*`, NEVER `py-*` PLUS A `pt-*` ON TOP OF IT. That was
               * the first cut here, and it silently did nothing: `cn()` is
               * `twMerge`, and this project's installed `tailwind-merge` (v3.6,
               * checked directly rather than assumed) does NOT fold a bare
               * `pt-8` into a `py-3` it follows — `twMerge('py-3','pt-8')`
               * returns `"py-3 pt-8"`, both classes, and whichever rule Tailwind
               * happens to have generated LATER in the stylesheet wins. That is
               * exactly the bug this screenshot showed: the badge still
               * overlapping the title after the "fix", because `py-3`'s 12px
               * `padding-top` was still the one taking effect.
               *
               * THE ACTUAL FIX IS TO NEVER EMIT BOTH: this branch picks one
               * complete top/bottom pair up front, so there is nothing left for
               * `cn()` to reconcile. `pt-2 pt-4` and `mt-2 mt-4` DO merge
               * correctly in the same check — it is specifically the
               * `py`-vs-`pt` cross-group case that this version does not know
               * about, so the rule for every future caller is: pick `pt-`/`pb-`
               * OR `py-`, never both in one `cn()` call.
               */
              grid && (rowBadge ? "pt-12 pb-4 @min-[22rem]/card:pb-4" : "py-3 @min-[22rem]/card:py-3.5"),
            )}
          >
            {grid ? (
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
               *
               * ONE DOM, TWO DENSITIES. This used to be the `dense` branch and
               * the roomy one was the `else` below; a grid whose column count is
               * now decided by `auto-fit` cannot pick between them at the call
               * site, so the compact shape is the base and `@min-[22rem]/card:`
               * upgrades it in place. The stacked branch below is untouched, and
               * with no `@container/card` above it those variants can never
               * fire there.
               */
              <>
                <Truncated className="text-[13px] font-semibold text-foreground @min-[22rem]/card:text-[15px]">
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
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5",
                // NO RULE ABOVE THE FOOTER ON A BADGED CARD (client 2026-09-04:
                // "in card inside i can [see a] line, remove it"). The badge
                // and its own shadow already say "this is a separate block"
                // more than a hairline does, and a border on top of that read
                // as one divider too many. Every other `MobileCardList` caller
                // keeps the line — it is what tells the footer apart from the
                // button above it when there is no badge doing that job.
                !rowBadge && "border-t border-border",
              )}
            >
              {/* THE INSTRUCTION, AND ONLY WHERE IT FITS. `@min-[20rem]/card:`
                  rather than always: at a sixth of the pane this line truncates
                  to three words, and half an instruction is worse than the
                  tooltip it came from — which is still on the pill. */}
              {rowHint && (
                <div className="hidden min-w-0 flex-1 @min-[20rem]/card:block">
                  {/* Through `Truncated`, not a bare `truncate`: this line is a
                      SENTENCE, so it is the likeliest thing on the card to be
                      cut off, and an ellipsis with no way to read the rest is
                      the dead end LAYOUT.md §14 is about. */}
                  <Truncated className="block text-[11px] leading-tight text-muted-foreground">
                    {rowHint}
                  </Truncated>
                </div>
              )}
              {/* The note takes the slack so the buttons stay hard right whether
                  there is one or not. `min-w-0` because it is usually a date and
                  a name, and a long name must truncate rather than shove the
                  delete control off the card. */}
              <div className="min-w-0 flex-1">
                <Truncated className="block text-[11px] leading-tight text-muted-foreground">
                  {footerNote?.(r)}
                </Truncated>
              </div>
              {actions(r)}
            </div>
          )}
        </Card>
        );
      })}
    </div>
  );

  // `TRACK[6]` steps on the grid's own width, and a container cannot query
  // itself — so that one track gets a wrapper to measure. No other caller
  // changes shape.
  return columns === 6 ? <div className="@container/cards">{list}</div> : list;
}

/** The stripe colour per tone — static literals, never `border-l-` + tone. */
const TONE_EDGE: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  // Neutral makes no claim, so it takes the record separator's grey rather than
  // a hue — visible as an edge, silent as a signal.
  neutral: "border-l-border-strong",
};

/**
 * THE BADGE'S TWO LAYERS — static literals for the same reason `TONE_EDGE` is
 * one, and the same shapes `StatusPill` already draws (`bg-*-soft` behind,
 * `bg-*` on the mark itself), so a badge and its row's own pill are always the
 * same colour by construction rather than by two people picking the same hex.
 */
const BADGE_HALO: Record<StatusTone, string> = {
  success: "bg-success-soft",
  warning: "bg-warning-soft",
  danger: "bg-danger-soft",
  info: "bg-info-soft",
  neutral: "bg-surface-muted",
};
const BADGE_SOLID: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};

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
    // `items-end`, so a `lead` figure grows UPWARD and every label still sits on
    // one line across the strip. Identical to the old `items-start` while all
    // the values are the same size.
    <dl className="mt-2 flex items-end justify-between gap-2">
      {stats.map((s, i) => (
        <div
          key={i}
          className={cn(
            "min-w-0",
            i === stats.length - 1 ? "text-right" : i > 0 ? "text-center" : undefined,
          )}
        >
          <dd
            className={cn(
              "font-semibold tabular-nums text-foreground",
              s.lead
                ? "text-[16px] leading-tight tracking-tight @min-[22rem]/card:text-[19px]"
                : "text-[13px]",
            )}
          >
            <Truncated>{s.value}</Truncated>
          </dd>
          <dt className="text-[10px] leading-tight text-muted-foreground">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * A `queue` card — see the `queue` prop for the why; this is the how.
 *
 * TWO SIBLINGS INSIDE ONE `Card`: the body is the tap-to-open button, and the
 * strip below it holds the buttons. Never one inside the other — a Delete
 * inside the open-button is the button-in-button markup `MobileCardList` was
 * written to avoid.
 *
 * THE STRIP IS ALWAYS THERE, EVEN EMPTY. A Pending row has no BOM, so no
 * Reports, no Delete and no Created date; if its strip were dropped, its
 * figures (`mt-auto`, on the body's floor) would sit one strip lower than a
 * saved neighbour's and the row would stop lining up. `min-h-10` holds the
 * strip at a button's height whatever it contains.
 *
 * No `interactive` on the `Card`: it does not lift or change on hover.
 */
function QueueCard({
  tone,
  accent,
  title,
  subtitle,
  pill,
  stats,
  note,
  actions,
  onEdit,
}: {
  tone: StatusTone | null | undefined;
  accent?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  pill?: ReactNode;
  stats?: CardStat[];
  note?: ReactNode;
  actions: ReactNode;
  onEdit?: () => void;
}) {
  const edge = accent ?? (tone ? TONE_EDGE[tone] : "border-l-border-strong");
  return (
    <Card className={cn("flex h-full min-w-0 max-w-[40rem] flex-col border-l-[3px]", edge)}>
      <button
        type="button"
        onClick={onEdit}
        disabled={!onEdit}
        /* `p-4` ON EVERY CARD, not a step up at a container width: the same
           inset on every card is what lines their contents up down a column
           of the grid (operator, 2026-09-18). `flex-col` so the figures sit on
           the body's floor and stay level across a row whose customer lines
           differ. */
        className="flex w-full flex-1 flex-col p-4 text-left enabled:active:bg-surface-muted disabled:cursor-default"
      >
        {/* THE HEADER: id left, pill right, and they cannot meet. The id is the
            one that gives ground — `min-w-0 flex-1` lets it shrink and
            ellipsis — while the pill is `shrink-0`, since a status cut to
            "Recalc…" says nothing. `items-start` keeps both on the first line's
            top edge when the pill is the taller of the two. */}
        <div className="flex w-full items-start justify-between gap-2">
          {/* truncate-reveal: exempt -- no hover bubbles on a queue card (operator, 2026-09-18); an id fits at the 15rem card floor, and a tap opens the record */}
          <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-foreground">
            {title}
          </span>
          {pill && <span className="shrink-0 leading-5">{pill}</span>}
        </div>
        {/* THE CUSTOMER (AND PO), ITS OWN LINE UNDER THE ID, `truncate` for a
            long name. */}
        {subtitle && (
          // truncate-reveal: exempt -- no hover bubbles on a queue card (operator, 2026-09-18); a tap opens the record, whose header prints the customer in full
          <span className="mt-1 block w-full min-w-0 truncate text-xs leading-4 text-muted-foreground">
            {subtitle}
          </span>
        )}
        <LabelledStats stats={stats} />
      </button>
      {(note || actions) && (
        <div className="flex min-h-10 items-center gap-1 border-t border-border py-1 pl-4 pr-2">
          {/* truncate-reveal: exempt -- no hover bubbles on a queue card (operator, 2026-09-18); a date and a creator's name, the Created pair every listing carries */}
          <span className="block min-w-0 flex-1 truncate text-[11px] leading-tight text-muted-foreground">
            {note}
          </span>
          {actions}
        </div>
      )}
    </Card>
  );
}

/**
 * The figures of a `queue` card, in the reference's shape: a small-caps
 * label ABOVE each value, every column left-aligned so the labels form one
 * line and the values another across the whole grid.
 *
 * EVERY COLUMN IS AT LEAST ITS OWN LABEL, AND THAT IS THE ALIGNMENT FIX
 * (operator, 2026-09-18: "PRODUCTION" and "LINES" ran together). The tracks
 * were `minmax(0, …fr)`, so a column could be squeezed below the width of
 * its own nowrap label and the label painted over its neighbour. Now each is
 * `minmax(min-content, …fr)` — and the VALUE opts out of that minimum with
 * `contain: inline-size`, so only the label sets it. That split is the point:
 * a refusal sentence in place of a number ("no approval quantity yet") would
 * otherwise widen its column and push the date off the card, where now it
 * ellipsises.
 *
 * Because every card in a row has the same width and the same labels, the
 * same tracks resolve on every card — which is what lines the figures up
 * ACROSS the grid, not just within one card.
 *
 * THE LAST COLUMN IS WIDER on a three-figure strip: on every caller it is the
 * delivery date, the longest value and the one carrying a "· 12d" suffix; the
 * middle one is a small count. Static literals, never an interpolated track
 * (see `TRACK`).
 */
const STAT_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-[repeat(2,minmax(min-content,1fr))]",
  3: "grid-cols-[minmax(min-content,1.15fr)_minmax(min-content,0.75fr)_minmax(min-content,1.2fr)]",
  4: "grid-cols-[repeat(4,minmax(min-content,1fr))]",
};

function LabelledStats({ stats }: { stats?: CardStat[] }) {
  if (!stats || stats.length === 0) return null;
  return (
    // `mt-auto`: the strip sits on the card's floor, so it is level across a
    // grid row even where one card's header is taller than its neighbour's.
    <dl
      className={cn(
        "mt-auto grid w-full gap-x-3 pt-3",
        STAT_COLS[stats.length] ?? "auto-cols-fr grid-flow-col",
      )}
    >
      {stats.map((s, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="whitespace-nowrap text-[9.5px] font-medium uppercase leading-3 tracking-wide text-muted-foreground">
            {s.label}
          </dt>
          <dd
            className={cn(
              // truncate-reveal: exempt -- no hover bubbles on a queue card (operator, 2026-09-18); at the 15rem card floor the figures fit, and only a "· 12d" suffix can clip
              "truncate font-semibold tabular-nums text-foreground [contain:inline-size]",
              s.lead ? "text-[15px] leading-5" : "text-[13px] leading-5",
            )}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
