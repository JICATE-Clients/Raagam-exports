"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { uniformApproval } from "@/lib/orders/amendments/approval-tree";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * APPROVAL QTY — ONE LINE AND ONE NUMBER PER COLOUR (client 2026-08-21,
 * screenshot 2443 and the instruction not to copy the legacy screen).
 *
 * THE LEGACY SCREEN ASKS THE SAME QUESTION SIX TIMES. Read its data rather than
 * its layout: every colour's sizes hold `2, 2, 2, 2, 2, 2`. The operator is not
 * making six decisions, they are making ONE and typing it six times — the table
 * has six rows because the SCHEMA stores six values, not because the person has
 * six answers. So this asks per colour, and `onSetAll` writes the six.
 *
 * Nothing about the data changes. `approval_qty` is still per (style, combo,
 * size), `flattenApprovalTree` still writes the complete tree, and Material BOM
 * still reads it per size. `uniformApproval` is what lets one box stand for six
 * values — and it returns null the moment they disagree, at which point the
 * sizes open on their own and the box says "mixed" instead of claiming a figure.
 *
 * SIZES ARE AN AXIS, SO THEY GO ACROSS. Six sizes were six stacked rows and are
 * one strip here: the same six numbers in a sixth of the height, and the run
 * reads as a curve. Each box carries its own ordered quantity above it, because
 * "2 out of 100" and "2 out of 300" are different decisions — the same reason
 * the Prices matrix can show quantities under its rates.
 *
 * WHAT WAS DROPPED FROM LEGACY, and why each carried nothing: three separate
 * `S No` columns (row numbers nobody refers to, one per level); `Combo
 * Description`, which repeated the colour name straight back (WHITE / WHITE);
 * and the one-row table holding Style Ref No / Style / Article No, which is a
 * heading in the caller.
 *
 * PRESENTATIONAL. It owns which colours are open and nothing else — the rows
 * are `buildApprovalTree`'s and the arithmetic is `approval-qty.ts`'s, arriving
 * through `derive` so this file cannot grow a second copy of a formula the
 * server also computes.
 */

export interface ApprovalQtySize {
  sizeId: string;
  label: string;
  /** Pieces from the assortment breakup. Derived — never typed. */
  qty: number;
  /** The typed figure, as the string an `<Input>` holds. "" when never entered. */
  approval: string;
}

export interface ApprovalQtyColour {
  combo: string;
  sizes: ApprovalQtySize[];
}

/** What the order's excess % and Rejection Rule make of one line. */
export interface ApprovalDerived {
  excess: number;
  /** NULL when unanswerable — no rule chosen, or a gap between tiers. Never 0. */
  rejection: number | null;
  total: number;
}

export interface ApprovalQtyLinesProps {
  colours: ApprovalQtyColour[];
  excessPct: number;
  /**
   * The three derived figures for one (qty, approval) pair.
   *
   * A FUNCTION RATHER THAN PRE-COMPUTED NUMBERS, and the reason is the rounding:
   * excess rounds UP per size and is then summed, which is not the same as
   * rounding a colour's total once (`excessQty`'s own note records the client's
   * worked example). Handing this component a per-colour figure would invite it
   * to divide; handing it the function keeps the size as the unit of
   * calculation everywhere, including in the roll-ups below.
   */
  derive: (qty: number, approvalQty: number) => ApprovalDerived;
  onSet: (combo: string, sizeId: string, value: string) => void;
  /** Write one value to EVERY size of a colour, in one state update. */
  onSetAll: (combo: string, value: string) => void;
}

