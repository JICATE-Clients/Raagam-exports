"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Download, FileSpreadsheet, Plus, Printer } from "lucide-react";
import { AddCharge, CellPick, Ed, EdText, RemoveX, type EditOptions } from "@/components/sales/cost-sheet-editors";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { gridKeyNav } from "@/components/masters/child-grid";
import { ProcessFoldList, type FoldListColumn } from "@/components/orders/process-fold-list";
import { Input } from "@/components/ui/input";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { newFabric, newFabricProcess, newPieceLine, newTrim, newWeightRows, newYarnMix } from "@/lib/sales/sample-costing/revision-draft";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { fmtDate } from "@/lib/format";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_TARGET_PCT, hasYarnMix, quoteKey, yarnMixTotal } from "@/lib/sales/sample-costing/calc";
import { isBlankExtra, isBlankPieceLine, isBlankTrim, type CostingDraft, type FabricDraft, type FabricProcessDraft, type PieceDraft, type YarnMixDraft } from "@/lib/sales/sample-costing/types";
import { changeText } from "@/lib/sales/sample-costing/revision-history";

/**
 * THE SAMPLE COST SHEET — the page (2026-10-08, "think more modern and visual").
 *
 * INTERNAL: rates, margin and wastage are on it. The buyer's document is the
 * Quotation, which prints prices only.
 *
 * A hero that answers "what do we quote, and does it earn enough", then the
 * story of the price (a waterfall, where it goes, the margin gauge), the working
 * per size, and the detail tables folded below. Every figure is read from
 * `CostSheetModel`, the one object the PDF and the Excel file also draw from.
 *
 * THE SHEET IS PAPER IN BOTH THEMES (the same call `document-print-styles.tsx`
 * records): it is a preview of a physical document, so its palette is fixed and
 * only the toolbar above it follows the theme. The size switch is the one
 * interactive thing on it and it does not print.
 *
 * NO RELOAD GUARD: read-only, no form, no overlay.
 */
const TONE_VAR = {
  fabric: "var(--cs-fabric)",
  cmt: "var(--cs-cmt)",
  emb: "var(--cs-emb)",
  trims: "var(--cs-trims)",
  over: "var(--cs-over)",
  margin: "var(--cs-margin)",
} as const;

/** A cost group's colour, softened for the Charts receipt (user 2026-10-15: light, plain). */
const softTone = (t: keyof typeof TONE_VAR) => `color-mix(in srgb, ${TONE_VAR[t]} 55%, #fff)`;

/** The currency the sheet's figures are SHOWN in — null is rupees, the sheet's own unit. */
type ShownCurrency = { code: string; sym: string; rate: number } | null;

/** "USD" → "$", "INR" → "₹" — the browser's narrow symbol; an unknown code comes back as itself. */
function ccySym(code: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/* AN AMOUNT BOX IN THE SHEET'S CURRENCY (user 2026-10-15: "fully USD currency format
   amounts"). The draft stores RUPEES — the costing's own unit — so a box shows its value
   ÷ the rate and writes what is typed × the rate. While the box has focus it shows exactly
   what was typed (a box re-converted on every key would eat the "." of "0.16"), and a
   value is only rewritten when it is edited. `rate` null = rupees, nothing converts. */
const toShown = (v: string, rate: number) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? v : String(+(n / rate).toFixed(4));
};
const fromShown = (v: string, rate: number) => {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? v : String(+(n * rate).toFixed(6));
};
function ShownAmount({ value, onChange, rate, children }: { value: string; onChange: (v: string) => void; rate: number | null; children: (v: string, set: (v: string) => void) => ReactNode }) {
  const [typing, setTyping] = useState<string | null>(null);
  if (!rate) return <>{children(value, onChange)}</>;
  const shown = typing ?? toShown(value, rate);
  return (
    <span className="contents" onFocus={() => setTyping(toShown(value, rate))} onBlur={() => setTyping(null)}>
      {children(shown, (v) => {
        setTyping(v);
        onChange(fromShown(v, rate));
      })}
    </span>
  );
}

/**
 * INLINE EDITING ON THE REPORT (client 2026-10-09: "inline edit inside the report
 * — the chart and the remaining calculation work the same, lively; not a
 * separate panel"). While a revision is being worked, `edit` carries the working
 * copy and the report's OWN cells become inputs: the Fabric rates table, the CMT
 * & embellishment rates and the Margin tile. The page above rebuilds `model`
 * from that copy on every keystroke, so the price, gauge, waterfall and donut
 * redraw as you type. This component computes nothing — it only writes the typed
 * text back into the draft row each cell belongs to (`model` carries the keys).
 */
export type CostSheetEdit = { draft: CostingDraft; onChange: (next: CostingDraft) => void; /** A quoted price was typed — the caller holds that one and stops recalculating it. */ onQuote?: (key: string) => void; /** The masters the row pickers list; without them the sheet edits figures only. */ options?: EditOptions };

const patchBy = <T extends { key: string }>(xs: readonly T[], key: string, patch: Partial<T>): T[] => xs.map((x) => (x.key === key ? { ...x, ...patch } : x));

/** A number box on the app's own Input — the Costing editor's NumInput, so a figure typed
 *  in the open fabric looks and selects exactly as it does there. */
function NumInput(props: React.ComponentProps<typeof Input>) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      {...props}
      className={`text-right tabular-nums ${props.className ?? ""}`}
      onFocus={(e) => {
        e.currentTarget.select();
        props.onFocus?.(e);
      }}
    />
  );
}

