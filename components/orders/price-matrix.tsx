"use client";

import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * THE PRICES TAB'S RATE GRID, AS A MATRIX — colours down, sizes across, the
 * rate in the cell (client 2026-08-21, screenshot 2439).
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
 * ONE COMPONENT, FOUR MODES. The four price types are not four grids; they are
 * this grid with one or both axes collapsed, which is why `applyPriceMode`
 * reshapes rather than replaces:
 *
 *     Style-wise            1 × 1   a single Price field, no matrix chrome
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
 * a small file rather than another section of a 9,000-line screen, and it is why
 * the leftover-rates warning stays OUT of here — those rows belong to a mode the
 * style has moved off, so they are not cells of this matrix.
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
  /** Pieces behind a (combo, size), which is what WEIGHTS every average below.
   *  0 for a pair the order has not broken down yet. */
  qtyOf: (combo: string, sizeId: string | null) => number;
  onPrice: (key: string, value: string) => void;
  /** Write one value across a set of rate keys — the fill affordances. ONE call
   *  carrying every key, never one per key: each state updater reads the list it
   *  is given, so a loop of calls folds to the last one (the stale-closure trap
   *  `fillApprovalDown` already records). */
  onFill: (keys: string[], value: string) => void;
  /** Show the pieces behind each rate under it. Off by default — the weight
   *  matters when reading the averages and is noise while typing. */
  showQty?: boolean;
}

const cellKey = (combo: string, sizeId: string | null) =>
  `${(combo ?? "").trim().toUpperCase()}|${sizeId ?? ""}`;

/**
 * THE AVERAGE EDGES ARE GONE (client 2026-08-21: "that avg field is no need,
 * remove it from column and row both").
 *
 * They were a quantity-weighted mean down each colour and across each size, and
 * removing them takes `weightedRate` with them. Worth recording what it knew,
 * because the next person to want an average here will reach for the wrong one:
 * a rate average must be WEIGHTED BY PIECES — 90 at 7.50 beside 10 at 5.50 is
 * 7.30, not 6.50 — and it must answer NULL rather than 0 when nothing is
 * priced, since a rate of zero is a number somebody could act on.
 *
 * The order's real average still exists and always did: `orderValue` computes
 * it for the Logistic tab, over the whole order, with its own five refusals.
 * That is the one to read, and having a second one on this tab was the thing
 * most likely to make the two look like a contradiction.
 */

/**
 * THE TYPE SCALE IS THE APP'S — the same values `approval-qty-lines.tsx` lists,
 * read off `ChildGrid` and `SectionBody` so the two tabs built this week agree
 * with each other and with everything older (client 2026-08-21: "read other
 * section size and applied for this too").
 *
 *   12.5px semi   a `ChildGrid` column header - a row identity, and a cell's digits
 *   11px caps     a `ChildGrid` totals label - the smallest type the app uses
 *
 * This file had 0.76rem and 0.66rem: ~12.2px and ~10.6px, close enough to look
 * deliberate and small enough that nothing else in the app is that size. A size
 * the app does not own is how a screen comes to read as not quite ours.
 */
