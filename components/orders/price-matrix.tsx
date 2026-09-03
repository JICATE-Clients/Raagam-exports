"use client";

import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  MATRIX_FOOT,
  MATRIX_HEAD,
  MATRIX_SIZE_TOKEN,
  matrixCell,
  sizeColPx,
  textColPx,
} from "./matrix-grid";

/**
 * THE PRICES TAB'S RATE GRID — colours down, sizes across, the rate in the cell
 * (client 2026-08-21, screenshot 2439).
 *
 * WHAT WAS WRONG WAS THE SHAPE, NOT THE DENSITY. Colour × Size is a table with
 * two axes and the tab rendered it as a flat list, which has one — so the second
 * axis was paid for in REPETITION: three colours over a seven-size run emitted
 * 21 rows of `[Colour] [Size] [Price]` with each colour name written out seven
 * times. The client's words were "if i choose color each componet is lisitng
 * with everytime with color … now its took huge space in screen".
 *
 * Naming each colour once turns those 21 rows into 3. The rate field then loses
 * its own border — the grid rule IS the field edge — which is where the rest of
 * the height goes: 34px rows became 26px, ~860px of grid body became ~124px.
 * The second half was asked for separately ("reduc ethe field size make it
 * compact") and is only possible because of the first: a standalone `<Input>`
 * needs `h-9`/`h-8` to draw its own border and be findable as a box, and a cell
 * in a ruled table needs neither.
 *
 * ## IT WEARS THE ASSORTMENT GRID'S FRAME (client 2026-09-02)
 *
 * "the quantities tab details inside that assortment kind of ui" — the two tabs
 * ask the same shape of question (an identity down the left, the order's size
 * run across the top, a value in every square) and were answering it in two
 * different visual languages. This was a `<table>`; Quantities ▸ Assort is a CSS
 * grid with a computed track. It is that grid now: one `data-grid-body`, rows of
 * `display: contents`, a sticky identity column, a sticky header band of size
 * tokens, a sticky value edge on the right and a band underneath.
 *
 * **Three things deliberately did NOT come across with the look:**
 *
 * - **THE WIDTH.** Assort is `w-full` and ends in a `1fr` spacer; this still
 *   HUGS ITS CONTENT, as it has since 08-21. Assort earns the spacer because
 *   seventeen sizes fill the pane — with one to five columns a `1fr` has nothing
 *   to be proportional to, and the client saw both failure modes within an hour
 *   (2638: a 73px rate beside 1,100px of nothing; 2640: the same emptiness moved
 *   into the identity column). See the track's own note. **The frame was never
 *   the width.**
 * - **THE ROW HEIGHT.** Assort's cells are `min-h-9`; these stay at 26px, which
 *   is the compaction the client bought on 08-21 and would have been handed
 *   straight back by copying a class name. `matrixCell()` takes the height as an
 *   argument for exactly this reason — see its note.
 * - **AN AVERAGE IN THE FOOT.** Assort's band sums its column, and the money
 *   equivalent here would be a mean rate — which the client REMOVED on
 *   2026-08-21 ("that avg field is no need, remove it from column and row
 *   both"), because the order's real average is `orderValue`'s on the Logistic
 *   tab with its own five refusals, and a second one here reads as a
 *   contradiction. So the band states PIECES: the weight behind each column,
 *   which is the number that makes those rates readable and is not a second
 *   answer to a question already answered elsewhere.
 *
 * ## ONE COMPONENT, FOUR MODES
 *
 * The four price types are not four grids; they are this grid with one or both
 * axes collapsed, which is why `applyPriceMode` reshapes rather than replaces:
 *
 *     Style-wise            1 × 1   a single Price field
 *     Color-wise            N × 1   colours down, one Price column
 *     Size-wise             1 × M   one row of rates under the size run
 *     Color-wise Size-wise  N × M   the full matrix
 *
 * Pass `colours: []` / `sizes: []` to collapse an axis. Nothing here knows the
 * mode's NAME — `priceAxes` already turns that string into two booleans, and a
 * second reading of the same string is how the two come to disagree.
 *
 * PRESENTATIONAL ON PURPOSE. It owns no state and no rows: `amendment-screen`
 * keeps `priceDetails` and this renders what it is handed. That is what keeps it
 * a small file rather than another section of a 19,000-line screen.
 */