export function CostSheetDocument({
  model,
  locked = false,
  edit,
  lead,
  trail,
  quietDownload = false,
}: {
  model: CostSheetModel;
  /** An UNSAVED revision is on screen: nothing may be downloaded or printed from it. */
  locked?: boolean;
  /** THE PAGE'S CONTROLS SHARE THIS ROW (client 2026-10-09, screenshot 3427: "make in
   *  single with better ui"). The report tabs go before the size switch; the
   *  revision picker / Revise / Submit after the downloads — one toolbar, not two. */
  lead?: ReactNode;
  trail?: ReactNode;
  /** Another button is the next step (Submit), so Download PDF drops to outline. */
  quietDownload?: boolean;
  /** Present only while a revision is being worked — the report's cells become inputs. */
  edit?: CostSheetEdit;
}) {
  // Open on the size that earns least: that is the one the reader came to check.
  const lowest = model.sizes.reduce((best, s, i) => (s.effectiveMarginPct != null && (model.sizes[best].effectiveMarginPct ?? Infinity) > s.effectiveMarginPct ? i : best), 0);
  const [idx, setIdx] = useState(lowest);
  // REPORT OR CHARTS, NEVER BOTH (client 2026-10-10: "both chart and report as text
  // in same page — give it toggle"). The text report is the costing format, so it
  // opens first. Print prints the view on screen — except Charts: paper is text and
  // tables only (client 2026-10-14), so Print from Charts prints the full page.
  // TABS, NOT THE FULL PAGE (user 2026-10-14, screenshot 3476: "Full page —
  // hide it, Tabs is enough"). "report" survives only as what Print prints.
  // Charts is now a tab of its own (user 2026-10-15), so the switch is gone.
  const [view, setView] = useState<SheetView>("tabs");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = model.sizes[idx] ?? model.sizes[0];
  /* THE SHEET IS SHOWN IN THE QUOTED CURRENCY — USD — BY DEFAULT (user 2026-10-15: "by
     default render the full costing in USD … that multi-currency option in the USD card").
     Every amount converts from rupees at the costing's own exchange rate; the Quoted FOB
     card's pick shows it in ₹ or any currency the Quotes / Orders master has a rate for.
     A VIEW only: nothing stored changes, and the draft stays in rupees. Falls back to ₹
     while the costing has no exchange rate to get there. (Earlier the same day the ₹ INR /
     USD tabs were removed — "inr and usd field inga remove pannu"; this pick replaces them.) */
  const quotedCcy = model.currency && model.currency !== "INR" ? model.currency : null;
  const rateOf = (c: string): number | null =>
    c === "INR" ? 1 : c === quotedCcy ? (model.exchangeRate ?? null) : (model.quoteRates[c] ?? null);
  const [shownPick, setShownPick] = useState<string | null>(null);
  const shownCode = shownPick ?? (quotedCcy && rateOf(quotedCcy) ? quotedCcy : "INR");
  const shownRate = rateOf(shownCode);
  const cur: ShownCurrency = shownCode === "INR" || !shownRate ? null : { code: shownCode, sym: ccySym(shownCode), rate: shownRate };
  const ccyCodes = [...new Set([...(quotedCcy ? [quotedCcy] : []), ...Object.keys(model.quoteRates), "INR"])].filter((c) => rateOf(c) != null);
  const show = { codes: ccyCodes, code: cur ? cur.code : "INR", quoted: quotedCcy, onPick: (c: string) => setShownPick(c) };

  async function run(kind: "pdf" | "csv") {
    setBusy(kind);
    setError(null);
    try {
      const mod = await import("@/lib/sales/sample-costing/cost-sheet-export");
      if (kind === "pdf") await mod.exportCostSheetReportPdf(model, idx);
      else mod.exportCostSheetCsv(model);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <DocumentPrintStyles scope="cs" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm print:hidden">
        {lead}
        {model.sizes.length > 1 ? (
          <ToggleGroup<string>
            label="Size shown"
            value={String(idx)}
            onChange={(v) => setIdx(Number(v))}
            options={model.sizes.map((x, i) => ({ value: String(i), label: x.label }))}
          />
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {error ? <span className="text-sm text-danger">{error}</span> : null}
          {locked ? (
            null
          ) : (
            <>
              <Button variant="outline" size="md" disabled={busy != null} onClick={() => void run("csv")}>
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  // Paper is the whole sheet, text and tables: print the full page,
                  // then come back to the view on screen.
                  flushSync(() => setView("report"));
                  window.print();
                  setView("tabs");
                }}
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button variant={quietDownload ? "outline" : undefined} size="md" disabled={busy != null} onClick={() => void run("pdf")}>
                <Download className="h-4 w-4" />
                {busy === "pdf" ? "Building…" : "Download PDF"}
              </Button>
            </>
          )}
          {trail}
        </div>
      </div>
      <Sheet model={model} s={s} edit={edit} view={view} cur={cur} show={show} />
    </div>
  );
}

/* "tabs" on screen, "report" only while Print runs. Charts was a third view with its
   own Tabs | Charts switch; it is the last TAB now (user 2026-10-15), so it prints
   with nothing special — Print always prints the full text report. */
type SheetView = "tabs" | "report";

type ShowIn = { codes: string[]; code: string; quoted: string | null; onPick: (c: string) => void };

function Sheet({ model, s, edit, view, cur, show }: { model: CostSheetModel; s: SizeFigures; edit?: CostSheetEdit; view: SheetView; cur: ShownCurrency; show: ShowIn }) {
  /* The shown size's column, highlighted in the Quotation tables. Master (095e6a1a) stopped
     passing it as a prop; it is the same fact read off `s`. */
  const idx = Math.max(0, model.sizes.findIndex((x) => x.label === s.label));
  // The shown currency: every rupee figure below goes through this `money`, and every
  // "₹" a reader sees is `SYM`. Figures that ARE rupees by definition (the INR value of
  // the quote, the exchange rate) call `fx` directly and keep their ₹.
  const money = (v: number | null | undefined) => fx(v == null || !cur ? v : v / cur.rate);
  const SYM = cur ? cur.sym : "₹";
  /** ₹ per shown unit, for the amount boxes (`ShownAmount`); null = rupees. */
  const rate = cur ? cur.rate : null;
  // OPENS ON QUOTATION (user 2026-10-14: "default open the quotation tab") — the
  // last of the five tabs, the price the buyer is quoted.
  const [tab, setTab] = useState(4);
  /** The Charts receipt's hover link: the cost group under the pointer (line, legend or slice). */
  const [hot, setHot] = useState<string | null>(null);
  /* Fabric processes fold (option "Fabric Process Fold", 2026-10-15): ONE fabric open at
     a time — `undefined` until the operator toggles, meaning "the first one". */
  const [procOpen, setProcOpen] = useState<string | null | undefined>(undefined);
  // Fabric processing folds — one fabric open at a time, the first one to begin with.
  const setFabric = (key: string, patch: Partial<FabricDraft>) => edit?.onChange({ ...edit.draft, fabrics: patchBy(edit.draft.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => edit?.onChange({ ...edit.draft, pieces: patchBy(edit.draft.pieces, key, patch) });
  const eff = s.effectiveMarginPct;
  const pin = eff == null ? null : (Math.min(Math.max(eff, 0), 30) / 30) * 100;
  const ccy = model.currency ?? "";
  const stateClass = model.status === "approved" ? "good" : model.status === "submitted" ? "warn" : model.status === "rejected" ? "bad" : "brand";
  /** The USD price in rupees at the sheet's own rate — the figure the ledger carries. */
  const inrOf = (v: number | null) => (v == null || model.exchangeRate == null ? null : v * model.exchangeRate);

  // The waterfall: costs climb to Net, extras to Gross cost, margin and charges to the Price.
  type WfRow = { label: string; value: number; tone: keyof typeof TONE_VAR | null };
  const wf: WfRow[] = ([
    { label: "Fabric", value: s.fabric, tone: "fabric" },
    { label: "CMT", value: s.cmt, tone: "cmt" },
    { label: "Embellishment & testing", value: s.process + s.testing, tone: "emb" },
    { label: "Trims", value: s.trims, tone: "trims" },
    { label: "Bank charges", value: s.bank, tone: "over" },
    { label: "Net cost", value: s.net, tone: null },
    { label: "Rejection + overhead", value: s.wastage + s.overhead, tone: "over" },
    { label: "Extra charges", value: s.extraOverhead, tone: "over" },
    { label: "Gross cost", value: s.grossCost, tone: null },
    { label: `Margin ${model.terms.margin}%`, value: s.margin, tone: "margin" },
    ...(s.discount ? [{ label: "Discount", value: -s.discount, tone: "margin" as const }] : []),
    ...(s.priceAdj ? [{ label: "Price charges", value: s.priceAdj, tone: "margin" as const }] : []),
    { label: "Price", value: s.price, tone: null },
  ] as WfRow[]).filter((r) => r.tone === null || r.value !== 0);
  let run = 0;
  const wfRows = wf.map((r) => {
    const total = r.tone === null;
    let start: number;
    if (total) {
      start = 0;
      run = r.value;
    } else if (r.value >= 0) {
      start = run;
      run += r.value;
    } else {
      run += r.value;
      start = run;
    }
    return { ...r, total, start, width: Math.abs(r.value) };
  });

  const parts = priceParts(s);
  const partTotal = parts.reduce((t, p) => t + p.value, 0) || 1;
  const RING_R = 46; // the donut radius — `SYM` above is the currency symbol
  const C = 2 * Math.PI * RING_R;
  // Each slice starts where the ones before it end — computed up front, not by a
  // counter mutated inside the render's map.
  const offs = parts.map((_, i) => parts.slice(0, i).reduce((t, p) => t + (p.value / partTotal) * C, 0));


  /* Every editable table while revising: the app's grid keys (Enter along the line, then
     "+ Add"; ↑↓ by column; Ctrl+Del drives the line's ✕), and an ACTION column on the
     right holding each line's ✕ and the add line's "+ Add" (user 2026-10-15). */
  const gridBody = edit ? ({ "data-grid-body": "", onKeyDown: gridKeyNav } as const) : {};
  /* "+ ADD CHARGE" ADDS A ROW YOU CAN SEE (user 2026-10-15, screenshot 3550: "add charge is
     not working"). The model builds Overheads from `liveRows`, which drops a charge still
     blank (`isBlankExtra`) — right for the printout and the exports, wrong while typing: the
     new line existed and was never drawn. While editing, each blank charge is listed after
     the model's rows, as an editable "extra" row with nothing in it yet. */
  const overheadRows: CostSheetModel["overheads"] = edit
    ? [
        ...model.overheads,
        ...edit.draft.extras.filter(isBlankExtra).map((e) => ({
          name: "",
          type: e.kind === "pct" ? "Percent" : "Flat ₹",
          value: "",
          perSize: model.sizes.map(() => 0),
          side: (e.section === "price" ? "price" : "cost") as "price" | "cost",
          edit: { kind: "extra" as const, key: e.key },
        })),
      ]
    : model.overheads;
  const actHead = edit ? <th className="act" aria-label="Row actions" /> : null;
  const actGap = edit ? <td className="act" /> : null;

  /* COMPONENT CONSUMPTION IS EDITED WHERE IT STANDS (user 2026-10-15, screenshot 3544):
     every line's Piece, Component and Fabric are pickers on the line itself, "+ Add row"
     adds a blank line under the last, and each line has the hover ✕ Sample Entry uses.
     The separate add line (`WeightReadyRow`) is gone. A blank line is on the table while
     editing (`editRows`) and never on the printout, the exports or the charts (`rows`). */
  const weightRows = edit ? model.weights.editRows : model.weights.rows;
  /** Re-pick what a line is: written to every size's weight on it, so it stays one line. */
  const setLine = (r: (typeof weightRows)[number], patch: { piece_key?: string; component_ids?: string[]; fabric_key?: string }) =>
    edit?.onChange({ ...edit.draft, weights: edit.draft.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, ...patch } : x)) });
  /** "+ Add row" — one weight per size column, like every line. Lines group by
   *  (piece, component, fabric), so a second blank line would merge into the first:
   *  while one is still blank, the button sends the cursor to it instead. */
  const addWeightLine = () => {
    if (!edit) return;
    const open = weightRows.findIndex((r) => r.componentIds.length === 0 && !r.fabricKey);
    if (open >= 0) {
      const row = document.querySelectorAll<HTMLElement>('[aria-label="Component consumption"] tbody tr[data-grid-row]')[open];
      row?.querySelector<HTMLElement>("input, select")?.focus();
      return;
    }
    edit.onChange({ ...edit.draft, weights: [...edit.draft.weights, ...newWeightRows(edit.draft.pieces[0]?.key ?? "", [], null, model.sizes.map((x) => x.size))] });
  };
  const consumptionCols = (model.pieceCount > 1 ? 1 : 0) + 2 + model.weights.sizeLabels.length + 1 + (edit ? 1 : 0);

  const secConsumption = (
        <section className="blk" aria-label="Component consumption">
          <details open>
            <summary>
              Component consumption
            </summary>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    {model.pieceCount > 1 ? <th>Piece</th> : null}
                    <th>Component</th>
                    <th>Fabric</th>
                    {model.weights.sizeLabels.map((l) => (
                      <th key={l} className="r">{l}</th>
                    ))}
                    <th className="r">Loss %</th>
                    {actHead}
                  </tr>
                </thead>
                <tbody {...gridBody}>
                  {weightRows.map((r, i) => (
                    <tr key={r.wkeys[0] ?? i} data-grid-row>
                      {model.pieceCount > 1 ? <td>{edit?.options ? <CellPick label="Piece" options={edit.draft.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} value={{ id: r.pieceKey, name: r.piece }} onPick={(v) => v.id && setLine(r, { piece_key: v.id })} /> : r.piece}</td> : null}
                      <td>
                        {/* A line weighing two components together (0699) keeps its "A + B" as text:
                            one picker would replace both with one. */}
                        {edit?.options && r.componentIds.length <= 1 ? (
                          <CellPick label="Component" options={edit.options.components} value={{ id: r.componentIds[0] ?? null, name: r.component }} onPick={(v) => v.id && setLine(r, { component_ids: [v.id] })} />
                        ) : (
                          r.component
                        )}
                      </td>
                      <td>
                        {edit?.options ? (
                          <CellPick label="Fabric" options={edit.draft.fabrics.map((f, k) => ({ id: f.key, name: f.quality || `Fabric ${k + 1}` }))} value={{ id: r.fabricKey, name: r.fabric }} onPick={(v) => v.id && setLine(r, { fabric_key: v.id })} />
                        ) : (
                          r.fabric
                        )}
                      </td>
                      {r.grams.map((g, j) => {
                        const cell = r.cells[j];
                        const w = edit && cell && !cell.dim ? edit.draft.weights.find((x) => x.key === cell.key) : null;
                        return (
                          <td key={j} className="r">
                            {w && edit ? <Ed w="w-20" label={`${r.component} ${model.weights.sizeLabels[j]} — grams`} value={w.weight_g} onChange={(v) => edit.onChange({ ...edit.draft, weights: patchBy(edit.draft.weights, w.key, { weight_g: v }) })} /> : g == null ? "" : g}
                          </td>
                        );
                      })}
                      <td className="r">
                        {edit && r.wkeys.length ? (
                          <Ed w="w-16" label={`${r.component} — loss %`} value={edit.draft.weights.find((x) => x.key === r.wkeys[0])?.wastage_pct ?? ""} onChange={(v) => edit.onChange({ ...edit.draft, weights: edit.draft.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, wastage_pct: v } : x)) })} />
                        ) : (
                          r.lossPct
                        )}
                      </td>
                      {edit ? (
                        <td className="act">
                          {r.wkeys.length && weightRows.length > 1 ? <RemoveX label={r.component || "weight line"} onClick={() => edit.onChange({ ...edit.draft, weights: edit.draft.weights.filter((x) => !r.wkeys.includes(x.key)) })} /> : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {edit?.options ? (
                    <tr className="addrow">
                      <td colSpan={consumptionCols}>
                        <Button type="button" variant="outline" size="sm" data-row-add onClick={addWeightLine}>
                          <Plus className="h-3.5 w-3.5" />
                          Add row
                        </Button>
                      </td>
                    </tr>
                  ) : null}
                  <tr className="total">
                    <td colSpan={(model.pieceCount > 1 ? 1 : 0) + 2}>Fabric cost {SYM} / {model.unitWord}</td>
                    {model.sizes.map((x) => (
                      <td key={x.label} className="r">{money(x.fabric)}</td>
                    ))}
                    <td />
                    {actGap}
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
  );

  /* THE STYLE PHOTO, BESIDE COMPONENT CONSUMPTION (user 2026-10-15, screenshot 3524:
     "Component consumption and image in a single row, next row [fabric processing]").
     Consumption has four columns and the most room beside it, so the photo sits there
     and Fabric processing gets the full width for its yarn / process lines. The
     "Price / kg by fabric" summary that stood under the photo is removed for now
     (same day: "for now remove it"); the Charts tab still shows each fabric's split.
     The printout keeps the photo beside Fabric processing. History of the rail: it
     used to wrap UNDER the fabric table because `.fabblk` inherited `.blk`'s column. */
  const photoRail = (
          <aside className="rail" aria-label="Style photo">
            <div className="photo">
              {model.thumbUrl ? (
                <a href={model.thumbUrl} target="_blank" rel="noreferrer" title="Open the full photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={model.thumbUrl} alt="Style sketch or photo" />
                </a>
              ) : (
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                  <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
                </svg>
              )}
              <span>{model.thumbUrl ? "Click to enlarge" : "Sketch / photo"}</span>
            </div>
          </aside>
  );

  /* FABRIC PROCESSING — A RAIL OF FABRICS BESIDE THE ONE BEING WORKED (user 2026-10-15,
     plan "Fabric Processing Layout", raagam-screen-layout). The precedent is the Orders
     one-open-at-a-time shape (orders-precedent.md §7: Fabric BOM Manual, Material BOM
     items — `ChildGrid masterDetail`), copied in the sheet's own markup because this is
     a paper document whose printout depends on its tables.
     What the panel-inside-the-table version got wrong, each answered here:
     - A BOUGHT-IN FABRIC WITH NO PRICE SAID NOTHING (— — — and a blank cell). The rail
       now says "price needed" in red, and the Price / kg box says why under itself.
     - "BLEND 103%" WAS ONLY A RED NUMBER. The warning now sits under Share %, the field
       it is about ("Shares add to 103%, 3% over"), as the skill's warning rule says.
     - PROSE THAT DESCRIBED THE BOX ("Price = (yarn + processes) × …", a bold tick label)
       is replaced by the working itself, in figures: Yarn + Processes = … · +loss = ….
     - The lines lived INSIDE the fabric table and could line up with nothing; they now
       sit beside the rail in their own hugged tables.
     Reading and printing keep one summary table: paper cannot click a rail. */
  const fabricSummaryTable = (
              <div className="scroll">
                <table className="fabtable">
                  <thead>
                    <tr>
                      <th>Fabric</th>
                      <th className="r">Yarn</th>
                      <th className="r">Processes</th>
                      <th className="r">Loss %</th>
                      <th className="r">Price / kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.fabrics.map((f) => (
                      <tr key={f.key}>
                        <td>
                          <span className="fabname">
                            {f.name}
                            {f.direct ? <span className="bchip">Bought-in</span> : null}
                          </span>
                          {f.mixNote ? <div className="dim fabmix">{f.mixNote}</div> : null}
                        </td>
                        <td className="r">{f.direct ? "—" : money(f.yarn)}</td>
                        <td className="r">{f.direct ? "—" : money(f.knitting + f.dyeing + f.finishing + f.special)}</td>
                        <td className="r">{f.direct ? "—" : fx(f.lossPct)}</td>
                        <td className="r">
                          <b>{money(f.price)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
  );

  /*
   * FABRIC PROCESSING COST — ONE TABLE, ONE ROW PER YARN; PROCESSES A SECTION OF THEIR OWN
   * (user 2026-10-15, plan "Fabric Row Layout", option B: "this in single row and move
   * processes as separate section"). Replaces the 220px fabric rail + one-open-fabric pane:
   * every fabric is in view at once. A fabric's own cells — Fabric structure, Bought-in,
   * Loss %, Price / kg and its ✕ — span its yarn rows; Yarn · Mix % · Rate / KG · Weighted
   * are per yarn. Bought-in is one row with only its price to type. Hand-rolled (not
   * ChildGrid) because a fabric's cells span rows, which ChildGrid cannot draw; it sits in
   * `.appgrid`, so the paper's table rules leave it alone, and keeps the hand-rolled-grid
   * markers (`data-grid-row`, the ✕'s `data-row-remove`, "+"'s `data-row-add`).
   * Widths: term 11 + hug 5.5 + num 4.5 + term 11 + num 4.5 + hug 5.5 + hug 5.5 + hug 5.5
   * + act 4 = 57rem (~912px).
   */
  /* FLAT, COMPACT, HUGGING (user 2026-10-15, plan "Fabric Sheet Compact"): the look is
     `.fsheet` in the sheet CSS below — 28px rows, a cell IS its field (no box), blue = a
     cell you type in, hover tints, focus draws the blue edge. `in` marks a cell holding a
     field, so its padding goes and the field fills it. */
  const TD = "in";
  const yarnFig = (y: YarnMixDraft) => {
    const m = Number(y.mix_pct);
    const r = Number(y.rate);
    return y.mix_pct.trim() !== "" && Number.isFinite(m) ? fx((m * (Number.isFinite(r) ? r : 0)) / 100) : "—";
  };
  const plusBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      data-row-add
      aria-label={label}
      title={label}
      onClick={onClick}
      className="fico"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  /* THE DRAFT'S FABRICS, NOT THE MODEL'S (2026-10-15): the model drops a fabric still
     blank (`liveRows` → `isBlankFabric`), so a row "+ Add row" had just made would not
     show. The table walks the draft; the model only lends a fabric's computed figures. */
  type FabricFig = Pick<(typeof model.fabrics)[number], "key" | "name" | "price" | "direct" | "yarn" | "knitting" | "dyeing" | "finishing" | "special" | "lossPct">;
  const figuresOf = (d: FabricDraft): FabricFig =>
    model.fabrics.find((x) => x.key === d.key) ?? {
      key: d.key,
      name: d.quality || "New fabric",
      price: null,
      direct: d.is_direct,
      yarn: 0,
      knitting: 0,
      dyeing: 0,
      finishing: 0,
      special: 0,
      lossPct: 0,
    };

  const fabricWorkbench = (() => {
    if (!edit) return null;
    const opts = edit.options;
    /* "+ ADD ROW" (user 2026-10-15, screenshot 3546: "that add update it as add row") —
       the same button Component consumption carries: a blank fabric row, filled in place.
       While one is still blank it sends the cursor there instead of stacking another. */
    const addFabricRow = () => {
      const open = edit.draft.fabrics.find((x) => !x.fabric_id && !x.quality.trim());
      if (open) {
        document.querySelector<HTMLElement>(`[data-fabric-row="${open.key}"] input`)?.focus();
        return;
      }
      edit.onChange({ ...edit.draft, fabrics: [...edit.draft.fabrics, { ...newFabric(), is_direct: false, processes: [] }] });
    };
    const removeFabric = (key: string) => edit.onChange({ ...edit.draft, fabrics: edit.draft.fabrics.filter((x) => x.key !== key) });
    return (
      <div className="appgrid fsheet">
        <div className="max-w-full overflow-x-auto">
          {/* Inline width: it HUGS its columns — term 11 + num 4.5 + num 4.5 + term 11 + num 4.5
              + hug 5.5 + hug 5.5 + hug 5.5 + act 3 = 55rem — never the tab's width. */}
          <table style={{ width: "55rem" }}>
            <colgroup>
              <col style={{ width: FIELD_WIDTH_CSS.term }} />
              <col style={{ width: FIELD_WIDTH_CSS.num }} />
              <col style={{ width: FIELD_WIDTH_CSS.num }} />
              <col style={{ width: FIELD_WIDTH_CSS.term }} />
              <col style={{ width: FIELD_WIDTH_CSS.num }} />
              <col style={{ width: FIELD_WIDTH_CSS.hug }} />
              <col style={{ width: FIELD_WIDTH_CSS.hug }} />
              <col style={{ width: FIELD_WIDTH_CSS.hug }} />
              <col style={{ width: "3rem" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fabric structure</th>
                <th>Bought-in</th>
                <th className="r">Loss %</th>
                <th>Yarn</th>
                <th className="r">Mix %</th>
                <th className="r">Rate / KG</th>
                <th className="r">Weighted</th>
                <th className="r">Price / kg</th>
                <th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {edit.draft.fabrics.map((d) => {
              const f = figuresOf(d);
              const setY = (key: string, patch: Partial<YarnMixDraft>) => setFabric(f.key, { yarns: patchBy(d.yarns, key, patch) });
              /* No blend yet: the fabric's one flat yarn rate is what Rate / KG edits — the
                 "Yarn ₹ / kg" the old header carried. A blend's rate is each yarn's own. */
              const blend = hasYarnMix(d);
              /* Every yarn line has its own Rate / KG once there is more than one: a second
                 line with no rate box read as broken (screenshot 3546). One line and no mix
                 still edits the fabric's flat yarn rate. */
              const perYarn = blend || d.yarns.length > 1;
              const lines: (YarnMixDraft | null)[] = d.is_direct ? [null] : d.yarns.length ? d.yarns : [null];
              const span = lines.length;
              const share = yarnMixTotal(d);
              const blendOff = !d.is_direct && blend ? Math.round((share - 100) * 100) / 100 : 0;
              const priceMissing = f.direct && !(f.price != null && f.price > 0);
              const procs = f.knitting + f.dyeing + f.finishing + f.special;
              const warn = blendOff
                ? blendOff < 0
                  ? `Mix is ${share}%. ${+Math.abs(blendOff).toFixed(2)}% still to place.`
                  : `Mix is ${share}%. ${+blendOff.toFixed(2)}% too much.`
                : priceMissing
                  ? "Type the price per kg."
                  : null;
              return (
                <tbody key={f.key} data-grid-body data-fabric-row={f.key}>
                  {lines.map((y, i) => (
                    <tr key={y?.key ?? `${f.key}-one`} data-grid-row data-hover-row>
                      {i === 0 ? (
                        <>
                          <td className={TD} rowSpan={span}>
                            {opts ? (
                              <TypeOrPick
                                label="Fabric structure"
                                options={opts.fabrics.map((o) => ({ id: o.id, name: o.name }))}
                                valueId={d.fabric_id}
                                text={d.quality}
                                onChange={(v) => setFabric(f.key, { fabric_id: v.id, quality: v.name })}
                                placeholder=""
                                uppercase
                              />
                            ) : (
                              <span className="px-1 font-medium">{f.name}</span>
                            )}
                          </td>
                          <td className="tog" rowSpan={span}>
                            <Toggle checked={d.is_direct} onChange={(v) => setFabric(f.key, { is_direct: v })} ariaLabel={`${f.name} bought in at a direct rate`} />
                          </td>
                          <td className={TD} rowSpan={span}>
                            {d.is_direct ? null : (
                              <NumInput aria-label={`${f.name} process loss percent`} value={d.process_loss_pct} onChange={(e) => setFabric(f.key, { process_loss_pct: e.target.value })} />
                            )}
                          </td>
                        </>
                      ) : null}
                      {d.is_direct ? (
                        <td className="dim" colSpan={4}>
                          Bought in finished: its price already includes loss.
                        </td>
                      ) : (
                        <>
                          <td className={TD}>
                            <TypeOrPick
                              label="Yarn"
                              options={(opts?.yarns ?? []).map((o) => ({ id: o.id, name: o.name }))}
                              valueId={y?.item_id ?? null}
                              text={y?.yarn_name ?? ""}
                              onChange={(v) =>
                                y
                                  ? setY(y.key, { item_id: v.id, yarn_name: v.name })
                                  : setFabric(f.key, { yarns: [{ ...newYarnMix(), item_id: v.id, yarn_name: v.name }] })
                              }
                              placeholder=""
                              uppercase
                            />
                          </td>
                          <td className={TD}>
                            <NumInput
                              aria-label="Mix percent"
                              value={y?.mix_pct ?? ""}
                              onChange={(e) => (y ? setY(y.key, { mix_pct: e.target.value }) : setFabric(f.key, { yarns: [{ ...newYarnMix(), mix_pct: e.target.value }] }))}
                            />
                          </td>
                          <td className={TD}>
                            {perYarn && y ? (
                              <ShownAmount rate={rate} value={y.rate} onChange={(v) => setY(y.key, { rate: v })}>{(v, set) => <NumInput aria-label="Yarn rate per KG" value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                            ) : i === 0 ? (
                              <ShownAmount rate={rate} value={d.yarn_rate} onChange={(v) => setFabric(f.key, { yarn_rate: v })}>{(v, set) => <NumInput aria-label={`${f.name} yarn rate per kg`} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                            ) : null}
                          </td>
                          <td className="r fig">{perYarn && y ? yarnFig(y) : i === 0 ? money(f.yarn) : ""}</td>
                        </>
                      )}
                      {i === 0 ? (
                        <td className={d.is_direct ? "in" : "r fig"} rowSpan={span}>
                          {d.is_direct ? (
                            <ShownAmount rate={rate} value={d.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })}>{(v, set) => <NumInput aria-label={`${f.name} price per kg`} aria-invalid={priceMissing || undefined} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                          ) : (
                            <b
                              className="tot"
                              title={`Yarn ${money(f.yarn)} + Processes ${money(procs)} = ${money(f.yarn + procs)} · +${fx(f.lossPct)}% loss`}
                            >
                              {SYM} {money(f.price)}
                            </b>
                          )}
                        </td>
                      ) : null}
                      <td className="act">
                        <span className="acts">
                          {/* A yarn line's ✕; on the first line it is the FABRIC's own when there is nothing else to take. */}
                          {!d.is_direct && y && d.yarns.length > 1 ? (
                            <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: d.yarns.filter((x) => x.key !== y.key) })} />
                          ) : i === 0 ? (
                            <RemoveX label={f.name} onClick={() => removeFabric(f.key)} />
                          ) : null}
                          {!d.is_direct && i === span - 1
                            ? plusBtn(`Add a yarn to ${f.name}`, () => setFabric(f.key, { yarns: [...(d.yarns.length ? d.yarns : [newYarnMix()]), newYarnMix()] }))
                            : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {warn ? (
                    <tr>
                      <td colSpan={9} className="warn">
                        {f.name}: {warn}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
        {/* "+ Add row", COMPACT (user 2026-10-15): a text link under the table rather than a
            32px outline button — the button-shape rule allows only 36 / 32px buttons. */}
        {opts ? (
          <button type="button" data-row-add className="faddrow" onClick={addFabricRow}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add row
          </button>
        ) : null}
      </div>
    );
  })();

  /*
   * FABRIC PROCESSES — A FOLD LIST (user 2026-10-15, screenshot 3548 "plan like this",
   * plan "Fabric Process Fold"): Fabric Plan ▸ Yarn Process's shape — each built fabric is
   * one line (its name, its yarn blend beneath, its processes ₹/kg), and opening it unfolds
   * that fabric's process grid under the line. ONE open at a time (AGENTS "Folds are
   * accordions"). `ProcessFoldList` is the shared component behind Yarn Process and the
   * Budget fold, so the keyboard contract (Tab into the panel, arrows, Ctrl+Del) comes with
   * it. Bought-in fabrics have no processes and are not listed. Old costings' flat
   * knitting / dyeing / finishing rates stay as lines of their own until cleared.
   */
  type ProcFab = { key: string; name: string; blend: string; procs: number };
  const procFoldColumns: FoldListColumn<ProcFab>[] = [
    {
      header: "Fabric",
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{r.name}</div>
          <div className="truncate text-xs text-muted-foreground">{r.blend}</div>
        </div>
      ),
    },
    {
      header: "Processes",
      width: "8rem",
      align: "right",
      cell: (r) => <span className="font-mono text-xs font-semibold text-primary">{SYM} {money(r.procs)} / kg</span>,
    },
  ];

  const processWorkbench = (() => {
    if (!edit) return null;
    const opts = edit.options;
    const built = edit.draft.fabrics.filter((d) => !d.is_direct);
    if (!built.length) return <p className="dim fbought px-3 py-2">No built fabrics: a bought-in fabric has no processes.</p>;
    const rows: ProcFab[] = built.map((d) => {
      const f = figuresOf(d);
      const named = d.yarns.filter((y) => y.yarn_name.trim() || y.item_id);
      return {
        key: d.key,
        name: f.name,
        blend: named.length ? named.map((y) => `${y.yarn_name || "Yarn"}${y.mix_pct.trim() ? ` ${y.mix_pct}%` : ""}`).join(" · ") : "No yarn yet",
        procs: f.knitting + f.dyeing + f.finishing + f.special,
      };
    });
    const openKey = procOpen === undefined ? (rows[0]?.key ?? null) : procOpen;
    return (
      <div className="appgrid">
        <ProcessFoldList<ProcFab>
          columns={procFoldColumns}
          rows={rows}
          openKey={openKey}
          onToggle={setProcOpen}
          hug
          ruled
          renderPanel={(r) => {
            const d = edit.draft.fabrics.find((x) => x.key === r.key);
            if (!d) return null;
            const setP = (key: string, patch: Partial<FabricProcessDraft>) => setFabric(d.key, { processes: patchBy(d.processes, key, patch) });
            const flat = ([
              ["knitting_rate", "Knitting (flat rate)"],
              ["dyeing_rate", "Dyeing (flat rate)"],
              ["finishing_rate", "Finishing (flat rate)"],
            ] as const).filter(([k]) => d[k].trim() !== "");
            const lines: (FabricProcessDraft | null)[] = d.processes.length ? d.processes : [null];
            return (
              <div className="fsheet">
                {/* # 2.5 + party 12.5 + hug 5.5 + act 3 = 23.5rem, hugging. */}
                <table style={{ width: "23.5rem" }}>
                  <colgroup>
                    <col style={{ width: "2.5rem" }} />
                    <col style={{ width: FIELD_WIDTH_CSS.party }} />
                    <col style={{ width: FIELD_WIDTH_CSS.hug }} />
                    <col style={{ width: "3rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="r">#</th>
                      <th>Process</th>
                      <th className="r">Rate / KG</th>
                      <th className="act"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody data-grid-body>
                    {lines.map((q, i) => (
                      <tr key={q?.key ?? `${d.key}-one`} data-grid-row data-hover-row>
                        <td className="r dim">{i + 1}</td>
                        <td className="in">
                          <TypeOrPick
                            label="Process"
                            options={(opts?.processes ?? []).map((o) => ({ id: o.id, name: o.name }))}
                            valueId={q?.process_id ?? null}
                            text={q?.process_name ?? ""}
                            onChange={(v) =>
                              q ? setP(q.key, { process_id: v.id, process_name: v.name }) : setFabric(d.key, { processes: [{ ...newFabricProcess(), process_id: v.id, process_name: v.name }] })
                            }
                            placeholder=""
                            uppercase
                          />
                        </td>
                        <td className="in">
                          <ShownAmount
                            rate={rate}
                            value={q?.rate ?? ""}
                            onChange={(v) => (q ? setP(q.key, { rate: v }) : setFabric(d.key, { processes: [{ ...newFabricProcess(), rate: v }] }))}
                          >
                            {(v, set) => <NumInput aria-label="Process rate per KG" value={v} onChange={(e) => set(e.target.value)} />}
                          </ShownAmount>
                        </td>
                        <td className="act">
                          <span className="acts">
                            {q ? <RemoveX label={q.process_name || "process"} onClick={() => setFabric(d.key, { processes: d.processes.filter((x) => x.key !== q.key) })} /> : null}
                            {i === lines.length - 1
                              ? plusBtn(`Add a process to ${r.name}`, () => setFabric(d.key, { processes: [...(d.processes.length ? d.processes : [newFabricProcess()]), newFabricProcess()] }))
                              : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {flat.map(([k, label]) => (
                      <tr key={k} data-grid-row>
                        <td />
                        <td className="dim">{label}</td>
                        <td className="in">
                          <ShownAmount rate={rate} value={d[k]} onChange={(v) => setFabric(d.key, { [k]: v } as Partial<FabricDraft>)}>{(v, set) => <NumInput aria-label={`${r.name} ${label}`} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                        </td>
                        <td className="act" />
                      </tr>
                    ))}
                    <tr>
                      <td />
                      <td className="dim">Processes</td>
                      <td className="r fig">
                        <b className="tot">{money(r.procs)}</b>
                      </td>
                      <td className="act" />
                    </tr>
                  </tbody>
                </table>
                <button
                  type="button"
                  data-row-add
                  className="faddrow"
                  onClick={() => setFabric(d.key, { processes: [...(d.processes.length ? d.processes : [newFabricProcess()]), newFabricProcess()] })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add process
                </button>
              </div>
            );
          }}
        />
      </div>
    );
  })();

  const secFabric = (
        <section className="blk fabblk" aria-label="Fabric processing cost">
          <div className="flex min-w-0 flex-col gap-3">
            <details open className={edit && view !== "report" ? "plain" : undefined}>
              <summary>
                Fabric processing cost <span>{SYM} per kg · yarn + processes, then loss</span>
              </summary>
              {edit && view !== "report" ? fabricWorkbench : fabricSummaryTable}
            </details>
            {/* PROCESSES, A SECTION OF THEIR OWN while revising (option B, 2026-10-15). */}
            {edit && view !== "report" ? (
              <details open className="plain">
                <summary>
                  Fabric processes <span>{SYM} per kg · added before loss</span>
                </summary>
                {processWorkbench}
              </details>
            ) : null}
          </div>
          {/* Printout only: on screen the photo sits beside Component consumption (photoRail). */}
          {view === "report" ? photoRail : null}
        </section>
  );

  /** An operation line's ✕ — only a picked process line can go; CMT and testing are the piece's own. */
  const opRemove = (o: (typeof model.ops)[number]) =>
    edit ? (
      <td className="act">
        {o.field === "line" && o.lineKey ? (
          <RemoveX
            label={o.name}
            onClick={() =>
              edit.onChange({
                ...edit.draft,
                pieces: edit.draft.pieces.map((x) => (x.key === o.pieceKey ? { ...x, lines: x.lines.filter((l) => l.key !== o.lineKey) } : x)),
              })
            }
          />
        ) : null}
      </td>
    ) : null;
  const opRate = (o: (typeof model.ops)[number]) => {
    const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
    if (!edit || !piece) return money(o.rate);
    const label = `${o.name}${o.piece ? ` (${o.piece})` : ""} — rate ${SYM}`;
    if (o.field === "cmt") return <ShownAmount rate={rate} value={piece.cmt} onChange={(v) => setPiece(piece.key, { cmt: v })}>{(v, set) => <Ed label={label} value={v} onChange={set} />}</ShownAmount>;
    if (o.field === "testing") return <ShownAmount rate={rate} value={piece.testing_cost} onChange={(v) => setPiece(piece.key, { testing_cost: v })}>{(v, set) => <Ed label={label} value={v} onChange={set} />}</ShownAmount>;
    const line = piece.lines.find((l) => l.key === o.lineKey);
    return line ? (
      <ShownAmount rate={rate} value={line.rate} onChange={(v) => setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { rate: v }) })}>{(v, set) => <Ed label={label} value={v} onChange={set} />}</ShownAmount>
    ) : (
      money(o.rate)
    );
  };

  /*
   * "+ ADD ROW" ON OPERATIONS & TRIMS (user 2026-10-15: "same add row update here") — the
   * shape Component consumption and Fabric processing cost already have. The full add
   * line (`OperationReadyRow` / `TrimReadyRow`: pick, type, then "+ Add") is gone; "+ Add
   * row" adds a BLANK line that is filled where it stands, and every line's operation /
   * trim and its piece are pickers on the line itself. The model drops a blank line
   * (`liveRows`), so while editing the draft's blank lines are drawn after the model's
   * rows — never on the printout, the exports or the totals. While one blank line waits,
   * "+ Add row" sends the cursor to it instead of stacking another.
   */
  type OpRow = (typeof model.ops)[number];
  type TrimRow = (typeof model.trims)[number];
  const pieceName = (key: string) => edit?.draft.pieces.find((p) => p.key === key)?.piece_name || "GARMENT";
  const pieceOpts = edit ? edit.draft.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" })) : [];
  const blankOps = (kind: "cmt" | "embellishment"): OpRow[] =>
    edit
      ? edit.draft.pieces.flatMap((p) =>
          p.lines
            .filter((l) => l.kind === kind && isBlankPieceLine(l))
            .map((l) => ({
              piece: model.pieceCount > 1 ? pieceName(p.key) : "",
              name: "",
              kind: kind === "cmt" ? ("CMT" as const) : ("Embellishment" as const),
              rate: 0,
              pieceKey: p.key,
              lineKey: l.key,
              field: "line" as const,
            })),
        )
      : [];
  const blankTrims: TrimRow[] = edit
    ? edit.draft.trims.filter(isBlankTrim).map((t) => ({ key: t.key, piece: model.pieceCount > 1 ? pieceName(t.piece_key) : "", name: "", pricing: "", qty: "", cost: 0 }))
    : [];
  /** The line under an op row, and its piece — null for CMT (direct) / testing rows. */
  const lineOf = (o: OpRow) => {
    const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
    const line = o.field === "line" && o.lineKey ? piece?.lines.find((l) => l.key === o.lineKey) : undefined;
    return piece && line ? { piece, line } : null;
  };
  const opName = (o: OpRow) => {
    const pl = edit?.options ? lineOf(o) : null;
    if (!edit?.options || !pl) return o.name;
    const { piece, line } = pl;
    const list = edit.options.garmentProcesses.filter((x) => x.garment_kind === line.kind);
    return (
      <CellPick
        label={line.kind === "cmt" ? "CMT operation" : "Process"}
        options={list}
        value={{ id: line.process_id, name: line.process_name }}
        onPick={(v) => setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { process_id: v.id, process_name: v.name }) })}
      />
    );
  };
  /** A line's piece, re-picked: the line moves to the other piece. */
  const opPiece = (o: OpRow) => {
    const pl = edit ? lineOf(o) : null;
    if (!edit || !pl) return o.piece;
    const { piece, line } = pl;
    return (
      <CellPick
        label="Piece"
        options={pieceOpts}
        value={{ id: piece.key, name: pieceName(piece.key) }}
        onPick={(v) => {
          if (!v.id || v.id === piece.key) return;
          edit.onChange({
            ...edit.draft,
            pieces: edit.draft.pieces.map((x) =>
              x.key === piece.key ? { ...x, lines: x.lines.filter((l) => l.key !== line.key) } : x.key === v.id ? { ...x, lines: [...x.lines, line] } : x,
            ),
          });
        }}
      />
    );
  };
  const trimDraft = (t: TrimRow) => edit?.draft.trims.find((x) => x.key === t.key);
  const setTrim = (key: string, patch: Partial<NonNullable<ReturnType<typeof trimDraft>>>) =>
    edit?.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, key, patch) });
  const trimName = (t: TrimRow) => {
    const d = trimDraft(t);
    if (!edit?.options || !d) return t.name;
    return <CellPick label="Trim or accessory" options={edit.options.trims} value={{ id: d.item_id, name: d.description || t.name }} onPick={(v) => setTrim(d.key, { item_id: v.id, description: v.name })} />;
  };
  const trimPiece = (t: TrimRow) => {
    const d = trimDraft(t);
    if (!edit || !d) return t.piece;
    return <CellPick label="Piece" options={pieceOpts} value={{ id: d.piece_key, name: pieceName(d.piece_key) }} onPick={(v) => v.id && setTrim(d.key, { piece_key: v.id })} />;
  };
  const focusLine = (key: string) => document.querySelector<HTMLElement>(`[data-line-key="${key}"] input`)?.focus();
  const addOpLine = (kind: "cmt" | "embellishment") => {
    if (!edit) return;
    const open = edit.draft.pieces.flatMap((p) => p.lines).find((l) => l.kind === kind && isBlankPieceLine(l));
    if (open) return focusLine(open.key);
    const first = edit.draft.pieces[0];
    if (!first) return;
    edit.onChange({ ...edit.draft, pieces: edit.draft.pieces.map((p) => (p.key === first.key ? { ...p, lines: [...p.lines, newPieceLine(kind, null, "")] } : p)) });
  };
  const addTrimLine = () => {
    if (!edit) return;
    const open = edit.draft.trims.find(isBlankTrim);
    if (open) return focusLine(open.key);
    edit.onChange({ ...edit.draft, trims: [...edit.draft.trims, newTrim(edit.draft.pieces[0]?.key ?? "")] });
  };
  const addRow = (cols: number, onClick: () => void) => (
    <tr className="addrow">
      <td colSpan={cols}>
        <Button type="button" variant="outline" size="sm" data-row-add onClick={onClick}>
          <Plus className="h-3.5 w-3.5" />
          Add row
        </Button>
      </td>
    </tr>
  );
  const opCols = (model.pieceCount > 1 ? 1 : 0) + 2 + (edit ? 1 : 0);
  const trimCols = (model.pieceCount > 1 ? 1 : 0) + 4 + (edit ? 1 : 0);

  const secTri = (
        <section className="tri" aria-label="Fabric, CMT and trims">
          {model.ops.some((o) => o.kind !== "CMT") || edit?.options ? (
            <details open>
              <summary>
                Fabric &amp; garment processes <span>{SYM} {money(s.fabric + s.process + s.testing)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th className="c-piece">Piece</th> : null}
                      <th className="c-name">Operation</th>
                      <th className="r c-num">Rate {SYM}</th>
                      {actHead}
                    </tr>
                  </thead>
                  <tbody {...gridBody}>
                    <tr data-grid-row>
                      {model.pieceCount > 1 ? <td /> : null}
                      <td>Fabric cost{model.sizes.length > 1 ? ` · ${s.label}` : ""}</td>
                      <td className="r">{money(s.fabric)}</td>
                      {actGap}
                    </tr>
                    {[...model.ops.filter((o) => o.kind !== "CMT"), ...blankOps("embellishment")].map((o, i) => (
                      <tr key={o.lineKey ?? `${o.field}-${i}`} data-grid-row data-line-key={o.lineKey ?? undefined}>
                        {model.pieceCount > 1 ? <td>{opPiece(o)}</td> : null}
                        <td>{opName(o)}</td>
                        <td className="r">{opRate(o)}</td>
                        {opRemove(o)}
                      </tr>
                    ))}
                    {edit?.options ? addRow(opCols, () => addOpLine("embellishment")) : null}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 2 : 1}>Fabric, processes &amp; testing</td>
                      <td className="r">{money(s.fabric + s.process + s.testing)}</td>
                      {actGap}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {model.ops.some((o) => o.kind === "CMT") || edit?.options ? (
            <details open>
              <summary>
                CMT operations <span>{SYM} {money(s.cmt)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th className="c-piece">Piece</th> : null}
                      <th className="c-name">Operation</th>
                      <th className="r c-num">Rate {SYM}</th>
                      {actHead}
                    </tr>
                  </thead>
                  <tbody {...gridBody}>
                    {[...model.ops.filter((o) => o.kind === "CMT"), ...blankOps("cmt")].map((o, i) => (
                      <tr key={o.lineKey ?? `${o.field}-${i}`} data-grid-row data-line-key={o.lineKey ?? undefined}>
                        {model.pieceCount > 1 ? <td>{opPiece(o)}</td> : null}
                        <td>{opName(o)}</td>
                        <td className="r">{opRate(o)}</td>
                        {opRemove(o)}
                      </tr>
                    ))}
                    {edit?.options ? addRow(opCols, () => addOpLine("cmt")) : null}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 2 : 1}>CMT</td>
                      <td className="r">{money(s.cmt)}</td>
                      {actGap}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {model.trims.length || edit?.options ? (
            <details open>
              <summary>
                Trims &amp; accessories <span>{SYM} {money(s.trims)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th className="c-piece">Piece</th> : null}
                      <th className="c-name">Trim</th>
                      <th className="c-price">Pricing</th>
                      <th className="r c-num">Consumption</th>
                      <th className="r c-num">Cost {SYM}</th>
                      {actHead}
                    </tr>
                  </thead>
                  <tbody {...gridBody}>
                    {[...model.trims, ...blankTrims].map((t) => (
                      <tr key={t.key} data-grid-row data-line-key={t.key}>
                        {model.pieceCount > 1 ? <td>{trimPiece(t)}</td> : null}
                        <td>{trimName(t)}</td>
                        <td className="dim">
                          {(() => {
                            const d = edit?.draft.trims.find((x) => x.key === t.key);
                            if (!edit || !d) return t.pricing;
                            const set = (patch: Partial<typeof d>) => edit.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, d.key, patch) });
                            // Direct: the flat ₹ per piece. Packed: the pack price (consumption beside it does the rest).
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <input type="checkbox" checked={d.is_direct !== false} onChange={(e) => set({ is_direct: e.target.checked })} />
                                  <span>Direct</span>
                                </label>
                                {d.is_direct !== false ? (
                                  <ShownAmount rate={rate} value={d.rate} onChange={(v) => set({ rate: v })}>{(v, setV) => <Ed w="w-20" label={`${t.name} — direct rate ${SYM}`} value={v} onChange={setV} />}</ShownAmount>
                                ) : (
                                  <>
                                    <ShownAmount rate={rate} value={d.pack_price} onChange={(v) => set({ pack_price: v })}>{(v, setV) => <Ed w="w-20" label={`${t.name} — pack price ${SYM}`} value={v} onChange={setV} />}</ShownAmount>
                                    <Ed w="w-16" label={`${t.name} — pack size`} value={d.pack_size} onChange={(v) => set({ pack_size: v })} />
                                  </>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="r">
                          {(() => {
                            const d = edit?.draft.trims.find((x) => x.key === t.key);
                            if (!edit || !d || d.is_direct !== false) return t.qty;
                            const set = (patch: Partial<typeof d>) => edit.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, d.key, patch) });
                            return <Ed w="w-20" label={`${t.name} — consumption`} value={d.qty} onChange={(v) => set({ qty: v })} />;
                          })()}
                        </td>
                        <td className="r">{money(t.cost)}</td>
                        {edit ? (
                          <td className="act">
                            <RemoveX label={t.name || "trim"} onClick={() => edit.onChange({ ...edit.draft, trims: edit.draft.trims.filter((x) => x.key !== t.key) })} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {edit?.options ? addRow(trimCols, addTrimLine) : null}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 4 : 3}>Trims</td>
                      <td className="r">{money(s.trims)}</td>
                      {actGap}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
  );

  const secGarment = (
        <section className="blk" aria-label="Garment cost">
          <details open>
            <summary>
              Garment cost <span>{SYM} per {model.unitWord}{model.sizes.length > 1 ? " · every size" : ""}</span>
            </summary>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    {model.sizes.map((x) => (
                      <th key={x.label} className="r">{model.sizes.length > 1 ? x.label : SYM}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Fabric cost", (x: SizeFigures) => x.fabric, false],
                      ["CMT", (x: SizeFigures) => x.cmt, false],
                      ["Garment processes & testing", (x: SizeFigures) => x.process + x.testing, false],
                      ["Trims", (x: SizeFigures) => x.trims, false],
                      ["Factory base cost", (x: SizeFigures) => x.net, true],
                      [`Rejection ${model.terms.wastage}%`, (x: SizeFigures) => x.wastage, false],
                      [`Overhead ${model.terms.overhead}%`, (x: SizeFigures) => x.overhead, false],
                      ["Bank charges & other overheads", (x: SizeFigures) => x.bank + x.extraOverhead, false],
                      ["Total cost", (x: SizeFigures) => x.grossCost, true],
                      [`Profit ${model.terms.margin}%`, (x: SizeFigures) => x.margin, false],
                    ] as const
                  ).map(([label, pick, strong]) => (
                    <tr key={label} className={strong ? "total" : undefined}>
                      <td>{label}</td>
                      {model.sizes.map((x) => (
                        <td key={x.label} className="r">{money(pick(x))}</td>
                      ))}
                    </tr>
                  ))}
                  {model.terms.freight + model.terms.insurance > 0 ? (
                    <tr>
                      <td>Freight &amp; insurance <span className="dim">(on the price, not earned)</span></td>
                      {model.sizes.map((x) => (
                        <td key={x.label} className="r">{money((model.terms.freight + model.terms.insurance) * model.pieceCount)}</td>
                      ))}
                    </tr>
                  ) : null}
                  {model.sizes.some((x) => x.priceAdj - x.discount !== 0) ? (
                    <tr>
                      <td>Price charges &amp; discount</td>
                      {model.sizes.map((x) => (
                        <td key={x.label} className="r">{x.priceAdj - x.discount >= 0 ? "+" : "−"}{money(Math.abs(x.priceAdj - x.discount))}</td>
                      ))}
                    </tr>
                  ) : null}
                  <tr className="total">
                    <td>Price {SYM}</td>
                    {model.sizes.map((x) => (
                      <td key={x.label} className="r">{money(x.price)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <details open>
            <summary>
              Overheads &amp; extra charges <span>{SYM} {money(s.bank + s.wastage + s.overhead + s.extraOverhead)} / {model.unitWord}</span>
            </summary>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Type</th>
                    <th className="r">Value</th>
                    {model.sizes.map((x) => (
                      <th key={x.label} className="r">{model.sizes.length > 1 ? `${x.label} ${SYM}` : `${SYM} / ${model.unitWord}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overheadRows.map((o, i) => (
                    <tr key={i}>
                      <td>
                        {(() => {
                          const x = edit && o.edit.kind === "extra" ? edit.draft.extras.find((e) => e.key === o.edit.key) : null;
                          if (!edit || !x) {
                            return (
                              <>
                                {o.name.toUpperCase()}
                                {o.side === "price" ? <span className="dim"> (price)</span> : null}
                              </>
                            );
                          }
                          const set = (patch: Partial<typeof x>) => edit.onChange({ ...edit.draft, extras: patchBy(edit.draft.extras, x.key, patch) });
                          return (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <EdText label="Charge name" value={x.name} onChange={(v) => set({ name: v })} />
                              <RemoveX label={x.name || "charge"} onClick={() => edit.onChange({ ...edit.draft, extras: edit.draft.extras.filter((e) => e.key !== x.key) })} />
                            </span>
                          );
                        })()}
                      </td>
                      <td className="dim">
                        {(() => {
                          const x = edit && o.edit.kind === "extra" ? edit.draft.extras.find((e) => e.key === o.edit.key) : null;
                          if (!edit || !x) return o.type;
                          const set = (patch: Partial<typeof x>) => edit.onChange({ ...edit.draft, extras: patchBy(edit.draft.extras, x.key, patch) });
                          return (
                            <select
                              aria-label="Charge type"
                              value={x.kind}
                              autoComplete="off"
                              data-1p-ignore
                              data-lpignore="true"
                              data-form-type="other"
                              onChange={(e) => set({ kind: e.target.value as "flat" | "pct" })}
                              className="h-7 rounded-md border border-[#037bb8] bg-white px-1.5 text-xs font-semibold text-[#0f1b26]"
                            >
                              <option value="flat">Flat ₹</option>
                              <option value="pct">Percent</option>
                            </select>
                          );
                        })()}
                      </td>
                      <td className="r">
                        {(() => {
                          if (!edit) return o.value;
                          const dr = edit.draft;
                          const label = `${o.name} — ${o.type === "Percent" ? "%" : "₹"}`;
                          const setH = (patch: Partial<typeof dr.header>) => edit.onChange({ ...dr, header: { ...dr.header, ...patch } });
                          if (o.edit.kind === "waste") return <Ed w="w-20" label={label} value={dr.header.garment_waste_pct} onChange={(v) => setH({ garment_waste_pct: v })} />;
                          if (o.edit.kind === "overhead") return <Ed w="w-20" label={label} value={dr.header.overhead_pct} onChange={(v) => setH({ overhead_pct: v })} />;
                          if (o.edit.kind === "bank") {
                            // Bank charges are per piece; with several pieces there is no single box to type into.
                            const only = dr.pieces.length === 1 ? dr.pieces[0] : null;
                            return only ? <ShownAmount rate={rate} value={only.bank_cost} onChange={(v) => edit.onChange({ ...dr, pieces: patchBy(dr.pieces, only.key, { bank_cost: v }) })}>{(v, set) => <Ed w="w-20" label={label} value={v} onChange={set} />}</ShownAmount> : o.value;
                          }
                          const x = dr.extras.find((e) => e.key === o.edit.key);
                          return x ? (
                            <ShownAmount rate={x.kind === "pct" ? null : rate} value={x.value} onChange={(v) => edit.onChange({ ...dr, extras: patchBy(dr.extras, x.key, { value: v }) })}>
                              {(v, set) => <Ed w="w-20" label={label} value={v} onChange={set} />}
                            </ShownAmount>
                          ) : (
                            o.value
                          );
                        })()}
                      </td>
                      {o.perSize.map((v, j) => (
                        <td key={j} className="r">{o.side === "price" && v >= 0 ? "+" : o.side === "price" ? "−" : ""}{money(Math.abs(v))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {edit ? <AddCharge draft={edit.draft} onChange={edit.onChange} /> : null}
            </div>
          </details>
        </section>
  );

  type TermField = "buyer_target_price" | "margin_pct" | "exchange_rate" | "commission_pct" | "discount_pct" | "freight_per_pc" | "insurance_per_pc";
  /* THE QUOTATION AS ONE SHEET (user 2026-10-15: "user should work very easily in this
     quotation, even easier than Excel … report looks too occupied"). It used to stack a
     price card, a margin gauge, a negotiation table, five KPI tiles and a strip of quote
     boxes — the same figures three times. Now: ONE Price build table with every size side
     by side (Excel's shape), ONE Terms table, and ONE summary card. Blue cells are the
     only cells that take typing; everything else is worked out. Revision history moved to
     its own tab (secHistory). Plan: artifact "Quotation Sheet Plan". */
  const target = edit ? (edit.draft.header.buyer_target_price.trim() === "" ? null : Number(edit.draft.header.buyer_target_price)) : model.targetPrice;
  const marginTone = (m: number | null) => (m == null ? "" : m < FLOOR_PCT ? "bad" : m < MARGIN_TARGET_PCT ? "warn" : "good");
  const quotedOf = (x: SizeFigures) => x.quoted ?? x.calc;
  const lowestIdx = model.sizes.reduce((b, x, i) => (x.effectiveMarginPct != null && (model.sizes[b].effectiveMarginPct ?? Infinity) > x.effectiveMarginPct ? i : b), 0);
  const overTarget = target == null ? 0 : model.sizes.filter((x) => (quotedOf(x) ?? -Infinity) > target + 0.000001).length;
  const thisRev = model.history.find((r) => r.current) ?? null;
  const showExtra = model.sizes.some((x) => x.extraOverhead);
  const setHeader = (field: TermField, v: string) => edit?.onChange({ ...edit.draft, header: { ...edit.draft.header, [field]: v } });
  const sizeHead = (
    <>
      {model.sizes.map((x, i) => (
        <th key={x.label} className={`r fig${i === idx ? " sel" : ""}`}>{model.sizes.length > 1 ? x.label : `Per ${model.unitWord}`}</th>
      ))}
    </>
  );
  /** `amount`: a rupee figure (the Cost group) — shown in the sheet's currency. */
  const figRow = (label: ReactNode, value: (x: SizeFigures) => number | null, opts: { sum?: boolean; digits?: number; amount?: boolean } = {}) => (
    <tr data-grid-row className={opts.sum ? "sum" : undefined}>
      <td>{label}</td>
      {model.sizes.map((x, i) => {
        const v = value(x);
        return (
          <td key={x.label} className={`r fig${i === idx ? " sel" : ""}`}>
            {v == null ? "—" : opts.amount ? money(v) : fx(v, opts.digits ?? 2)}
          </td>
        );
      })}
    </tr>
  );
  /** A Terms row: label · value (typed while revising) · what it applies to. */
  const termRow = (label: string, field: TermField, shown: number | null, note: string, always = false) =>
    edit ? (
      <tr data-grid-row key={field}>
        <td>{label}</td>
        <td className="in">
          <ShownAmount rate={field === "freight_per_pc" || field === "insurance_per_pc" ? rate : null} value={edit.draft.header[field]} onChange={(v) => setHeader(field, v)}>
            {(v, set) => <Ed label={label} value={v} onChange={set} />}
          </ShownAmount>
        </td>
        <td className="dim">{note}</td>
      </tr>
    ) : always || (shown != null && shown !== 0) ? (
      <tr data-grid-row key={field}>
        <td>{label}</td>
        <td className="r fig">{shown == null ? "—" : field === "freight_per_pc" || field === "insurance_per_pc" ? money(shown) : fx(shown, 2)}</td>
        <td className="dim">{note}</td>
      </tr>
    ) : null;

  const secCommercial = (
        <section className="blk qsheet" aria-label="Commercial quote">
          {model.status === "rejected" && model.decisionRemark ? (
            <div className="banner">
              <b>Sent back for rework:</b> {model.decisionRemark}
            </div>
          ) : null}
          <div className="qgrid">
            <div className="qtables">
              <div className="qt">
                <table aria-label="Price build per size">
                  <thead>
                    <tr data-grid-row>
                      <th>Price build</th>
                      {sizeHead}
                    </tr>
                  </thead>
                  <tbody data-grid-body data-grid-axis="sheet" onKeyDown={gridKeyNav}>
                    <tr data-grid-row className="grp">
                      <td colSpan={model.sizes.length + 1}>Cost · {SYM} per {model.unitWord}</td>
                    </tr>
                    {figRow("Net cost", (x) => x.net, { amount: true })}
                    {figRow("Rejection + overhead", (x) => x.wastage + x.overhead, { amount: true })}
                    {showExtra ? figRow("Extra charges", (x) => x.extraOverhead, { amount: true }) : null}
                    {figRow("Gross cost", (x) => x.grossCost, { sum: true, amount: true })}
                    {figRow(`Margin · ${edit ? Number(edit.draft.header.margin_pct) || 0 : model.terms.margin}% of net`, (x) => x.margin, { amount: true })}
                    {figRow(`Selling price ${SYM}`, (x) => x.price, { sum: true, amount: true })}
                    <tr data-grid-row className="grp">
                      <td colSpan={model.sizes.length + 1}>
                        Price · {ccy || "FOB"} per {model.unitWord}
                        {model.exchangeRate != null ? <span className="why"> · at ₹ {fx(model.exchangeRate)} / {ccy}</span> : null}
                      </td>
                    </tr>
                    {figRow("Calculated", (x) => x.calc)}
                    {edit
                      ? edit.draft.pieces.map((p) => (
                          <tr data-grid-row key={p.key}>
                            <td>Quoted{edit.draft.pieces.length > 1 ? ` · ${p.piece_name || "piece"}` : " price"}</td>
                            {model.sizes.map((x, i) => {
                              const k = quoteKey(p.key, x.size);
                              return (
                                <td key={k} className={`in${i === idx ? " sel" : ""}`}>
                                  <Ed
                                    label={`Quoted price${edit.draft.pieces.length > 1 ? ` ${p.piece_name || "piece"}` : ""} ${x.label}`}
                                    value={edit.draft.quotes[k] ?? ""}
                                    onChange={(v) => {
                                      edit.onQuote?.(k);
                                      edit.onChange({ ...edit.draft, quotes: { ...edit.draft.quotes, [k]: v } });
                                    }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : null}
                    {!edit || edit.draft.pieces.length > 1 ? figRow(edit ? "Quoted · total" : "Quoted price", (x) => x.quoted, { sum: !edit }) : null}
                    {target != null ? (
                      <tr data-grid-row>
                        <td>
                          vs target <span className="why">· + over, − under</span>
                        </td>
                        {model.sizes.map((x, i) => {
                          const q = quotedOf(x);
                          const gap = q == null ? null : Math.round((q - target) * 100) / 100;
                          return (
                            <td key={x.label} className={`r fig ${gap == null ? "" : gap > 0 ? "bad" : "good"}${i === idx ? " sel" : ""}`}>
                              {gap == null ? "—" : `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${fx(Math.abs(gap), 2)}`}
                            </td>
                          );
                        })}
                      </tr>
                    ) : null}
                    <tr data-grid-row className="sum">
                      <td>Margin on quote</td>
                      {model.sizes.map((x, i) => (
                        <td key={x.label} className={`r fig ${marginTone(x.effectiveMarginPct)}${i === idx ? " sel" : ""}`}>
                          {x.effectiveMarginPct == null ? "—" : `${x.effectiveMarginPct.toFixed(1)}%`}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="qt">
                <table aria-label="Terms">
                  <thead>
                    <tr data-grid-row>
                      <th>Terms</th>
                      <th className="r fig">Value</th>
                      <th>Applies to</th>
                    </tr>
                  </thead>
                  <tbody data-grid-body data-grid-axis="sheet" onKeyDown={gridKeyNav}>
                    {termRow(`Buyer target ${ccy}`.trim(), "buyer_target_price", model.targetPrice, "compared with every size")}
                    {termRow("Margin %", "margin_pct", model.terms.margin, "of net cost", true)}
                    {termRow(`Exchange rate ₹ / ${ccy || "FOB"}`, "exchange_rate", model.exchangeRate, "converts the price", true)}
                    {termRow("Commission %", "commission_pct", model.commissionPct, "added to the price")}
                    {termRow("LC discount %", "discount_pct", model.terms.discount, "taken off the price")}
                    {termRow("Freight / pc", "freight_per_pc", model.terms.freight, "added per piece")}
                    {termRow("Insurance / pc", "insurance_per_pc", model.terms.insurance, "added per piece")}
                  </tbody>
                </table>
              </div>
              {edit ? <p className="qhint">Blue cells take typing. Enter moves down the column, Tab moves along the row — like Excel.</p> : null}
            </div>
            <aside className="qrail" aria-label="Quote summary">
              <div className="qcard">
                <div className="eyebrow">
                  {s.quoted != null ? "Quoted" : "Calculated"} FOB{model.sizes.length > 1 ? ` · size ${s.label}` : ""}
                </div>
                {/* "SHOW IN" — the Costing editor's Quotation-summary pick (user 2026-10-15):
                    switches the WHOLE sheet's currency, USD by default. The price is the
                    quote in the shown currency; the line under it is always rupees. */}
                {(() => {
                  const q = quotedOf(s);
                  const inr = inrOf(q);
                  const big = q == null ? null : show.code === show.quoted || !show.quoted ? q : show.code === "INR" ? inr : inr != null && cur ? inr / cur.rate : null;
                  return (
                    <>
                      <div className="qbigrow">
                        <div className="qbig">{big == null ? "—" : `${show.code === "INR" ? "₹" : show.code === show.quoted ? ccy : cur?.code ?? ""} ${fx(big, 2)}`.trim()}</div>
                        {show.codes.length > 1 ? (
                          <select
                            className="qccy"
                            aria-label="Show the costing in"
                            autoComplete="off"
                            data-1p-ignore
                            data-lpignore="true"
                            data-form-type="other"
                            value={show.code}
                            onChange={(e) => show.onPick(e.target.value)}
                          >
                            {show.codes.map((c) => (
                              <option key={c} value={c}>
                                {c === show.quoted ? `${c} ●` : c}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                      {inr != null && show.code !== "INR" ? (
                        <div className="qinr">
                          ₹ {fx(inr)} per {model.unitWord}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                <div className="qgauge" aria-hidden style={{ ["--f" as string]: `${(FLOOR_PCT / 30) * 100}%`, ["--t" as string]: `${(MARGIN_TARGET_PCT / 30) * 100}%` }}>
                  <i style={{ left: `${(FLOOR_PCT / 30) * 100}%` }} className="mark" />
                  <i style={{ left: `${(MARGIN_TARGET_PCT / 30) * 100}%` }} className="mark" />
                  {pin != null ? <i style={{ left: `${pin}%` }} className="pin" /> : null}
                </div>
                <div className="qscale">
                  <span>0%</span>
                  <span>
                    floor {FLOOR_PCT}% · target {MARGIN_TARGET_PCT}%
                  </span>
                  <span>30%</span>
                </div>
                <div className={`qverdict ${marginTone(eff)}`}>
                  {eff == null
                    ? "Add a price to see the margin"
                    : eff < FLOOR_PCT
                      ? `${eff.toFixed(1)}% — under the ${FLOOR_PCT}% floor`
                      : eff < MARGIN_TARGET_PCT
                        ? `${eff.toFixed(1)}% — above the floor, under the ${MARGIN_TARGET_PCT}% target`
                        : `${eff.toFixed(1)}% — at or above the ${MARGIN_TARGET_PCT}% target`}
                </div>
              </div>
              <dl className="qcard qkv">
                {model.sizes.length > 1 ? (
                  <>
                    <dt>Lowest margin</dt>
                    <dd className={marginTone(model.sizes[lowestIdx]?.effectiveMarginPct ?? null)}>
                      {model.sizes[lowestIdx]?.effectiveMarginPct == null ? "—" : `${model.sizes[lowestIdx].effectiveMarginPct!.toFixed(1)}% (${model.sizes[lowestIdx].label})`}
                    </dd>
                  </>
                ) : null}
                {target != null ? (
                  <>
                    <dt>Sizes over buyer target</dt>
                    <dd className={overTarget ? "bad" : "good"}>
                      {overTarget} of {model.sizes.length}
                    </dd>
                  </>
                ) : null}
                {thisRev && model.history.length > 1 ? (
                  <>
                    <dt>vs previous revision</dt>
                    <dd>{changeText(thisRev.changePct)}</dd>
                  </>
                ) : null}
                <dt>Gross cost</dt>
                <dd>{SYM} {money(s.grossCost)}</dd>
              </dl>
            </aside>
          </div>
        </section>
  );

  /* REVISION HISTORY IS ITS OWN TAB (user 2026-10-15) — it sat under the quote and made
     the Quotation tab the most crowded one. */
  const secHistory =
    model.history.length > 0 ? (
      <section className="blk" aria-label="Revision history">
        <div className="qt">
          <table aria-label="Revision history">
            <thead>
              <tr>
                <th>Revision</th>
                <th>Date</th>
                <th>Status</th>
                <th className="r fig">Quoted</th>
                <th className="r fig">Change</th>
                <th className="r fig">Margin</th>
              </tr>
            </thead>
            <tbody>
              {model.history.map((r) => (
                <tr key={r.id} className={r.current ? "cur" : undefined}>
                  <td>
                    {r.current ? (
                      <b>{r.label}</b>
                    ) : (
                      <Link href={`/sales/sample-costing/${r.id}/reports?tab=cost-sheet`} style={{ color: "var(--cs-brand)", textDecoration: "underline" }}>
                        {r.label}
                      </Link>
                    )}
                    {r.current ? <span className="dim"> · this sheet</span> : null}
                  </td>
                  <td>{r.date ? fmtDate(r.date) : "—"}</td>
                  <td>{r.statusLabel}</td>
                  <td className="r fig">{r.price == null ? "—" : `${ccy} ${fx(r.price, 2)}`.trim()}</td>
                  <td className="r fig">{changeText(r.changePct)}</td>
                  <td className={`r fig ${marginTone(r.marginPct)}`}>{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ) : (
      <section className="blk" aria-label="Revision history">
        <p className="dim">This is the first revision of this costing.</p>
      </section>
    );

  const signBlock = (
          <div className="sign">
            <div><b />Prepared by</div>
            <div><b />Checked by</div>
            <div><b />Approved by</div>
          </div>
  );

  const specGrid = (
          <div className="hdr-grid">
            <dl className="spec">
              {(
                [
                  ["Buyer / importer", model.customer],
                  ["SMP Number", model.enquiryNo],
                  ["Style", model.style && model.description && model.style !== model.description ? model.style : null],
                  ["Fabric", model.fabricFacts.structure],
                  ["GSM / counts", model.fabricFacts.gsm],
                  ["Composition", model.fabricFacts.composition],
                ] as const
              ).map(([k, v]) => (v ? (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ) : null))}
            </dl>
            <dl className="spec">
              {(
                [
                  ["Date", model.date ? fmtDate(model.date) : null],
                  ["Currency", ccy ? `${ccy}${model.exchangeRate ? ` @ ₹ ${fx(model.exchangeRate)}` : ""}` : null],
                  ["Size group", model.sizeGroup],
                  ["Pieces", model.pieceCount > 1 ? String(model.pieceCount) : null],
                ] as const
              ).map(([k, v]) => (v ? (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ) : null))}
            </dl>
          </div>
  );

  const tabDefs = [
    { label: "Details", hint: "buyer & style" },
    { label: "Fabric", hint: `${SYM} ${money(s.fabric)} / ${model.unitWord}` },
    { label: "Operations & trims", hint: `${SYM} ${money(s.cmt + s.process + s.testing + s.trims)} / ${model.unitWord}` },
    { label: "Cost & overheads", hint: `${SYM} ${money(s.grossCost)} total` },
    { label: "Quotation", hint: `${s.quoted != null || s.calc != null ? `${ccy} ${fx(s.quoted ?? s.calc, 2)}`.trim() : "—"} · ${eff == null ? "—" : `${eff.toFixed(1)}%`}` },
    { label: "Revisions", hint: model.history.length > 1 ? `${model.history.length} revisions` : "first revision" },
    { label: "Charts", hint: "price at a glance" },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (tab + (e.key === "ArrowRight" ? 1 : tabDefs.length - 1)) % tabDefs.length;
    setTab(n);
    document.getElementById(`cs-tab-${n}`)?.focus();
  };

  return (
    <article className="cs-sheet">
      <style>{CSS}</style>
      <header className="mast">
        <div className="brand">
          {model.company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={model.company.logo} alt="" className="logo" />
          ) : (
            <div className="mark">{(model.company.name ?? "R").slice(0, 1)}</div>
          )}
          <div>
            <b>{model.company.name ?? "Raagam"}</b>
            {model.company.unit ? <span>{model.company.unit}</span> : null}
          </div>
        </div>
        <div className="docid">
          <span>Sample Cost Sheet · internal</span>
          <span className="no">
            {model.costingNo ?? "—"} · {model.revision}
          </span>
          <span>{model.date ? fmtDate(model.date) : ""}</span>
          <span className={`pill ${stateClass}`}>{model.statusLabel}</span>
        </div>
      </header>

      {/* THE APPROVAL LINE (client 2026-10-09: "where is the approver") — how this
          costing was approved and by whom: automatically on submit when every quote
          clears the floor, else the BUYER (0725). INTERNAL; the Quotation says only
          "Approved on …". It now sits at the END of the header row below rather than as
          a band of its own (user 2026-10-15, "align this into single line"). */}
      <div className="pad">
        {/* 1 · HEADER — the RAAGAM COSTING FORMAT's top block (client 2026-10-09). Only the
            lines this costing has a value for print: an empty "Buying Agent" row is chrome. */}
        <section className="blk hdrblk" aria-label="Header">
          <div className="hdr-title">
            {/* ONE BAR ON SCREEN (user 2026-10-15: "too much wording … hold important only").
                The doc number, status and date live here on screen; the letterhead above is
                print-only, so a screen shows each fact once. "Garment costing", the PCS chip
                (PCS is the default — only SET is worth flagging) and "Ship" are gone. */}
            <div className="min0">
              <span className="scr-only docno">
                {model.costingNo ?? "—"} · {model.revision}
              </span>
              <span className={`scr-only pill ${stateClass}`}>{model.statusLabel}</span>
              <h2>{model.description || model.style || "—"}</h2>
              <div className="chips">
                {model.season ? <span className="chip">{model.season}</span> : null}
                {model.isSet ? <span className="chip">SET</span> : null}
                {/* CHARTS FIT ONE SCREEN, so the two spec tables give way to their two
                    facts that matter at a glance; the Report keeps the full block. */}
                {view === "tabs" && tab === 6 && model.customer ? (
                  <span className="chip">
                    Buyer <b>{model.customer}</b>
                  </span>
                ) : null}
                {view === "tabs" && tab === 6 && model.fabricFacts.structure ? (
                  <span className="chip">
                    Fabric <b>{model.fabricFacts.structure}</b>
                  </span>
                ) : null}
                {model.shipMode ? (
                  <span className="chip">{model.shipMode}</span>
                ) : null}
              </div>
              {model.date ? <span className="scr-only dim">{fmtDate(model.date)}</span> : null}
              {/* A muted line (Draft, Superseded) only repeats the status pill — dropped. */}
              {model.approval.tone !== "muted" ? (
                <div className="apv" data-tone={model.approval.tone}>
                  <b>{model.approval.text}</b>
                  {model.approval.detail ? <span>{model.approval.detail}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          {view === "report" ? specGrid : null}
        </section>


        {/* FULL PAGE: the report exactly as it was, every section stacked. */}
        {view === "report" ? (
          <>
            {secConsumption}
            {secFabric}
            {secTri}
            {secGarment}
            {secCommercial}
            {model.history.length > 0 ? secHistory : null}
          </>
        ) : null}

        {/* TABS (client 2026-10-12): the same sections one at a time, each read at full size and nothing to
            scroll. Header, approval line and footer stay put. */}
        {view === "tabs" ? (
          <>
            <div className="ctabs" role="tablist" aria-label="Report sections" onKeyDown={onTabKey}>
              {tabDefs.map((t, i) => (
                <button key={t.label} type="button" role="tab" id={`cs-tab-${i}`} aria-selected={tab === i} aria-controls="cs-tabpanel" tabIndex={tab === i ? 0 : -1} className="ctab" onClick={() => setTab(i)}>
                  <span>{t.label}</span>
                  <small>{t.hint}</small>
                </button>
              ))}
            </div>
            <div className="tpanel" role="tabpanel" id="cs-tabpanel" aria-labelledby={`cs-tab-${tab}`}>
              {tab === 0 ? specGrid : null}
              {tab === 1 ? (
                <>
                  <div className="fabrow">
                    {secConsumption}
                    {photoRail}
                  </div>
                  {secFabric}
                </>
              ) : null}
              {tab === 2 ? secTri : null}
              {tab === 3 ? secGarment : null}
              {tab === 4 ? secCommercial : null}
              {tab === 5 ? secHistory : null}
              {/* CHARTS IS A TAB, NOT A VIEW (user 2026-10-15: "Charts is one of the tabs
                  after Revisions — remove Tabs and Charts from the top, Tabs is default"). */}
              {tab === 6 ? (
        /* THE CHARTS TAB IS THE RECEIPT (master 095e6a1a, user 2026-10-15, design E: "light aa
           plain aa … neat aa") — merged into this branch's Charts TAB (tab 6). */
        <section className={`rc${hot ? " hot" : ""}`} aria-label="Price charts" onMouseLeave={() => setHot(null)}>
          <div className="rc-led">
            <div className="rc-cap t">
              How the price is built
              <span>
                {SYM} per {model.unitWord}
                {model.sizes.length > 1 ? ` · size ${s.label}` : ""}
              </span>
            </div>
            {wfRows.map((r, i) => {
              const last = i === wfRows.length - 1;
              const cls = r.total ? (last ? "tot" : "sub") : r.value < 0 ? "neg" : "";
              const pct = s.price ? (r.width / s.price) * 100 : null;
              return (
                <div
                  key={r.label}
                  className={`rc-ln ${cls}${r.tone && hot === r.tone ? " on" : ""}`}
                  style={{ ["--i" as string]: i }}
                  onMouseEnter={() => setHot(r.tone)}
                >
                  <i className="sw" style={{ background: r.tone && r.value >= 0 ? softTone(r.tone) : "transparent" }} />
                  <span className="t">{r.label}</span>
                  <span className="ld" />
                  <span className="t a">
                    {r.value < 0 ? "−" : ""}
                    {money(r.width)}
                  </span>
                  <span className="t p">{pct == null ? "" : `${pct.toFixed(1)}%`}</span>
                </div>
              );
            })}
          </div>
          <div className="rc-side">
            <div className="rc-mix">
              <svg viewBox="0 0 120 120" role="img" aria-label="Share of the price by cost group">
                {parts.map((p, i) => {
                  const len = (p.value / partTotal) * C;
                  return (
                    <circle
                      key={p.label}
                      className={hot === p.tone ? "on" : ""}
                      cx="60"
                      cy="60"
                      r={RING_R}
                      fill="none"
                      stroke={softTone(p.tone)}
                      strokeWidth="15"
                      strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`}
                      strokeDashoffset={-offs[i]}
                      transform="rotate(-90 60 60)"
                      onMouseEnter={() => setHot(p.tone)}
                    />
                  );
                })}
                <text className="t" x="60" y="65" textAnchor="middle" fontSize="15" fontWeight="700">
                  {money(partTotal)}
                </text>
              </svg>
              <div className="rc-lg">
                {parts.map((p, i) => (
                  <div key={p.label} className={hot === p.tone ? "on" : ""} style={{ ["--i" as string]: i }} onMouseEnter={() => setHot(p.tone)}>
                    <i className="sw" style={{ background: softTone(p.tone) }} />
                    <span className="t">{p.label}</span>
                    <b className="t">{((p.value / partTotal) * 100).toFixed(1)}%</b>
                  </div>
                ))}
              </div>
            </div>
            {model.fabrics.length ? (
              <div className="rc-fab">
                <div className="rc-cap t">Fabric rate · {SYM} / kg</div>
                {model.fabrics.map((f, i) => {
                  const fin = f.finishing + f.special;
                  const sub = f.yarn + f.knitting + f.dyeing + fin;
                  const loss = f.price != null && !f.direct ? Math.max(f.price - sub, 0) : 0;
                  const segs = (
                    [
                      ["Yarn", f.yarn, "var(--cs-fabric)"],
                      ["Knitting", f.knitting, "var(--cs-cmt)"],
                      ["Dyeing", f.dyeing, "var(--cs-over)"],
                      [f.special ? "Finishing + special" : "Finishing", fin, "var(--cs-trims)"],
                      [f.lossPct ? `Loss ${f.lossPct}%` : "Loss", loss, "var(--cs-muted)"],
                    ] as const
                  ).filter(([, v]) => v > 0);
                  return (
                    <div className="rc-f" key={f.key || f.name} style={{ ["--i" as string]: i }}>
                      <div className="top t">
                        <span>{f.name}</span>
                        <span>{money(f.price)}</span>
                      </div>
                      {f.direct || !segs.length ? (
                        <div className="parts t">Direct rate (bought-in)</div>
                      ) : (
                        <>
                          <div className="bar" aria-hidden>
                            {segs.map(([l, v, c]) => (
                              <span key={l} style={{ flex: v, background: `color-mix(in srgb, ${c} 60%, #fff)` }} />
                            ))}
                          </div>
                          <div className="parts t">
                            {segs.map(([l, v], k) => (
                              <span key={l}>
                                {k ? " · " : ""}
                                {l} <b>{money(v)}</b>
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
              ) : null}
            </div>
          </>
        ) : null}

        {view === "report" ? signBlock : null}
      </div>
      {/* In TABS the footer belongs to the last tab only (user 2026-10-12: "ella tab
          layum katta venda, quote and sign off la mattum") — it closes the document,
          and under Details or Fabric it is a closing line in the middle. The full
          page keeps it, where it really is the end. */}
      {view !== "tabs" || tab === 4 ? (
        <footer className="foot">
          <span>Internal document. For the buyer, use the Quotation.</span>
          <span>{model.costingNo ?? ""} · {model.revision}</span>
        </footer>
      ) : null}
    </article>
  );
}

/* The sheet's own palette — paper in both themes. */
const CSS = `
.cs-sheet { --cs-sheet:#fff; --cs-ink:#0f1b26; --cs-muted:#5a6a79; --cs-rule:#dde4eb; --cs-soft:#f5f8fb;
  --cs-brand:#037bb8; --cs-brand-ink:#024f78; --cs-brand-tint:#e6f5fc;
  --cs-good:#14803f; --cs-good-tint:#e3f4ea; --cs-warn:#9a6200; --cs-warn-tint:#fcefd3; --cs-bad:#b3261e; --cs-bad-tint:#fbe7e4;
  --cs-fabric:#037bb8; --cs-cmt:#1f9a8a; --cs-emb:#d1527a; --cs-trims:#e0a030; --cs-over:#7c62d0; --cs-margin:#2f9e5b;
  background:var(--cs-sheet); color:var(--cs-ink); border:1px solid var(--cs-rule); border-radius:14px; overflow:hidden; font-variant-numeric:tabular-nums;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.cs-sheet * { box-sizing:border-box; }
.cs-sheet h2,.cs-sheet h3,.cs-sheet h4,.cs-sheet p { margin:0; }
.cs-sheet .mast { display:flex; flex-wrap:wrap; gap:12px 24px; justify-content:space-between; align-items:center; padding:9px 18px; border-bottom:1px solid var(--cs-rule); background:var(--cs-soft); }
.cs-sheet .brand { display:flex; gap:10px; align-items:center; }
.cs-sheet .mark { width:34px; height:34px; border-radius:9px; background:var(--cs-brand); color:#fff; display:grid; place-items:center; font-weight:800; }
.cs-sheet .logo { height:34px; width:auto; max-width:120px; object-fit:contain; }
.cs-sheet .brand b { display:block; font-size:14px; } .cs-sheet .brand span { color:var(--cs-muted); font-size:12px; }
.cs-sheet .docid { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--cs-muted); }
.cs-sheet .docid .no { font-family:ui-monospace,Consolas,monospace; font-size:15px; color:var(--cs-ink); }
.cs-sheet .pill { display:inline-flex; align-items:center; height:22px; padding-inline:10px; border-radius:11px; font-size:11.5px; font-weight:700; }
.cs-sheet .pill.good { background:var(--cs-good-tint); color:var(--cs-good); } .cs-sheet .pill.warn { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .pill.bad { background:var(--cs-bad-tint); color:var(--cs-bad); } .cs-sheet .pill.brand { background:var(--cs-brand-tint); color:var(--cs-brand-ink); }
.cs-sheet .pad { padding:14px 18px; display:flex; flex-direction:column; gap:14px; min-width:0; }
@media (max-width:560px){ .cs-sheet .pad { padding:12px; } }
.cs-sheet .hero { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:14px; }
@media (max-width:820px){ .cs-sheet .hero { grid-template-columns:1fr; } }
.cs-sheet .title { display:flex; gap:16px; align-items:flex-start; min-width:0; }
.cs-sheet .min0 { min-width:0; }
.cs-sheet .thumb { width:68px; height:80px; flex:none; border-radius:12px; background:var(--cs-brand-tint); display:grid; place-items:center; overflow:hidden; }
.cs-sheet .thumb svg { width:40px; height:40px; color:var(--cs-brand); } .cs-sheet .thumb img { width:100%; height:100%; object-fit:cover; }
.cs-sheet .eyebrow { font-size:11px; letter-spacing:.1em; text-transform:uppercase; font-weight:700; color:var(--cs-muted); }
.cs-sheet .title h2 { font-size:20px; line-height:1.15; letter-spacing:-.01em; margin-block:2px 6px; font-weight:800; }
.cs-sheet .chips { display:flex; flex-wrap:wrap; gap:6px; }
.cs-sheet .chip { font-size:12px; padding:3px 10px; border-radius:999px; background:var(--cs-soft); border:1px solid var(--cs-rule); color:var(--cs-muted); }
.cs-sheet .chip b { color:var(--cs-ink); font-weight:600; }
.cs-sheet .facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:6px 16px; margin:8px 0 0; }
.cs-sheet .facts dt { font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--cs-muted); font-weight:700; }
.cs-sheet .facts dd { margin:1px 0 0; font-weight:600; font-size:13px; }
.cs-sheet .quote { background:var(--cs-brand-tint); border-radius:12px; padding:12px 16px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.cs-sheet .quote-top { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.cs-sheet .big { font-size:34px; line-height:1; font-weight:800; letter-spacing:-.02em; color:var(--cs-brand-ink); margin-top:4px; }
.cs-sheet .sub { color:var(--cs-muted); font-size:12px; margin-top:3px; }
.cs-sheet .inr { font-size:15px; font-weight:700; color:var(--cs-ink); margin-top:2px; }
.cs-sheet .inr small { font-weight:500; color:var(--cs-muted); font-size:11.5px; }
.cs-sheet .gauge-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12.5px; }
.cs-sheet .gauge-head b { font-size:18px; }
.cs-sheet .track { position:relative; height:12px; border-radius:6px; margin-top:24px; background:linear-gradient(90deg,var(--cs-bad-b,#d9534f) 0 50%,#e9a93a 50% 73.33%,#2f9e5b 73.33% 100%); opacity:.85; }
.cs-sheet .tick { position:absolute; top:-6px; bottom:-6px; width:2px; background:var(--cs-ink); opacity:.55; }
.cs-sheet .tick span { position:absolute; top:24px; transform:translateX(-50%); font-size:10.5px; color:var(--cs-muted); white-space:nowrap; font-weight:600; }
.cs-sheet .pin { position:absolute; top:-9px; width:18px; height:30px; transform:translateX(-50%); }
.cs-sheet .pin i { display:block; width:4px; height:100%; margin-inline:auto; background:var(--cs-ink); border-radius:2px; box-shadow:0 0 0 2px #fff; }
.cs-sheet .pin span { position:absolute; bottom:32px; left:50%; transform:translateX(-50%); background:var(--cs-ink); color:#fff; font-size:11px; font-weight:700; padding:1px 7px; border-radius:6px; white-space:nowrap; }
.cs-sheet .scale { display:flex; justify-content:space-between; margin-top:22px; font-size:10.5px; color:var(--cs-muted); }
.cs-sheet .blk { display:flex; flex-direction:column; gap:10px; min-width:0; }
.cs-sheet .hdrblk { gap:8px; }
.cs-sheet .hdr-title h2 { font-size:20px; line-height:1.15; letter-spacing:-.01em; margin-block:2px 6px; font-weight:800; }
.cs-sheet .hdr-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px 28px; }
@media (max-width:760px){ .cs-sheet .hdr-grid { grid-template-columns:1fr; } }
.cs-sheet .spec { margin:0; display:flex; flex-direction:column; border:1px solid var(--cs-rule); border-radius:10px; overflow:hidden; }
.cs-sheet .spec > div { display:grid; grid-template-columns:130px minmax(0,1fr); gap:10px; padding:5px 12px; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .spec > div:last-child { border-bottom:0; }
.cs-sheet .spec dt { font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--cs-muted); font-weight:700; align-self:center; }
.cs-sheet .spec dd { margin:0; font-weight:600; font-size:13px; min-width:0; overflow-wrap:anywhere; }
/* Table | 220px rail. A GRID on purpose: as a flex box it inherited .blk's column
   direction and the photo wrapped underneath. Under 900px the rail goes ABOVE the
   table as a short strip, so a phone never has the picture between it and Add fabric. */
.cs-sheet .fabblk { display:grid; grid-template-columns:minmax(0,max-content) 220px; gap:12px; align-items:start; }
.cs-sheet .fabblk > div { min-width:0; }
.cs-sheet .rail { display:flex; flex-direction:column; gap:10px; position:sticky; top:8px; }
.cs-sheet .rail .photo { min-height:0; }
.cs-sheet .rail .photo a { display:block; width:100%; }
.cs-sheet .rail .photo img { width:100%; aspect-ratio:4/3; height:auto; object-fit:cover; max-height:none; }
@media (max-width:900px){
  .cs-sheet .fabblk { grid-template-columns:minmax(0,1fr); }
  .cs-sheet .rail { order:-1; position:static; flex-direction:row; align-items:stretch; }
  .cs-sheet .rail .photo { flex:0 0 96px; }
  .cs-sheet .rail .photo > span { display:none; }
}
.cs-sheet .photo { border:1px dashed var(--cs-rule); border-radius:12px; background:var(--cs-soft); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:6px; min-height:130px; overflow:hidden; color:var(--cs-muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; font-weight:700; }
.cs-sheet .photo img { display:block; width:100%; height:auto; max-height:320px; object-fit:contain; border-radius:8px; } .cs-sheet .photo svg { width:46px; height:46px; color:var(--cs-brand); opacity:.7; }
.cs-sheet .tri { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; }
.cs-sheet .comm { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); gap:14px; align-items:start; }
@media (max-width:860px){ .cs-sheet .comm { grid-template-columns:1fr; } }
/* COMPACT — the commercial block is read at a glance, so it is one short band, not a poster. */
.cs-sheet .comm .quote { padding:8px 12px; gap:4px; border-radius:10px; }
.cs-sheet .comm .quote-top .big { font-size:24px; margin-top:1px; }
.cs-sheet .comm .quote-top .inr { font-size:13px; margin-top:0; }
.cs-sheet .comm .quote-top .sub { font-size:11.5px; margin-top:1px; }
.cs-sheet .comm .gauge-head { font-size:12px; } .cs-sheet .comm .gauge-head b { font-size:15px; }
.cs-sheet .comm .track { height:8px; margin-top:20px; }
.cs-sheet .comm .tick { top:-4px; bottom:-4px; } .cs-sheet .comm .tick span { top:16px; font-size:10px; }
.cs-sheet .comm .pin { top:-8px; height:24px; } .cs-sheet .comm .pin span { bottom:26px; font-size:10.5px; }
.cs-sheet .comm .scale { margin-top:16px; font-size:10px; }
.cs-sheet .comm .box { padding:6px 10px; gap:4px; }
.cs-sheet .blk .kpis { grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:6px; }
.cs-sheet .blk .kpi { padding:5px 10px; border-radius:8px; } .cs-sheet .blk .kpi .v { font-size:15px; } .cs-sheet .blk .kpi .n { font-size:11px; }
.cs-sheet .neg table td { padding:5px 4px; } .cs-sheet .neg table td:first-child { color:var(--cs-muted); }
.cs-sheet .banner { border:1px solid var(--cs-warn); background:var(--cs-warn-tint); border-radius:6px; padding:9px 12px; font-size:13px; }
.cs-sheet .banner b { color:var(--cs-warn); }
.cs-sheet .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; }
.cs-sheet .kpi { border:1px solid var(--cs-rule); border-radius:10px; padding:8px 12px; }
.cs-sheet .kpi label { display:block; font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--cs-muted); font-weight:700; }
.cs-sheet .kpi .v { font-size:18px; font-weight:800; margin-top:1px; letter-spacing:-.01em; }
.cs-sheet .kpi .n { font-size:12px; color:var(--cs-muted); }
.cs-sheet hr { border:0; border-top:1px solid var(--cs-rule); margin:0; }
.cs-sheet .sec { display:flex; flex-direction:column; gap:8px; min-width:0; }
.cs-sheet .sec-h { display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; }
.cs-sheet .sec-h h3 { font-size:15px; font-weight:800; } .cs-sheet .sec-h span { color:var(--cs-muted); font-size:12.5px; }
/* THE CHARTS VIEW IS A RECEIPT (user 2026-10-15, design E). One card: the ledger
   left, a small donut + legend and the fabric rates right; stacked on a narrow
   pane. The card is the home page hero's surface — top-left smoke wash, a soft
   brand-blue glow at the top-right, a soft lift and a 1px sheen. */
.cs-sheet .rc { position:relative; isolation:isolate; overflow:hidden; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  border:1px solid var(--cs-rule); border-radius:12px; background-color:#fff;
  background-image:linear-gradient(152deg, rgb(22 24 29 / .055) 0%, rgb(22 24 29 / .012) 34%, rgb(22 24 29 / 0) 62%);
  box-shadow:0 1px 2px rgb(16 24 40 / .06), 0 4px 14px rgb(16 24 40 / .06), inset 0 1px 0 rgb(255 255 255 / .75); }
.cs-sheet .rc::before { content:""; position:absolute; z-index:-1; pointer-events:none; right:-40px; top:-96px; width:320px; height:224px;
  border-radius:50%; background:var(--cs-brand-tint); opacity:.6; filter:blur(48px); }
@media (max-width:860px){ .cs-sheet .rc { grid-template-columns:minmax(0,1fr); } .cs-sheet .rc-led { border-right:0; border-bottom:1px dashed var(--cs-rule); } }
.cs-sheet .rc-led { padding:12px 12px 14px; border-right:1px dashed var(--cs-rule); min-width:0; }
.cs-sheet .rc-side { padding:14px 18px; display:grid; gap:16px; align-content:start; min-width:0; }
.cs-sheet .rc-cap { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--cs-muted);
  display:flex; justify-content:space-between; gap:10px; padding:0 6px 6px; }
.cs-sheet .rc-cap span { text-transform:none; letter-spacing:0; font-weight:500; font-size:12px; }
.cs-sheet .rc-fab .rc-cap { padding:0; }
.cs-sheet .rc .sw { display:block; width:9px; height:9px; border-radius:2px; }
.cs-sheet .rc-ln { display:grid; grid-template-columns:10px auto minmax(12px,1fr) 76px 52px; align-items:baseline; column-gap:8px;
  padding:3px 6px; border-radius:5px; font-size:13px; transition:background-color .2s, opacity .2s; }
.cs-sheet .rc-ln .sw { align-self:center; }
.cs-sheet .rc-ln .ld { border-bottom:1px dotted #b6c0c9; transform:translateY(-4px); }
.cs-sheet .rc-ln .a { text-align:right; } .cs-sheet .rc-ln .p { text-align:right; color:var(--cs-muted); font-size:12px; }
.cs-sheet .rc-ln.neg .a { color:var(--cs-bad); }
.cs-sheet .rc-ln.sub { border-top:1px solid var(--cs-rule); border-radius:0; margin-top:3px; padding-top:5px; font-weight:700; }
.cs-sheet .rc-ln.tot { border-top:3px double var(--cs-muted); border-radius:0; margin-top:6px; padding-top:7px; font-size:16px; font-weight:800; }
.cs-sheet .rc-ln.sub .ld, .cs-sheet .rc-ln.tot .ld { border-bottom-color:transparent; }
.cs-sheet .rc-ln:not(.sub):not(.tot):hover, .cs-sheet .rc-ln.on { background:var(--cs-soft); }
.cs-sheet .rc-mix { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.cs-sheet .rc-mix svg { width:96px; height:96px; flex:none; overflow:visible; }
.cs-sheet .rc-mix circle { transition:stroke-width .2s, opacity .2s; } .cs-sheet .rc-mix circle.on { stroke-width:19; }
.cs-sheet .rc-mix text { fill:var(--cs-ink); }
.cs-sheet .rc-lg { flex:1 1 240px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px 16px; font-size:12.5px; min-width:0; }
.cs-sheet .rc-lg div { display:grid; grid-template-columns:10px 1fr auto; gap:8px; align-items:center; padding:2px 6px; border-radius:5px; transition:background-color .2s, opacity .2s; }
.cs-sheet .rc-lg div:hover, .cs-sheet .rc-lg div.on { background:var(--cs-soft); }
.cs-sheet .rc-lg b { font-weight:700; }
.cs-sheet .rc.hot .rc-ln:not(.on) { opacity:.45; }
.cs-sheet .rc.hot .rc-lg div:not(.on), .cs-sheet .rc.hot .rc-mix circle:not(.on) { opacity:.4; }
.cs-sheet .rc-fab { border-top:1px solid var(--cs-rule); padding-top:12px; display:grid; gap:12px; }
.cs-sheet .rc-f .top { display:flex; justify-content:space-between; gap:10px; font-weight:800; font-size:13px; }
.cs-sheet .rc-f .bar { display:flex; gap:2px; height:8px; margin:5px 0 4px; border-radius:4px; overflow:hidden; background:var(--cs-soft); }
.cs-sheet .rc-f .bar span { display:block; }
.cs-sheet .rc-f .parts { color:var(--cs-muted); font-size:12px; } .cs-sheet .rc-f .parts b { color:var(--cs-ink); font-weight:700; }
/* ONLY THE WORDS ARRIVE: opacity, no movement, no blur, no counting. */
@keyframes cs-ink { from { opacity:0; } to { opacity:1; } }
.cs-sheet .rc-ln .t { animation:cs-ink .5s cubic-bezier(.22,.8,.3,1) both; animation-delay:calc(var(--i, 0) * 55ms); }
.cs-sheet .rc-lg .t { animation:cs-ink .45s cubic-bezier(.22,.8,.3,1) both; animation-delay:calc(250ms + var(--i, 0) * 60ms); }
.cs-sheet .rc-f .t { animation:cs-ink .5s cubic-bezier(.22,.8,.3,1) both; animation-delay:calc(400ms + var(--i, 0) * 120ms); }
.cs-sheet .rc-cap.t, .cs-sheet .rc-mix text.t { animation:cs-ink .5s cubic-bezier(.22,.8,.3,1) both; animation-delay:150ms; }
@media (prefers-reduced-motion: reduce) { .cs-sheet .rc .t { animation:none; } .cs-sheet .rc-ln, .cs-sheet .rc-lg div, .cs-sheet .rc-mix circle { transition:none; } }
.cs-sheet .two { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,1fr); gap:18px; }
@media (max-width:860px){ .cs-sheet .two { grid-template-columns:1fr; } }
.cs-sheet .wf { display:flex; flex-direction:column; gap:3px; }
.cs-sheet .wf-row { display:grid; grid-template-columns:150px minmax(0,1fr) 66px; gap:10px; align-items:center; font-size:12.5px; }
.cs-sheet .wf-row .lab { color:var(--cs-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .wf-row .val { text-align:right; font-weight:600; }
.cs-sheet .wf-row.tot .lab { color:var(--cs-ink); font-weight:800; } .cs-sheet .wf-row.tot .val { font-weight:800; }
.cs-sheet .lane { position:relative; height:14px; background:var(--cs-soft); border-radius:5px; }
.cs-sheet .bar { position:absolute; top:0; bottom:0; border-radius:5px; min-width:3px; }
.cs-sheet .donut { display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
.cs-sheet .donut svg { width:136px; height:136px; flex:none; } .cs-sheet .donut text { fill:var(--cs-ink); }
.cs-sheet .lg { flex:1 1 170px; display:flex; flex-direction:column; gap:4px; font-size:12px; min-width:0; }
.cs-sheet .lg div { display:grid; grid-template-columns:12px 1fr auto auto; gap:8px; align-items:center; }
.cs-sheet .lg i { width:12px; height:12px; border-radius:4px; display:block; }
.cs-sheet .lg .p { color:var(--cs-muted); width:44px; text-align:right; } .cs-sheet .lg .a { font-weight:700; }
.cs-sheet .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:10px; }
.cs-sheet .box { border:1px solid var(--cs-rule); border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.cs-sheet .box h4 { font-size:13px; font-weight:800; display:flex; justify-content:space-between; gap:8px; }
.cs-sheet .box h4 span { color:var(--cs-muted); font-weight:500; font-size:12px; }
.cs-sheet .stack { display:flex; height:22px; border-radius:6px; overflow:hidden; gap:2px; } .cs-sheet .stack i { display:block; height:100%; }
.cs-sheet .keys { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:var(--cs-muted); }
.cs-sheet .keys b { color:var(--cs-ink); } .cs-sheet .keys i { display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:5px; }
.cs-sheet .big2 { font-size:19px; font-weight:800; letter-spacing:-.01em; } .cs-sheet .big2 small { font-size:12px; color:var(--cs-muted); font-weight:500; letter-spacing:0; }
.cs-sheet .hb { display:grid; grid-template-columns:110px minmax(0,1fr) 54px; gap:8px; align-items:center; font-size:12px; margin-bottom:3px; }
.cs-sheet .hb.cmp { grid-template-columns:24px minmax(0,1fr) 190px; }
.cs-sheet .hb .lane { height:12px; } .cs-sheet .hb .v { text-align:right; font-weight:600; } .cs-sheet .dim { color:var(--cs-muted); }
.cs-sheet details { border:1px solid var(--cs-rule); border-radius:12px; overflow:hidden; }
/* Card title and column headers are WHITE (user 2026-10-15, globally); a firmer rule under the
   header row is what marks it, as in the app's grids. */
.cs-sheet summary { list-style:none; cursor:pointer; padding:7px 12px; font-weight:800; font-size:13px; display:flex; justify-content:space-between; gap:10px; background:#fff; }
.cs-sheet summary::-webkit-details-marker { display:none; } .cs-sheet summary span { color:var(--cs-muted); font-weight:500; font-size:12.5px; }
.cs-sheet .scroll { overflow-x:auto; }
/* The paper's own table rules stop at an .appgrid (an app ChildGrid inside the sheet). :where keeps
   their specificity exactly as it was, so no other paper table changes. */
.cs-sheet table:where(:not(.appgrid *)) { width:100%; border-collapse:collapse; font-size:12px; }
.cs-sheet th:where(:not(.appgrid *)) { text-align:left; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--cs-muted); padding:4px 10px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; font-weight:700; background:#fff; }
.cs-sheet td:where(:not(.appgrid *)) { padding:3px 10px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; background:#fff; }
.cs-sheet tr:last-child td:where(:not(.appgrid *)) { border-bottom:0; } .cs-sheet .r { text-align:right; }
.cs-sheet td:where(:not(.appgrid *)) { vertical-align:middle; }
.cs-sheet tr.sub td { background:var(--cs-soft); padding:3px 8px; font-size:12px; }
/* The fabric block's boxes are 26px, not 28 — the yarn/process lines stack five deep
   (user 2026-10-15, "innum compact pannu"). Height only; the type size is unchanged. */
.cs-sheet .fabblk input:not([type="checkbox"]), .cs-sheet .fabblk select { height:26px !important; }
/* A nested line's ✕ shows on THAT line's hover — RowHoverRemove's reveal reads any
   ancestor <tr>, so hovering the fabric's sub row would light every ✕ under it. */
@media (hover:hover) { .cs-sheet table.parts tr:not(:hover) [data-row-remove]:not(:focus-visible) { opacity:0; } }
.cs-sheet tr.sub table.parts { width:auto; margin:0; border:1px solid var(--cs-rule); border-radius:8px; border-collapse:separate; border-spacing:0; overflow:hidden; }
.cs-sheet tr.sub table.parts td, .cs-sheet tr.sub table.parts th { background:#fff; padding:1px 6px; }
/* The ready row a table ends in (the add option): a faint green, so it reads as "type here", not as data. */
.cs-sheet tr.ready > td, .cs-sheet tr.sub table.parts tr.ready > td { background:#f4faf6; }
.cs-sheet tr.total td { background:var(--cs-brand-tint); font-weight:800; color:var(--cs-brand-ink); }
/* THE PAPER INPUT (Ed). Unlayered + !important so it beats the skin's green box. */
.cs-sheet input.cs-ed { height:28px !important; padding-inline:8px !important; border-color:#037bb8 !important; background:#fff !important; color:#0f1b26 !important; }
/* SPREADSHEET TABLES THAT HUG THEIR COLUMNS (user 2026-10-15: "intha table lam
   erp-sheet-grid, erp-table-fit apply panni kudu"). Both skills' rules, written in
   the sheet's own fixed paper palette rather than the app's data-grid-style="sheet"
   marker, whose theme tokens would turn the paper dark in dark mode.
   - FIT: each card is as wide as its table (w-fit + max-w-full), never stretched,
     so the columns no longer open gaps between them. A long table still scrolls.
   - GRID: a thin line between every cell; the card's own rounded border is the one
     outer frame, so all four corners curve and there is no second frame.
   - HEADER: grey band, sentence case. Type size unchanged.
   - FLAT CELLS: a field in a cell has no box, radius or fill — the cell is the
     field. Hover tints it, focus draws the blue inset. A field that is not the
     cell's own value (the + Yarn / + Process add pickers) keeps its box. */
.cs-sheet details { width:fit-content; max-width:100%; border-radius:8px; }
/* The table fills its card: a card is as wide as the WIDER of its table and its title
   line, and a table stopping short of the card's edge left a blank strip inside it. */
.cs-sheet .scroll table { width:100%; }
/* ONE EDGE PER TAB (user 2026-10-15, "inside alignment not good"). Every card hugging
   its own table left no two right edges in line. The panel now shrink-wraps to its
   WIDEST card and every other card stretches to it; cards side by side grow to share
   the row. Columns still hug — what stretches is the card, not a gap between columns. */
.cs-sheet .tpanel { width:fit-content; max-width:100%; align-items:stretch; }
.cs-sheet .tpanel details { width:auto; }
/* Charts have no width of their own to shrink-wrap to, so the Charts tab takes the full width. */
.cs-sheet .tpanel:has(> .dash) { width:auto; }
.cs-sheet .tpanel .tri > * { flex:1 1 auto; min-width:0; }
/* Fabric tab: row 1 is consumption + the photo; row 2 (.fabblk) is the processing table alone, full width. */
.cs-sheet .tpanel .fabblk { grid-template-columns:minmax(0,1fr); }
.cs-sheet .fabrow { display:grid; grid-template-columns:minmax(0,1fr) 230px; gap:12px; align-items:start; }
@media (max-width:900px){ .cs-sheet .fabrow { grid-template-columns:minmax(0,1fr); } }
@media (max-width:900px){ .cs-sheet .tpanel .fabblk { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .scroll :is(th, td) { border-right:1px solid var(--cs-rule); }
.cs-sheet .scroll tr > :last-child { border-right:0; }
.cs-sheet .scroll th { background:#fff; border-bottom:1.5px solid #9aa4b2; text-transform:none; letter-spacing:normal; }
.cs-sheet .scroll td:has(> input.cs-ed, > select) { padding:0; }
.cs-sheet .scroll :is(td > input.cs-ed, td > select, td > span > select, td > span > input:not([type="checkbox"])) { border-color:transparent !important; border-radius:0 !important; background:transparent !important; box-shadow:none !important; }
.cs-sheet .scroll :is(td > input.cs-ed, td > select, td > span > select, td > span > input:not([type="checkbox"])):hover { background:#f3f8fc !important; }
.cs-sheet .scroll :is(td > input.cs-ed, td > select, td > span > select, td > span > input:not([type="checkbox"])):focus { box-shadow:inset 0 0 0 2px #037bb8 !important; outline:none !important; }
/* THE ACTION COLUMN (user 2026-10-15, "rethink the add option"): a line's hover ✕ and
   the add line's "+ Add" share one narrow column on the right, so every data column
   of the add line is free for typing. */
/* THE ACTION COLUMN FITS ITS ✕ (user 2026-10-15: "close option everywhere has much field
   space, make it compacted"). It was 76px for the add lines' "+ Add" buttons, which "+ Add
   row" replaced; the ✕ is a 20px icon. The fabric tables, where a line also carries a +,
   take 3rem below. */
.cs-sheet :is(th, td).act { width:28px; min-width:28px; text-align:center; padding:0 4px !important; }
.cs-sheet tr.ready > td { background:#f4faf6; }
/* An add line's figure box shows its edge — a flat cell would hide where to type. */
.cs-sheet tr.ready td.r input.cs-ed, .cs-sheet tr.ready td input.cs-ed { box-shadow:inset 0 0 0 1px #9fd3b4 !important; background:#fff !important; }
.cs-sheet tr.ready td.r input.cs-ed:focus { box-shadow:inset 0 0 0 2px #037bb8 !important; }
.cs-sheet .linepick { display:block; min-width:11rem; }
/* FABRIC FOLDS: one fabric open at a time; the open one's lines sit beneath its row. */
.cs-sheet table.fabtable tbody.fab.open > tr.fabhead > td { background:var(--cs-soft); }
.cs-sheet .fabname { display:inline-flex; align-items:center; gap:6px; }
.cs-sheet .chev { all:unset; cursor:pointer; width:16px; text-align:center; color:var(--cs-muted); font-size:12px; }
.cs-sheet .chev:hover { color:var(--cs-ink); }
/* Not ".chip" — that is the header's Season / Ship pills, and reusing it turned them amber. */
.cs-sheet .bchip { font-size:10.5px; font-weight:600; padding:1px 7px; border-radius:999px; background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet tr.panel > td { background:var(--cs-soft); padding:8px 12px 12px !important; height:auto; }
.cs-sheet .ptop { display:flex; flex-wrap:wrap; align-items:center; gap:6px 18px; margin-bottom:8px; font-size:12px; }
/* NOT ".tick": that class is the margin gauge's absolutely-placed marker line, and a
   label wearing it became a 2px line down the whole page (user 2026-10-15, screenshot 3528). */
.cs-sheet .ptop .ptick { display:inline-flex; align-items:center; gap:6px; font-weight:600; }
.cs-sheet .pgrid { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,1fr); gap:12px; align-items:start; }
@media (max-width:900px){ .cs-sheet .pgrid { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .pcard { border:1px solid var(--cs-rule); border-radius:8px; overflow:hidden; background:#fff; min-width:0; }
.cs-sheet .pcard table { width:100%; }
.cs-sheet .psub { display:flex; justify-content:space-between; gap:8px; padding:5px 8px; border-top:1px solid var(--cs-rule); font-size:11.5px; color:var(--cs-muted); }
.cs-sheet .psub .good { color:var(--cs-good); } .cs-sheet .psub .bad { color:var(--cs-bad); }
/* FABRIC RAIL | OPEN FABRIC (plan "Fabric Processing Layout"): a 220px rail of fabrics
   beside the one being worked — orders-precedent §7's shape in the sheet's own markup. */
.cs-sheet .fmd { display:grid; grid-template-columns:220px minmax(0,1fr); border-top:1px solid var(--cs-rule); }
@media (max-width:900px){ .cs-sheet .fmd { grid-template-columns:minmax(0,1fr); } .cs-sheet .frail { border-right:0 !important; border-bottom:1px solid var(--cs-rule); } }
.cs-sheet .frail { display:flex; flex-direction:column; border-right:1px solid var(--cs-rule); min-width:0; }
.cs-sheet .frow { all:unset; box-sizing:border-box; cursor:pointer; display:flex; flex-direction:column; gap:2px; padding:8px 12px; border-bottom:1px solid var(--cs-rule); border-left:3px solid transparent; }
.cs-sheet .frow:hover { background:var(--cs-soft); }
.cs-sheet .frow[aria-selected="true"] { background:var(--cs-brand-tint); border-left-color:var(--cs-brand); }
.cs-sheet .frow:focus-visible { outline:2px solid var(--cs-brand); outline-offset:-2px; }
.cs-sheet .fnm { font-weight:600; font-size:12.5px; overflow-wrap:anywhere; }
.cs-sheet .fpr { display:flex; justify-content:space-between; gap:6px; font-size:12px; color:var(--cs-muted); font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet .fpr b { color:var(--cs-ink); } .cs-sheet .fpr.miss b { color:var(--cs-bad); }
.cs-sheet .fpr .bchip { font-family:inherit; }
.cs-sheet .fadd { display:flex; gap:6px; align-items:center; padding:8px 10px; background:#f4faf6; margin-top:auto; }
.cs-sheet .fadd > :first-child { flex:1 1 auto; min-width:0; }
.cs-sheet .fdetail { padding:12px 14px; display:flex; flex-direction:column; gap:10px; min-width:0; }
/* GRID, NOT FLEX: FieldRow is a size container (@container/section) and has no width of its own,
   so as a content-sized flex item it collapsed to ~0 and every field stacked word by word
   (user 2026-10-15, screenshot 3532 — the skill's "content-sized cap computes to 0" trap). */
.cs-sheet .fhead { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; }
.cs-sheet .fld { display:flex; flex-direction:column; gap:3px; }
.cs-sheet .flab { font-size:11px; font-weight:600; color:var(--cs-muted); }
.cs-sheet .fhead input.cs-ed { box-shadow:inset 0 0 0 1px #9fcbe6 !important; background:#eef6fc !important; }
.cs-sheet .ffig { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:14px; line-height:28px; }
.cs-sheet .ferr { font-size:11.5px; color:var(--cs-bad); }
.cs-sheet .fdel { margin-left:auto; align-self:center; }
.cs-sheet .fstrip { font-size:12px; color:var(--cs-muted); font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; padding:5px 10px; border-radius:6px; background:var(--cs-soft); width:fit-content; max-width:100%; }
.cs-sheet .fstrip b { color:var(--cs-ink); }
.cs-sheet .fgrids { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; overflow:visible; }
.cs-sheet .fgrids .pcard { width:fit-content; max-width:100%; }
.cs-sheet .fgrids .pcard table { width:auto; }
.cs-sheet .fgrids .pc-name { width:176px; min-width:176px; }
.cs-sheet .fgrids .pc-num { width:80px; min-width:80px; }
.cs-sheet .fgrids td.bad { color:var(--cs-bad); }
.cs-sheet .fgrids tr.under td { border-bottom:0; height:auto; padding:2px 8px 6px; font-size:11.5px; color:var(--cs-bad); background:#fff; }
.cs-sheet .fbought { font-size:12.5px; margin:0; }
.cs-sheet .fabmix { font-size:11px; }
/* An app ChildGrid inside the paper: see the :where(:not(.appgrid *)) guard on the paper's table rules. */
.cs-sheet .fgrids { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start; }
/* ONE TABLE STYLE (user 2026-10-15, plan "Quotation Sheet Plan"): 28px rows, figures in
   a monospaced face so decimals stack, a total is BOLD over a dark rule rather than a
   blue band, and blue means one thing only — a cell you can type in. */
.cs-sheet .scroll :is(td, th) { font-size:12.5px; }
.cs-sheet .scroll td { height:28px; }
.cs-sheet .scroll td.r { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-variant-numeric:tabular-nums; min-width:76px; }
.cs-sheet tr.total td { background:transparent !important; color:var(--cs-ink) !important; font-weight:700; border-top:1.5px solid var(--cs-ink); }
/* THE QUOTATION SHEET. Fixed columns — 200px labels, 80px figures — in BOTH tables, so
   Price build and Terms line up as one spreadsheet. Tables hug their columns; a cell
   never widens its table (user 2026-10-15, "no more scrolling in table"). */
.cs-sheet .qgrid { display:grid; grid-template-columns:minmax(0,max-content) 250px; gap:16px; align-items:start; }
@media (max-width:900px){ .cs-sheet .qgrid { grid-template-columns:minmax(0,1fr); } }
/* ONE ROW (user 2026-10-15, screenshot 3549: "align this into single row"): Price build
   and Terms sit side by side, the Quoted FOB column beside them — ~350 + 570 + 250px. A
   narrow pane wraps Terms under Price build rather than squeezing either. */
.cs-sheet .qtables { display:flex; flex-direction:row; flex-wrap:wrap; gap:12px; align-items:flex-start; min-width:0; }
.cs-sheet .qt { border:1px solid var(--cs-rule); border-radius:8px; overflow:hidden; width:fit-content; max-width:100%; background:#fff; }
@media (max-width:700px){ .cs-sheet .qt { overflow-x:auto; } }
.cs-sheet .qt table { border-collapse:collapse; width:auto; font-size:12.5px; font-variant-numeric:tabular-nums; }
.cs-sheet .qt th { background:#fff; border-bottom-color:#9aa4b2 !important; color:var(--cs-muted); font-weight:600; font-size:11.5px; text-transform:none; letter-spacing:normal; text-align:left; padding:5px 8px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; }
.cs-sheet .qt td { height:28px; padding:0 8px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; }
.cs-sheet .qt tbody tr:last-child td { border-bottom:0; }
.cs-sheet .qt :is(td, th) + :is(td, th) { border-left:1px solid var(--cs-rule); }
.cs-sheet .qt tr > :first-child { width:200px; min-width:200px; }
.cs-sheet .qt :is(.fig, td.in) { width:80px; min-width:80px; max-width:96px; }
.cs-sheet .qt th.r { text-align:right; }
.cs-sheet .qt td.fig { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; text-align:right; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .qt td.sel:not(.in) { background:#f7fafc; }
.cs-sheet .qt th.sel { color:var(--cs-ink); }
.cs-sheet .qt tr.grp td { background:#fff; color:var(--cs-muted); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; font-weight:600; height:24px; padding-top:4px; border-left:0; }
.cs-sheet .qt tr.sum td { font-weight:700; border-top:1.5px solid var(--cs-ink); }
.cs-sheet .qt tr.cur td { background:var(--cs-brand-tint); }
.cs-sheet .qt td.in { padding:0; background:#eef6fc; box-shadow:inset 0 0 0 1px #9fcbe6; }
.cs-sheet .qt td.in input.cs-ed { width:100% !important; height:28px !important; border:0 !important; border-radius:0 !important; background:transparent !important; text-align:right; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12.5px; }
.cs-sheet .qt td.in input.cs-ed:focus { box-shadow:inset 0 0 0 2px #037bb8 !important; background:#fff !important; outline:none !important; }
.cs-sheet .qt .good { color:var(--cs-good); } .cs-sheet .qt .warn { color:var(--cs-warn); } .cs-sheet .qt .bad { color:var(--cs-bad); }
.cs-sheet .why { color:var(--cs-muted); font-weight:400; font-size:11px; text-transform:none; letter-spacing:normal; }
/* ALIGNED (user 2026-10-15, screenshot 3549 → 3555: "align this screen"). The hint is a
   flex item in the tables' row, and its ~650px sentence counted toward the row's
   max-content: the grid's first column was reserved that much too wide, so the Quoted FOB
   rail sat at the far edge behind an empty gap. "contain: inline-size" gives it no say in
   that width; "flex-basis: 100%" puts it on its own line under the tables. */
.cs-sheet .qhint { font-size:12px; color:var(--cs-muted); margin:0; flex-basis:100%; contain:inline-size; }
.cs-sheet .qrail { display:flex; flex-direction:column; gap:10px; position:sticky; top:8px; }
.cs-sheet .qcard { border:1px solid var(--cs-rule); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:7px; background:#fff; margin:0; }
.cs-sheet .qbig { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:24px; font-weight:600; line-height:1; color:var(--cs-ink); }
.cs-sheet .qinr { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12.5px; color:var(--cs-muted); }
.cs-sheet .qgauge { position:relative; height:8px; border-radius:4px; margin-top:4px; background:linear-gradient(90deg, var(--cs-bad-tint) 0 var(--f), var(--cs-warn-tint) var(--f) var(--t), var(--cs-good-tint) var(--t)); }
.cs-sheet .qgauge .mark { position:absolute; top:0; bottom:0; width:1px; background:var(--cs-muted); opacity:.5; }
.cs-sheet .qgauge .pin { position:absolute; top:-4px; width:3px; height:16px; border-radius:2px; background:var(--cs-ink); transform:translateX(-50%); }
.cs-sheet .qscale { display:flex; justify-content:space-between; gap:6px; font-size:10.5px; color:var(--cs-muted); font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet .qverdict { font-size:12.5px; font-weight:600; padding:5px 9px; border-radius:7px; }
.cs-sheet .qverdict.good { background:var(--cs-good-tint); color:var(--cs-good); } .cs-sheet .qverdict.warn { background:var(--cs-warn-tint); color:var(--cs-warn); } .cs-sheet .qverdict.bad { background:var(--cs-bad-tint); color:var(--cs-bad); }
.cs-sheet .qkv { display:grid; grid-template-columns:1fr auto; gap:4px 12px; font-size:12.5px; }
.cs-sheet .qkv dt { color:var(--cs-muted); } .cs-sheet .qkv dd { margin:0; text-align:right; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet .qkv .good { color:var(--cs-good); } .cs-sheet .qkv .warn { color:var(--cs-warn); } .cs-sheet .qkv .bad { color:var(--cs-bad); }
@media print { .cs-sheet .qrail { position:static; } }
/* ONE ROW (user 2026-10-15): eyebrow · title · chips · approval, wrapping only when the
   pane is too narrow. The approval pill is pushed to the row's right end. */
.cs-sheet .hdr-title > .min0 { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; }
.cs-sheet .hdr-title > .min0 > h2 { margin:0; }
.cs-sheet .docno { font-family:ui-monospace,Consolas,monospace; font-size:14px; font-weight:600; color:var(--cs-ink); }
@media screen { .cs-sheet .mast { display:none; } }
@media print { .cs-sheet .scr-only { display:none !important; } }
.cs-sheet .apv { display:inline-flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px; margin-left:auto; padding:3px 12px; border-radius:999px; font-size:12px; }
.cs-sheet .apv span { font-size:12px; opacity:.85; }
.cs-sheet .apv[data-tone="good"] { background:var(--cs-good-tint); color:var(--cs-good); }
.cs-sheet .apv[data-tone="warn"] { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .apv[data-tone="bad"] { background:var(--cs-bad-tint); color:var(--cs-bad); }
.cs-sheet .apv[data-tone="muted"] { background:var(--cs-soft); color:var(--cs-muted); }
.cs-sheet .sign { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:20px; padding-top:2px; }
.cs-sheet .sign div { border-top:1px solid var(--cs-ink); padding-top:6px; font-size:12px; color:var(--cs-muted); } .cs-sheet .sign b { display:block; min-height:1.6em; }
.cs-sheet .foot { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--cs-muted); font-size:11.5px; padding:8px 18px; border-top:1px solid var(--cs-rule); background:#fff; }
.cs-sheet .ctabs { display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .ctab { border:1px solid transparent; border-bottom:0; background:transparent; border-radius:8px 8px 0 0; padding:7px 16px 8px; margin-bottom:-1px; display:flex; flex-direction:column; align-items:flex-start; color:var(--cs-muted); cursor:pointer; text-align:left; gap:1px; }
/* The NAME is ink and heavy on every tab, not only the open one (user 2026-10-12: "tab field name lam
   therira mari bold") — muted grey at 700 read as disabled. The hint under it stays muted. */
.cs-sheet .ctab > span { color:var(--cs-ink); font-weight:800; font-size:14px; letter-spacing:.01em; }
.cs-sheet .ctab small { color:var(--cs-muted); font-weight:500; font-size:11.5px; font-variant-numeric:tabular-nums; }
.cs-sheet .ctab:hover { background:var(--cs-soft); color:var(--cs-ink); }
.cs-sheet .ctab[aria-selected="true"] { color:var(--cs-brand-ink); background:#fff; border-color:var(--cs-rule); border-bottom:1px solid #fff; box-shadow:inset 0 3px 0 var(--cs-brand); }
.cs-sheet .ctab[aria-selected="true"] > span { color:var(--cs-brand-ink); }
.cs-sheet .ctab:focus-visible { outline:2px solid var(--cs-brand); outline-offset:-2px; }
/* TIGHTER SHEET (user 2026-10-15, Quotation tab: "compact pannu neat aa"). SPACING
   ONLY — paddings, gaps and row heights come down; every text size stays. Sits after
   the rules it overrides so equal specificity resolves to this one. */
.cs-sheet .mast { padding:6px 16px; }
.cs-sheet .apv { padding:5px 16px; }
.cs-sheet .pad { padding:10px 16px 12px; gap:10px; }
.cs-sheet .hdrblk { gap:5px; }
.cs-sheet .title h2, .cs-sheet .hdr-title h2 { margin-block:1px 4px; }
.cs-sheet .chip { padding:2px 9px; }
.cs-sheet .ctab { padding:5px 14px 6px; }
.cs-sheet .blk { gap:8px; }
.cs-sheet .sec { gap:6px; }
.cs-sheet .comm { gap:10px; }
.cs-sheet .comm .quote { padding:8px 12px 6px; }
/* The pin's bubble repeated the % printed in the gauge head and sat on top of it;
   the head carries the figure, so the bubble goes and the track moves up under it. */
.cs-sheet .comm .pin span { display:none; }
.cs-sheet .comm .track { margin-top:10px; }
/* Floor and target are 2 points apart and their labels collided: floor reads to the
   LEFT of its tick, target to the RIGHT. */
.cs-sheet .comm .tick.floor span { transform:translateX(calc(-100% - 3px)); }
.cs-sheet .comm .tick.target span { transform:translateX(5px); }
.cs-sheet .comm .scale { margin-top:14px; }
/* The price, its "show in" picker and the unit on one line (Quotation summary's shape). */
.cs-sheet .big-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px; }
.cs-sheet .big-row .big { margin-top:0; }
.cs-sheet .ccy-pick { height:26px; padding:0 4px; border:1px solid var(--cs-brand); border-radius:8px; background:#fff; color:var(--cs-brand-ink); font:inherit; font-size:12px; font-weight:700; cursor:pointer; }
.cs-sheet .ccy-pick:focus-visible { outline:2px solid var(--cs-brand); outline-offset:1px; }
.cs-sheet .big-row .per { color:var(--cs-muted); font-size:12px; font-weight:600; }
@media print { .cs-sheet .ccy-pick { border:0; appearance:none; padding:0; background:transparent; } }
.cs-sheet .neg table td { padding:2px 4px; }
.cs-sheet .neg input.cs-ed { height:26px !important; }
.cs-sheet .blk .kpi { padding:4px 10px; }
/* Rows, not just padding: the title and its chips share a line under the eyebrow, and
   each KPI puts its label and figure on one line with the note beneath. */
.cs-sheet .hdr-title .min0 { display:flex; flex-wrap:wrap; align-items:center; column-gap:12px; row-gap:2px; }
.cs-sheet .hdr-title .min0 > .eyebrow { flex-basis:100%; }
.cs-sheet .hdr-title h2 { margin-block:0; }
.cs-sheet .blk .kpi { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:baseline; column-gap:8px; }
.cs-sheet .blk .kpi > label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .blk .kpi > .v { margin-top:0; text-align:right; white-space:nowrap; }
.cs-sheet .blk .kpi > .n { grid-column:1 / -1; }
/* The quote box is ONE band (user 2026-10-15, screenshot 144929): price on the left,
   the margin gauge beside it, and the floor / target labels on the scale's own line
   instead of a line of their own. Wraps back to stacked when the box is narrow. */
.cs-sheet .comm .quote { flex-direction:row; flex-wrap:wrap; align-items:center; column-gap:18px; row-gap:6px; }
.cs-sheet .comm .quote > .quote-top { flex:0 1 auto; }
.cs-sheet .comm .quote > div:last-child { flex:1 1 260px; min-width:0; }
.cs-sheet .comm .track { margin-top:8px; }
.cs-sheet .comm .tick span { top:18px; }
.cs-sheet .comm .scale { margin-top:6px; }
/* The KPIs sit UNDER the quote, beside the taller Negotiation box (screenshot 145019
   showed a blank pane there). Narrow pane: one column, quote → KPIs → Negotiation. */
.cs-sheet .comm { grid-template-areas:"quote neg" "kpis neg"; grid-template-rows:auto 1fr; }
.cs-sheet .comm > .quote { grid-area:quote; }
.cs-sheet .comm > .neg { grid-area:neg; }
.cs-sheet .comm > .kpis { grid-area:kpis; align-self:start; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
@media (max-width:860px){ .cs-sheet .comm { grid-template-areas:"quote" "kpis" "neg"; grid-template-rows:auto; } }
/* Five tiles in the quote's column are ~150px each — too narrow to put a label and
   its figure on one line without clipping "MARGIN EARNED", so here they stack. */
.cs-sheet .comm .kpi { display:block; }
.cs-sheet .comm .kpi > .v { text-align:left; }
/* WIDTH, TOO (user 2026-10-15, screenshot 145408): the quote box hugs what it holds
   and the gauge is capped, instead of a 500px bar ruled across the column. */
.cs-sheet .comm > .quote { justify-self:start; width:fit-content; max-width:100%; }
.cs-sheet .comm .quote > div:last-child { flex:0 1 320px; }
/* ONE TIGHT BLOCK (user 2026-10-15, screenshot 145603: "compacted aa neat aa").
   The grid was two 1.3fr / 1fr columns, so the hugging quote left a blank band
   before a stretched Negotiation box, and five 150px tiles in the quote's column
   left MARGIN EARNED alone on a second line. Now: quote and Negotiation side by
   side at their own widths, the five tiles in ONE row beneath both, each tile as
   wide as its words. Narrow pane: one column, as before. */
.cs-sheet .comm { grid-template-columns:auto auto; justify-content:start; grid-template-areas:"quote neg" "kpis kpis"; grid-template-rows:auto auto; }
.cs-sheet .comm > .neg { width:fit-content; max-width:100%; align-self:stretch; }
.cs-sheet .comm > .neg table { width:auto; }
.cs-sheet .comm > .neg table td:last-child { padding-left:24px; }
.cs-sheet .comm > .kpis { display:flex; flex-wrap:wrap; gap:6px; }
.cs-sheet .comm > .kpis > .kpi { flex:0 0 auto; }
.cs-sheet .comm .kpi > .n { white-space:nowrap; }
@media (max-width:860px){ .cs-sheet .comm { grid-template-columns:minmax(0,1fr); grid-template-areas:"quote" "kpis" "neg"; } }
.cs-sheet .neg table td { padding:1px 4px; }
.cs-sheet .neg input.cs-ed { height:24px !important; }
.cs-sheet .tpanel { display:flex; flex-direction:column; gap:12px; }
.cs-sheet .tpanel section[aria-label="Garment cost"] { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:12px; align-items:start; }
@media (max-width:900px){ .cs-sheet .tpanel section[aria-label="Garment cost"] { grid-template-columns:1fr; } }
@media print {
  .cs-sheet { border:0; border-radius:0; }
  .cs-sheet details > summary { pointer-events:none; }
  .cs-sheet .box, .cs-sheet details, .cs-sheet .kpi, .cs-sheet .sec { break-inside:avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}

/* FABRIC TABLES — FLAT, COMPACT, HUGGING (user 2026-10-15, plan "Fabric Sheet Compact"). */
.cs-sheet details.plain { border:0; border-radius:0; overflow:visible; width:auto; }
.cs-sheet details.plain > summary { background:transparent; padding:0 0 6px; }
.cs-sheet .fsheet { display:flex; flex-direction:column; gap:4px; min-width:0; }
.cs-sheet .fsheet table { table-layout:fixed; border-collapse:separate; border-spacing:0; border:1px solid var(--cs-rule); border-radius:8px; font-size:12.5px; font-variant-numeric:tabular-nums; }
.cs-sheet .fsheet :is(th, td) { border-right:1px solid var(--cs-rule); border-bottom:1px solid var(--cs-rule); height:28px; padding:0 8px; white-space:nowrap; text-align:left; vertical-align:middle; background:#fff; color:var(--cs-ink); }
.cs-sheet .fsheet tr > :last-child { border-right:0; }
.cs-sheet .fsheet tbody:last-of-type tr:last-child td { border-bottom:0; }
.cs-sheet .fsheet th { background:#f3f6f8; font-weight:600; color:var(--cs-muted); font-size:12px; }
.cs-sheet .fsheet .r { text-align:right; }
.cs-sheet .fsheet td.fig { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12px; }
.cs-sheet .fsheet td.top { vertical-align:top; padding-top:6px; font-weight:600; }
.cs-sheet .fsheet td.dim { color:var(--cs-muted); font-size:11.5px; }
.cs-sheet .fsheet td.warn { color:var(--cs-bad); font-size:11.5px; height:22px; }
.cs-sheet .fsheet td.tog { text-align:center; }
.cs-sheet .fsheet .tot { color:#037bb8; font-weight:700; }
/* A cell IS its field: no box, no radius, no fill; blue text = you type here. */
.cs-sheet .fsheet td.in { padding:0; }
.cs-sheet .fsheet td.in :is(input, select) { height:28px !important; width:100%; border-color:transparent !important; border-radius:0 !important; background:transparent !important; box-shadow:none !important; color:#037bb8; font-size:12.5px; }
.cs-sheet .fsheet td.in :is(input, select):hover { background:#f3f8fc !important; }
.cs-sheet .fsheet td.in :is(input, select):focus { box-shadow:inset 0 0 0 2px #037bb8 !important; outline:none !important; }
.cs-sheet .fsheet td.in input[aria-invalid="true"] { box-shadow:inset 0 0 0 1px var(--cs-bad) !important; }
/* ✕ and + — the same small size, no round button. */
.cs-sheet .fsheet td.act { padding:0 2px; }
.cs-sheet .fsheet :is(th, td).act { width:3rem; min-width:3rem; }
.cs-sheet .fsheet .acts { display:flex; align-items:center; justify-content:flex-end; gap:0; }
.cs-sheet .fsheet .fico { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:4px; color:#037bb8; }
.cs-sheet .fsheet .fico:hover { background:#f3f8fc; }
.cs-sheet .fsheet .fico:focus-visible { outline:2px solid #037bb8; outline-offset:0; }
.cs-sheet .fsheet .faddrow { display:inline-flex; align-items:center; gap:4px; height:24px; width:max-content; padding:0 6px; border-radius:6px; font-size:12px; font-weight:600; color:#037bb8; }
.cs-sheet .fsheet .faddrow:hover { background:#f3f8fc; }
.cs-sheet .fsheet .faddrow:focus-visible { outline:2px solid #037bb8; outline-offset:0; }

/* OPERATIONS & TRIMS, COMPACT (user 2026-10-15, screenshot 3551: "next compact the fields").
   Each table HUGS its columns instead of stretching across the tab: a section no longer
   grows to fill its row, a table is as wide as its headings say — name 200, figure 88,
   Pricing 250, Piece 120, actions 4.5rem — and the add line's boxes are 28px, cell-wide. */
.cs-sheet .tpanel .tri > * { flex:0 1 auto; }
.cs-sheet .tri .scroll table { width:auto; table-layout:fixed; }
.cs-sheet .tri th.c-name { width:200px; }
.cs-sheet .tri th.c-num { width:88px; }
/* No ÷ between pack price and pack size (user 2026-10-15: "hide the divide icon"), so
   tick + "Direct" + an 80px price + a 64px size fit 250. */
.cs-sheet .tri th.c-price { width:250px; }
.cs-sheet .tri td.dim > span { white-space:nowrap; }
.cs-sheet .tri th.c-piece { width:120px; }
.cs-sheet .tri tr.ready td { padding-top:2px; padding-bottom:2px; }
.cs-sheet .tri tr.ready :is(input, select) { height:28px !important; width:100%; min-width:0; }

/* The Quoted FOB card's "show in" pick, beside the price (2026-10-15). */
.cs-sheet .qbigrow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cs-sheet .qccy { height:28px; border:1px solid var(--cs-rule); border-radius:6px; background:#fff; padding:0 6px; font-size:12px; font-weight:700; color:#037bb8; cursor:pointer; }
.cs-sheet .qccy:focus-visible { outline:2px solid #037bb8; outline-offset:1px; }
`;
