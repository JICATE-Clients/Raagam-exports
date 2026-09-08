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
 *
 * ## A 72–80px BOX, DECLARED AS A 92–100px COLUMN
 *
 * Client: "reduce its width to ~70px–80px … remove the extra left space so it
 * sits neatly compact". THE EXTRA LEFT SPACE WAS THE BOX ITSELF. The input is
 * `w-full` in a `px-0` cell, so the column width IS the box width, and a
 * right-aligned "7.50" inside 132px leaves ~100px of empty box to the left of
 * the digits — read as the field being indented when it was simply too wide.
 * So the fix is the column, not a padding: narrow the box and the digits sit
 * where the box ends.
 *
 * THE NUMBERS HERE ARE THE COLUMN, AND THE BOX IS 20px LESS. The cell spends
 * `VALUE_CELL`'s 10px a side (see `PAD_X`), so 92–100 declared is the 72–80 the
 * client asked for once the padding is taken out. Written this way round
 * because a grid track sizes the CELL; stating the box width here and letting
 * the padding eat it is how the box quietly stops being the size it was set to.
 *
 * It does not cost the 2638 reading. `textColPx` still measures the longest
 * rate actually typed, and 80px less the `<Input>`'s own `px-1` and border is
 * ~70px of digits — "12,345.67" is nine characters at ~62px in the grid's
 * 12.5px tabular figures, so the ceiling still holds the value that set the old
 * floor. What went was the headroom above it, never measured against anything.
 *
 * THIS COLUMN IS ALSO THE ONE THAT MAY NOT ABSORB SLACK — see `CARD_W` and the
 * track below, where widening it back is exactly what the floor must not do.
 */
const RATE_MIN = 92;
const RATE_MAX = 100;

/**
 * THE WIDTH OF THE GROUP TABLE THIS MATRIX HANGS UNDER (client 2026-09-06:
 * "expand the pricing table width to match the upper card").
 *
 * 24.5rem — Style 10 + Price Type 10 + Unit 4.5, declared on the `PriceGroup`
 * grid in `garment-order-screen.tsx`, which states that arithmetic at length.
 * The two tables are one record read top to bottom, and a rate table narrower
 * than the header table above it reads as a fragment rather than the rest of
 * the row. If those three columns are re-measured, this number moves with them.
 *
 * ## IT IS A FLOOR, NOT `w-full`, AND THAT DISTINCTION IS THE WHOLE NOTE
 *
 * `w-full` was tried on 2026-09-02 and is what the track note below rejects: a
 * `1fr` in a track this short has nothing to be proportional to, so it put a
 * 73px rate beside ~1,100px of nothing (screenshot 2638), and moving the slack
 * into the identity column instead marooned the rate at the far right of a
 * 1,300px name (2640). Both are the same failure — surplus landing in ONE
 * column that could not use it. A floor cannot reproduce it: the surplus is
 * bounded by this number (~90px on a Style-wise grid), it is handed out in even
 * shares CAPPED by what each column can use, the hand-set "Price *" width is
 * excluded outright, and a Size-wise grid already measuring past 392px is left
 * exactly as it is. The track below states the distribution.
 */
const CARD_W = 392;

/**
 * THE VALUE CELL'S OWN PADDING — `px-2.5 py-1.5`, i.e. 6px 10px (client
 * 2026-09-06: "the price input box is touching the cell border … ensure proper
 * breathing space around it").
 *
 * The cell was `px-0` so that a `w-full` box would fill it exactly, which is
 * what put the `<Input>`'s green skin border flush against the column
 * hairline — two edges meeting with nothing between them, on the one control
 * the operator types into.
 *
 * ## 20px IS ADDED TO EVERY VALUE COLUMN, NOT TAKEN OUT OF THE BOX
 *
 * `PAD_X` is declared here as a NUMBER as well as a class because the track
 * below has to add it. Padding a cell without widening its column would have
 * shrunk the box by 20px — and the box width is the thing the client set by
 * hand one instruction earlier ("~70px–80px"), so the padding would have
 * silently undone it. Same trap as the `textColPx` `pad` arguments: a cell's
 * chrome is stated twice, as a class and as a number, and the two move
 * together or the column stops fitting what is in it.
 *
 * The vertical half needs no such arithmetic — a grid row is sized by its
 * tallest cell, so 28px of box plus 12px of padding simply makes a 40px body
 * row. The sticky bands keep `ROW_H` and stay 30px: they hold a token and a
 * total, not a control, so nothing in them is touching anything.
 */
const PAD_X = 20;
const VALUE_CELL = "px-2.5 py-1.5";

/**
 * 32px, UP FROM THE 26 BOUGHT ON 2026-08-21 — and it is the box below that
 * moved, not the row's own padding.
 *
 * A 28px control (client 2026-09-06, refining the ~30px asked for earlier the
 * same day) does not fit a 26px row, so the row is exactly what the box needs
 * plus the 2px of air it already had at 22-in-26. The RATIO tightens rather
 * than loosening: 28-in-30 is 1px a side. Nothing else about the compaction is
 * handed back — the bands still come down to the rows (see `HEAD`/`FOOT`), and
 * the horizontal padding went the other way in the same change (`px-3` -> `px-2`
 * on the identity and value edges, with `textColPx`'s `pad` moved with it).
 */
