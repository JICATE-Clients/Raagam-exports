"use client";

/**
 * Budget ▸ CMTs ▸ [Breakup] — one CMT line's rate, split into the operations
 * that make it up, as the SAMPLE COSTING's CMT table does it (client
 * 2026-10-30, screenshots 3870 + "CMT OPERATIONS ₹ / piece": "CMT breakup
 * connect with master like costing operation … same, duplicate it in budget
 * breakup"). Operation is picked from Master Data ▸ Materials ▸ CMT Processes
 * (0735), Rate is typed per piece, and the band prints their total per piece.
 * It replaced five fixed boxes (0574: Cutting · Sewing / Making · Checking ·
 * Ironing · Packing), which could not name a Bar Tack or a Kaja Button.
 *
 * A `[Click]` sub-detail of an already-open editor with NOTHING OF ITS OWN TO
 * SAVE, so every rule of AGENTS.md "A sub-detail Sheet's size" applies:
 * `size="sm"`, `alignToPane`, `origin` from the button that opened it, and a
 * `SubSheetFooter`. The rows live on the budget line (`cmt_ops`, 0771) and are
 * written by the budget's own Save.
 *
 * ## THE BREAKUP EXPLAINS THE RATE; IT NEVER DISAGREES WITH IT
 *
 * `chk_obl_cmt_ops` holds `rate = Σ operations` whenever one is picked, and
 * the schema derives the rate from them. The screen writes the total onto the
 * line's rate as the rows change. Removing every operation leaves the rate as
 * it last stood, typed-in again.
 *
 * ## A BLANK END ROW, NOT A "+ ADD" (AGENTS.md "Tab lands on fields")
 *
 * The costing's tables keep one blank row at the bottom; picking an operation
 * on it makes it a line and a fresh blank appears. Same here (`tailRow`): the
 * save drops the blank, and Enter on it moves on rather than adding anything.
 * NOTHING IS REQUIRED — the breakup is optional, so no cell holds the cursor.
 */

import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { isInactive } from "@/lib/masters/inactive";
import { cmtBreakupTotal, isRefusal, type CmtOp } from "@/lib/orders/budget/totals";

/** One operation row as the screen holds it — the rate as typed. */
export type CmtOpRow = { key: string; cmt_process_id: string | null; name: string; rate: string };

/** A CMT operation from the master, as the picker offers it. */
export type CmtProcessOption = { id: string; name: string; inactive?: boolean | null };

let seq = 0;
export const blankCmtOp = (): CmtOpRow => ({ key: `cmt-op-${++seq}`, cmt_process_id: null, name: "", rate: "" });

/** Untouched = nothing picked and nothing typed: the blank end row. */
const isBlankOp = (r: CmtOpRow) => !r.cmt_process_id && r.rate.trim() === "";

/** Always exactly one blank row at the end — never `[]` (default rows rule). */
export function withTrailingOp(rows: readonly CmtOpRow[]): CmtOpRow[] {
  const kept = rows.filter((r, i) => !isBlankOp(r) || i === rows.length - 1);
  return kept.length && isBlankOp(kept[kept.length - 1]) ? kept : [...kept, blankCmtOp()];
}

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The rows as the engine and the save read them — the blank row dropped. */
export function breakupOf(rows: readonly CmtOpRow[]): CmtOp[] {
  return rows
    .filter((r) => !isBlankOp(r))
    .map((r) => ({ cmt_process_id: r.cmt_process_id, name: r.name, rate: numOrNull(r.rate) }));
}

/** A line has a breakup once an operation is picked on it. */
export const hasBreakupRows = (rows: readonly CmtOpRow[]) => rows.some((r) => !!r.cmt_process_id);

/** Stored operations → screen rows, with the blank end row. */
export function cmtOpRowsOf(ops: readonly CmtOp[] | null | undefined): CmtOpRow[] {
  return withTrailingOp(
    (ops ?? []).map((o) => ({
      key: `cmt-op-${++seq}`,
      cmt_process_id: o.cmt_process_id,
      name: o.name,
      rate: o.rate == null ? "" : String(o.rate),
    })),
  );
}

/**
 * Operation `term` (176) + Rate `range` (112) = 288, + the grid's ~72px of
 * index and ✕ = 360 — inside `size="sm"`'s ~408px of content, which is why the
 * table can be `tableAlways` instead of collapsing to cards. A long name
 * ("COMPONENTS FROM BIT FORM") ellipses in the trigger and reveals on hover.
 */
export function CmtBreakupSheet({
  open,
  onClose,
  origin,
  title,
  rows,
  options,
  editable,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  origin?: SheetOrigin | null;
  /** The row's style + coordinate — "CMT breakup · ST-104 · TOP". */
  title: string;
  rows: CmtOpRow[];
  options: readonly CmtProcessOption[];
  editable: boolean;
  onChange: (rows: CmtOpRow[]) => void;
}) {
  const total = cmtBreakupTotal(breakupOf(rows));
  const refusal = isRefusal(total) ? total : null;
  const perPiece = typeof total === "number" ? total : 0;

  const setRow = (key: string, patch: Partial<CmtOpRow>) =>
    onChange(withTrailingOp(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))));

  /* AGENTS.md "Disabled rows": a switched-off operation is not offered, except
     on the row that already holds it. An operation already on another row is
     not offered twice — one rate per operation. */
  const optionsFor = (r: CmtOpRow) =>
    options
      .filter((o) => o.id === r.cmt_process_id || (!isInactive(o) && !rows.some((x) => x.cmt_process_id === o.id)))
      .map((o) => ({ value: o.id, label: o.name }));

  const columns: ChildGridColumn<CmtOpRow>[] = [
    {
      header: "Operation",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <Combobox
          compact
          inputClassName="h-8"
          openOnFocus={false}
          disabled={!editable}
          options={optionsFor(r)}
          value={r.cmt_process_id ?? ""}
          onChange={(id) => setRow(r.key, { cmt_process_id: id || null, name: options.find((o) => o.id === id)?.name ?? "" })}
        />
      ),
    },
    {
      header: "Rate ₹",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label={`${r.name || "Operation"} rate per piece`}
          readOnly={!editable}
          value={r.rate}
          onChange={(e) => setRow(r.key, { rate: e.target.value })}
        />
      ),
    },
  ];

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
      <ChildGrid<CmtOpRow>
        label="CMT Operations"
        badge={<span className="tabular-nums">₹ {perPiece.toFixed(2)} / piece</span>}
        columns={columns}
        rows={rows}
        tableAlways
        tailRow={isBlankOp}
        hideAdd={!editable}
        hideRemove={!editable}
        onAdd={() => onChange(withTrailingOp([...rows, blankCmtOp()]))}
        onRemove={(r) => onChange(withTrailingOp(rows.filter((x) => x.key !== r.key)))}
      />
      {/* THE WARNING SITS UNDER THE TABLE IT IS ABOUT — the engine's refusal
          names the operation ("BAR TACK rate cannot be negative"). */}
      {refusal && <p className="mt-2 text-sm text-danger">{refusal.refused}</p>}
    </Sheet>
  );
}
