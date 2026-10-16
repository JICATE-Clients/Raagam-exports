"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ChartPie, ChevronRight, Layers, Plus, Printer, Tag, TrendingUp } from "lucide-react";
import { AddCharge, CellPick, Ed, EdText, RemoveX, type EditOptions } from "@/components/sales/cost-sheet-editors";
import { Button } from "@/components/ui/button";
import { DownloadMenu, asExcel, asPdf } from "@/components/ui/download-menu";
import { Toggle } from "@/components/ui/toggle";
import { gridKeyNav } from "@/components/masters/child-grid";
import { useAccordion } from "@/lib/ui/use-accordion";
import { Input } from "@/components/ui/input";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { newFabric, newFabricProcess, newPieceLine, newTrim, newWeightRows, newYarnMix } from "@/lib/sales/sample-costing/revision-draft";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { GlassRing } from "@/components/orders/budget-breakdown-chart";
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
export type CostSheetEdit = {
  draft: CostingDraft;
  onChange: (next: CostingDraft) => void;
  /** A quoted price was typed — the caller holds that one and stops recalculating it. */
  onQuote?: (key: string) => void;
  /** The masters the row pickers list; without them the sheet edits figures only. */
  options?: EditOptions;
  /* COSTING ENTRY IS THIS SCREEN TOO (client 2026-10-16: the Reports tab screen
     replaces the step-by-step entry). A revision copies its sample, style, sizes,
     currency and ship mode; a NEW costing has to choose them, so the entry screen
     hands in its own controls for the few things a revision never edits. */
  /** Details tab: SMP Number, Style, Costing Date, Revision — above the facts. */
  details?: ReactNode;
  /** Fabric tab: the sizes the weights are costed in — above Component consumption. */
  sizes?: ReactNode;
  /** Quotation tab: Currency and Ship Mode — above the terms. */
  terms?: ReactNode;
  /** What picking a fabric structure writes (the entry's remembered rates); default: the id and name only. */
  pickFabric?: (fabric: FabricDraft, picked: { id: string | null; name: string }) => Partial<FabricDraft>;
};

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
  /* THE SHEET IS SHOWN IN RUPEES BY DEFAULT; ONLY THE QUOTED FOB IS IN THE QUOTED
     CURRENCY (user 2026-10-16: "in quotation quoted FOB only default, otherwise
     defaultly INR for whole report"). This REVERSES 2026-10-15's "by default render
     the full costing in USD" — the costs are rupees, and the buyer's currency belongs
     only on the price quoted to them. The Quoted FOB card's pick still shows the whole
     sheet in USD or any currency the Quotes / Orders master has a rate for. A VIEW only:
     nothing stored changes, and the draft stays in rupees. */
  const quotedCcy = model.currency && model.currency !== "INR" ? model.currency : null;
  const rateOf = (c: string): number | null =>
    c === "INR" ? 1 : c === quotedCcy ? (model.exchangeRate ?? null) : (model.quoteRates[c] ?? null);
  const [shownPick, setShownPick] = useState<string | null>(null);
  const shownCode = shownPick ?? "INR";
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

  /* NO EMPTY BAR (user 2026-10-16, screenshot 3574: "I can see bar blankly in
     top, remove it"). On a new or locked costing every control here is absent
     — no lead, no trail, one size, no export — and the frame was still drawn:
     a bordered strip with nothing in it above the sheet. */
  const shows = (n: ReactNode) => n != null && n !== false && n !== "";
  const hasBar = shows(lead) || shows(trail) || model.sizes.length > 1 || error != null || !locked;

  return (
    <div className="space-y-3">
      <DocumentPrintStyles scope="cs" />
      {hasBar ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm print:hidden">
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
              {/* Excel and PDF in one Download menu (user 2026-10-16, "globally fix"). */}
              <DownloadMenu
                variant={quietDownload ? "outline" : "primary"}
                disabled={busy != null}
                formats={[asPdf(() => run("pdf")), asExcel(() => run("csv"))]}
              />
            </>
          )}
          {trail}
        </div>
      </div>
      ) : null}
      <Sheet model={model} s={s} edit={edit} view={view} cur={cur} show={show} onSize={setIdx} />
    </div>
  );
}

/* "tabs" on screen, "report" only while Print runs. Charts was a third view with its
   own Tabs | Charts switch; it is the last TAB now (user 2026-10-15), so it prints
   with nothing special — Print always prints the full text report. */
type SheetView = "tabs" | "report";

type ShowIn = { codes: string[]; code: string; quoted: string | null; onPick: (c: string) => void };