/**
 * THE TYPE SCALE IS THE APP'S, NOT THIS FILE'S (client 2026-08-21: "that order
 * count and color is look to bigger comparitive our application other section
 * font size … read other section size and applied for this too").
 *
 * Read off the surfaces this sits beside, so a figure here cannot out-shout one
 * in a `ChildGrid` two tabs away:
 *
 *   15px bold      `SectionBody`'s <h2> — THE CEILING. It is the section's own
 *                  heading, so nothing inside the section may be bigger, and
 *                  "To make" was `text-xl` (20px): a running total set larger
 *                  than the title above it.
 *   14px semibold  a `ChildGrid` totals value (`child-grid.tsx`) — which is
 *                  exactly what "To make" IS, so it takes exactly that.
 *   12.5px semi    a `ChildGrid` column header, and the size of a matrix cell's
 *                  own digits. The row identity sits here.
 *   11px caps      a `ChildGrid` totals LABEL — the smallest type the app uses.
 *                  Anything under it (this file had 0.63rem ≈ 10px) is a size
 *                  the app does not own.
 *
 * `price-matrix.tsx` carries the same four, so the two tabs built this week
 * agree with each other as well as with everything older.
 */
const T_TOTAL = "text-sm font-semibold tabular-nums";
const T_NAME = "text-[12.5px] font-semibold";
const T_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";

/**
 * THE CELL'S SIZE, IN ONE PLACE, ANSWERING EVERY VARIANT THE PRIMITIVE SETS.
 *
 * `Input` ships `h-9 @2xl/editor:h-8 … text-base md:text-sm`, and `twMerge` only
 * resolves a conflict WITHIN one variant — so a bare `text-[0.78rem]` loses to
 * `md:text-sm` from `md` up, which is every desktop this screen is for. The box
 * would render short with full-size digits and nothing would explain why. Same
 * trap `price-matrix.tsx` records.
 */
const BOX = "h-[26px] @2xl/editor:h-[26px] text-[12.5px] md:text-[12.5px] text-right tabular-nums";

/** The row grid, declared ONCE so the header and every line cannot drift. */
const COLS =
  "grid grid-cols-[minmax(7rem,1.5fr)_5.5rem_1.75rem] items-center gap-x-2.5 @lg/section:grid-cols-[minmax(8rem,1.5fr)_6rem_7.5rem_5rem_6.5rem_1.75rem]";