/** One rate the order owes a number for. `key` is the row's identity in `priceDetails`. */
export interface PriceMatrixRate {
  key: string;
  combo: string;
  size_id: string | null;
  price: string;
}

export interface PriceMatrixProps {
  /** The colour axis, in the order the order declares its combos. Empty collapses it. */
  colours: string[];
  /** The size axis, in the STYLE's declared run order — 2 YEARS before 14 YEARS,
   *  never alphabetical. Empty collapses it. */
  sizes: { id: string; label: string }[];
  /** Every rate row of the current mode, in any order — indexed here by (combo, size). */
  rates: readonly PriceMatrixRate[];
  /** Pieces behind a (combo, size), which is what WEIGHTS every average the
   *  order computes elsewhere, and what the band under this grid states.
   *  0 for a pair the order has not broken down yet. */
  qtyOf: (combo: string, sizeId: string | null) => number;
  onPrice: (key: string, value: string) => void;
  /** Write one value across a set of rate keys — the fill affordances. ONE call
   *  carrying every key, never one per key: each state updater reads the list it
   *  is given, so a loop of calls folds to the last one (the stale-closure trap
   *  `fillApprovalDown` already records). */
  onFill: (keys: string[], value: string) => void;
  /** Show the pieces behind each CELL under it. Off by default — the per-column
   *  weight is in the band already, and a figure under every square is noise
   *  while typing. */
  showQty?: boolean;
}

const cellKey = (combo: string, sizeId: string | null) =>
  `${(combo ?? "").trim().toUpperCase()}|${sizeId ?? ""}`;

/**
 * THE AVERAGE EDGES ARE GONE (client 2026-08-21: "that avg field is no need,
 * remove it from column and row both").
 *
 * They were a quantity-weighted mean down each colour and across each size, and
 * removing them took `weightedRate` with them. Worth recording what it knew,
 * because the next person to want an average here will reach for the wrong one:
 * a rate average must be WEIGHTED BY PIECES — 90 at 7.50 beside 10 at 5.50 is
 * 7.30, not 6.50 — and it must answer NULL rather than 0 when nothing is
 * priced, since a rate of zero is a number somebody could act on.
 *
 * The order's real average still exists and always did: `orderValue` computes
 * it for the Logistic tab, over the whole order, with its own five refusals.
 * That is the one to read, and having a second one on this tab was the thing
 * most likely to make the two look like a contradiction. **The 09-02 reframe
 * onto the Assort grid did not bring it back** — the band under this grid
 * counts PIECES, which is a weight and not a rate.
 */

/**
 * EVERY COLUMN IS MEASURED FROM WHAT IS IN IT (client 2026-09-02, screenshot
 * 2640 + "i think can make it more compact"). `textColPx` is the rule and lives
 * in `matrix-grid.ts` beside `sizeColPx`, because the Approval Qty breakup
 * measures its columns the same way — see that file's note for why the floors
 * are the HEADER's needs rather than the value's.
 */
/** The identity column: floor fits "COLOUR", ceiling stops a long combo name. */
const ID_MIN = 80;
const ID_MAX = 200;
/** The value edge: floor fits "QTY", ceiling is Assort's own Qty width. */
const QTY_MIN = 56;
const QTY_MAX = 88;
/**
 * THE COLLAPSED COLUMN IS MONEY, AND `sizeColPx` DOES NOT MEASURE MONEY.
 *
 * With the size axis collapsed (Style-wise, Color-wise) there is exactly ONE
 * value column and its title is "Price *", not a size. `sizeColPx` is calibrated
 * for a size label over an integer quantity and returned ~73px for it — enough
 * for "5" and not for "12,345.67" (client 2026-09-02, screenshot 2638). A rate
 * column is a fixed money width instead: nothing about it varies with a size run
 * it does not have.
 */
