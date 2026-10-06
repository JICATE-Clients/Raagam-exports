"use client";

/**
 * Sample Entry ▸ Quantities ▸ [Details] — ORDER ENTRY'S ASSORTMENTS SHEET,
 * copied (user 2026-10-06: "the quantities tab should open the qty tab from
 * order module order entry ... copy to here same"). That reverses the morning's
 * "spec's simplified version" decision; this file used to be the simplified one.
 *
 * What is Order Entry's, rule for rule (garment-order-screen.tsx, `assortGrid`
 * and the Assortments `Sheet`):
 *
 * - `fullBleed`; the title says the destination and its Assortment Type, and is
 *   the only thing above the grid besides the pack's own switches.
 * - SINGLE STYLE / MULTIPLE STYLE. Single: every line packs the destination's
 *   style and the size columns are its sizes. Multiple: each line names a style,
 *   the columns are the union of the styles in play, and a cell for a size the
 *   line's style does not carry is read-only (OE `lineHasSize`).
 * - THE MODE IS THE ASSORTMENT TYPE (`sampleAssortMode`, OE `assortModeOf`):
 *   Solid Colour / Solid Size — the cells are pieces, Qty = their sum.
 *   An assorted-size type — the cells are a RATIO; Ctns (and Inners when Ratio
 *   For = Inner) multiply it, Pcs/Pack is the ratio's sum, and
 *   Qty = cartons × (inners) × ratio — `qty-balance.ts`, the module Order Entry
 *   itself reads, so the two screens cannot do this sum two ways.
 * - Totals band, the "N of M allocated" strip, a Ratio Total under an assorted
 *   pack, "+ Add assortment" that declines while the last line is untouched,
 *   and Done that REFUSES while the breakup and the PO Qty disagree.
 *
 * What a sample has no part of: pack types (Order Entry's PACKS row), and the
 * carton / master-CTN block Order Entry withdrew on 2026-08-19 — this sheet's
 * Pack / No of Cartons / Master CTN fields went with that copy; their stored
 * values pass through a save untouched.
 */
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { gridKeyNav } from "@/components/masters/child-grid";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import {
  MATRIX_FOOT,
  MATRIX_HEAD,
  MATRIX_SIZE_TOKEN,
  matrixCell,
  sizeColPx,
} from "@/components/orders/matrix-grid";
import { fmtNumber } from "@/lib/format";
import { sortBySize } from "@/lib/masters/size-order";
import type { AssortMode } from "@/lib/orders/amendments/qty-balance";
import {
  assortLineQty,
  assortRatioTotal,
  assortTotal,
  sampleAssortBalanceMessage,
  type AssortLineDraft,
  type QuantityDraft,
  type StyleDraft,
} from "@/lib/sales/sample-entry/types";
import { AllocationStrip } from "./allocation-strip";

/** OE `ASSORT_ID_W` / `ASSORT_QTY_W`. */
const ID_W = 340;
const QTY_W = 88;
const CELL = matrixCell("min-h-9");