/** Columns that only appear once the pane is wide enough to hold them. */
const WIDE = "hidden @lg/section:block";

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function ApprovalQtyLines({
  colours,
  excessPct,
  derive,
  onSet,
  onSetAll,
}: ApprovalQtyLinesProps) {
  /**
   * WHICH COLOURS ARE SHUT — the set is CLOSED, not open, and that inversion is
   * the whole of "default open" (client 2026-08-21, screenshots 2452 → 2454:
   * "it open as like … closed state but make it as default open like second
   * one").
   *
   * Tracking the open ones and seeding the set would have got today's colours
   * open and left tomorrow's shut: a colour added on the Combos tab after this
   * component mounted is not in the seed, so it would arrive collapsed on a
   * screen whose every other colour is expanded. Tracking the SHUT ones makes
   * open the absence of a decision, so anything new is open because nobody has
   * closed it — no effect, no dependency on `colours`, nothing to re-seed.
   *
   * IT REVERSES A CHOICE MADE THREE HOURS AGO and does so on instruction. The
   * argument for collapsed was length: the client's first complaint about this
   * tab was that it "took huge space in screen". What paid that off was the
   * SHAPE — one line per colour instead of one grid per colour, sizes across
   * instead of down — not the folding, so opening by default costs one strip
   * per colour rather than the six stacked rows it replaced.
   *
   * Component state, deliberately: `amendment-screen` returns early on
   * `if (mode === "list")`, so a `useState` added there has to sit above that
   * return or React counts hooks differently between the two renders and blanks
   * the route. Owning it here means the screen grows no hook at all.
   */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (combo: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(combo)) next.delete(combo);
      else next.add(combo);
      return next;
    });

  /** A colour's figures are the SUM of its sizes — computed every render, never
   *  stored, so a roll-up cannot drift from the rows beneath it. (The legacy
   *  screen's did: screenshot 2443 shows GREY MELANGE at 1,800 ordered with a
   *  stale 630 total beside it.) */
  const roll = (c: ApprovalQtyColour) =>
    c.sizes.reduce(
      (a, z) => {
        const d = derive(z.qty, num(z.approval));
        return {
          qty: a.qty + z.qty,
          excess: a.excess + d.excess,
          approval: a.approval + num(z.approval),
          rejection: a.rejection + (d.rejection ?? 0),
          total: a.total + d.total,
        };
      },
      { qty: 0, excess: 0, approval: 0, rejection: 0, total: 0 },
    );

  const all = colours.map(roll).reduce(
    (a, r) => ({
      qty: a.qty + r.qty,
      excess: a.excess + r.excess,
      approval: a.approval + r.approval,
      rejection: a.rejection + r.rejection,
      total: a.total + r.total,
    }),
    { qty: 0, excess: 0, approval: 0, rejection: 0, total: 0 },
  );

  return (
    <div className="space-y-2">
      {/* THE ANSWER LINE — what the tab is FOR, stated once.
          The four addends read left to right as the sum they are, so the
          arithmetic is visible rather than implied; the legacy screen never
          said the production target anywhere. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-surface-muted px-3 py-2">
        <div>
          <div className={T_LABEL}>To make</div>
          <div className={cn(T_TOTAL, "leading-none")}>{fmtNumber(all.total)}</div>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-baseline gap-1.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">
            <b className="font-semibold text-foreground tabular-nums">{fmtNumber(all.qty)}</b> ordered
          </span>
          <span className="opacity-60">+</span>
          <span className="whitespace-nowrap">
            <b className="font-semibold text-foreground tabular-nums">{fmtNumber(all.excess)}</b> excess
          </span>
          <span className="opacity-60">+</span>
          <span className="whitespace-nowrap">
            <b className="font-semibold text-foreground tabular-nums">{fmtNumber(all.approval)}</b> approval
          </span>
          <span className="opacity-60">+</span>
          <span className="whitespace-nowrap">
            <b className="font-semibold text-foreground tabular-nums">{fmtNumber(all.rejection)}</b> rejection
          </span>
        </div>
      </div>

      <div className={cn(COLS, T_LABEL, "px-3 pb-1")}>
        <div>Colour</div>
        <div className={cn(WIDE, "text-right")}>Ordered</div>
        <div className="text-right">Approval / size</div>
        <div className={cn(WIDE, "text-right")}>Approval</div>
        <div className={cn(WIDE, "text-right")}>To make</div>
        <div />
      </div>

      {/* `data-grid-body` + `data-grid-row` ARE THE KEYBOARD, exactly as on the
          Prices matrix: `gridKeyNav` walks a row's fields with ←/→ and steps
          between rows with ↑/↓, landing on the same column. Here a "row" is a
          colour AND its open size strip, so ←/→ run: the each-box, then S, M,
          L … which is the order the operator fills them in. No handler of our
          own — AGENTS.md's rule that a keyboard question is never answered per
          screen. */}
      <div data-grid-body className="space-y-1.5" onKeyDown={(e) => gridKeyNav(e)}>
        {colours.map((c) => {
          const r = roll(c);
          const one = uniformApproval(c.sizes.map((z) => z.approval));
          /* MIXED CANNOT BE CLOSED. A single box cannot honestly show one
             figure for six that disagree, so the sizes are the only place the
             value can be read — shutting them would leave the operator with a
             box that refuses to say what is stored. Now that open is the
             default this is a refusal to CLOSE rather than a force to open,
             which is why it survives the inversion unchanged in effect. */
          const isOpen =
            (!closed.has(c.combo) || one === null) && c.sizes.length > 0;
          return (
            <div
              key={c.combo}
              data-grid-row
              className={cn(
                "rounded-md border bg-surface px-3",
                isOpen ? "border-primary" : "border-border hover:border-border-strong",
              )}
            >
              <div className={cn(COLS, "min-h-9")}>
                <Truncated text={c.combo} className={T_NAME} />
                <div className={cn(WIDE, "text-right text-[11px] leading-tight text-muted-foreground")}>
                  <b className={cn("block text-foreground tabular-nums", T_NAME)}>
                    {fmtNumber(r.qty)}
                  </b>
                  {c.sizes.length} {c.sizes.length === 1 ? "size" : "sizes"}
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  {c.sizes.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">no sizes</span>
                  ) : (
                    <>
                      {/* "mixed" is a LABEL, never a placeholder. An unfilled
                          field shows nothing (the de-clutter rule), and a word
                          inside the box would also read as a value the operator
                          could overtype without noticing what it replaced. */}
                      <span
                        className={cn(
                          "whitespace-nowrap text-[11px]",
                          one === null ? "font-medium text-warning" : "text-muted-foreground",
                        )}
                      >
                        {one === null ? "mixed" : "each"}
                      </span>
                      <Input
                        type="number"
                        value={one ?? ""}
                        onChange={(e) => onSetAll(c.combo, e.target.value)}
                        aria-label={`Approval quantity per size for ${c.combo}`}
                        className={cn(BOX, "w-14 px-2 font-semibold", one === null && "border-dashed")}
                      />
                    </>
                  )}
                </div>
                <div className={cn(WIDE, T_NAME, "text-right tabular-nums")}>
                  {fmtNumber(r.approval)}
                </div>
                <div className={cn(WIDE, T_NAME, "text-right text-primary tabular-nums")}>
                  {fmtNumber(r.total)}
                </div>
                {/* `data-row-open` — a row's own "open this" control IS a cell of
                    the row, so all three movement keys reach it (AGENTS.md, the
                    marker Combos ▸ Detail already uses). A bare <button> is not
                    `isFieldLike`, so without this the sizes would be mouse-only
                    for anyone working from the keyboard. */}
                <button
                  type="button"
                  data-row-open
                  onClick={() => toggle(c.combo)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} sizes for ${c.combo}`}
                  className="grid h-6 w-6 place-items-center justify-self-end rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                  />
                </button>
              </div>

              {isOpen && c.sizes.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-2 pb-2.5">
                  {c.sizes.map((z) => (
                    <div key={z.sizeId} className="min-w-[3.9rem] flex-none">
                      <div className="flex justify-between gap-1.5 pb-0.5 text-[11px] text-muted-foreground">
                        <span>{z.label}</span>
                        {/* The ordered quantity, above the box rather than
                            inside it: it is what the answer is judged against,
                            and 2-of-100 is a different decision from 2-of-300. */}
                        <span className="tabular-nums opacity-75">{fmtNumber(z.qty)}</span>
                      </div>
                      <Input
                        type="number"
                        value={z.approval}
                        onChange={(e) => onSet(c.combo, z.sizeId, e.target.value)}
                        aria-label={`Approval quantity, ${c.combo} ${z.label}, of ${z.qty} ordered`}
                        className={cn(BOX, "w-full px-1.5")}
                      />
                    </div>
                  ))}
                  <div className="w-full pt-1 text-[11px] text-muted-foreground">
                    <b className="font-semibold text-foreground tabular-nums">
                      {fmtNumber(r.approval)}
                    </b>{" "}
                    approval pieces · {fmtNumber(r.qty)} + {fmtNumber(r.excess)} +{" "}
                    {fmtNumber(r.approval)} + {fmtNumber(r.rejection)} ={" "}
                    <b className="font-semibold text-foreground tabular-nums">{fmtNumber(r.total)}</b>{" "}
                    to make
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="px-3 text-[11px] text-muted-foreground">
        Excess {excessPct || 0}% and Rejection are worked out per size and summed, never on the total.
      </p>
    </div>
  );
}