const ROW_H = "min-h-[30px]";

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
  "h-[28px] @2xl/editor:h-[28px] w-full min-w-0 text-[12.5px] md:text-[12.5px] rounded-[6px]";

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
  /* `px-2` each side on the identity and the value edge — 8px, DOWN FROM 12
     (client 2026-09-06: "tighten row padding"), and the same 8px the Approval
     Qty breakup spends, so the two matrices built in one week still agree. The
     `pad` arguments below move WITH the class: they are the cell's own chrome
     stated as a number, so trimming the padding without trimming these would
     leave every column 8px wider than the thing in it. Plus the rate cell's own
     `px-1` and the `<Input>` border. */
  /* The SAME string the identity cell renders — "All colours" and "All colours
     & sizes" are eight characters apart, and measuring the longer one on a
     Size-wise grid would buy ~55px for a label that is not there. */
  const idLabel = (c: string | null) =>
    c ?? (hasSize ? "All colours" : "All colours & sizes");
  const idW = textColPx(
    Math.max(6, ...rowKeys.map((c) => idLabel(c).length)),
    16,
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
    16,
    QTY_MIN,
    QTY_MAX,
  );

  /**
   * THE MEASURED TRACK, THEN THE FLOOR — see `CARD_W`.
   *
   * Nothing here is `1fr`: every column is its own width and the grid is the
   * sum. Any shortfall against the card above is shared out, and WHERE it lands
   * is the whole design — 2638 and 2640 were both one column swallowing the
   * surplus, so the rule is that no column takes more than it can use.
   *
   * ## A COLLAPSED "Price *" COLUMN TAKES NONE OF IT
   *
   * It is the one column with a width the client set by hand (72–80px, see
   * `RATE_MIN`), and it was set because the box was TOO WIDE — right-aligned
   * digits floating away from a left edge 100px behind them. Letting the floor
   * grow it back would undo that instruction with arithmetic, silently, which
   * is why `headroom` gives it zero. A SIZE column has no such ceiling: its
   * width is measured from the run and a little air between sizes is free.
   *
   * ## THE IDENTITY COLUMN IS THE DESIGNATED OVERFLOW
   *
   * Pass one hands out even shares, each capped by what that column can use.
   * Whatever the caps refuse goes to the identity column in pass two, past its
   * own `ID_MAX` — deliberately, because it is left-aligned TEXT and the only
   * column where surplus reads as room rather than as a gap. It is also the
   * LEFT column, so this cannot recreate 2640: that was a rate marooned at the
   * far right of a 1,300px name, and the whole budget here is bounded by
   * `CARD_W` (~90px on a Style-wise grid, against a 392px table).
   *
   * A grid already at or past the card keeps every measurement untouched, so a
   * long size run is unaffected.
   */
  const measured = [
    idW,
    /* `+ PAD_X` on a SIZE column and not on the rate one: `sizeColPx` measures
       the box, so the cell's padding is added on top, while `RATE_MIN`/`MAX`
       are already stated as column widths with the padding inside them. Both
       end up as "box + 20px"; only the starting point differs. */
    ...colKeys.map((z) => (z ? sizeColPx(z.label, colDigits(z)) + PAD_X : rateW)),
    qtyW,
  ];
  /** What each column may take before the width stops being usable. */
  const headroom = [
    ID_MAX - idW,
    ...colKeys.map((z) => (z ? Number.POSITIVE_INFINITY : 0)),
    QTY_MAX - qtyW,
  ];
  const grown = [...measured];
  let left = Math.max(0, CARD_W - measured.reduce((a, b) => a + b, 0));
  for (let i = 0; i < grown.length && left > 0; i++) {
    const take = Math.max(0, Math.min(headroom[i], Math.ceil(left / (grown.length - i))));
    grown[i] += take;
    left -= take;
  }
  grown[0] += left;
  const track = grown.map((w) => w + "px").join(" ");

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
        {/**
          * THE IDENTITY COLUMN'S HEADING — "Colour" when the rows ARE colours,
          * "Variant" when they are not (client 2026-09-07: the header above
          * "All colours & sizes" was blank).
          *
          * ## WHY IT WAS BLANK, WHICH IS WHY IT IS TWO WORDS AND NOT ONE
          *
          * This column names the ROW AXIS, and on two of the four modes there
          * is no axis to name: `rowKeys` collapses to `[null]` when the style
          * declares no colours, so the grid has exactly one row and its cell
          * reads "All colours" (Size-wise) or "All colours & sizes" (one flat
          * rate). `hasColour ? "Colour" : ""` was honest about that — there is
          * no colour axis — and it left a heading cell with nothing in it above
          * the widest label on the grid, which reads as a rendering fault
          * rather than as a deliberate blank.
          *
          * So the fallback names what the cell HOLDS rather than what the axis
          * IS: every row of this grid is a variant of the one style being
          * priced, and "All colours & sizes" is the variant that is all of them.
          *
          * ## "Variant", NOT "Breakup" / "Description" / "Item"
          *
          * All three were offered and each says something untrue here.
          * **Breakup** is already spent in this module on the QUANTITY split
          * (the Approval Qty breakup, whose matrix this one is built to match),
          * and in the trade a "price breakup" is the cost build-up — fabric plus
          * trims plus CM — which is a different table this screen does not have.
          * **Description** claims free text; the cell is a colour name or a
          * generated phrase. **Item** is wrong at the grain: the item is the
          * style, and every row here is the same style.
          *
          * ## "Colour" STAYS WHERE THE ROWS ARE COLOURS
          *
          * One word for both modes was the alternative and it is worse: where a
          * colour axis exists, naming it is strictly more information than
          * "Variant", and the heading changing with the data is correct because
          * the DATA under it changes — colour names in one mode, a standing
          * phrase in the other.
          *
          * ## NO STYLING OF ITS OWN, DELIBERATELY
          *
          * "Left-aligned, subtle and compact" is what this cell already is and
          * none of it is written here: `MATRIX_HEAD` carries the 10.5px
          * uppercase `text-muted-foreground` band every column title on both
          * matrices wears, and `justify-start pl-2` is the alignment. Adding a
          * size or a colour beside them would be the call-site-patches-one-
          * property-of-a-primitive bug AGENTS.md ▸ "The header row" records.
          *
          * `justify-start` genuinely wins over `MATRIX_HEAD`'s own
          * `justify-center` even though these are concatenated rather than
          * `cn`-merged — Tailwind emits `.justify-start` after `.justify-center`,
          * so equal specificity is settled by source order in the sheet, not by
          * the order in the attribute. Checked, because a class list that is not
          * twMerge'd is exactly where that assumption goes wrong silently.
          *
          * The column's width is unaffected: `idW` measures `idLabel`, and both
          * labels it can produce here (11 and 19 characters) are longer than
          * either heading, so nothing is clipped and no floor has to move.
          */}
        <div className={HEAD + " sticky left-0 z-30 justify-start pl-2"}>
          {hasColour ? "Colour" : "Variant"}
        </div>
        {colKeys.map((z, i) => (
          <div
            key={z?.id ?? `c${i}`}
            /* `justify-end` — the header band of a value column, moved with the
               two bands under it. See the alignment note on the rate input. */
            className={cn(HEAD, "group/mxhead relative justify-end pr-2")}
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
        <div className={HEAD + " sticky right-0 z-30 justify-end pr-2"}>
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
                  "group/mxhead relative sticky left-0 z-10 justify-start border-r bg-surface px-2 text-[12.5px] font-semibold text-foreground",
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
                    /* `VALUE_CELL` REPLACES `px-0` — 6px 10px, so the box's
                       own border stops short of the column hairline instead of
                       meeting it. The column was widened by the same 20px (see
                       `PAD_X`), so the box keeps the width it was set to. */
                    className={cn(CELL, "flex-col items-stretch justify-center", VALUE_CELL)}
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
                          /* RIGHT-ALIGNED SINCE 2026-09-06 (client: "right-align
                             the price and quantity numbers"), AND ALL THREE
                             BANDS MOVED TOGETHER.

                             THE RULE IS UNCHANGED AND IS WHY THIS IS SAFE. The
                             2026-09-02 ruling (screenshot 2641, "this look
                             unaligned the size and all color fields") was never
                             "money is centred" — it was **the column, not the
                             datum, decides**, because two of a value column's
                             three stacked bands were centred while the rate
                             alone was right-aligned, which put a single `5`
                             about 17px off its own column's centre. Centring was
                             the cheaper way to make the three agree that day.
                             Right is the other way, it is the ordinary
                             convention for money and quantity, and it now
                             matches the Approval Qty breakup, whose figures
                             stack into a vertical sum and have always been
                             right-aligned.

                             So the size token in the header, this rate, and the
                             piece count in the band beneath it are ALL
                             `justify-end`/`text-right` — the identity column is
                             still left in all three bands and the Qty edge still
                             right in all three. Moving one of the three back is
                             what re-opens 2641. */
                          "px-1 text-right hover:bg-surface-muted",
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
                          "cursor-default rounded-none border-0 bg-transparent px-1 text-right",
                        )}
                      />
                    )}
                    {showQty && r && (
                      /* The third band of the value column — `text-right` with
                         the rate above it. See the alignment note there. */
                      <span className="-mt-0.5 block px-1 pb-[3px] text-right text-[0.58rem] leading-none text-muted-foreground">
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
                  "sticky right-0 z-10 justify-end border-l bg-surface px-2 text-[11px] tabular-nums text-muted-foreground",
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
            " sticky left-0 z-30 justify-start pl-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
          }
        >
          Pieces
        </div>
        {colKeys.map((z, i) => (
          /* The band under a value column, right-aligned with the two above it
             — see the alignment note on the rate input. */
          <div key={z?.id ?? `f${i}`} className={cn(FOOT, "justify-end pr-2")}>
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
        <div className={FOOT + " sticky right-0 z-30 justify-end pr-2"}>
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
