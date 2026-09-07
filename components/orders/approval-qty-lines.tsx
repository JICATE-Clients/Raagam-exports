"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import {
  MATRIX_FOOT,
  MATRIX_HEAD,
  MATRIX_SIZE_TOKEN,
  matrixCell,
  sizeColPx,
  textColPx,
} from "@/components/orders/matrix-grid";
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

/**
 * THE BREAKUP MATRIX — sizes ACROSS, the five figures DOWN (client 2026-08-27,
 * screenshot 2523: "in approval qty tab need to show the breakup values").
 *
 * ## WHAT WAS MISSING, EXACTLY
 *
 * The strip that stood here showed a size's ORDERED quantity and a box to type
 * its approval into, and nothing else. Excess, Rejection and To make existed
 * only as a colour-level roll-up, so the operator could see that WHITE makes 550
 * and never that the L makes 165 — the legacy screen's third level (the `+` on
 * every combo row of 2523) is exactly that breakup, and we had folded it away.
 *
 * ## IT IS A MATRIX AND NOT THE SIX ROWS LEGACY USES, DELIBERATELY
 *
 * Restoring `Size · Qty · Excess · Approval · Rejection · Total` as six stacked
 * ROWS is the shape the client had removed on 2026-08-21 ("took huge space in
 * screen"), and the note above records why: SIZES ARE AN AXIS, SO THEY GO
 * ACROSS. Both instructions are satisfied by transposing — a size stays a
 * COLUMN, and the five figures become five rows whose height does not grow with
 * the size run. Six sizes cost five lines here and thirty-six there.
 *
 * READ A COLUMN AND YOU READ ONE SIZE'S STORY; read down it and the arithmetic
 * is vertical — Ordered + Excess + Approval + Rejection = To make. That sum used
 * to be a sentence under the strip and is now the shape of the table, so the
 * sentence went rather than being repeated.
 *
 * ## THE CHROME IS `price-matrix.tsx`'S, NOT A SECOND OPINION
 *
 * Same box, same sticky first column, same borderless cell field — the two tabs
 * were built in one week and a matrix that looked like neither would be a third
 * thing to learn. A twelve-size run scrolls sideways INSIDE this box (never the
 * page), and the row label stays put while it does, or the operator is reading
 * digits with nothing to say which figure they are.
 */
const MX_WRAP = "w-fit max-w-full overflow-x-auto rounded-lg border border-border bg-surface";
/** 26px rows, the compaction `price-matrix` runs at. */
const MX_ROW_H = "min-h-[26px]";
const MX_HEAD = cn(MATRIX_HEAD, MX_ROW_H);
const MX_FOOT = cn(MATRIX_FOOT, MX_ROW_H);
const MX_CELL = matrixCell(MX_ROW_H);
/**
 * A FIGURE CELL IS RIGHT-ALIGNED HERE AND CENTRED ON THE PRICES MATRIX, AND
 * THAT IS NOT AN INCONSISTENCY.
 *
 * There, a column holds ONE rate with a size token over it and a piece count
 * under it, nothing stacks, and centring is what made the three agree (client
 * 2026-09-02, screenshot 2641). Here a column holds FIVE figures that add up
 * DOWN it — Ordered + Excess + Approval + Rejection = To make — so the digits
 * have to stack on their right edge or the arithmetic the table exists to show
 * cannot be read. The header and the Total column are right-aligned with them,
 * which is the same rule both grids obey: the column decides, and all its bands
 * agree.
 */