function Sheet({ model, s, edit, view, cur, show, onSize }: { model: CostSheetModel; s: SizeFigures; edit?: CostSheetEdit; view: SheetView; cur: ShownCurrency; show: ShowIn; /** The Charts tab's size rows drive the toolbar's size switch. */ onSize?: (i: number) => void }) {
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
  // OPENS ON DETAILS (user 2026-10-16: "default landing in quotation tab, update
  // it as first details tab") — reverses 10-14's Quotation default. The sheet
  // reads left to right from who and what is being costed.
  const [tab, setTab] = useState(0);
  /* Fabric bands fold (plan "Fabric Cost Single Table", 2026-10-16): ONE fabric open at a
     time, the first one to begin with — the shared accordion (AGENTS "Folds are accordions"). */
  const fabFold = useAccordion(edit?.draft.fabrics[0]?.key ?? null);
  // Fabric processing folds — one fabric open at a time, the first one to begin with.
  const setFabric = (key: string, patch: Partial<FabricDraft>) => edit?.onChange({ ...edit.draft, fabrics: patchBy(edit.draft.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => edit?.onChange({ ...edit.draft, pieces: patchBy(edit.draft.pieces, key, patch) });
  const eff = s.effectiveMarginPct;
  const pin = eff == null ? null : (Math.min(Math.max(eff, 0), 30) / 30) * 100;
  const ccy = model.currency ?? "";
  const stateClass = model.status === "approved" ? "good" : model.status === "submitted" ? "warn" : model.status === "rejected" ? "bad" : "brand";
  /** The USD price in rupees at the sheet's own rate — the figure the ledger carries. */
  const inrOf = (v: number | null) => (v == null || model.exchangeRate == null ? null : v * model.exchangeRate);
  /** The letterhead's price card: the FOB in the quoted currency (quoted, else
   *  calculated — the same pair the Quotation tab's hint reads) and its rupees. */
  const fobShown = s.quoted ?? s.calc;
  const fobInr = inrOf(fobShown);

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
            <summary data-tone="fabric">
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

  const yarnFig = (y: YarnMixDraft) => {
    const m = Number(y.mix_pct);
    const r = Number(y.rate);
    return y.mix_pct.trim() !== "" && Number.isFinite(m) ? fx((m * (Number.isFinite(r) ? r : 0)) / 100) : "—";
  };

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

  /*
   * FABRIC PROCESSING COST — ONE TABLE, FABRIC BANDS (user 2026-10-16, plan "Fabric Cost
   * Single Table", option A). Replaces 10-15's two blocks — the yarn table and, below it,
   * the "Fabric processes" fold list — so a fabric's price is read in one place.
   *
   * Each fabric is one <tbody>: a grey BAND (structure, blend, Bought-in, Price / kg,
   * Loss %, ✕) that stays visible when folded, then — while open — a Yarn group and a
   * Processes group, each with a count + subtotal on its group line, its lines, and its
   * own "+ Add", and a working line closing it (Yarn + Processes = subtotal · + loss =
   * price). ONE fabric open at a time (AGENTS "Folds are accordions", `useAccordion`):
   * a click on the caret toggles, and the cursor arriving on a band's field claims it.
   * Bought-in collapses to the band alone: the price is typed there, its yarn and process
   * lines are hidden, not deleted. Processes stay priced once per FABRIC, as before.
   *
   * Hand-rolled (not ChildGrid) because the band's cells and the group lines span
   * columns; it keeps the hand-rolled-grid markers (`data-grid-row`, the ✕'s
   * `data-row-remove` via RemoveX, "+ Add"'s `data-row-add`).
   * Widths: 20 + 6 + 7 + 8 + 8 + 6 + 3 = 58rem (~928px), hugging its columns.
   */
  const fabricWorkbench = (() => {
    if (!edit) return null;
    const opts = edit.options;
    /* "+ ADD FABRIC": a blank fabric, filled in place. While one is still blank the
       cursor goes there instead of stacking another. The new fabric opens. */
    const addFabricRow = () => {
      const open = edit.draft.fabrics.find((x) => !x.fabric_id && !x.quality.trim());
      if (open) {
        fabFold.setOpenKey(open.key);
        document.querySelector<HTMLElement>(`[data-fabric-row="${open.key}"] input`)?.focus();
        return;
      }
      const fresh = { ...newFabric(), is_direct: false, processes: [] };
      edit.onChange({ ...edit.draft, fabrics: [...edit.draft.fabrics, fresh] });
      fabFold.setOpenKey(fresh.key);
    };
    const removeFabric = (key: string) => edit.onChange({ ...edit.draft, fabrics: edit.draft.fabrics.filter((x) => x.key !== key) });
    /* A held key that names no fabric here is another costing's (the editor does not
       remount between records) — the first fabric opens instead. A null the operator
       chose by folding stays null. */
    const held = fabFold.openKey;
    const openKey = held !== null && !edit.draft.fabrics.some((x) => x.key === held) ? (edit.draft.fabrics[0]?.key ?? null) : held;
    const addLink = (label: string, onClick: () => void) => (
      <button type="button" data-row-add className="faddrow" onClick={onClick}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    );
    return (
      <div className="appgrid fsheet fband">
        <div className="max-w-full overflow-x-auto">
          <table style={{ width: "58rem" }}>
            <colgroup>
              <col style={{ width: "20rem" }} />
              <col style={{ width: "6rem" }} />
              <col style={{ width: "7rem" }} />
              <col style={{ width: "8rem" }} />
              <col style={{ width: "8rem" }} />
              <col style={{ width: "6rem" }} />
              <col style={{ width: "3rem" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fabric · yarn · process</th>
                <th className="r">Mix %</th>
                <th className="r">Rate / KG</th>
                <th className="r">Amount / KG</th>
                <th className="r">Price / KG</th>
                <th className="r">Loss %</th>
                <th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {edit.draft.fabrics.map((d) => {
              const f = figuresOf(d);
              const setY = (key: string, patch: Partial<YarnMixDraft>) => setFabric(f.key, { yarns: patchBy(d.yarns, key, patch) });
              const setP = (key: string, patch: Partial<FabricProcessDraft>) => setFabric(f.key, { processes: patchBy(d.processes, key, patch) });
              /* No blend yet: the fabric's one flat yarn rate is what Rate / KG edits. Once
                 there is a mix or a second line, every yarn line carries its own rate. */
              const perYarn = hasYarnMix(d) || d.yarns.length > 1;
              const yarnLines: (YarnMixDraft | null)[] = d.yarns.length ? d.yarns : [null];
              const procLines: (FabricProcessDraft | null)[] = d.processes.length ? d.processes : [null];
              const flat = ([
                ["knitting_rate", "Knitting (flat rate)"],
                ["dyeing_rate", "Dyeing (flat rate)"],
                ["finishing_rate", "Finishing (flat rate)"],
              ] as const).filter(([k]) => d[k].trim() !== "");
              const share = yarnMixTotal(d);
              const blendOff = !d.is_direct && hasYarnMix(d) ? Math.round((share - 100) * 100) / 100 : 0;
              const priceMissing = f.direct && !(f.price != null && f.price > 0);
              const procs = f.knitting + f.dyeing + f.finishing + f.special;
              const sub = f.yarn + procs;
              const named = d.yarns.filter((y) => y.yarn_name.trim() || y.item_id);
              const blendText = d.is_direct
                ? "bought in finished"
                : named.map((y) => `${y.mix_pct.trim() ? `${y.mix_pct}% ` : ""}${y.yarn_name || "yarn"}`).join(" · ");
              const warn = blendOff
                ? blendOff < 0
                  ? `Mix is ${share}%. ${+Math.abs(blendOff).toFixed(2)}% still to place.`
                  : `Mix is ${share}%. ${+blendOff.toFixed(2)}% too much.`
                : priceMissing
                  ? "Type the price per kg."
                  : null;
              const open = !d.is_direct && openKey === f.key;
              const addYarn = () => setFabric(f.key, { yarns: [...(d.yarns.length ? d.yarns : [newYarnMix()]), newYarnMix()] });
              const addProc = () => setFabric(f.key, { processes: [...(d.processes.length ? d.processes : [newFabricProcess()]), newFabricProcess()] });
              return (
                <tbody key={f.key} data-grid-body data-fabric-row={f.key} className={open ? "is-open" : undefined} {...fabFold.focusProps(f.key)}>
                  <tr data-grid-row className="band">
                    <td className="in bandname">
                      <span className="bandhead">
                        {d.is_direct ? (
                          <span className="caret" aria-hidden />
                        ) : (
                          <button
                            type="button"
                            className="caret"
                            aria-expanded={open}
                            aria-label={`${open ? "Fold" : "Open"} ${f.name}`}
                            tabIndex={-1}
                            onClick={() => fabFold.toggle(f.key)}
                          >
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                        {opts ? (
                          <TypeOrPick
                            label="Fabric structure"
                            options={opts.fabrics.map((o) => ({ id: o.id, name: o.name }))}
                            valueId={d.fabric_id}
                            text={d.quality}
                            onChange={(v) => setFabric(f.key, edit.pickFabric ? edit.pickFabric(d, v) : { fabric_id: v.id, quality: v.name })}
                            placeholder=""
                            uppercase
                          />
                        ) : (
                          <span className="px-1 font-semibold">{f.name}</span>
                        )}
                      </span>
                      {blendText ? <span className="blend">{blendText}</span> : null}
                    </td>
                    <td colSpan={2} className="tog">
                      <span className="toglabel">
                        <Toggle checked={d.is_direct} onChange={(v) => setFabric(f.key, { is_direct: v })} ariaLabel={`${f.name} bought in at a direct rate`} />
                        Bought-in
                      </span>
                    </td>
                    <td className="dim r">{d.is_direct ? "price includes loss" : null}</td>
                    <td className={d.is_direct ? "in" : "r fig"}>
                      {d.is_direct ? (
                        <ShownAmount rate={rate} value={d.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })}>{(v, set) => <NumInput aria-label={`${f.name} price per kg`} aria-invalid={priceMissing || undefined} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                      ) : (
                        <b className="bandprice" title={`Yarn ${money(f.yarn)} + Processes ${money(procs)} = ${money(sub)} · +${fx(f.lossPct)}% loss`}>
                          {SYM} {money(f.price)}
                        </b>
                      )}
                    </td>
                    <td className={d.is_direct ? "dim r" : "in"}>
                      {d.is_direct ? "—" : <NumInput aria-label={`${f.name} process loss percent`} value={d.process_loss_pct} onChange={(e) => setFabric(f.key, { process_loss_pct: e.target.value })} />}
                    </td>
                    <td className="act">
                      <span className="acts">
                        <RemoveX label={f.name} onClick={() => removeFabric(f.key)} />
                      </span>
                    </td>
                  </tr>

                  {open ? (
                    <>
                      <tr className="grp">
                        <td colSpan={7}>
                          Yarn · {named.length || yarnLines.length}
                          <span className="gsum">{money(f.yarn)}</span>
                        </td>
                      </tr>
                      {yarnLines.map((y, i) => (
                        <tr key={y?.key ?? `${f.key}-y`} data-grid-row data-hover-row className="line">
                          <td className="in">
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
                          <td className="in">
                            <NumInput
                              aria-label="Mix percent"
                              value={y?.mix_pct ?? ""}
                              onChange={(e) => (y ? setY(y.key, { mix_pct: e.target.value }) : setFabric(f.key, { yarns: [{ ...newYarnMix(), mix_pct: e.target.value }] }))}
                            />
                          </td>
                          <td className="in">
                            {perYarn && y ? (
                              <ShownAmount rate={rate} value={y.rate} onChange={(v) => setY(y.key, { rate: v })}>{(v, set) => <NumInput aria-label="Yarn rate per KG" value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                            ) : i === 0 ? (
                              <ShownAmount rate={rate} value={d.yarn_rate} onChange={(v) => setFabric(f.key, { yarn_rate: v })}>{(v, set) => <NumInput aria-label={`${f.name} yarn rate per kg`} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                            ) : null}
                          </td>
                          <td className="r fig">{perYarn && y ? yarnFig(y) : i === 0 ? money(f.yarn) : ""}</td>
                          <td />
                          <td />
                          <td className="act">
                            <span className="acts">
                              {y && d.yarns.length > 1 ? (
                                <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: d.yarns.filter((x) => x.key !== y.key) })} />
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                      <tr className="addln">
                        <td colSpan={7}>{addLink("Add yarn", addYarn)}</td>
                      </tr>

                      <tr className="grp p">
                        <td colSpan={7}>
                          Processes · {d.processes.length + flat.length}
                          <span className="gsum">{money(procs)}</span>
                        </td>
                      </tr>
                      {procLines.map((q) => (
                        <tr key={q?.key ?? `${f.key}-p`} data-grid-row data-hover-row className="line p">
                          <td className="in">
                            <TypeOrPick
                              label="Process"
                              options={(opts?.processes ?? []).map((o) => ({ id: o.id, name: o.name }))}
                              valueId={q?.process_id ?? null}
                              text={q?.process_name ?? ""}
                              onChange={(v) =>
                                q ? setP(q.key, { process_id: v.id, process_name: v.name }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), process_id: v.id, process_name: v.name }] })
                              }
                              placeholder=""
                              uppercase
                            />
                          </td>
                          <td />
                          <td className="in">
                            <ShownAmount
                              rate={rate}
                              value={q?.rate ?? ""}
                              onChange={(v) => (q ? setP(q.key, { rate: v }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), rate: v }] }))}
                            >
                              {(v, set) => <NumInput aria-label="Process rate per KG" value={v} onChange={(e) => set(e.target.value)} />}
                            </ShownAmount>
                          </td>
                          <td className="r fig">{q && q.rate.trim() !== "" && Number.isFinite(Number(q.rate)) ? fx(Number(q.rate)) : ""}</td>
                          <td />
                          <td />
                          <td className="act">
                            <span className="acts">
                              {q ? <RemoveX label={q.process_name || "process"} onClick={() => setFabric(f.key, { processes: d.processes.filter((x) => x.key !== q.key) })} /> : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {/* Old costings' flat knitting / dyeing / finishing rates, until cleared. */}
                      {flat.map(([k, label]) => (
                        <tr key={k} data-grid-row className="line p">
                          <td className="dim">{label}</td>
                          <td />
                          <td className="in">
                            <ShownAmount rate={rate} value={d[k]} onChange={(v) => setFabric(f.key, { [k]: v } as Partial<FabricDraft>)}>{(v, set) => <NumInput aria-label={`${f.name} ${label}`} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                          </td>
                          <td className="r fig">{fx(Number(d[k]) || 0)}</td>
                          <td />
                          <td />
                          <td className="act" />
                        </tr>
                      ))}
                      <tr className="addln">
                        <td colSpan={7}>{addLink("Add process", addProc)}</td>
                      </tr>
                      <tr className="work">
                        <td colSpan={7}>
                          Yarn <b>{money(f.yarn)}</b> + Processes <b>{money(procs)}</b> = <b>{money(sub)}</b> · + {fx(f.lossPct)}% loss{" "}
                          <b>{money(f.price != null ? f.price - sub : 0)}</b> <span className="eq">= <b>{money(f.price)} / kg</b></span>
                        </td>
                      </tr>
                    </>
                  ) : null}
                  {warn ? (
                    <tr>
                      <td colSpan={7} className="warn">
                        {f.name}: {warn}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
        {opts ? addLink("Add fabric", addFabricRow) : null}
      </div>
    );
  })();

  const secFabric = (
        <section className="blk fabblk" aria-label="Fabric processing cost">
          <div className="flex min-w-0 flex-col gap-3">
            <details open className={edit && view !== "report" ? "plain" : undefined}>
              <summary data-tone="fabric">
                Fabric processing cost <span>{SYM} per kg · yarn + processes, then loss</span>
              </summary>
              {edit && view !== "report" ? fabricWorkbench : fabricSummaryTable}
            </details>
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
              <summary data-tone="fabric">
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
              <summary data-tone="cmt">
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
              <summary data-tone="trims">
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
            <summary data-tone="over">
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
            <summary data-tone="over">
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
                    switches the WHOLE sheet's currency, ₹ by default (2026-10-16). The
                    quoted FOB itself stays in the QUOTED currency while the sheet is in ₹
                    — it is the one figure the buyer is given — and follows the pick only
                    to a third currency. The line under it is always rupees. */}
                {(() => {
                  const q = quotedOf(s);
                  const inr = inrOf(q);
                  const inQuoted = !show.quoted || show.code === show.quoted || show.code === "INR";
                  const big = q == null ? null : inQuoted ? q : inr != null && cur ? inr / cur.rate : null;
                  const bigCode = !show.quoted ? "₹" : inQuoted ? ccy : (cur?.code ?? "");
                  return (
                    <>
                      <div className="qbigrow">
                        <div className="qbig">{big == null ? "—" : `${bigCode} ${fx(big, 2)}`.trim()}</div>
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
                            {/* "Sheet in …": the pick is the SHEET's currency, and a bare
                                "INR" beside a USD price read as contradicting it. */}
                            {show.codes.map((c) => (
                              <option key={c} value={c}>
                                {`Sheet in ${c}${c === show.quoted ? " ●" : ""}`}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>
                      {inr != null && show.quoted && bigCode !== "₹" ? (
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

  /* `tone` — the cost colour a tab's card is topped in (Option B, 2026-10-16), the
     same `--cs-*` family as the section bars inside it. A tab that is not one cost
     takes none and stays neutral. */
  const tabDefs = [
    { label: "Details", hint: "buyer & style" },
    { label: "Fabric", hint: `${SYM} ${money(s.fabric)} / ${model.unitWord}`, tone: "fabric" },
    { label: "Operations & trims", hint: `${SYM} ${money(s.cmt + s.process + s.testing + s.trims)} / ${model.unitWord}`, tone: "cmt" },
    { label: "Cost & overheads", hint: `${SYM} ${money(s.grossCost)} total`, tone: "over" },
    { label: "Quotation", hint: `${s.quoted != null || s.calc != null ? `${ccy} ${fx(s.quoted ?? s.calc, 2)}`.trim() : "—"} · ${eff == null ? "—" : `${eff.toFixed(1)}%`}`, tone: "margin" },
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
      {/* THE LETTERHEAD — OPTION B of the "Costing Report Header" mock-ups (user
          2026-10-16: "Option B is okay"). A white letterhead under the four-colour
          brand stripe the order reports carry (`SheetMasthead`), the document's
          number and status beside the company, the style as the title, and ONE
          coloured card for the figure the reader came for: the FOB, its rupees, the
          rate and the margin. ON SCREEN AND ON PAPER — the old `.mast` letterhead was
          print-only and the screen got a bare bar. The facts band under it replaces
          the header chips; every fact prints only when the costing has it. */}
      <header className="lh">
        <div className="lh-stripe" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="lh-head">
          <div className="lh-left">
            <div className="lh-brand">
              {model.company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={model.company.logo} alt="" className="lh-logo" />
              ) : (
                <div className="lh-mark" aria-hidden>
                  {(model.company.name ?? "R").trim().slice(0, 1)}
                </div>
              )}
              <div className="min0">
                <b>{model.company.name ?? "Raagam Exports"}</b>
                {model.company.unit ? <span>{model.company.unit}</span> : null}
              </div>
            </div>
            <div className="lh-title">
              <span className="lh-kind">Sample Cost Sheet</span>
              <span className="lh-no">
                {model.costingNo ?? "—"} · {model.revision}
              </span>
              <span className={`pill ${stateClass}`}>{model.statusLabel}</span>
            </div>
            <h2 className="lh-style">
              {model.description || model.style || "—"}
              {model.customer ? <span> · {model.customer}</span> : null}
            </h2>
          </div>
          <div className="lh-card">
            <span className="k">
              {s.quoted != null ? "Quoted" : "Calculated"} FOB / {model.unitWord}
              {model.sizes.length > 1 ? ` · ${s.label}` : ""}
            </span>
            <span className="big">{fobShown == null ? "—" : `${ccy} ${fx(fobShown, 2)}`.trim()}</span>
            {fobInr != null && ccy && ccy !== "INR" ? (
              <span className="row">
                Rupees <b>₹ {fx(fobInr)}</b>
              </span>
            ) : null}
            {model.exchangeRate != null && ccy && ccy !== "INR" ? (
              <span className="row">
                Exchange rate <b>{fx(model.exchangeRate)}</b>
              </span>
            ) : null}
            {eff != null ? (
              <span className="marg" data-low={eff < 0 || undefined}>
                Margin {eff.toFixed(1)}%
              </span>
            ) : null}
          </div>
        </div>
        <dl className="lh-facts">
          {(
            [
              ["SMP No", model.enquiryNo],
              ["Style", model.style && model.description && model.style !== model.description ? model.style : null],
              ["Season", model.season],
              ["Fabric", [model.fabricFacts.structure, model.fabricFacts.gsm].filter(Boolean).join(" · ") || null],
              ["Unit", model.isSet ? "SET" : null],
              ["Ship", model.shipMode],
              ["Date", model.date ? fmtDate(model.date) : null],
            ] as const
          ).map(([k, v]) =>
            v ? (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </header>

      {/* THE APPROVAL LINE (client 2026-10-09: "where is the approver") — how this
          costing was approved and by whom: automatically on submit when every quote
          clears the floor, else the BUYER (0725). INTERNAL; the Quotation says only
          "Approved on …". It now sits at the END of the header row below rather than as
          a band of its own (user 2026-10-15, "align this into single line"). */}
      <div className="pad">
        {/* 1 · HEADER — the RAAGAM COSTING FORMAT's top block (client 2026-10-09). Only the
            lines this costing has a value for print: an empty "Buying Agent" row is chrome. */}
        {/* THE LETTERHEAD NOW CARRIES WHAT THIS BAR DID (Option B, 2026-10-16): number,
            status, style, season, ship and date are all above, on screen and in print, so
            the bar that repeated them is gone. What is left is the one line the letterhead
            does not say — who approved it — and the full spec grid when printing. */}
        {model.approval.tone !== "muted" || view === "report" ? (
          <section className="blk hdrblk" aria-label="Header">
            {/* A muted line (Draft, Superseded) only repeats the status pill — dropped. */}
            {model.approval.tone !== "muted" ? (
              <div className="apv" data-tone={model.approval.tone}>
                <b>{model.approval.text}</b>
                {model.approval.detail ? <span>{model.approval.detail}</span> : null}
              </div>
            ) : null}
            {view === "report" ? specGrid : null}
          </section>
        ) : null}


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
                <button key={t.label} type="button" role="tab" id={`cs-tab-${i}`} aria-selected={tab === i} aria-controls="cs-tabpanel" tabIndex={tab === i ? 0 : -1} className="ctab" data-tone={t.tone} onClick={() => setTab(i)}>
                  <span>{t.label}</span>
                  <small>{t.hint}</small>
                </button>
              ))}
            </div>
            <div className="tpanel" role="tabpanel" id="cs-tabpanel" aria-labelledby={`cs-tab-${tab}`}>
              {tab === 0 ? (
                <>
                  {edit?.details}
                  {specGrid}
                </>
              ) : null}
              {tab === 1 ? (
                <>
                  {edit?.sizes}
                  <div className="fabrow">
                    {secConsumption}
                    {photoRail}
                  </div>
                  {secFabric}
                </>
              ) : null}
              {tab === 2 ? secTri : null}
              {tab === 3 ? secGarment : null}
              {tab === 4 ? (
                <>
                  {edit?.terms}
                  {secCommercial}
                </>
              ) : null}
              {tab === 5 ? secHistory : null}
              {/* CHARTS IS A TAB, NOT A VIEW (user 2026-10-15: "Charts is one of the tabs
                  after Revisions — remove Tabs and Charts from the top, Tabs is default"). */}
              {tab === 6 ? (
                <CostCharts model={model} s={s} idx={idx} onSize={onSize} rows={wfRows} money={money} SYM={SYM} ccy={ccy} shownCode={cur ? cur.code : "INR"} />
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

/* ===========================================================================
 * THE CHARTS TAB — COMPACT GLASS (user 2026-10-16: "colourful interactive UI for
 * the tab", then "compacted and better professional glass look", then — pointing
 * at the order budget approval's ring — "have one chart round like this"; the
 * mockup "Cost Sheet Charts" approved the same day with "okay build it").
 *
 * This REPLACES the 2026-10-15 receipt (design E, "light aa plain aa … neat aa").
 * The later instruction governs; restoring the receipt needs a new decision.
 *
 * FOUR TILES, THEN THE PRICE STORY, THEN THE DRILL-DOWNS:
 *  - Price · Gross cost · Margin (zoned against MARGIN_TARGET_PCT / FLOOR_PCT) ·
 *    the biggest cost group;
 *  - How the price is built (the waterfall as floating bars) · Where the price
 *    goes (THE APPROVAL'S `GlassRing`, not a copy) · Margin vs target, and Cost
 *    by size — a size row is a button that switches the whole sheet's size;
 *  - Fabric rate per kg · Price across revisions (only once there IS a history).
 *
 * ONE HIGHLIGHT, THREE PLACES. Hover previews a cost group in the build-up, the
 * ring and the legend at once; a click pins it (again, or Escape, lets go) —
 * the approval ring's own "hover previews, a click picks" rule, for the same
 * reason: a touch pointer "leaves" the moment the finger lifts.
 *
 * GLASS ON PAPER. The sheet is paper in both themes, but `GlassRing` reads the
 * app's `--glass-*` and text tokens, which go dark under `.dark`. So `.cg`
 * pins every token it uses to its light value (see the CSS) — the panel is a
 * light glass panel in either theme, like the paper around it.
 *
 * SCREEN ONLY. Print and the PDF always use the full text report (`view`
 * "report"), so nothing here reaches paper.
 * ======================================================================== */
type Tone = keyof typeof TONE_VAR;
type Zone = "good" | "warn" | "bad";
const zoneOf = (e: number | null): Zone | null =>
  e == null ? null : e >= MARGIN_TARGET_PCT ? "good" : e >= FLOOR_PCT ? "warn" : "bad";
const ZONE_WORD: Record<Zone, string> = { good: "On target", warn: "Below target", bad: "Below floor" };
const ZONE_INK: Record<Zone, string> = { good: "var(--cs-good)", warn: "var(--cs-warn)", bad: "var(--cs-bad)" };
const ZONE_TEXT: Record<Zone, string> = { good: "text-success", warn: "text-warning", bad: "text-danger" };
/** The gauge's right edge — a margin past 30% pins to it. */
const GAUGE_MAX = 30;

type ChartRow = { label: string; value: number; tone: Tone | null; total: boolean; start: number; width: number };

function CostCharts({
  model,
  s,
  idx,
  onSize,
  rows,
  money,
  SYM,
  ccy,
  shownCode,
}: {
  model: CostSheetModel;
  s: SizeFigures;
  idx: number;
  onSize?: (i: number) => void;
  rows: ChartRow[];
  money: (v: number | null | undefined) => string;
  SYM: string;
  ccy: string;
  /** The currency the sheet is shown in — the price tile adds the quoted currency only when it differs. */
  shownCode: string;
}) {
  const [hover, setHover] = useState<Tone | null>(null);
  const [pinned, setPinned] = useState<Tone | null>(null);
  const active = hover ?? pinned;
  const pick = (k: Tone) => setPinned((p) => (p === k ? null : k));
  const lift = (k: Tone | null) => (active ? (active === k ? " on" : " dim") : "");

  const eff = s.effectiveMarginPct;
  const zone = zoneOf(eff);
  const parts = priceParts(s);
  const partTotal = parts.reduce((t, p) => t + p.value, 0) || 1;
  const pctOf = (v: number) => (v / partTotal) * 100;
  const maxShare = Math.max(1, ...parts.map((p) => pctOf(p.value)));
  const biggest = parts.filter((p) => p.tone !== "margin").sort((a, b) => b.value - a.value)[0];
  const marginPart = parts.find((p) => p.tone === "margin");
  const scaleMax = Math.max(1, ...rows.map((r) => r.start + r.width));
  const focus = active ? parts.find((p) => p.tone === active) : null;
  const fob = s.quoted ?? s.calc;

  const centre = focus
    ? { label: focus.label.replace("Embellishment & testing", "Emb. & test"), value: `${pctOf(focus.value).toFixed(1)}%`, sub: `${SYM} ${money(focus.value)}`, color: TONE_VAR[focus.tone] }
    : { label: "Margin", value: eff == null ? "—" : `${eff.toFixed(1)}%`, sub: marginPart ? `${SYM} ${money(marginPart.value)}` : "", tone: zone ? ZONE_TEXT[zone] : "" };

  const gaugeAt = (v: number) => (Math.min(Math.max(v, 0), GAUGE_MAX) / GAUGE_MAX) * 100;
  const short = eff != null && eff < MARGIN_TARGET_PCT ? (MARGIN_TARGET_PCT / 100) * s.price - (marginPart?.value ?? 0) : null;

  const sizeMax = Math.max(1, ...model.sizes.map((x) => x.price));
  const hist = model.history;

  return (
    <section
      className="cg"
      aria-label="Price charts"
      onKeyDown={(e) => {
        if (e.key === "Escape" && pinned) {
          e.stopPropagation();
          setPinned(null);
        }
      }}
    >
      {/* 1 · THE FOUR TILES */}
      <div className="cg-kpis">
        <div className="cg-kpi cg-glass" style={{ ["--c" as string]: "var(--cs-brand)" }}>
          <span className="dot"><Tag aria-hidden /></span>
          <span className="k">
            {s.quoted != null ? "Quoted" : "Calculated"} FOB{model.sizes.length > 1 ? ` · ${s.label}` : ""}
          </span>
          <span className="v">
            {SYM} {money(s.price)}
            {fob != null && ccy && shownCode !== ccy ? <small>{`${ccy} ${fx(fob, 2)}`}</small> : null}
          </span>
        </div>
        <div className="cg-kpi cg-glass" style={{ ["--c" as string]: "var(--cs-over)" }}>
          <span className="dot"><Layers aria-hidden /></span>
          <span className="k">Gross cost</span>
          <span className="v">
            {SYM} {money(s.grossCost)}
            <small>net {money(s.net)}</small>
          </span>
        </div>
        <div className="cg-kpi cg-glass" style={{ ["--c" as string]: zone ? ZONE_INK[zone] : "var(--cs-muted)" }}>
          <span className="dot"><TrendingUp aria-hidden /></span>
          <span className="k">Margin</span>
          <span className="v">
            <span style={{ color: zone ? ZONE_INK[zone] : undefined }}>{eff == null ? "—" : `${eff.toFixed(1)}%`}</span>
            {zone ? <span className={`cg-tag ${zone}`}>{ZONE_WORD[zone]}</span> : null}
          </span>
        </div>
        <div className="cg-kpi cg-glass" style={{ ["--c" as string]: biggest ? TONE_VAR[biggest.tone] : "var(--cs-muted)" }}>
          <span className="dot"><ChartPie aria-hidden /></span>
          <span className="k">Biggest cost</span>
          <span className="v">
            {biggest?.label ?? "—"}
            {biggest && s.price ? <small>{((biggest.value / s.price) * 100).toFixed(1)}% of price</small> : null}
          </span>
        </div>
      </div>

      <div className="cg-main">
        {/* 2 · HOW THE PRICE IS BUILT — each cost climbs from where the last one ended. */}
        <div className="cg-card cg-glass">
          <div className="cg-cap">
            <h4>How the price is built</h4>
            <span>
              {SYM} / {model.unitWord}
              {model.sizes.length > 1 ? ` · ${s.label}` : ""}
            </span>
          </div>
          <div className={`cg-wf${active ? " hot" : ""}`}>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              const fill = r.tone ? TONE_VAR[r.tone] : last ? "var(--cs-brand)" : "#3a5068";
              const bar = (
                <>
                  <span className="l">
                    {r.tone ? <i className="sw" style={{ background: fill }} /> : null}
                    <span>{r.label}</span>
                  </span>
                  <span className="tr">
                    <span className="b cg-gloss" style={{ left: `${(r.start / scaleMax) * 100}%`, width: `${Math.max((r.width / scaleMax) * 100, 0.6)}%`, backgroundColor: fill }} />
                  </span>
                  <span className={`a${r.value < 0 ? " neg" : ""}`}>
                    {r.value < 0 ? "−" : ""}
                    {money(r.width)}
                  </span>
                  <span className="p">{s.price ? `${((r.width / s.price) * 100).toFixed(1)}%` : ""}</span>
                </>
              );
              return r.tone ? (
                // button-shape: exempt -- a waterfall bar you can point at, not a pick-one switch
                <button
                  key={r.label}
                  type="button"
                  className={`cg-row${lift(r.tone)}`}
                  aria-pressed={pinned === r.tone}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHover(r.tone)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
                  onFocus={() => setHover(r.tone)}
                  onBlur={() => setHover(null)}
                  onClick={() => pick(r.tone as Tone)}
                >
                  {bar}
                </button>
              ) : (
                <div key={r.label} className={`cg-row tot${last ? " final" : ""}`}>
                  {bar}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3 · WHERE THE PRICE GOES — the order budget approval's ring. */}
        <div className="cg-card cg-glass">
          <div className="cg-cap">
            <h4>Where the price goes</h4>
            <span>share of the price</span>
          </div>
          <div className="cg-mix">
            <GlassRing
              className="size-[8.75rem]"
              discClassName="size-[5rem] [&>span:nth-child(2)]:text-[1.15rem]"
              slices={parts.map((p) => ({ key: p.tone, amount: p.value, color: TONE_VAR[p.tone] }))}
              base={partTotal}
              active={active}
              onHover={(k) => setHover(k as Tone | null)}
              onPick={(k) => pick(k as Tone)}
              centre={centre}
            />
            <div className="cg-lg">
              {parts.map((p) => {
                const pct = pctOf(p.value);
                return (
                  // button-shape: exempt -- a legend row linked to its ring slice, not a pick-one switch
                  <button
                    key={p.tone}
                    type="button"
                    className={lift(p.tone).trim()}
                    style={{ ["--c" as string]: TONE_VAR[p.tone] }}
                    aria-pressed={pinned === p.tone}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHover(p.tone)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
                    onFocus={() => setHover(p.tone)}
                    onBlur={() => setHover(null)}
                    onClick={() => pick(p.tone)}
                    title={`${p.label}: ${SYM} ${money(p.value)}`}
                  >
                    <i className="dot" />
                    <span className="nm">{p.label}</span>
                    <span className="sh" aria-hidden>
                      <i style={{ width: `${(pct / maxShare) * 100}%` }} />
                    </span>
                    <b>{pct.toFixed(1)}%</b>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="cg-col">
          {/* 4 · MARGIN VS TARGET — red under the floor, amber to the target, green past it. */}
          <div className="cg-card cg-glass">
            <div className="cg-cap">
              <h4>Margin vs target</h4>
              {zone ? <span className={`cg-tag ${zone}`}>{ZONE_WORD[zone]}</span> : <span>no margin yet</span>}
            </div>
            <div className="cg-track" aria-hidden>
              <i className="cg-gloss" style={{ width: `${gaugeAt(FLOOR_PCT)}%`, backgroundColor: "#e88a82" }} />
              <i className="cg-gloss" style={{ width: `${gaugeAt(MARGIN_TARGET_PCT) - gaugeAt(FLOOR_PCT)}%`, backgroundColor: "#efbd4f" }} />
              <i className="cg-gloss" style={{ width: `${100 - gaugeAt(MARGIN_TARGET_PCT)}%`, backgroundColor: "#4fb377" }} />
            </div>
            <div className="cg-pin">
              {eff != null ? (
                <span className="m" style={{ left: `${gaugeAt(eff)}%` }}>
                  <b>{eff.toFixed(1)}%</b>
                </span>
              ) : null}
            </div>
            <div className="cg-ax">
              <span style={{ left: 0 }}>0%</span>
              <span style={{ left: `${gaugeAt(FLOOR_PCT)}%`, transform: "translateX(-100%)", paddingRight: 3 }}>floor {FLOOR_PCT}</span>
              <span style={{ left: `${gaugeAt(MARGIN_TARGET_PCT)}%`, paddingLeft: 3 }}>target {MARGIN_TARGET_PCT}</span>
              <span style={{ right: 0 }}>{GAUGE_MAX}%</span>
            </div>
            {eff != null ? (
              <p className="cg-msg">
                {short == null ? (
                  <>
                    Clears the target by <b>{(eff - MARGIN_TARGET_PCT).toFixed(1)} pts</b>.
                  </>
                ) : (
                  <>
                    Needs <b>{SYM} {money(short)}</b> more per {model.unitWord} to reach {MARGIN_TARGET_PCT}%.
                  </>
                )}
              </p>
            ) : null}
          </div>

          {/* 5 · COST BY SIZE — a row IS the size switch, so the sheet follows the click. */}
          {model.sizes.length > 1 ? (
            <div className="cg-card cg-glass">
              <div className="cg-cap">
                <h4>Cost by size</h4>
                <span>{onSize ? "click to show" : "margin per size"}</span>
              </div>
              <div className="cg-sz">
                {model.sizes.map((x, i) => {
                  const z = zoneOf(x.effectiveMarginPct);
                  return (
                    // button-shape: exempt -- a size bar that drives the toolbar's size switch
                    <button
                      key={x.label}
                      type="button"
                      aria-pressed={i === idx}
                      disabled={!onSize}
                      onClick={() => onSize?.(i)}
                      title={`Size ${x.label}: ${SYM} ${money(x.price)}`}
                    >
                      <span className="n">{x.label}</span>
                      <span className="st" style={{ width: `${(x.price / sizeMax) * 100}%` }}>
                        {priceParts(x).map((p) => (
                          <i key={p.tone} className="cg-gloss" style={{ flex: Math.max(p.value, 0), backgroundColor: TONE_VAR[p.tone] }} />
                        ))}
                      </span>
                      <span className="r">
                        {z && x.effectiveMarginPct != null ? <span className={`cg-tag ${z}`}>{x.effectiveMarginPct.toFixed(1)}%</span> : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {model.fabrics.length || hist.length > 1 ? (
        <div className={`cg-low${model.fabrics.length && hist.length > 1 ? "" : " one"}`}>
          {/* 6 · FABRIC RATE — what a kilo is made of; hover a colour for its amount. */}
          {model.fabrics.length ? (
            <div className="cg-card cg-glass">
              <div className="cg-cap">
                <h4>Fabric rate</h4>
                <span>{SYM} per kg</span>
              </div>
              <div className="cg-fab">
                {model.fabrics.map((f) => {
                  const fin = f.finishing + f.special;
                  const sub = f.yarn + f.knitting + f.dyeing + fin;
                  const loss = f.price != null && !f.direct ? Math.max(f.price - sub, 0) : 0;
                  const segs = (
                    [
                      ["Yarn", f.yarn, "var(--cs-fabric)"],
                      ["Knitting", f.knitting, "var(--cs-cmt)"],
                      ["Dyeing", f.dyeing, "var(--cs-over)"],
                      [f.special ? "Finishing + special" : "Finishing", fin, "var(--cs-trims)"],
                      [f.lossPct ? `Loss ${f.lossPct}%` : "Loss", loss, "#b8c3cd"],
                    ] as const
                  ).filter(([, v]) => v > 0);
                  const tot = segs.reduce((t, [, v]) => t + v, 0) || 1;
                  return (
                    <div key={f.key || f.name}>
                      <div className="top">
                        <span>{f.name}</span>
                        <span>{SYM} {money(f.price)}</span>
                      </div>
                      {f.direct || !segs.length ? (
                        <div className="keys">Direct rate (bought-in)</div>
                      ) : (
                        <>
                          <div className="st">
                            {segs.map(([l, v, c]) => (
                              <i key={l} className="cg-gloss" title={`${l} · ${SYM} ${money(v)} · ${((v / tot) * 100).toFixed(0)}%`} style={{ flex: v, backgroundColor: c }} />
                            ))}
                          </div>
                          <div className="keys">
                            {segs.map(([l, v, c]) => (
                              <span key={l}>
                                <i style={{ background: c }} />
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
            </div>
          ) : null}

          {/* 7 · PRICE ACROSS REVISIONS — only once the costing has been revised. */}
          {hist.length > 1 ? <RevisionTrend hist={hist} ccy={ccy} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/** The quoted price per revision as a line, each point's margin printed under it in its zone colour. */
function RevisionTrend({ hist, ccy }: { hist: CostSheetModel["history"]; ccy: string }) {
  const pts = hist.filter((h) => h.price != null) as (CostSheetModel["history"][number] & { price: number })[];
  if (pts.length < 2) return null;
  const W = 320, H = 118, L = 34, R = 18, T = 18, B = 26;
  const prices = pts.map((p) => p.price);
  const pad = Math.max((Math.max(...prices) - Math.min(...prices)) * 0.25, 0.05);
  const lo = Math.min(...prices) - pad;
  const hi = Math.max(...prices) + pad * 0.6;
  const x = (i: number) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const first = pts[0].price;
  const lastP = pts[pts.length - 1].price;
  const change = first ? ((lastP - first) / first) * 100 : 0;
  const ticks = [lo + pad * 0.4, (lo + hi) / 2, hi - pad * 0.3];
  return (
    <div className="cg-card cg-glass">
      <div className="cg-cap">
        <h4>Price across revisions</h4>
        <span>
          {ccy || "price"} · {change >= 0 ? "+" : ""}
          {change.toFixed(1)}% since {pts[0].label}
        </span>
      </div>
      <svg className="cg-rev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quoted price per revision">
        <defs>
          <linearGradient id="cg-rev-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#037bb8" stopOpacity=".28" />
            <stop offset="1" stopColor="#037bb8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(15,27,38,.07)" />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="#5a6a79">
              {fx(v, 2)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#cg-rev-area)" />
        <path d={line} fill="none" stroke="#037bb8" strokeWidth="2.2" strokeLinejoin="round" />
        {pts.map((p, i) => {
          const z = zoneOf(p.marginPct);
          const anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
          return (
            <g key={p.id}>
              <title>{`${p.label}${p.date ? ` · ${fmtDate(p.date)}` : ""} · ${p.statusLabel}`}</title>
              <circle cx={x(i)} cy={y(p.price)} r="11" fill="transparent" />
              <circle cx={x(i)} cy={y(p.price)} r={p.current ? 6 : 4.5} fill={p.current ? "#037bb8" : "#fff"} stroke="#037bb8" strokeWidth="2.2" />
              <text x={x(i)} y={y(p.price) - 10} textAnchor={anchor} fontSize="10" fontWeight="700" fill="#13304a">
                {fx(p.price, 2)}
              </text>
              <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="10" fontWeight={p.current ? 800 : 600} fill="#0f1b26">
                {p.label.replace("Original (Rev 0)", "Rev 0")}
              </text>
              {p.marginPct != null ? (
                <text x={x(i)} y={H - 1} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={z === "good" ? "#14803f" : z === "warn" ? "#9a6200" : "#b3261e"}>
                  {p.marginPct.toFixed(1)}%
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
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
/* THE CHARTS TAB — COMPACT GLASS (user 2026-10-16; see CostCharts). Replaces the
   2026-10-15 receipt. Every token the shared GlassRing reads is PINNED here to its
   light value, so the panel stays light glass on the paper sheet in either theme. */
.cs-sheet .cg { --glass-ground:#eef3f8; --glass:rgba(255,255,255,.58); --glass-strong:rgba(255,255,255,.85); --glass-row:rgba(255,255,255,.45);
  --glass-edge:rgba(255,255,255,.9); --glass-disc:rgba(255,255,255,.72); --glass-track:rgba(22,32,43,.07);
  --glass-disc-shadow:inset 0 1px 0 #fff, 0 6px 18px -10px rgba(11,111,179,.4);
  --cg-shadow:inset 0 1px 0 rgba(255,255,255,.9), 0 10px 28px -16px rgba(16,38,64,.35), 0 2px 6px -3px rgba(16,38,64,.12);
  --foreground:var(--cs-ink); --muted-foreground:var(--cs-muted); --success:var(--cs-good); --warning:var(--cs-warn); --danger:var(--cs-bad);
  position:relative; isolation:isolate; overflow:hidden; display:grid; gap:10px; padding:12px; border-radius:16px; border:1px solid var(--cs-rule);
  background:
    radial-gradient(38% 55% at 8% 10%, rgba(42,120,214,.28), transparent 70%),
    radial-gradient(34% 50% at 92% 16%, rgba(232,123,164,.24), transparent 70%),
    radial-gradient(40% 60% at 60% 100%, rgba(27,175,122,.22), transparent 70%),
    var(--glass-ground); }
@media (max-width:560px){ .cs-sheet .cg { padding:8px; } }
.cs-sheet .cg-glass { background:var(--glass); -webkit-backdrop-filter:blur(16px) saturate(1.5); backdrop-filter:blur(16px) saturate(1.5);
  border:1px solid var(--glass-edge); border-radius:14px; box-shadow:var(--cg-shadow); animation:cg-rise .4s cubic-bezier(.22,.8,.3,1) both; }
@keyframes cg-rise { from { opacity:0; transform:translateY(4px); } }
/* A light sheen on every bar: lighter at the top, the tone below. */
.cs-sheet .cg-gloss { background-image:linear-gradient(180deg, rgba(255,255,255,.38), rgba(255,255,255,0) 60%); box-shadow:inset 0 1px 0 rgba(255,255,255,.45); }
.cs-sheet .cg-tag { display:inline-flex; align-items:center; height:18px; padding-inline:7px; border-radius:9px; font-size:10.5px; font-weight:700; letter-spacing:0; }
.cs-sheet .cg-tag.good { background:var(--cs-good-tint); color:var(--cs-good); } .cs-sheet .cg-tag.warn { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .cg-tag.bad { background:var(--cs-bad-tint); color:var(--cs-bad); }

/* 1 · tiles */
.cs-sheet .cg-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
@media (max-width:900px){ .cs-sheet .cg-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
.cs-sheet .cg-kpi { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:10px; align-items:center; padding:9px 12px; }
.cs-sheet .cg-kpi .dot { grid-row:span 2; width:30px; height:30px; border-radius:9px; display:grid; place-items:center; color:#fff;
  background:linear-gradient(160deg, color-mix(in srgb, var(--c) 70%, #fff), var(--c)); box-shadow:inset 0 1px 0 rgba(255,255,255,.55), 0 4px 10px -4px var(--c); }
.cs-sheet .cg-kpi .dot svg { width:15px; height:15px; }
.cs-sheet .cg-kpi .k { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--cs-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .cg-kpi .v { font-size:18px; font-weight:800; letter-spacing:-.02em; color:#13304a; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; min-width:0; }
.cs-sheet .cg-kpi .v small { font-size:11px; font-weight:600; color:var(--cs-muted); letter-spacing:0; }

/* panels */
.cs-sheet .cg-main { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,.85fr); gap:10px; }
.cs-sheet .cg-low { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; }
.cs-sheet .cg-low.one { grid-template-columns:minmax(0,1fr); }
@media (max-width:1080px){ .cs-sheet .cg-main { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .cs-sheet .cg-main > :first-child { grid-column:1 / -1; } }
@media (max-width:700px){ .cs-sheet .cg-main, .cs-sheet .cg-low { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cg-card { padding:10px 12px 12px; min-width:0; display:grid; gap:8px; align-content:start; }
.cs-sheet .cg-col { display:grid; gap:10px; align-content:start; min-width:0; }
.cs-sheet .cg-cap { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.cs-sheet .cg-cap h4 { margin:0; font-size:12.5px; font-weight:700; color:#13304a; }
.cs-sheet .cg-cap > span { font-size:11px; color:var(--cs-muted); }
.cs-sheet .cg button { font:inherit; color:inherit; }
.cs-sheet .cg button:focus-visible { outline:2px solid var(--cs-brand); outline-offset:1px; }

/* 2 · build-up */
.cs-sheet .cg-wf { display:grid; gap:1px; font-size:12.5px; }
.cs-sheet .cg-row { display:grid; grid-template-columns:132px minmax(0,1fr) 58px 42px; align-items:center; gap:8px; height:24px; padding:0 6px; border-radius:7px;
  border:0; background:transparent; text-align:left; cursor:pointer; transition:background-color .15s, opacity .2s; }
@media (max-width:560px){ .cs-sheet .cg-row { grid-template-columns:100px minmax(0,1fr) 56px; } .cs-sheet .cg-row .p { display:none; } }
.cs-sheet .cg-row:hover, .cs-sheet .cg-row.on { background:var(--glass-strong); }
.cs-sheet .cg-row .l { display:flex; gap:6px; align-items:center; min-width:0; font-weight:500; }
.cs-sheet .cg-row .l span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .cg-row .sw { width:8px; height:8px; border-radius:2px; flex:none; }
.cs-sheet .cg-row .tr { position:relative; height:12px; border-radius:4px; background:rgba(15,27,38,.045); }
.cs-sheet .cg-row .b { position:absolute; top:0; bottom:0; border-radius:4px; transition:left .45s cubic-bezier(.22,.8,.3,1), width .45s cubic-bezier(.22,.8,.3,1); }
.cs-sheet .cg-row .a { text-align:right; font-weight:600; } .cs-sheet .cg-row .a.neg { color:var(--cs-bad); }
.cs-sheet .cg-row .p { text-align:right; color:var(--cs-muted); font-size:11px; }
.cs-sheet .cg-row.tot { cursor:default; border-top:1px solid rgba(15,27,38,.08); border-radius:0; margin-top:2px; height:27px; }
.cs-sheet .cg-row.tot .l, .cs-sheet .cg-row.tot .a { font-weight:800; }
.cs-sheet .cg-row.final .a { font-size:13.5px; color:var(--cs-brand-ink); }
.cs-sheet .cg-row.tot:hover { background:transparent; }
.cs-sheet .cg-wf.hot .cg-row.dim { opacity:.38; }

/* 3 · the ring + its legend */
.cs-sheet .cg-mix { display:grid; grid-template-columns:8.75rem minmax(0,1fr); gap:12px; align-items:center; }
@media (max-width:420px){ .cs-sheet .cg-mix { grid-template-columns:minmax(0,1fr); justify-items:center; } }
.cs-sheet .cg-lg { display:grid; gap:4px; min-width:0; width:100%; font-size:12.5px; }
.cs-sheet .cg-lg button { display:grid; grid-template-columns:10px minmax(0,1fr) 44px 42px; column-gap:8px; align-items:center; padding:4px 9px; border-radius:11px; cursor:pointer; text-align:left;
  background:var(--glass-row); border:1px solid var(--glass-edge); transition:background-color .2s, opacity .2s; }
.cs-sheet .cg-lg button:hover, .cs-sheet .cg-lg button.on { background:var(--glass-strong); }
.cs-sheet .cg-lg button.dim { opacity:.45; }
.cs-sheet .cg-lg .dot { width:9px; height:9px; border-radius:50%; background:var(--c); box-shadow:0 0 8px var(--c); }
.cs-sheet .cg-lg .nm { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .cg-lg .sh { height:4px; border-radius:2px; background:var(--glass-track); overflow:hidden; }
.cs-sheet .cg-lg .sh i { display:block; height:100%; border-radius:2px; background:var(--c); box-shadow:0 0 6px var(--c); transform-origin:left center; animation:viz-grow .8s cubic-bezier(.22,.8,.26,1) .15s both; }
.cs-sheet .cg-lg b { font-weight:700; text-align:right; }

/* 4 · margin gauge */
.cs-sheet .cg-track { height:10px; border-radius:5px; overflow:hidden; display:flex; box-shadow:inset 0 1px 2px rgba(16,38,64,.15); }
.cs-sheet .cg-track i { display:block; height:100%; }
.cs-sheet .cg-pin { position:relative; height:20px; margin-top:-4px; }
.cs-sheet .cg-pin .m { position:absolute; top:2px; transform:translateX(-50%); display:grid; justify-items:center; transition:left .45s cubic-bezier(.22,.8,.3,1); }
.cs-sheet .cg-pin .m::before { content:""; border:5px solid transparent; border-bottom:6px solid var(--cs-ink); margin-top:-8px; }
.cs-sheet .cg-pin .m b { font-size:11px; font-weight:800; background:var(--cs-ink); color:#fff; border-radius:5px; padding:0 6px; line-height:16px; }
.cs-sheet .cg-ax { position:relative; height:13px; font-size:10.5px; color:var(--cs-muted); margin-top:-4px; }
.cs-sheet .cg-ax span { position:absolute; white-space:nowrap; }
.cs-sheet .cg-msg { font-size:11.5px; color:var(--cs-muted); margin:0; } .cs-sheet .cg-msg b { color:var(--cs-ink); }

/* 5 · sizes */
.cs-sheet .cg-sz { display:grid; gap:2px; font-size:12.5px; }
.cs-sheet .cg-sz button { display:grid; grid-template-columns:30px minmax(0,1fr) 50px; gap:7px; align-items:center; height:25px; padding:0 6px; border-radius:7px; border:1px solid transparent; background:transparent; cursor:pointer; text-align:left; }
.cs-sheet .cg-sz button:hover:not(:disabled) { background:var(--glass-strong); }
.cs-sheet .cg-sz button:disabled { cursor:default; }
.cs-sheet .cg-sz button[aria-pressed="true"] { background:var(--glass-strong); border-color:#b9dff2; box-shadow:0 2px 8px -4px rgba(3,123,184,.45); }
.cs-sheet .cg-sz .n { font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .cg-sz .st { display:flex; height:10px; border-radius:4px; overflow:hidden; gap:1px; }
.cs-sheet .cg-sz .st i { display:block; height:100%; }
.cs-sheet .cg-sz .r { text-align:right; }

/* 6 · fabric rate */
.cs-sheet .cg-fab { display:grid; gap:9px; }
.cs-sheet .cg-fab .top { display:flex; justify-content:space-between; gap:8px; font-weight:700; font-size:12px; }
.cs-sheet .cg-fab .top span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .cg-fab .st { display:flex; gap:2px; height:12px; border-radius:5px; overflow:hidden; margin-top:4px; }
.cs-sheet .cg-fab .st i { display:block; height:100%; cursor:help; transition:opacity .15s; }
.cs-sheet .cg-fab .st:hover i:not(:hover) { opacity:.4; }
.cs-sheet .cg-fab .keys { display:flex; flex-wrap:wrap; gap:2px 10px; margin-top:4px; font-size:11px; color:var(--cs-muted); }
.cs-sheet .cg-fab .keys i { display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:4px; }
.cs-sheet .cg-fab .keys b { color:var(--cs-ink); }

/* 7 · revisions */
.cs-sheet .cg-rev { width:100%; height:auto; max-height:130px; display:block; }

@media (prefers-reduced-motion: reduce) { .cs-sheet .cg-glass, .cs-sheet .cg-lg .sh i { animation:none; } .cs-sheet .cg-row .b, .cs-sheet .cg-pin .m { transition:none; } }
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

/* FABRIC BANDS (plan "Fabric Cost Single Table", option A, 2026-10-16). A fabric's band is
   a grey 40px line that starts each block with a firmer rule; its Yarn and Processes
   groups sit under it while open; process lines are tinted amber so the two groups read
   apart; a working line closes the block. */
.cs-sheet .fband tr.band td { background:#f5f7f9; height:40px; }
.cs-sheet .fband tbody + tbody tr.band td { border-top:2px solid #c8dce9; }
.cs-sheet .fband tr.band:hover td { background:#eef4f9; }
.cs-sheet .fband td.bandname { padding:3px 0 3px 0; vertical-align:middle; }
.cs-sheet .fband .bandhead { display:flex; align-items:center; gap:2px; }
.cs-sheet .fband .bandhead :is(input, select) { font-weight:700; }
.cs-sheet .fband .caret { flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; margin-left:4px; border-radius:4px; color:var(--cs-muted); transition:transform .15s; }
.cs-sheet .fband button.caret:hover { background:#e6edf3; }
.cs-sheet .fband tbody.is-open .caret { transform:rotate(90deg); }
.cs-sheet .fband .blend { display:block; padding-left:30px; font-size:11px; color:var(--cs-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .fband .toglabel { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--cs-muted); }
.cs-sheet .fband td.tog { text-align:left; }
.cs-sheet .fband .bandprice { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:13.5px; font-weight:700; color:#3f7d17; }
.cs-sheet .fband tr.grp td { height:24px; padding-left:30px; font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--cs-muted); background:#fff; }
.cs-sheet .fband tr.grp.p td { color:#8a6512; }
.cs-sheet .fband tr.grp .gsum { float:right; padding-right:3.5rem; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12px; letter-spacing:0; text-transform:none; font-weight:600; color:var(--cs-ink); }
.cs-sheet .fband tr.line > td:first-child { padding-left:22px; }
.cs-sheet .fband tr.line > td.in:first-child { padding-left:22px; }
.cs-sheet .fband tr.line.p > td:not(.in) { background:#fcf8ee; }
.cs-sheet .fband tr.addln td { height:26px; padding-left:22px; background:#fff; }
.cs-sheet .fband tr.work td { height:30px; padding-left:30px; font-size:12px; color:var(--cs-muted); background:#fff; }
.cs-sheet .fband tr.work b { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-weight:600; color:var(--cs-ink); }
.cs-sheet .fband tr.work .eq b { color:#3f7d17; }
@media (prefers-reduced-motion: reduce) { .cs-sheet .fband .caret { transition:none; } }

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

/* ===== OPTION B — LETTERHEAD + PRICE CARD (user 2026-10-16, "Option B is okay";
   artifact "Costing Report Header"). On screen AND in print. The stripe is the order
   reports' own four colours (report-kit.tsx SheetMasthead); the card is the one block
   of strong colour, and it carries the price. ===== */
.cs-sheet .lh { background:#fff; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .lh-stripe { display:flex; height:5px; }
.cs-sheet .lh-stripe span { flex:1; }
.cs-sheet .lh-stripe span:nth-child(1) { background:#d98e04; } .cs-sheet .lh-stripe span:nth-child(2) { background:#6b7480; }
.cs-sheet .lh-stripe span:nth-child(3) { background:#037bb8; } .cs-sheet .lh-stripe span:nth-child(4) { background:#85c227; }
.cs-sheet .lh-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:stretch; padding:14px 18px; border-bottom:2px solid var(--cs-ink); }
.cs-sheet .lh-left { display:flex; flex-direction:column; gap:8px; min-width:0; }
.cs-sheet .lh-brand { display:flex; align-items:center; gap:10px; }
.cs-sheet .lh-logo { height:40px; width:auto; object-fit:contain; flex:none; }
.cs-sheet .lh-mark { width:40px; height:40px; border-radius:9px; background:var(--cs-brand); color:#fff; display:grid; place-items:center; font-weight:800; font-size:19px; flex:none; }
.cs-sheet .lh-brand b { display:block; font-size:16px; font-weight:800; text-transform:uppercase; letter-spacing:.01em; }
.cs-sheet .lh-brand span { display:block; font-size:11.5px; color:var(--cs-muted); text-transform:uppercase; letter-spacing:.06em; }
.cs-sheet .lh-title { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; }
.cs-sheet .lh-kind { font-size:11.5px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--cs-brand); }
.cs-sheet .lh-no { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:16px; font-weight:600; color:var(--cs-ink); }
.cs-sheet .lh-style { font-size:19px; font-weight:800; letter-spacing:-.01em; line-height:1.2; }
.cs-sheet .lh-style span { color:var(--cs-muted); font-weight:600; font-size:15px; }
.cs-sheet .lh-card { background:linear-gradient(160deg,#037bb8,#024f78); color:#fff; border-radius:12px; padding:12px 16px; min-width:200px; display:flex; flex-direction:column; justify-content:center; gap:3px; }
.cs-sheet .lh-card .k { font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:#bfe0f2; font-weight:700; }
.cs-sheet .lh-card .big { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:26px; font-weight:700; line-height:1.1; }
.cs-sheet .lh-card .row { display:flex; justify-content:space-between; gap:12px; font-size:12px; color:#d8ecf7; }
.cs-sheet .lh-card .row b { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; color:#fff; font-weight:600; }
.cs-sheet .lh-card .marg { margin-top:4px; align-self:flex-start; font-size:12px; font-weight:700; color:#1d3b06; background:#c9ec8e; padding:2px 9px; border-radius:999px; }
.cs-sheet .lh-card .marg[data-low] { color:#7a1a14; background:#fbd5d1; }
.cs-sheet .lh-facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px 18px; margin:0; padding:10px 18px; background:var(--cs-soft); }
.cs-sheet .lh-facts dt { font-size:10.5px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:var(--cs-muted); }
.cs-sheet .lh-facts dd { margin:0; font-size:13.5px; font-weight:600; color:var(--cs-ink); }
@media (max-width:640px) { .cs-sheet .lh-head { grid-template-columns:minmax(0,1fr); } .cs-sheet .lh-card { min-width:0; } }

/* Option B's TABS: small cards on a pale band, each topped in its cost colour
   (data-tone on the tab); the open one raised with a brand edge. */
.cs-sheet .ctab { --tone:var(--cs-rule); }
.cs-sheet .ctab[data-tone="fabric"] { --tone:var(--cs-fabric); } .cs-sheet .ctab[data-tone="cmt"] { --tone:var(--cs-cmt); }
.cs-sheet .ctab[data-tone="over"] { --tone:var(--cs-over); } .cs-sheet .ctab[data-tone="margin"] { --tone:var(--cs-margin); }
.cs-sheet .ctabs { gap:6px; padding:8px 10px; background:var(--cs-soft); border:1px solid var(--cs-rule); border-radius:10px; }
.cs-sheet .ctab { border:1px solid var(--cs-rule); border-top:3px solid var(--tone); border-radius:8px; background:#fff; margin-bottom:0; padding:5px 12px 6px; }
.cs-sheet .ctab:hover { background:#fff; box-shadow:0 4px 10px -8px rgb(2 79 120 / .5); }
.cs-sheet .ctab[aria-selected="true"]:not([data-tone]) { --tone:var(--cs-brand); }
.cs-sheet .ctab[aria-selected="true"] { background:#fff; border-color:var(--cs-brand); border-top:3px solid var(--tone); box-shadow:0 6px 14px -10px rgb(2 79 120 / .6); }

/* Option B's SECTION BARS: each section's title row in its cost colour — tint,
   ink, and a 2px rule on top — so the body speaks the tabs' and card's colours. */
.cs-sheet summary[data-tone] { background:var(--tint); color:var(--ink); border-top:2px solid var(--tone); text-transform:uppercase; font-size:12px; letter-spacing:.06em; padding:7px 12px; }
.cs-sheet summary[data-tone] span { text-transform:none; letter-spacing:0; color:var(--ink); opacity:.8; }
.cs-sheet summary[data-tone="fabric"] { --tone:var(--cs-fabric); --tint:#e6f5fc; --ink:#024f78; }
.cs-sheet summary[data-tone="cmt"] { --tone:var(--cs-cmt); --tint:#e4f5f2; --ink:#146b60; }
.cs-sheet summary[data-tone="trims"] { --tone:var(--cs-trims); --tint:#fcf3df; --ink:#8a5a00; }
.cs-sheet summary[data-tone="over"] { --tone:var(--cs-over); --tint:#efebfa; --ink:#5a44a8; }
.cs-sheet details.plain > summary[data-tone] { padding:6px 10px; border-radius:6px; margin-bottom:6px; }
`;