const RATE_MIN = 88;
const RATE_MAX = 132;

/** 26px, the compaction bought on 2026-08-21 — see the header. */
const ROW_H = "min-h-[26px]";

/**
 * THE CELL'S BOX, IN ONE PLACE — two call sites have to agree or the rows go
 * ragged, and it is the number the client tunes when asking for "compact".
 *
 * ## IT KEEPS `Input`'S OWN BORDER, AND THAT REVERSES 2026-08-21
 *
 * This was `rounded-none border-0 bg-transparent` on the reasoning that "the
 * grid rule IS the field edge", which was true and is now wrong — because the
 * RAAGAM SKIN arrived a week later (2026-08-28) and its whole thesis is the
 * opposite arrangement: **bold on the fields, quiet on the partitions**.
 * `[data-skin="raagam"] input { border-color: #79b023 }` lifts every typed box
 * in the module to the logo green, and `--border` is deliberately left pale
 * (#dde5d3) so the seams stay quiet.
 *
 * A border-LESS field opts out of the only rule that colours it. So on a skinned
 * screen the rates were the one place an operator types that had no edge at all,
 * beside a Style and a Price Type wearing green ones — reported as this tab's
 * "color and borders not matching with other tab ui" (client 2026-09-02).
 * `assortGrid` never had the problem: its size cells are plain `<Input>`s and
 * inherited the green for free.
 *
 * **22px, so the row does not grow.** The cell is still `min-h-[26px]` and the
 * box sits inside it with 2px of air — the same relationship Assort has at
 * 32-in-36, one size down. None of the compaction bought on 08-21 or 09-02 is
 * handed back.
 *
 * **6px of radius, not the token's 12px.** `--radius-md` is 0.75rem under the
 * skin and the skin's own note explains why that is the ceiling: "past ~10px a
 * 36px control reads as a lozenge". This control is 22px, so the same sentence
 * chooses a smaller number rather than contradicting it.
 *
 * EVERY VARIANT THE PRIMITIVE DECLARES HAS TO BE ANSWERED, not just the base.
 * `Input` ships `h-9 @2xl/editor:h-8 … text-base md:text-sm`, and `twMerge`
 * only resolves a conflict WITHIN one variant — so `text-[0.78rem]` alone loses
 * to `md:text-sm` from `md` up, which is every desktop this grid is for. The
 * cell would have rendered at 26px tall with 14px digits and nobody would have
 * seen why. Same reason `@2xl/editor:h-[26px]` is spelled out beside `h-[26px]`.
 *
 * This is the twMerge trap doc/ui records from the other direction (call sites
 * silently defeating a primitive's font change); here the primitive silently
 * defeats the call site.
 */
const CELL_BOX =
  "h-[22px] @2xl/editor:h-[22px] w-full min-w-0 text-[12.5px] md:text-[12.5px] rounded-[6px]";

/** A combination the order does not declare — hatched, so the hole is visible.
 *  Written as a style rather than an arbitrary Tailwind gradient because the
 *  value carries a CSS variable and commas, which is exactly where an arbitrary
 *  class silently compiles to nothing (the `bg-muted` lesson in doc/ui). */
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0, transparent 4px, var(--surface-muted) 4px, var(--surface-muted) 8px)",
};