const MX_NUM = cn(MX_CELL, "justify-end px-2 text-[12.5px] tabular-nums");
/** The row-name column. Sticky for the reason `price-matrix` gives. */
const MX_NAME = cn(
  MX_CELL,
  "sticky left-0 z-10 justify-start whitespace-nowrap border-r border-border-strong bg-surface px-2",
);
/** The roll-up column. `border-l-2` so it reads as a rule rather than a cell edge. */
const MX_TOTAL = "border-l-2 border-border-strong font-semibold";
/** A cell that IS a field, and it KEEPS `Input`'s own border.
 *
 *  It read `rounded-none border-0 bg-transparent` on the same "the grid rule is
 *  the field edge" reasoning `price-matrix` used, and the RAAGAM SKIN reverses
 *  it: `[data-skin="raagam"] input { border-color: #79b023 }` is what lifts
 *  every typed box in the Orders module to the logo green, while `--border`
 *  stays pale so the seams keep quiet. A borderless field opts out of the one
 *  rule that colours it, which is why this tab's boxes were invisible beside
 *  green ones everywhere else (client 2026-09-02). 22px inside a 26px cell, so
 *  no row grows; 6px of radius because the token's 12px is a lozenge at this
 *  height, by the skin's own measure.
 *
 *  `w-full min-w-0` IS THE WHOLE REASON THIS TABLE WAS 1,175px WIDE. An
 *  `<input>` has an intrinsic width of ~180px (the HTML `size` default of 20
 *  characters), and in an AUTO-LAYOUT `<table>` that intrinsic width is what the
 *  column is sized from — `w-full` cannot shrink it, and `min-w-[44px]` was a
 *  floor where a ceiling was needed. Five sizes therefore came out at ~205px
 *  each (client 2026-09-02, screenshot 2642). An explicit grid track ignores
 *  intrinsic widths entirely, which is why the fix is the track and not a
 *  narrower box. */
const MX_BOX =
  "h-[22px] @2xl/editor:h-[22px] w-full min-w-0 rounded-[6px] px-1 text-right text-[12.5px] md:text-[12.5px] font-semibold tabular-nums";

/** The row grid, declared ONCE so the header and every line cannot drift. */
/**
 * The row grid, declared ONCE so the header and every line cannot drift.
 *
 * ## IT QUERIES `/editor`, BECAUSE `/section` IS NOT A CONTAINER HERE
 *
 * These were `@lg/section:` and therefore DEAD (client 2026-09-02, screenshot
 * 2642): `@container/section` is declared by `DetailSection`, the Garment
 * Order's Approval Qty tab renders a bare `<div>`, and a container query with no
 * named ancestor never matches. So the three wide columns below were not
 * "hidden until the pane is wide enough" — they were hidden at every width, on
 * a 1,600px pane, while the 3-column track stretched across it. **This is the
 * `bg-muted` trap in a different costume**: a class that compiles, ships, and
 * silently does nothing.
 *
 * `@container/editor` is real — `MasterFullScreen` puts it on the content pane
 * every section renders into — so querying it works wherever this component is
 * mounted, without depending on a wrapper the caller may not use.
 */
const COLS =
  "grid grid-cols-[minmax(7rem,1.5fr)_5.5rem_1.75rem] items-center gap-x-2.5 @lg/editor:grid-cols-[minmax(8rem,1.5fr)_6rem_7.5rem_5rem_6.5rem_1.75rem]";
