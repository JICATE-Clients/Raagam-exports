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
import { RowHoverRemove } from "@/components/ui/row-hover-remove";
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
import { MATRIX_SIZE_TOKEN, sizeColPx } from "@/components/orders/matrix-grid";
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
/* Qty is 88px of figure plus the 28px the hover x takes in the LAST cell. */
const QTY_W = 116;
/* A small numeric column (Ctns, Inners, Pcs/Pack): 4.5rem was 72px of CONTENT, and
   the sheet header cell adds 8px a side, so "Pcs/Pack" was ellipsised. */
const SMALL_W = 80;

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
  /* THE SIZE NAME IS NEVER CUT. `sizeColPx` sizes a column for its label as
     bare text, but the header draws it inside `MATRIX_SIZE_TOKEN` and the sheet
     header cell adds 8px a side with `text-overflow: ellipsis`, so "XS" read
     "X..." (user 2026-10-14). The column is the wider of the data's width and the
     chip's: 13px mono is about 8px a character, plus 14px chip, plus 16px cell. */
  const colW = (z: string) => Math.max(sizeColPx(z, digits(z)), Math.ceil(z.trim().length * 8 + 14 + 16 + 4));
  const widths = [
    ID_W,
    ...(assort ? [SMALL_W] : []),
    ...(inner ? [SMALL_W] : []),
    ...sizes.map(colW),
    ...(assort ? [SMALL_W] : []),
    QTY_W,
  ];
  const tableWidth = widths.reduce((t, w) => t + w, 0);

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
            /* SPREADSHEET TABLE, SIZED TO ITS COLUMNS (user 2026-10-14, Sample Entry >
               Assortments: `erp-sheet-grid` + `erp-table-fit`). Was a CSS grid of boxed
               fields with a 1fr filler column; now one ruled `<table>` under
               `data-grid-style="sheet"` + `data-grid-cells="flat"`, `w-fit max-w-full`,
               so the frame stops after Qty instead of running to the sheet's edge.
               The size run still scrolls inside its own frame (`[overflow-x:auto]`,
               not the `overflow-x-auto` class the sheet CSS forces to `visible`) with
               the Style / Combo column sticky. The row's x rides in the LAST cell. */
            <div data-grid-style="sheet" data-grid-cells="flat" className="w-fit max-w-full">
              <div className="w-fit max-w-full [overflow-x:auto]">
                <table className="table-fixed" style={{ width: tableWidth }}>
                  <colgroup>
                    {widths.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 text-left">Style / Combo</th>
                      {assort && <th className="text-right">Ctns</th>}
                      {inner && <th className="text-right">Inners</th>}
                      {sizes.map((z) => (
                        <th key={z} className="text-right !overflow-visible">
                          <span className={MATRIX_SIZE_TOKEN}>{z}</span>
                        </th>
                      ))}
                      {assort && <th className="text-right">Pcs/Pack</th>}
                      <th className="text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
                    {lines.map((l) => {
                      const lq = assortLineQty(q, l, m);
                      const ls = lineStyle(l);
                      return (
                        <tr key={l.key} data-grid-row>
                          <td className="sticky left-0 z-10 bg-surface">
                            <div className="flex items-stretch divide-x divide-border">
                              {single || styleChoices.length < 2 ? (
                                <div className="flex min-w-0 flex-1 items-center px-2">
                                  <Truncated className="min-w-0 flex-1 text-sm font-medium">{destName || "—"}</Truncated>
                                </div>
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
                            </div>
                            <Truncated className="block px-2 pb-1 text-[10px] leading-tight text-border-strong">
                              {ls?.description.trim() ?? ""}
                            </Truncated>
                          </td>
                          {assort && (
                            <td>
                              <Input
                                type="number"
                                min={0}
                                aria-label="Ctns"
                                className="text-right"
                                value={l.no_of_cartons}
                                onChange={(e) => patchLine(l.key, { no_of_cartons: e.target.value })}
                              />
                            </td>
                          )}
                          {inner && (
                            <td>
                              <Input
                                type="number"
                                min={0}
                                aria-label="Inners per carton"
                                className="text-right"
                                value={l.inners_per_carton}
                                onChange={(e) => patchLine(l.key, { inners_per_carton: e.target.value })}
                              />
                            </td>
                          )}
                          {sizes.map((z) => {
                            const usable = lineHasSize(l, z);
                            return (
                              <td key={z} className={usable ? "" : "bg-surface-muted"}>
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="decimal"
                                  readOnly={!usable}
                                  aria-label={`${l.combo || "Combo"} ${z}`}
                                  className="px-1.5 text-right font-mono text-[13px] tabular-nums"
                                  value={usable ? (l.sizes[z] ?? "") : ""}
                                  onChange={(e) => patchLine(l.key, { sizes: { ...l.sizes, [z]: e.target.value } })}
                                />
                              </td>
                            );
                          })}
                          {assort && (
                            <td className="text-right text-sm tabular-nums text-muted-foreground">
                              {fmtNumber(assortRatioTotal(l))}
                            </td>
                          )}
                          <td>
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`text-sm font-semibold tabular-nums ${lq > poQty ? "text-danger" : ""}`}>
                                {fmtNumber(lq)}
                              </span>
                              {/* Hover x in the last cell (user 2026-10-12, erp-row-hover-remove). */}
                              <RowHoverRemove
                                label="Remove assortment line"
                                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-muted font-semibold">
                      <td className="sticky left-0 z-10 bg-surface-muted text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                        Total
                      </td>
                      {assort && <td />}
                      {inner && <td />}
                      {sizes.map((z) => (
                        <td key={z} className="text-right tabular-nums">
                          {fmtNumber(sizeSum(z))}
                        </td>
                      ))}
                      {assort && <td />}
                      <td className={`text-right tabular-nums ${balance ? "text-danger" : "text-primary"}`}>
                        <span className="pr-[1.625rem]">{fmtNumber(total)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
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