export function AssortmentSheet({
  open,
  onClose,
  onBlocked,
  quantity,
  mode,
  destStyle,
  styles,
  assortmentTypeName,
  onChange,
  newKey,
}: {
  open: boolean;
  onClose: () => void;
  /** Done pressed while the breakup and the PO Qty disagree. */
  onBlocked: (why: string) => void;
  quantity: QuantityDraft | null;
  /** The Assortment Type's mode; Details opens only once it is known. */
  mode: AssortMode | null;
  /** The style the destination belongs to (its Ref No). */
  destStyle: StyleDraft | null;
  /** Every named style on the entry — the choices on a Multiple Style pack. */
  styles: StyleDraft[];
  assortmentTypeName: string;
  onChange: (patch: Partial<QuantityDraft>) => void;
  newKey: () => string;
}) {
  const q = quantity;
  const m: AssortMode = mode ?? "solid";
  const assort = m === "assort";
  const inner = assort && q?.ratio_for === "inner";
  const single = q?.is_single_style_pack ?? true;
  const destName = destStyle?.name.trim() ?? "";
  const lines = q?.lines ?? [];

  const styleOf = (name: string) =>
    styles.find((x) => x.name.trim().toUpperCase() === name.trim().toUpperCase()) ?? null;
  /** The style a line packs: its own on a Multiple pack, else the destination's. */
  const lineStyle = (l: AssortLineDraft) => (single || !l.style_ref.trim() ? destStyle : styleOf(l.style_ref));
  const lineHasSize = (l: AssortLineDraft, z: string) => !!lineStyle(l)?.sizes.includes(z);

  /** OE `sizesForOverlay`: one style's run on Single, the union on Multiple. */
  const sizes = single
    ? (destStyle?.sizes ?? [])
    : sortBySize(
        [...new Set([...(destStyle?.sizes ?? []), ...lines.flatMap((l) => lineStyle(l)?.sizes ?? [])])],
        (z) => z,
      );

  const setLines = (next: AssortLineDraft[]) => onChange({ lines: next });
  const patchLine = (key: string, patch: Partial<AssortLineDraft>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** OE `setAssortLineStyle`: a new style prunes the cells it does not carry. */
  const setLineStyle = (l: AssortLineDraft, name: string) => {
    const st = styleOf(name);
    const kept = Object.fromEntries(Object.entries(l.sizes).filter(([z]) => !!st?.sizes.includes(z)));
    patchLine(l.key, { style_ref: name.toUpperCase(), sizes: kept });
  };
  /** OE `setAssortScope`: Multiple stamps the destination's style on lines with none. */
  const setScope = (v: "single" | "multiple") =>
    onChange({
      is_single_style_pack: v === "single",
      ...(v === "multiple"
        ? { lines: lines.map((l) => (l.style_ref.trim() ? l : { ...l, style_ref: destName.toUpperCase() })) }
        : {}),
    });

  const total = q ? assortTotal(q, m) : 0;
  const poQty = Number(q?.po_qty) || 0;
  const balance = q && mode ? sampleAssortBalanceMessage(q, m, destName || "this destination") : null;
  const sizeSum = (z: string) => lines.reduce((t, l) => t + (Number(l.sizes[z]) || 0), 0);
  const digits = (z: string) =>
    Math.max(2, String(sizeSum(z)).length, ...lines.map((l) => (l.sizes[z] ?? "").trim().length));
  const track = [
    `${ID_W}px`,
    ...(assort ? ["4.5rem"] : []),
    ...(inner ? ["4.5rem"] : []),
    ...sizes.map((z) => `${sizeColPx(z, digits(z))}px`),
    ...(assort ? ["4.5rem"] : []),
    "minmax(12px,1fr)",
    `${QTY_W}px`,
  ].join(" ");

  const comboChoices = (l: AssortLineDraft) => {
    const own = (lineStyle(l)?.combos ?? []).map((c) => c.combo.trim()).filter(Boolean);
    const all = styles.flatMap((x) => x.combos.map((c) => c.combo.trim())).filter(Boolean);
    const list = [...new Set(own.length ? own : all)];
    // OE `withHeldOption`: a value the line already holds always survives.
    return [...list, ...(l.combo.trim() && !list.includes(l.combo) ? [l.combo] : [])].map((c) => ({
      value: c,
      label: c,
    }));
  };
  const styleChoices = styles
    .map((x) => x.name.trim())
    .filter(Boolean)
    .map((n) => ({ value: n.toUpperCase(), label: n }));

  /** OE `addAssortLine`: declines while the last line is untouched. */
  const last = lines[lines.length - 1];
  const lastUntouched =
    !!last &&
    !last.combo.trim() &&
    !last.no_of_cartons.trim() &&
    !last.inners_per_carton.trim() &&
    !Object.values(last.sizes).some((v) => v.trim()) &&
    (single || !last.style_ref.trim() || last.style_ref.trim().toUpperCase() === destName.toUpperCase());

  const title = [`Assortments — ${destName || "(no style)"}`, assortmentTypeName].filter(Boolean).join(" · ");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      zIndexBase={120}
      fullBleed
      footer={<SubSheetFooter onDone={onClose} parent="sample entry" blockedReason={balance} onBlocked={onBlocked} />}
    >
      {q && (
        <div className="space-y-3">
          <FieldRow>
            <Field label="">
              <Segmented<"single" | "multiple">
                name={`assort-scope-${q.key}`}
                value={single ? "single" : "multiple"}
                onChange={setScope}
                options={[
                  { value: "single", label: "Single Style" },
                  { value: "multiple", label: "Multiple Style" },
                ]}
              />
            </Field>
            {assort && (
              <Field label="Ratio For" w="term" htmlFor={`assort-ratio-${q.key}`}>
                <Select
                  id={`assort-ratio-${q.key}`}
                  value={q.ratio_for}
                  onChange={(e) =>
                    onChange({
                      ratio_for: e.target.value === "inner" || e.target.value === "master" ? e.target.value : "",
                    })
                  }
                >
                  <option value=""></option>
                  <option value="master">Master</option>
                  <option value="inner">Inner</option>
                </Select>
              </Field>
            )}
          </FieldRow>

          {sizes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This style lists no sizes, so there are no size cells to fill and Qty stays 0 — the quantity is the SUM of
              the size cells, never typed on its own. Add the sizes on <strong>Styles</strong>, then reopen this.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <div
                data-grid-body
                className="grid w-full"
                style={{ gridTemplateColumns: track }}
                onKeyDown={(e) => gridKeyNav(e)}
              >
                <div className={`${MATRIX_HEAD} sticky left-0 z-30 justify-start pl-3`}>Style / Combo</div>
                {assort && <div className={MATRIX_HEAD}>Ctns</div>}
                {inner && <div className={MATRIX_HEAD}>Inners</div>}
                {sizes.map((z) => (
                  <div key={z} className={MATRIX_HEAD}>
                    <span className={MATRIX_SIZE_TOKEN}>{z}</span>
                  </div>
                ))}
                {assort && <div className={MATRIX_HEAD}>Pcs/Pack</div>}
                <div className={MATRIX_HEAD} />
                <div className={`${MATRIX_HEAD} sticky right-0 z-30 justify-end pr-3`}>Qty</div>

                {lines.map((l) => {
                  const lq = assortLineQty(q, l, m);
                  const ls = lineStyle(l);
                  return (
                    <div key={l.key} data-grid-row className="contents">
                      <div
                        className={`${CELL} sticky left-0 z-10 flex-col items-stretch justify-center gap-1 border-r bg-surface px-3 py-1.5`}
                      >
                        <div className="flex items-center gap-1.5">
                          {single || styleChoices.length < 2 ? (
                            <Truncated className="min-w-0 flex-1 text-sm font-medium">{destName || "—"}</Truncated>
                          ) : (
                            <div className="min-w-0 flex-1">
                              <Combobox
                                options={styleChoices}
                                value={l.style_ref}
                                onChange={(v) => setLineStyle(l, v)}
                                clearable
                              />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <Combobox
                              options={comboChoices(l)}
                              value={l.combo}
                              onChange={(v) => patchLine(l.key, { combo: v.toUpperCase() })}
                              clearable
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-row-remove
                            className="shrink-0 text-muted-foreground hover:text-danger"
                            aria-label="Remove assortment line"
                            onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                          >
                            <Trash2 className="h-4 w-4 shrink-0" />
                          </Button>
                        </div>
                        <Truncated className="text-[10px] leading-tight text-border-strong">
                          {ls?.description.trim() ?? ""}
                        </Truncated>
                      </div>
                      {assort && (
                        <div className={CELL}>
                          <Input
                            type="number"
                            min={0}
                            aria-label="Ctns"
                            className="h-8 text-right"
                            value={l.no_of_cartons}
                            onChange={(e) => patchLine(l.key, { no_of_cartons: e.target.value })}
                          />
                        </div>
                      )}
                      {inner && (
                        <div className={CELL}>
                          <Input
                            type="number"
                            min={0}
                            aria-label="Inners per carton"
                            className="h-8 text-right"
                            value={l.inners_per_carton}
                            onChange={(e) => patchLine(l.key, { inners_per_carton: e.target.value })}
                          />
                        </div>
                      )}
                      {sizes.map((z) => {
                        const usable = lineHasSize(l, z);
                        return (
                          <div key={z} className={CELL}>
                            <Input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              readOnly={!usable}
                              aria-label={`${l.combo || "Combo"} ${z}`}
                              className="h-8 px-1.5 text-right font-mono text-[13px] tabular-nums"
                              value={usable ? (l.sizes[z] ?? "") : ""}
                              onChange={(e) => patchLine(l.key, { sizes: { ...l.sizes, [z]: e.target.value } })}
                            />
                          </div>
                        );
                      })}
                      {assort && (
                        <div className={CELL}>
                          <span className="block w-full text-right text-sm tabular-nums text-muted-foreground">
                            {fmtNumber(assortRatioTotal(l))}
                          </span>
                        </div>
                      )}
                      <div className={CELL} />
                      <div
                        className={`${CELL} sticky right-0 z-10 justify-end border-l bg-surface pr-3 text-sm font-semibold tabular-nums ${lq > poQty ? "text-danger" : ""}`}
                      >
                        {fmtNumber(lq)}
                      </div>
                    </div>
                  );
                })}

                <div
                  className={`${MATRIX_FOOT} sticky left-0 z-30 justify-start pl-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground`}
                >
                  Total
                </div>
                {assort && <div className={MATRIX_FOOT} />}
                {inner && <div className={MATRIX_FOOT} />}
                {sizes.map((z) => (
                  <div key={z} className={MATRIX_FOOT}>
                    {fmtNumber(sizeSum(z))}
                  </div>
                ))}
                {assort && <div className={MATRIX_FOOT} />}
                <div className={MATRIX_FOOT} />
                <div
                  className={`${MATRIX_FOOT} sticky right-0 z-30 justify-end pr-3 ${balance ? "text-danger" : "text-primary"}`}
                >
                  {fmtNumber(total)}
                </div>
              </div>
            </div>
          )}

          <AllocationStrip allocated={total} target={poQty} />
          {assort && (
            <p className="text-xs tabular-nums text-muted-foreground">
              Ratio Total{" "}
              <span className="font-semibold text-foreground">
                {fmtNumber(lines.reduce((t, l) => t + assortRatioTotal(l), 0))}
              </span>
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-row-add
            className="mt-3"
            onClick={() => {
              if (lastUntouched) return;
              setLines([
                ...lines,
                {
                  key: newKey(),
                  style_ref: single ? "" : destName.toUpperCase(),
                  combo: "",
                  no_of_cartons: "",
                  inners_per_carton: "",
                  sizes: {},
                },
              ]);
            }}
          >
            + Add assortment
          </Button>
        </div>
      )}
    </Sheet>
  );
}