/** Columns that only appear once the pane is wide enough to hold them. */
const WIDE = "hidden @lg/editor:block";

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
   * WHICH COLOUR IS OPEN — an ACCORDION (client 2026-08-27: "add auto collaps
   * option", the same instruction given for the Material BOM's combination
   * bands that morning: "add that automatic collapse option, now its totally
   * open … open the first section, close the second one").
   *
   * ## IT REVERSES "DEFAULT OPEN", WHICH ITSELF REVERSED "DEFAULT CLOSED"
   *
   * This state was a SHUT SET, and the set was the whole of default-open: open
   * was the absence of a decision, so a colour added on the Combos tab later
   * arrived expanded rather than hidden behind a set nobody had updated. That
   * reasoning is right for a multi-open fold and WRONG under an accordion,
   * where a colour arriving open is a SECOND open colour. Same reversal, same
   * reason, as `mba-master-screen`'s bands the same day.
   *
   * The 08-21 argument for opening everything is not refuted, it is outgrown:
   * what paid off "took huge space in screen" was the SHAPE — one line per
   * colour, sizes across — and an open colour cost one strip. It now costs a
   * five-row breakup matrix, so the length that folding used to save is back.
   *
   * ## ONE NAME, BECAUSE A SET CAN HOLD TWO
   *
   * The invariant is the TYPE, not a rule every future writer has to remember:
   * there is nowhere here to write "both open". Three states, the shape
   * `ChildGrid`'s `openRowKey` and the BOM's `openGroups` already use:
   *
   *   undefined — no decision yet, so the FIRST colour is open. DERIVED rather
   *               than seeded: `colours` is built by `buildApprovalTree` and is
   *               empty on the render this state is created in, so a seed would
   *               name nothing and never be revisited.
   *   a combo   — that colour is open and every other one is shut.
   *   null      — the operator shut the open one. Nothing is open, and the tab
   *               is a clean index of colours with their totals — a legitimate
   *               resting state, which is why this toggles rather than cycling
   *               to always leave one open.
   *
   * Component state, deliberately: `amendment-screen` returns early on
   * `if (mode === "list")`, so a `useState` added there has to sit above that
   * return or React counts hooks differently between the two renders and blanks
   * the route. Owning it here means the screen grows no hook at all.
   */
  const [openCombo, setOpenCombo] = useState<string | null | undefined>(undefined);
  /** `undefined` resolved against today's colours — see the three states above. */
  const shown = openCombo === undefined ? (colours[0]?.combo ?? null) : openCombo;
  const toggle = (combo: string) =>
    setOpenCombo((cur) => {
      const at = cur === undefined ? (colours[0]?.combo ?? null) : cur;
      return at === combo ? null : combo;
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
          /* EVERY SIZE'S FIGURES, DERIVED ONCE. Five rows read the same three
             numbers per size, and calling `derive` inside each row would run it
             five times over — and, worse, put five call sites where one rounding
             rule has to hold. `roll` above sums the same values; it is left
             alone rather than folded in with these, because it must keep
             answering for a CLOSED colour too, where no cell is drawn. */
          const cells = c.sizes.map((z) => ({ z, d: derive(z.qty, num(z.approval)) }));
          /* Whether the Rejection row has anything to say — see its comment. */
          const anyRejection = cells.some((x) => x.d.rejection !== null);
          /**
           * THE BREAKUP'S COLUMN TRACK, measured from the figures actually in
           * each column — the same rule the Prices matrix and the Assortments
           * grid size their size runs by (`sizeColPx` / `textColPx`).
           *
           * A size column has to hold FIVE stacked figures plus its own token,
           * so all five are measured; the widest is what the column is for. The
           * row-name column is a fixed vocabulary whose longest word is
           * "Rejection", and the Total column holds a colour's roll-up.
           */
          const colChars = (x: (typeof cells)[number]) =>
            Math.max(
              fmtNumber(x.z.qty).length,
              fmtNumber(x.d.excess).length,
              x.z.approval.trim().length,
              x.d.rejection === null ? 1 : fmtNumber(x.d.rejection).length,
              fmtNumber(x.d.total).length,
            );
          const track = [
            textColPx("Rejection".length, 16, 76, 120) + "px",
            ...cells.map((x) => sizeColPx(x.z.label, colChars(x)) + "px"),
            textColPx(
              Math.max(fmtNumber(r.total).length, fmtNumber(r.qty).length),
              16,
              56,
              96,
            ) + "px",
          ].join(" ");
          /* MIXED CANNOT BE CLOSED, AND THAT OUTRANKS THE ACCORDION. A single
             box cannot honestly show one figure for six that disagree, so the
             breakup is the only place the value can be read — shutting it would
             leave the operator with a box that refuses to say what is stored.

             SO A MIXED COLOUR IS OPEN ALONGSIDE THE ACCORDION'S ONE, and that
             is the intended reading rather than a leak: "one at a time" is a
             convenience about LENGTH, and honesty about a stored value is not
             negotiable against it. It cannot run away with the screen either —
             `uniformApproval` returns "" for a colour nobody has typed into, so
             every colour on a fresh order is uniform and mixed is only ever
             something the operator did on purpose. */
          const isOpen = (shown === c.combo || one === null) && c.sizes.length > 0;
          return (
            <div
              key={c.combo}
              data-grid-row
              className={cn(
                "rounded-md border bg-surface px-3",
                isOpen ? "border-primary" : "border-border hover:border-border-strong",
              )}
            >
              {/**
               * THE WHOLE LINE OPENS THE COLOUR, not just the chevron (client
               * 2026-09-02: "if i click the colors the tab is why not ist
               * exploting").
               *
               * The chevron was a 24px target at the far right of a ~1,600px
               * row, and the thing an operator actually points at is the colour
               * name — so the row read as inert everywhere except one corner.
               * `bom-slice-grid` answers the same question by putting the NAME
               * inside the `data-row-open` button; that shape is not available
               * here because this row also holds an `<Input>` (the each-box)
               * and a control cannot nest inside a button.
               *
               * SO THE MOUSE GETS THE ROW AND THE KEYBOARD KEEPS THE CHEVRON.
               * A second `data-row-open` — or a `role="button"` on this div —
               * would be a SECOND Tab stop for one action, which is the
               * regression AGENTS.md's "Tab lands on fields" rule exists to
               * prevent; the chevron already carries `aria-expanded` and a real
               * accessible name, so nothing is lost by leaving it the only
               * focusable control.
               *
               * TWO GUARDS, both load-bearing. `closest(...)` lets a click on
               * the each-box, or on the chevron itself, reach its own control —
               * without it the chevron would toggle twice (its handler, then
               * this one on the way up) and land back where it started. And a
               * colour with no sizes does not toggle at all: `isOpen` requires
               * sizes, so opening one would show nothing WHILE shutting the
               * colour the operator was reading.
               */}
              <div
                className={cn(COLS, "min-h-9", c.sizes.length > 0 && "cursor-pointer")}
                onClick={(e) => {
                  if (c.sizes.length === 0) return;
                  if (
                    (e.target as HTMLElement).closest(
                      "input,button,select,textarea,a,[role='button']",
                    )
                  ) {
                    return;
                  }
                  toggle(c.combo);
                }}
              >
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
                <div className="mt-0.5 border-t border-dashed border-border pt-2 pb-2.5">
                  <div className={MX_WRAP}>
                    {/* NO `data-grid-body` AND NO `data-grid-row` IN HERE.
                        A "row" for the keyboard is the COLOUR and its open
                        breakup together — `gridKeyNav` walks the each-box then
                        S, M, L along the colour's own `data-grid-row` above, in
                        the order the operator fills them. Marking these five
                        display rows would split that one row into five and put
                        the four read-only ones on the ↑/↓ axis with nothing to
                        type in them.

                        THE TRACK IS EXPLICIT, WHICH IS THE FIX. This was a
                        `<table>` with auto layout, so each column was sized from
                        its widest content — and the Approval row's `<input>`
                        contributes its ~180px intrinsic width whatever CSS width
                        it is given. Five sizes came out at ~205px each and the
                        breakup filled the pane (client 2026-09-02, screenshot
                        2642) while its wrapper was, correctly, hugging. */}
                    <div
                      className="grid w-fit"
                      style={{ gridTemplateColumns: track }}
                    >
                      {/* ---- header ---- THE CORNER IS EMPTY, not labelled
                          "Figure": the row names below say what they are, and a
                          word here would be a heading for a column of headings. */}
                      <div className={cn(MX_HEAD, "sticky left-0 z-30 justify-start pl-2")} />
                      {cells.map((x) => (
                        <div key={x.z.sizeId} className={MX_HEAD}>
                          <span className={MATRIX_SIZE_TOKEN}>{x.z.label}</span>
                        </div>
                      ))}
                      <div className={cn(MX_HEAD, MX_TOTAL, "justify-end pr-2")}>
                        Total
                      </div>

                      {/* ORDERED is what every other row is judged against, so
                          it leads — "2 of 100" and "2 of 300" are different
                          decisions, which is why the strip used to print it
                          above each box. */}
                      <div className={cn(MX_NAME, T_LABEL)}>Ordered</div>
                      {cells.map((x) => (
                        <div key={x.z.sizeId} className={MX_NUM}>{fmtNumber(x.z.qty)}</div>
                      ))}
                      <div className={cn(MX_NUM, MX_TOTAL)}>{fmtNumber(r.qty)}</div>

                      <div className={cn(MX_NAME, T_LABEL)}>Excess</div>
                      {cells.map((x) => (
                        <div key={x.z.sizeId} className={MX_NUM}>{fmtNumber(x.d.excess)}</div>
                      ))}
                      <div className={cn(MX_NUM, MX_TOTAL)}>{fmtNumber(r.excess)}</div>

                      {/* THE ONE ROW THAT IS TYPED. It sits where the strip's
                          boxes sat and holds the same `onSet`, so the keyboard
                          is unchanged: these are the only fields in the row, in
                          size order, and `gridKeyNav` still walks the each-box
                          then S, M, L along the SAME `data-grid-row`. */}
                      <div className={cn(MX_NAME, T_LABEL, "bg-surface-muted/40 text-foreground")}>
                        Approval
                      </div>
                      {cells.map((x) => (
                        <div
                          key={x.z.sizeId}
                          className={cn(MX_CELL, "justify-end bg-surface-muted/40 px-0")}
                        >
                          <Input
                            type="number"
                            value={x.z.approval}
                            onChange={(e) => onSet(c.combo, x.z.sizeId, e.target.value)}
                            aria-label={`Approval quantity, ${c.combo} ${x.z.label}, of ${x.z.qty} ordered`}
                            className={MX_BOX}
                          />
                        </div>
                      ))}
                      <div className={cn(MX_NUM, MX_TOTAL, "bg-surface-muted/40")}>
                        {fmtNumber(r.approval)}
                      </div>

                      {/* REJECTION IS DRAWN ONLY WHEN IT HAS AN ANSWER. It is
                          null with no Rejection Rule on the order and null in a
                          gap between tiers, and a row of zeroes would read as
                          "none needed" — the `0`-versus-refusal distinction the
                          requirement engine is built around. A null BESIDE real
                          answers still prints, as a dash, because there the gap
                          is the finding. */}
                      {anyRejection && (
                        <>
                          <div className={cn(MX_NAME, T_LABEL)}>Rejection</div>
                          {cells.map((x) => (
                            <div key={x.z.sizeId} className={MX_NUM}>
                              {x.d.rejection === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                fmtNumber(x.d.rejection)
                              )}
                            </div>
                          ))}
                          <div className={cn(MX_NUM, MX_TOTAL)}>{fmtNumber(r.rejection)}</div>
                        </>
                      )}

                      {/* THE ANSWER, in the accent the colour row's own "To
                          make" already uses, so the eye pairs the two. It takes
                          the FOOT band for the same reason Prices' weights do:
                          the last line of one of these grids is a conclusion,
                          not another row. */}
                      <div
                        className={cn(
                          MX_FOOT,
                          "sticky left-0 z-30 justify-start pl-2 text-[10.5px] uppercase tracking-wide text-foreground",
                        )}
                      >
                        To make
                      </div>
                      {cells.map((x) => (
                        <div key={x.z.sizeId} className={cn(MX_FOOT, "justify-end px-2 text-primary")}>
                          {fmtNumber(x.d.total)}
                        </div>
                      ))}
                      <div className={cn(MX_FOOT, MX_TOTAL, "justify-end px-2 text-primary")}>
                        {fmtNumber(r.total)}
                      </div>
                    </div>
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