const T_NAME = "text-[12.5px] font-semibold";
const T_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * THE CELL'S SIZE, IN ONE PLACE — two call sites have to agree or the rows go
 * ragged, and it is the number the client tunes when asking for "compact".
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
  "h-[26px] @2xl/editor:h-[26px] min-w-[50px] text-[12.5px] md:text-[12.5px] rounded-none border-0 bg-transparent";

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

  const headCell =
    "group/mxhead relative border-b border-r border-border bg-surface-muted px-1.5 py-1 text-center " + T_LABEL;

  return (
    <div
      /* `data-grid-body` + `data-grid-row` ARE THE WHOLE KEYBOARD
         IMPLEMENTATION, and that is not luck — a matrix is the shape
         `gridKeyNav` was already describing. ←/→ walk `fieldsIn(row)` by column
         index, which here is the size run; ↑/↓ take `rows.indexOf(row)` and land
         on `fields[col]` of the next row, which here is the SAME SIZE in the
         next colour. The axes on screen become the axes under the fingers with
         no per-screen handler — AGENTS.md's rule that a keyboard complaint is
         never answered per component, arriving as a component that needs no
         answer of its own.

         The focused cell's fill and its 2px ring are the app's, not this file's:
         globals.css already fills any focused `ROW_FIELDS` field inside a
         `[data-grid-row]` with `--cell-active`, and `Input` already draws the
         ring. Restating either here is how a cell comes to paint ring+outline. */
      data-grid-body
      /* HUGS ITS CONTENT, never stretches (client 2026-08-21: the built grid
         "not match with our ui"). With `w-full` on the table, seven sizes split
         the whole pane and each rate box came out ~185px wide — a wall of
         near-empty cells that reads nothing like the compact grid this is. The
         columns are sized to their figures and the slack falls to the RIGHT of
         them, which is the same escape `ChildGrid`'s `hugsContent` note
         describes. `max-w-full` keeps a long size run inside the pane, and the
         overflow below then scrolls it rather than the page. */
      className="w-fit max-w-full overflow-x-auto rounded-md border border-border bg-surface"
      onKeyDown={(e) => gridKeyNav(e)}
    >
      <table className="border-separate border-spacing-0 tabular-nums">
        <thead>
          <tr>
            {/* STICKY, because a twelve-size run scrolls sideways inside this box
                and a colour name that scrolls away leaves the operator typing
                into a row they can no longer name. The overflow is on the
                container above, never on the page body. */}
            <th className={cn("sticky left-0 z-[2] min-w-[104px] border-b border-r border-border-strong bg-surface-muted px-2 py-1 text-left", T_LABEL)}>
              {hasColour ? "Colour" : ""}
            </th>
            {colKeys.map((z, i) => (
              <th
                key={z?.id ?? `c${i}`}
                /* The last column loses its right border — the container draws
                   that edge, and two lines a pixel apart read as a seam. */
                className={cn(headCell, i === colKeys.length - 1 && "border-r-0")}
              >
                {z ? z.label : "Price *"}
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((c, ri) => {
            const line = colKeys
              .map((z) => rateAt(c, z))
              .filter((r): r is PriceMatrixRate => !!r);
            const last = ri === rowKeys.length - 1;
            const edge = last ? "" : "border-b";
            return (
              <tr key={c ?? "all"} data-grid-row>
                <th
                  className={cn(
                    "group/mxhead sticky left-0 z-[2] max-w-[150px] border-r border-border-strong bg-surface px-2 text-left text-foreground",
                    T_NAME,
                    edge,
                  )}
                >
                  {c ? (
                    /* `Truncated`, not a bare `truncate`: the colour name is the
                       row's identity, so an ellipsis that swallows it makes the
                       whole row unreadable. The component writes the span
                       itself, so a name that fits gets no bubble at all. */
                    <Truncated text={c} />
                  ) : (
                    <span className="text-muted-foreground">
                      {hasSize ? "All colours" : "All colours & sizes"}
                    </span>
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
                </th>
                {colKeys.map((z, ci) => {
                  const r = rateAt(c, z);
                  return (
                    <td
                      key={z?.id ?? `c${ci}`}
                      className={cn(
                        "border-r border-border p-0",
                        edge,
                        ci === colKeys.length - 1 && "border-r-0",
                      )}
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
                            "pl-1 pr-2 text-right hover:bg-surface-muted",
                            /* Unanswered and mandatory: a calm tint, not a red
                               border. Nothing is WRONG yet — red belongs to the
                               blocked Save, and the cursor hold is the
                               primitive's own `data-required-empty`, which
                               `required` above still declares exactly as the
                               old `priceRateCell` did. */
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
                           arrows silently reading a different column from the
                           one on screen.

                           It also never holds the cursor (a readOnly field has
                           no exit, so the primitive refuses to hold one) and
                           never takes the focused-cell fill, which globals.css
                           withholds from `[tabindex="-1"]` for the same stated
                           reason: it is not a live destination. */
                        <Input
                          readOnly
                          value=""
                          aria-label={`${c ?? ""} ${z?.label ?? ""} — not declared on this order`}
                          title="This order does not declare this colour in this size"
                          className={cn(CELL_BOX, "cursor-default px-1 text-center")}
                        />
                      )}
                      {showQty && r && (
                        <span className="-mt-0.5 block px-2 pb-[3px] text-right text-[0.58rem] leading-none text-muted-foreground">
                          {qtyOf(c ?? "", z?.id ?? null) || ""}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
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