export function PriceMatrix({
  colours,
  sizes,
  rates,
  qtyOf,
  onPrice,
  onFill,
  showQty = false,
}: PriceMatrixProps) {
  const byCell = new Map(rates.map((r) => [cellKey(r.combo, r.size_id), r]));
  const hasColour = colours.length > 0;
  const hasSize = sizes.length > 0;
  const both = hasColour && hasSize;

  // A collapsed axis is ONE nameless lane, so the loops below stay identical
  // across all four modes instead of branching four ways.
  const rowKeys: (string | null)[] = hasColour ? colours : [null];
  const colKeys: ({ id: string; label: string } | null)[] = hasSize ? sizes : [null];

  const rateAt = (c: string | null, z: { id: string } | null) =>
    byCell.get(cellKey(c ?? "", z?.id ?? null));

  /** The first answered rate on a line, which is what a fill propagates. */
  const fillFrom = (line: PriceMatrixRate[]) =>
    line.find((r) => r.price.trim())?.price.trim() ?? "";

  /** Pieces down a column — what the band states, and what widens the column. */
  const colPieces = (z: { id: string } | null) =>
    rowKeys.reduce((a, c) => a + (qtyOf(c ?? "", z?.id ?? null) || 0), 0);
  const rowPieces = (c: string | null) =>
    colKeys.reduce((a, z) => a + (qtyOf(c ?? "", z?.id ?? null) || 0), 0);
  const allPieces = rowKeys.reduce((a, c) => a + rowPieces(c), 0);

  /**
   * The widest thing this column has to hold — every rate typed into it, its
   * title, and the weight under it. Measured, not assumed, so the track breathes
   * with the data rather than with the size name (`sizeColPx`'s own note).
   *
   * A rate carries a decimal point and often two places, so a bare digit count
   * under-measures it; the string's own length is the honest input.
   */
  const colDigits = (z: { id: string } | null) => {
    const typed = rowKeys.map((c) => (rateAt(c, z)?.price ?? "").trim().length);
    return Math.max(4, String(colPieces(z)).length, ...typed);
  };

  /**
   * THE TRACK IS ALL FIXED WIDTHS AND THERE IS NO SPACER — THE GRID HUGS
   * (client 2026-09-02, screenshot 2640: "why this much huge table field from
   * both left and right side, just compac tit").
   *
   * ## THIS REVERSES THE FULL-WIDTH TRACK OF AN HOUR EARLIER, DELIBERATELY
   *
   * Wearing the Assort frame was read as wearing Assort's `w-full` grid too, and
   * that grid ends in `minmax(12px,1fr)` + a sticky value edge. Assort earns
   * both: seventeen kidswear sizes fill the pane, so the spacer is a sliver and
   * the edge is genuinely an edge. This grid has between ONE and a handful of
   * columns, so the same track put a 73px rate beside ~1,100px of nothing
   * (2638), and moving the slack into the identity column instead just moved the
   * emptiness to the other side — a colour name stretched over 1,300px with its
   * rate marooned at the far right (2640). Both are the same mistake: a `1fr`
   * anywhere in a track this short has nothing to be proportional to.
   *
   * So nothing here is `1fr`. Every column is its own width and the whole grid
   * is the sum — which is what `w-fit max-w-full` on the scroller means, and
   * what the 08-21 note ("HUGS ITS CONTENT, never stretches") said before the
   * frame arrived. **The frame was never the width.** The sticky identity, the
   * two bands, the size tokens and the hairlines are what "assortment kind of
   * ui" asked for and they are all still here; `w-full` was the one part of
   * Assort that was about Assort's data rather than about the look.
   *
   * The sticky columns are kept and are not dead weight: `max-w-full` still
   * scrolls a long size run inside the box, and that is exactly when a colour
   * name scrolling away would leave the operator typing into a row they can no
   * longer name.
   */
  /* `px-3` each side on the identity and the value edge; the rate cell's own
     `pl-1 pr-2` plus the `<Input>` border. */
  /* The SAME string the identity cell renders — "All colours" and "All colours
     & sizes" are eight characters apart, and measuring the longer one on a
     Size-wise grid would buy ~55px for a label that is not there. */
  const idLabel = (c: string | null) =>
    c ?? (hasSize ? "All colours" : "All colours & sizes");
  const idW = textColPx(
    Math.max(6, ...rowKeys.map((c) => idLabel(c).length)),
    24,
    ID_MIN,
    ID_MAX,
  );
  const rateW = textColPx(
    Math.max(7, ...rowKeys.map((c) => (rateAt(c, null)?.price ?? "").trim().length)),
    20,
    RATE_MIN,
    RATE_MAX,
  );
  const qtyW = textColPx(
    Math.max(3, String(allPieces).length + 1),
    24,
    QTY_MIN,
    QTY_MAX,
  );

  const track = [
    idW + "px",
    ...colKeys.map((z) => (z ? sizeColPx(z.label, colDigits(z)) : rateW) + "px"),
    qtyW + "px",
  ].join(" ");

  const CELL = matrixCell(ROW_H);
  /* THE BANDS COME DOWN TO THE ROWS. Assort's are `min-h-8` / `min-h-9` over
     36px rows; here they sat over 26px ones, so a three-row table was half
     chrome. `cn` is what makes this safe — twMerge resolves the `min-h-*`
     conflict, so the shared declaration keeps every other property. */
  const HEAD = cn(MATRIX_HEAD, ROW_H);
  const FOOT = cn(MATRIX_FOOT, ROW_H);

  return (
    /* THE SCROLLER IS THE BOX, NOT THE PAGE. A long size run scrolls sideways
       inside this border; the sticky identity column and the sticky bands above
       and below are all relative to it, which is what keeps a colour name on
       screen while its rates scroll away. Same container `assortGrid` uses. */
    <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-border">
      <div
        /* `data-grid-body` + `data-grid-row` ARE THE WHOLE KEYBOARD
           IMPLEMENTATION, and that is not luck — a matrix is the shape
           `gridKeyNav` was already describing. ←/→ walk `fieldsIn(row)` by
           column index, which here is the size run; ↑/↓ take `rows.indexOf(row)`
           and land on `fields[col]` of the next row, which here is the SAME SIZE
           in the next colour. The axes on screen become the axes under the
           fingers with no per-screen handler — AGENTS.md's rule that a keyboard
           complaint is never answered per component, arriving as a component
           that needs no answer of its own.

           The focused cell's fill and its 2px ring are the app's, not this
           file's: globals.css already fills any focused `ROW_FIELDS` field
           inside a `[data-grid-row]` with `--cell-active`, and `Input` already
           draws the ring. Restating either here is how a cell comes to paint
           ring+outline. */
        data-grid-body
        className="grid w-fit"
        style={{ gridTemplateColumns: track }}
        onKeyDown={(e) => gridKeyNav(e)}
      >
        {/* ---- header ---- */}
        <div className={HEAD + " sticky left-0 z-30 justify-start pl-3"}>
          {hasColour ? "Colour" : ""}
        </div>
        {colKeys.map((z, i) => (
          <div
            key={z?.id ?? `c${i}`}
            className={cn(HEAD, "group/mxhead relative")}
          >
            {z ? (
              <span className={MATRIX_SIZE_TOKEN}>{z.label}</span>
            ) : (
              "Price *"
            )}
            {both && z && (
              <FillButton
                label="↓"
                title={`Fill ${z.label} down every colour`}
                onClick={() => {
                  const line = colours
                    .map((c) => rateAt(c, z))
                    .filter((r): r is PriceMatrixRate => !!r);
                  const v = fillFrom(line);
                  if (v) onFill(line.map((r) => r.key), v);
                }}
              />
            )}
          </div>
        ))}
        <div className={HEAD + " sticky right-0 z-30 justify-end pr-3"}>
          Qty
        </div>

        {/* ---- one row per colour ---- */}
        {rowKeys.map((c) => {
          const line = colKeys
            .map((z) => rateAt(c, z))
            .filter((r): r is PriceMatrixRate => !!r);
          return (
            /* `contents`, so the cells are children of the ONE grid that owns
               the track. Two rows sizing their own columns is the bug the track
               exists to prevent; the cost is that a row cannot draw its own
               border, which is why the hairline is on the cells. */
            <div key={c ?? "all"} data-grid-row className="contents">
              <div
                className={cn(
                  CELL,
                  /* `relative` is what the fill button positions against —
                     it is `absolute`, and a cell with no positioning context
                     would throw it to the nearest ancestor that has one, which
                     is the whole grid. */
                  "group/mxhead relative sticky left-0 z-10 justify-start border-r bg-surface px-3 text-[12.5px] font-semibold text-foreground",
                )}
              >
                {c ? (
                  /* `Truncated`, not a bare `truncate`: the colour name is the
                     row's identity, so an ellipsis that swallows it makes the
                     whole row unreadable. The component writes the span itself,
                     so a name that fits gets no bubble at all. */
                  <Truncated text={c} />
                ) : (
                  <span className="text-muted-foreground">{idLabel(c)}</span>
                )}
                {both && (
                  <FillButton
                    label="→"
                    title={`Fill ${c} across every size`}
                    onClick={() => {
                      const v = fillFrom(line);
                      if (v) onFill(line.map((r) => r.key), v);
                    }}
                  />
                )}
              </div>
              {colKeys.map((z, ci) => {
                const r = rateAt(c, z);
                return (
                  <div
                    key={z?.id ?? `c${ci}`}
                    className={cn(CELL, "flex-col items-stretch justify-center px-0")}
                    style={r ? undefined : HATCH}
                  >
                    {r ? (
                      <Input
                        type="number"
                        required
                        value={r.price}
                        onChange={(e) => onPrice(r.key, e.target.value)}
                        aria-label={`Price${c ? ` ${c}` : ""}${z ? ` ${z.label}` : ""}`}
                        className={cn(
                          CELL_BOX,
                          /* CENTRED, NOT RIGHT-ALIGNED, AND THAT IS AN
                             ALIGNMENT RULE RATHER THAN A TASTE (client
                             2026-09-02, screenshot 2641: "this look unaligned
                             the size and all color fields").

                             Every value column carries three things stacked —
                             the size token in the header, the rate, the piece
                             count in the band — and two of the three were
                             centred while the rate was right-aligned. In a 57px
                             column that puts a single `5` about 17px right of
                             the column's own centre, which reads as a rate
                             belonging to the NEXT size along.

                             Right-aligning money is the ordinary convention and
                             it is the wrong one here: these are 1-6 character
                             rates in a narrow column, not a ledger whose
                             decimal points must line up. SO THE COLUMN, NOT THE
                             DATUM, DECIDES — the identity column is left-aligned
                             in all three bands, every value column is centred in
                             all three, and the Qty edge is right-aligned in all
                             three. Assort carries the same latent offset
                             (`text-right px-1.5` under a centred token) and
                             hides it only because its cells hold 3-4 digit
                             quantities rather than a single digit. */
                          "px-1 text-center hover:bg-surface-muted",
                          /* Unanswered and mandatory: a calm tint, not a red
                             border. Nothing is WRONG yet — red belongs to the
                             blocked Save, and the cursor hold is the
                             primitive's own `data-required-empty`, which
                             `required` above still declares exactly as the old
                             `priceRateCell` did. */
                          !r.price.trim() && "bg-warning-soft",
                        )}
                      />
                    ) : (
                      /* A PAIR THE ORDER DOES NOT DECLARE — and it is a
                         `readOnly` INPUT rather than a dash, for a reason that
                         is pure keyboard geometry.

                         `ROW_FIELDS` excludes `[disabled]` and says nothing
                         about `readOnly`, so this box stays ON the ↑/↓ axis
                         while `Input` gives a readOnly field `tabIndex={-1}`
                         itself and Tab steps over it. Render a bare `<span>`
                         instead and the column indices go ragged: GREY MELANGE
                         lacking XS and S would make its first field M, so ↓
                         from WHITE ▸ XS would land on GREY MELANGE ▸ M — the
                         arrows silently reading a different column from the one
                         on screen.

                         It also never holds the cursor (a readOnly field has no
                         exit, so the primitive refuses to hold one) and never
                         takes the focused-cell fill, which globals.css
                         withholds from `[tabindex="-1"]` for the same stated
                         reason: it is not a live destination. */
                      <Input
                        readOnly
                        value=""
                        aria-label={`${c ?? ""} ${z?.label ?? ""} — not declared on this order`}
                        title="This order does not declare this colour in this size"
                        /* AND THIS ONE STAYS EDGELESS, deliberately. The skin's
                           green says "type here"; this pair is not declared on
                           the order, so a box would promise a cell that will
                           never accept a rate. The hatch is the answer and the
                           border would fight it. */
                        className={cn(
                          CELL_BOX,
                          "cursor-default rounded-none border-0 bg-transparent px-1 text-center",
                        )}
                      />
                    )}
                    {showQty && r && (
                      <span className="-mt-0.5 block px-1 pb-[3px] text-center text-[0.58rem] leading-none text-muted-foreground">
                        {qtyOf(c ?? "", z?.id ?? null) || ""}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* The weight behind this colour's rates. BLANK, never `0`, when
                  the order has not been broken down yet — `0` is a claim
                  ("nothing is ordered in this colour") that an unfilled
                  Quantities tab is not making. */}
              <div
                className={cn(
                  CELL,
                  "sticky right-0 z-10 justify-end border-l bg-surface px-3 text-[11px] tabular-nums text-muted-foreground",
                )}
              >
                {rowPieces(c) ? fmtNumber(rowPieces(c)) : ""}
              </div>
            </div>
          );
        })}

        {/* ---- the band underneath ----
            PIECES, NOT AN AVERAGE. See the header: the money average was
            removed from this tab on 2026-08-21 and lives on Logistic. What a
            rate column needs beside it is its WEIGHT — 90 pieces at 7.50 beside
            10 at 5.50 is why the order's average is 7.30 and not 6.50 — and
            that is a fact this tab can state without answering a question
            another tab already answers. */}
        <div
          className={
            FOOT +
            " sticky left-0 z-30 justify-start pl-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
          }
        >
          Pieces
        </div>
        {colKeys.map((z, i) => (
          <div key={z?.id ?? `f${i}`} className={FOOT}>
            {/* A PIECE COUNT BELONGS UNDER A SIZE AND NOWHERE ELSE.
                `z` is null exactly when the size axis is collapsed, and that
                column is titled "Price *" — so the band was printing 1,000
                directly beneath a money heading, which reads as a price total
                (client 2026-09-02, screenshot 2638). It is not a formatting
                slip: under Color-wise the figure was the style's whole run, so
                the number was both wrong-looking and unarguable. The row's
                pieces are on the Qty edge and their sum is at the end of this
                band; neither needs restating under a rate. */}
            {z && colPieces(z) ? fmtNumber(colPieces(z)) : ""}
          </div>
        ))}
        <div className={FOOT + " sticky right-0 z-30 justify-end pr-3"}>
          {allPieces ? fmtNumber(allPieces) : ""}
        </div>
      </div>
    </div>
  );
}

/**
 * A fill affordance, in a header, revealed on hover.
 *
 * `tabIndex={-1}` — Tab lands on FIELDS (AGENTS.md), and this is an action, so
 * it stays on the mouse and in screen-reader order while Tab steps over it. The
 * same treatment a row's ✕ has, and the same treatment Approval Qty's existing
 * "Fill 20 down" already uses. It is a `<button>`, which is not in `ROW_FIELDS`,
 * so the arrows step over it too without being told to.
 *
 * IT OVERWRITES, and that is the case it exists for: "I typed 5.20 on S, make
 * them all 5.20" is a line of values to REPLACE. A fill that skipped answered
 * cells would be the safer rule and the useless one.
 */
function FillButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      aria-label={title}
      onClick={onClick}
      className="absolute bottom-px right-0.5 rounded-sm border border-border-strong bg-surface px-1 text-[0.56rem] leading-tight text-primary opacity-0 hover:bg-surface-muted focus-visible:opacity-100 group-hover/mxhead:opacity-100"
    >
      {label}
    </button>
  );
}
