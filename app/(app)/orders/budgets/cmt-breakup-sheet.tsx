"use client";

/**
 * Budget ▸ CMTs ▸ [Breakup] — one CMT line's rate, split into the operations
 * that make it up (Cutting · Sewing / Making · Checking · Ironing · Packing).
 *
 * A `[Click]` sub-detail of an already-open editor with NOTHING OF ITS OWN TO
 * SAVE, so every rule of AGENTS.md "A sub-detail Sheet's size" applies as
 * written: `size="sm"` (five boxes and a total — `md`'s 1152px would be a blank
 * pane around them), `alignToPane`, `origin` from the button that opened it,
 * and a `SubSheetFooter`. The values live on the budget line and are written by
 * the budget's own Save.
 *
 * ## THE BREAKUP EXPLAINS THE RATE; IT NEVER DISAGREES WITH IT
 *
 * 0574 holds `rate = Σ breakup` whenever any operation is set, and the schema
 * derives the rate from the breakup. This sheet therefore only ever edits the
 * five figures; the screen writes their total onto the line's rate as they
 * change. Clearing all five leaves the rate as it last stood, typed-in again —
 * the fast path of one rate per piece is not taken away by having looked here.
 *
 * NOTHING HERE IS REQUIRED. A breakup is optional per operation: a style that
 * is not ironed has no Ironing figure, and a blank box must not hold the cursor.
 */

import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import {
  CMT_OPERATIONS,
  cmtBreakupTotal,
  isRefusal,
  type CmtOperationKey,
} from "@/lib/orders/budget/totals";

export type CmtBreakupValues = Record<CmtOperationKey, string>;

/**
 * THE SIX BOXES ARE `range` (112px), TWO ROWS OF THREE (Phase 6, 2026-09-18).
 *
 * The value decides it, not the label: a rate is `numeric(14,4)`, so a
 * three-digit rate reads "123.4567" — 8 characters, ~67px of text plus the
 * input's ~26px of padding and border, which `hug` (88) clips and `range`
 * clears. `range` also holds "Sewing / Making" on one line (~95px at the
 * label's 12px/600), so no label in the row wraps.
 *
 * THE SHEET IS THE CAP. `size="sm"` is `max-w-md` (448px, ~408 of content),
 * and a row of three is 3 x 112 + 2 x 12 = 360 — it fits whole, and a fourth
 * (484) would not, which is what makes the break fall after Checking on every
 * screen rather than wherever the pane happens to end. No card here, so there
 * is no second width to state.
 */
const RATE_W = "range" as const;

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The five typed figures as the engine reads them — blank is "not broken up". */
export function breakupOf(values: CmtBreakupValues) {
  return Object.fromEntries(
    CMT_OPERATIONS.map((op) => [op.key, numOrNull(values[op.key])]),
  ) as Record<CmtOperationKey, number | null>;
}

export function CmtBreakupSheet({
  open,
  onClose,
  origin,
  title,
  values,
  editable,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  origin?: SheetOrigin | null;
  /** The row's style + coordinate — "CMT breakup · ST-104 · TOP". */
  title: string;
  values: CmtBreakupValues;
  editable: boolean;
  onChange: (key: CmtOperationKey, value: string) => void;
}) {
  const total = cmtBreakupTotal(breakupOf(values));
  /* A WARNING SITS UNDER THE FIELD IT IS ABOUT (Phase 7, 2026-09-18). The
     engine's refusal names its operation (`Refusal.field`), so the sentence
     goes under THAT box — "Ironing rate cannot be negative" under Ironing —
     and nothing is printed under the row. A refusal naming no operation (none
     today) falls back to the Total, the figure it stops. */
  const refusal = isRefusal(total) ? total : null;
  const refusedOp = CMT_OPERATIONS.find((op) => op.key === refusal?.field)?.key ?? null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      alignToPane
      origin={origin}
      footer={<SubSheetFooter onDone={onClose} parent="budget" />}
    >
      {/* `align="start"`: a message renders UNDER its control, and a
          bottom-aligned row would lift that one box above the others. */}
      <FieldRow align="start">
        {CMT_OPERATIONS.map((op) => (
          <Field
            key={op.key}
            label={op.label}
            w={RATE_W}
            htmlFor={`cmt-${op.key}`}
            error={refusedOp === op.key ? refusal?.refused : undefined}
          >
            <Input
              id={`cmt-${op.key}`}
              className="text-right"
              inputMode="decimal"
              readOnly={!editable}
              value={values[op.key]}
              onChange={(e) => onChange(op.key, e.target.value)}
            />
          </Field>
        ))}
        {/* THE TOTAL IS THE LINE'S RATE — printed, never typed. Blank while
            nothing is broken up: there is no total of no operations. `String`,
            not `fmtNumber`: that caps at three places, and a 4dp rate printed
            at three would not be the figure the line is saved with. */}
        <Field
          label="Total"
          w={RATE_W}
          htmlFor="cmt-total"
          error={refusal && !refusedOp ? refusal.refused : undefined}
        >
          <Input
            id="cmt-total"
            readOnly
            className="text-right tabular-nums"
            value={total == null || isRefusal(total) ? "" : String(total)}
          />
        </Field>
      </FieldRow>
    </Sheet>
  );
}
