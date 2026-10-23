"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { fetchTodayRate, listQuoteCurrencies } from "@/lib/sales/sample-costing/actions";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ChevronRight, Plus, Printer } from "lucide-react";
import { AddCharge, CellPick, Ed, EdText, Pick, RemoveX, type EditOptions } from "@/components/sales/cost-sheet-editors";
import { Button } from "@/components/ui/button";
import { DownloadMenu, asExcel, asPdf } from "@/components/ui/download-menu";
import { Toggle } from "@/components/ui/toggle";
import { Sheet as Overlay, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { Field, FieldRow } from "@/components/ui/field";
import { gridKeyNav } from "@/components/masters/child-grid";
import { useAccordion } from "@/lib/ui/use-accordion";
import { focusFirstField, focusLastField, registerContentEdge } from "@/lib/focus";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { newExtra, newFabric, newFabricProcess, newPieceLine, newTrim, newWeightRows, newYarnMix } from "@/lib/sales/sample-costing/revision-draft";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { GlassRing } from "@/components/orders/budget-breakdown-chart";
import { fmtDate } from "@/lib/format";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_TARGET_PCT, extraChargeAmount, hasYarnMix, offeredPrice, quoteKey, sizesOf, yarnMixTotal } from "@/lib/sales/sample-costing/calc";
import { isBlankExtra, isBlankFabric, isBlankPieceLine, isBlankProcess, isBlankTrim, isBlankWeight, isBlankYarn, type CostingDraft, type FabricDraft, type FabricProcessDraft, type PieceDraft, type PieceLineKind, type YarnMixDraft } from "@/lib/sales/sample-costing/types";
import { changeText } from "@/lib/sales/sample-costing/revision-history";
import { withTrailingRows } from "@/lib/sales/sample-costing/trailing-rows";

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
/** A rate fetched for the "show in" switch: ₹ per one unit, the day it is for, and who said so. */
type TodayRate = { rate: number; date: string | null; source: string };

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
  /** Size-Wise is Yes: the single Pcs Wgt column is not drawn while no size is added. */
  sizeWise?: boolean;
  /** Quotation tab: Currency and Ship Mode — above the terms. */
  terms?: ReactNode;
  /** `merged` only: the line under the exchange-rate box — where the rate came from, or a newer one to use. */
  rateNote?: ReactNode;
  /** What picking a fabric structure writes (the entry's remembered rates); default: the id and name only. */
  pickFabric?: (fabric: FabricDraft, picked: { id: string | null; name: string }) => Partial<FabricDraft>;
};

const patchBy = <T extends { key: string }>(xs: readonly T[], key: string, patch: Partial<T>): T[] => xs.map((x) => (x.key === key ? { ...x, ...patch } : x));

/**
 * NO DUPLICATES IN A TABLE (user 2026-10-22: "each table is allowing duplicates").
 * A line's picker offers only what no OTHER line of the same table already holds —
 * by id, and by name for a typed value — so the second COTTON 30S or the second
 * STITCHING is never on offer. The line's own value is not in `others`, so it stays
 * on its field and can be re-picked. "Same table" is the caller's call: a fabric's
 * yarns, a piece's CMT operations, a piece's trims.
 */
function notTaken<T extends { id: string; name: string }>(options: readonly T[], others: readonly { id: string | null; name: string | null }[]): T[] {
  const ids = new Set(others.map((o) => o.id).filter(Boolean));
  const names = new Set(others.map((o) => (o.name ?? "").trim().toUpperCase()).filter(Boolean));
  return options.filter((o) => !ids.has(o.id) && !names.has(o.name.trim().toUpperCase()));
}

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
  entry = false,
  merged = false,
  narrowValues = false,
  opsRow = false,
  opsStack = false,
  trimsByTick = false,
  chargesTable = false,
  fabricFold = false,
  enterFlow = false,
  liveAmounts = false,
  fabricAlign = false,
  onePage = false,
  chartsOnly = false,
  tab,
  onTabChange,
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
  /** THE COST ENTRY (user 2026-10-17): no letterhead on screen (the company / CST No /
   *  Quoted FOB block — the editor's own header already says it) and no Print or
   *  Download ("costing entry no need this option"). Reports and Revise keep both:
   *  that is where a costing is printed and sent. */
  entry?: boolean;
  /** COSTING 3 (user 2026-10-21): Operations, Overheads and Quotation as ONE split-screen
   *  "Cost & Quote" tab — see `secCostQuote`. Off: the seven tabs, unchanged. */
  merged?: boolean;
  /** COSTING 4 (user 2026-10-21: "compact the section, make it 25% of the screen"): with
   *  `merged`, the Price build side takes a quarter of the width, set tight. Off: Costing 3's
   *  even split. */
  narrowValues?: boolean;
  /** COSTING 4 (user 2026-10-21, artifact "Costing 4 Operations"): with `merged`, Cost &
   *  Quote's left side is two rows — Garment processes | CMT operations | Trims as the three
   *  tables Costing 1 draws (no Type dropdown), then Overheads & charges | Terms. Off:
   *  Costing 3's one Operations table, each band on its own line. */
  opsRow?: boolean;
  /** COSTING 5 (user 2026-10-21: "CMT operations — move this under Garment processes"):
   *  with `opsRow`, row 1 is two columns — Garment processes with CMT operations under it,
   *  and Trims beside the pair, the full height of both. Off: the three side by side. */
  opsStack?: boolean;
  /** COSTING 5 (user 2026-10-21, artifact "Trims Direct Rate" v4 — "the unticked item inside
   *  a pop box"): Trims is four columns, Trim · Direct Rate · Rate · Cost. Ticked: Rate is the
   *  ₹ / pc box. Unticked: Rate is a plain "Pack" button (no figures in the row) that opens a
   *  small box with No of Items, No of Pcs, Cons Qty and Rate per pack; unticking opens it.
   *  Off: every row shows every column, as today. */
  trimsByTick?: boolean;
  /** COSTING 5 (user 2026-10-21, artifact "Charges, Terms & Quote"): Overheads & charges,
   *  Terms and Quoted price are ONE table — Item · Type · Value headed once, a shaded band
   *  row per section. Off: three boxes side by side (`opsRow`) or stacked. */
  chargesTable?: boolean;
  /** COSTING 5 (user 2026-10-21, "auto closing option for the section"): with `merged`, Fabric
   *  processing cost's fabric bands fold ONE AT A TIME (AGENTS "Folds are accordions") — the
   *  cursor or a click on a band opens it and shuts the one behind. Off: every band stays open,
   *  as Costing 3 / 4 had it. */
  fabricFold?: boolean;
  /** COSTING 5 (user 2026-10-21: "no more add row concept, using only the Enter key the user
   *  should work in costing entry end to end"): every table ends with one blank row
   *  (`withTrailingRows`), no "+ Add" button is drawn, Enter on the untouched blank row
   *  leaves the table (`data-row-tail`), and Trims' Direct Rate tick is off the Enter path.
   *  Off: the "+ Add row" buttons, as today. */
  enterFlow?: boolean;
  /** COSTING 6 (user 2026-10-22, screenshots 110900 / 111000: Price build showed what an entry
   *  works out to in a separate table; the client asked to see it beside the entry). Each
   *  percentage row of Overheads, terms & quote carries its ₹ amount, faint, at the right of
   *  its label — Rejection, Overhead, a % charge, Margin, Commission, LC discount — and it
   *  moves as the figure is typed. A row typed in ₹ already IS its amount, so it gets none.
   *  Off: the amounts are read in Price build only, as today. */
  liveAmounts?: boolean;
  /** COSTING 6 (user 2026-10-22, screenshot 3657: "alignment of the size, component and fabric
   *  cost table"). The Fabric tab's Size-wise switch takes a row of its own above BOTH tables,
   *  so Component consumption and Fabric processing cost start on one line, and the fabric
   *  table runs to the pane's right edge instead of stopping short of it. Off: Size-wise sits
   *  over the left table only and the fabric table hugs its columns, as today. */
  fabricAlign?: boolean;
  /** THE REPORT ON ONE PAGE (user 2026-10-22, artifact "Cost Sheet One Page": "report in
   *  single page … fabric to quotation", then "report only — the costing entry and revision
   *  will remain the previous version"). Read-only: Details through Quotation stand one under
   *  another, a sticky jump bar in the tab bar's place, Revisions and Charts folded closed at
   *  the bottom. While anything is being edited (Revise, the entry) the tabs stay. */
  onePage?: boolean;
  /** The report's CHARTS tab (user 2026-10-22: "Charts near the Quotation as a separate tab
   *  … remove from bottom"): with `onePage`, the sheet draws its header line and the charts
   *  only. The Cost Sheet itself no longer carries a Charts fold. */
  chartsOnly?: boolean;
  /** The open tab, held by the SCREEN (Costing 5, user 2026-10-22: "add next option … bottom
   *  bar") so its save bar can step it. Omitted, the sheet keeps its own, as before. */
  tab?: number;
  onTabChange?: (tab: number) => void;
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
  /* ANY CURRENCY, AT TODAY'S RATE (user 2026-10-22: "choose EUR — show the exchange rate
     of today and the costing's value"). The pick used to offer only currencies the
     Quotes / Orders register had a rate for, so EUR was simply absent. Now every code in
     the Currency master is offered, and picking one fetches TODAY's market rate
     (`fetchTodayRate`). The quoted currency keeps the costing's own rate — that is the
     rate the price was built at. */
  const [masterCodes, setMasterCodes] = useState<string[]>([]);
  const [todayRates, setTodayRates] = useState<Record<string, TodayRate>>({});
  const [rateWait, setRateWait] = useState<string | null>(null);
  const [rateFail, setRateFail] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void listQuoteCurrencies().then((r) => {
      if (live && r.ok) setMasterCodes(r.codes);
    });
    return () => {
      live = false;
    };
  }, []);
  const rateOf = (c: string): number | null =>
    c === "INR" ? 1 : c === quotedCcy ? (model.exchangeRate ?? null) : (todayRates[c]?.rate ?? model.quoteRates[c] ?? null);
  const [shownPick, setShownPick] = useState<string | null>(null);
  const shownCode = shownPick ?? "INR";
  const shownRate = rateOf(shownCode);
  const cur: ShownCurrency = shownCode === "INR" || !shownRate ? null : { code: shownCode, sym: ccySym(shownCode), rate: shownRate };
  const ccyCodes = [...new Set([...(quotedCcy ? [quotedCcy] : []), ...Object.keys(model.quoteRates), ...masterCodes, "INR"])];
  const pickShown = (c: string) => {
    setShownPick(c);
    setRateFail(null);
    if (c === "INR" || c === quotedCcy || todayRates[c]) return;
    setRateWait(c);
    void fetchTodayRate(c)
      .then((r) => {
        if (r.ok) setTodayRates((m) => ({ ...m, [c]: { rate: r.rate, date: r.effectiveFrom, source: r.source } }));
        else setRateFail(r.error);
      })
      .finally(() => setRateWait((w) => (w === c ? null : w)));
  };
  const show = {
    codes: ccyCodes,
    code: cur ? cur.code : shownCode,
    quoted: quotedCcy,
    onPick: pickShown,
    today: todayRates[shownCode] ?? null,
    waiting: rateWait === shownCode,
    failed: rateFail,
  };

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
  const outputs = !locked && !entry;
  const hasBar = shows(lead) || shows(trail) || model.sizes.length > 1 || error != null || outputs;

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
          {/* THE REVISION PAIR FIRST, THEN THE OUTPUTS (user 2026-10-17): the revision
              picker and Revise are one job and sit together; Print and Download close the
              row, Download last as the filled step. */}
          {trail ? (
            <>
              {trail}
              {outputs ? <span aria-hidden className="mx-1 h-6 w-px bg-border" /> : null}
            </>
          ) : null}
          {!outputs ? (
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
        </div>
      </div>
      ) : null}
      <Sheet model={model} s={s} edit={edit} view={view} cur={cur} show={show} onSize={setIdx} letterhead={!entry} merged={merged} narrowValues={narrowValues} opsRow={opsRow} opsStack={opsStack} trimsByTick={trimsByTick} chargesTable={chargesTable} fabricFold={fabricFold} enterFlow={enterFlow} liveAmounts={liveAmounts} fabricAlign={fabricAlign} onePage={onePage} chartsOnly={chartsOnly} tab={tab} onTabChange={onTabChange} />
    </div>
  );
}

/* "tabs" on screen, "report" only while Print runs. Charts was a third view with its
   own Tabs | Charts switch; it is the last TAB now (user 2026-10-15), so it prints
   with nothing special — Print always prints the full text report. */
type SheetView = "tabs" | "report";

type ShowIn = {
  codes: string[];
  code: string;
  quoted: string | null;
  onPick: (c: string) => void;
  /** Today's rate for the picked currency, once fetched — null for INR, the quoted currency, or while waiting. */
  today: TodayRate | null;
  waiting: boolean;
  failed: string | null;
};

function Sheet({ model, s, edit: editIn, view, cur, show, onSize, letterhead = true, merged = false, narrowValues = false, opsRow = false, opsStack = false, trimsByTick = false, chargesTable = false, fabricFold = false, enterFlow = false, liveAmounts = false, fabricAlign = false, onePage: onePageIn = false, chartsOnly = false, tab: tabIn, onTabChange }: { model: CostSheetModel; s: SizeFigures; edit?: CostSheetEdit; view: SheetView; cur: ShownCurrency; show: ShowIn; /** The Charts tab's size rows drive the toolbar's size switch. */ onSize?: (i: number) => void; /** See `CostSheetDocument`'s `letterhead`. */ letterhead?: boolean; /** See `CostSheetDocument`'s `merged`. */ merged?: boolean; /** See `CostSheetDocument`'s `narrowValues`. */ narrowValues?: boolean; /** See `CostSheetDocument`'s `opsRow`. */ opsRow?: boolean; /** See `CostSheetDocument`'s `opsStack`. */ opsStack?: boolean; /** See `CostSheetDocument`'s `trimsByTick`. */ trimsByTick?: boolean; /** See `CostSheetDocument`'s `chargesTable`. */ chargesTable?: boolean; /** See `CostSheetDocument`'s `fabricFold`. */ fabricFold?: boolean; /** See `CostSheetDocument`'s `enterFlow`. */ enterFlow?: boolean; /** See `CostSheetDocument`'s `liveAmounts`. */ liveAmounts?: boolean; /** See `CostSheetDocument`'s `fabricAlign`. */ fabricAlign?: boolean; /** See `CostSheetDocument`'s `onePage`. */ onePage?: boolean; /** See `CostSheetDocument`'s `chartsOnly`. */ chartsOnly?: boolean; /** See `CostSheetDocument`'s `tab`. */ tab?: number; onTabChange?: (tab: number) => void }) {
  /* enterFlow: the sheet draws (and every edit writes back) the draft with one blank row at
     the end of each table. Same draft in, same blanks out — the keys are deterministic. */
  const edit = enterFlow && editIn ? { ...editIn, draft: withTrailingRows(editIn.draft) } : editIn;
  /** enterFlow: marks a table's blank end row — Enter there before typing leaves the table. */
  const tailIf = (blank: boolean) => (enterFlow && blank ? { "data-row-tail": "" } : {});
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
  const [ownTab, setOwnTab] = useState(0);
  // Held by the screen when it passes one (Costing 5's Next), else by the sheet.
  const tab = tabIn ?? ownTab;
  const setTab = (n: number) => (onTabChange ? onTabChange(n) : setOwnTab(n));
  /** onePage: the report's sections on one page — on screen and read-only only. Print
   *  keeps "report"; a Revise or an entry (anything editable) keeps its tabs. */
  const onePage = onePageIn && view === "tabs" && !editIn;
  /** onePage: Charts draws only once its fold is opened — it is the heaviest section. */
  const [chartsOpen, setChartsOpen] = useState(false);
  /** trimsByTick: the trim whose pack box is open, and the button it grows out of. */
  const [pack, setPack] = useState<{ key: string; origin: SheetOrigin | null } | null>(null);
  /* Fabric bands fold (plan "Fabric Cost Single Table", 2026-10-16): ONE fabric open at a
     time, the first one to begin with — the shared accordion (AGENTS "Folds are accordions"). */
  const fabFold = useAccordion(edit?.draft.fabrics[0]?.key ?? null);
  // Fabric processing folds — one fabric open at a time, the first one to begin with.
  const setFabric = (key: string, patch: Partial<FabricDraft>) => edit?.onChange({ ...edit.draft, fabrics: patchBy(edit.draft.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => edit?.onChange({ ...edit.draft, pieces: patchBy(edit.draft.pieces, key, patch) });
  const eff = s.effectiveMarginPct;
  /** The FOB card's tone: under the floor, short of the target, or clear of it. */
  const effTone = eff == null ? null : eff < FLOOR_PCT ? "bad" : eff < MARGIN_TARGET_PCT ? "warn" : "good";
  const pin = eff == null ? null : (Math.min(Math.max(eff, 0), 30) / 30) * 100;
  const ccy = model.currency ?? "";
  const stateClass = model.status === "approved" ? "good" : model.status === "submitted" ? "warn" : model.status === "rejected" ? "bad" : "brand";
  /** The USD price in rupees at the sheet's own rate — the figure the ledger carries. */
  const inrOf = (v: number | null) => (v == null || model.exchangeRate == null ? null : v * model.exchangeRate);
  /** The letterhead's price card: the FOB in the quoted currency (quoted, else
   *  calculated — the same pair the Quotation tab's hint reads) and its rupees. */
  // A blank Quoted IS the Calculated price rounded to the cent (user 2026-10-22) — so the top card shows it as the quote.
  const fobShown = offeredPrice(s.quoted, s.calc);
  const fobInr = inrOf(fobShown);

  // The waterfall: costs climb to Net, extras to Gross cost, margin and charges to the Price.
  type WfRow = { label: string; value: number; tone: keyof typeof TONE_VAR | null };
  const steps = fobSteps(s, model.exchangeRate);
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
    /* THE BUILD-UP ENDS ON THE HEADER'S PRICE (user 2026-10-17, screenshot 3586: the
       header read ₹427.50 and this chart ₹441.37). `s.price` is the CALCULATED rupee price
       — gross cost + the target margin, freight left out — while the header shows the
       FOB (quoted, else calculated) × the rate, freight and insurance in. Both are right;
       the chart just stopped two steps short. `fobSteps` supplies those two steps. */
    { label: steps.fi || steps.qa ? "Calculated price" : "Price", value: s.price, tone: null },
    ...(steps.fi ? [{ label: "Freight & insurance", value: steps.fi, tone: "over" as const }] : []),
    ...(steps.qa ? [{ label: "Quoted vs calculated", value: steps.qa, tone: "margin" as const }] : []),
    ...(steps.fi || steps.qa ? [{ label: `${s.quoted != null ? "Quoted" : "Calculated"} FOB`, value: steps.fob, tone: null }] : []),
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
  /* THE FABRIC IS CHOSEN HERE, ONCE (client 2026-10-17, screenshot 3595): the Fabric
     column lists the fabric structures. A structure already on the sheet is reused —
     two lines, one fabric, priced once; a new one becomes a fabric band in Fabric
     processing cost (a still-blank seeded fabric is named rather than a second added),
     filled from the entry's rate memory through `pickFabric` as before. A fabric typed
     in before structures were picked (no id) stays offered by its name. */
  const fabricChoices = edit?.options
    ? [
        ...edit.options.fabrics.map((o) => ({ id: o.id, name: o.name })),
        ...edit.draft.fabrics.filter((x) => !x.fabric_id && x.quality.trim()).map((x) => ({ id: `q:${x.key}`, name: x.quality })),
      ]
    : [];
  const pickLineFabric = (r: (typeof weightRows)[number], v: { id: string | null; name: string }) => {
    if (!edit || (!v.id && !v.name.trim())) return;
    /* THE CELL REPORTS EVERY KEYSTROKE (`TypeOrPick` writes typed text as the value), so
       a name that matches nothing must RENAME the line's own typed fabric, never add one:
       adding one per keystroke left a band each for S, SI, SIN … SINGLE S (client
       2026-10-17, screenshot 3620), and each band's name then matched the typed text
       exactly, which unfiltered the list. "Its own" = typed (no structure id) and on no
       other line. Moving a line off such a fabric drops it once nothing but its name is
       on it, so a half-typed name never survives as a band. */
    const cur = edit.draft.fabrics.find((x) => x.key === r.fabricKey);
    const ownTyped = !!cur && !cur.fabric_id && edit.draft.weights.every((x) => x.fabric_key !== cur.key || r.wkeys.includes(x.key));
    const nameOnly = ownTyped && v.id !== `q:${cur.key}` && isBlankFabric({ ...cur, quality: "" });
    const typedName = v.name.trim().toUpperCase();
    const sameName = (x: FabricDraft) => !x.fabric_id && x.quality.trim().toUpperCase() === typedName;
    if (!v.id && ownTyped && !edit.draft.fabrics.some((x) => x.key !== cur.key && sameName(x))) {
      edit.onChange({ ...edit.draft, fabrics: edit.draft.fabrics.map((x) => (x.key === cur.key ? { ...x, quality: v.name } : x)) });
      return;
    }
    const fabrics = nameOnly ? edit.draft.fabrics.filter((x) => x.key !== cur!.key) : edit.draft.fabrics;
    let target = v.id?.startsWith("q:")
      ? fabrics.find((x) => `q:${x.key}` === v.id)
      : fabrics.find((x) => (v.id ? x.fabric_id === v.id : !x.fabric_id && x.quality.trim().toUpperCase() === v.name.trim().toUpperCase()));
    let next = fabrics;
    if (!target) {
      const blank = fabrics.find((x) => !x.fabric_id && !x.quality.trim());
      const base: FabricDraft = { ...(blank ?? { ...newFabric(), processes: [] }), is_direct: false };
      const named: FabricDraft = { ...base, ...(edit.pickFabric ? edit.pickFabric(base, v) : { fabric_id: v.id, quality: v.name }) };
      target = named;
      next = blank ? fabrics.map((x) => (x.key === blank.key ? named : x)) : [...fabrics, named];
    }
    const key = target.key;
    edit.onChange({ ...edit.draft, fabrics: next, weights: edit.draft.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, fabric_key: key } : x)) });
    fabFold.setOpenKey(key);
  };
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
    edit.onChange({ ...edit.draft, weights: [...edit.draft.weights, ...newWeightRows(edit.draft.pieces[0]?.key ?? "", [], null, sizesOf(edit.draft.weights))] });
  };
  /* SIZE-WISE YES / NO (client 2026-10-17). No = the one "All sizes" column, headed
     "Avg Pcs Wgt": one piece weight costs every size. Yes = a column per size,
     then an Avg column — each line's grams over the size count (Avg PCS Wgt), and on
     the total row the fabric cost over the size count (Avg Piece Rate / PCS). */
  const sizeWise = model.weights.sizeLabels.length > 1;
  // No = one weight for every size, so the heading names no size (user 2026-10-17: "if No
  // means avg pcs weight only, how does it still mention the size").
  const weightHead = (l: string) => (l === "All sizes" ? "Avg Pcs Wgt" : l);
  const avgOf = (xs: readonly (number | null)[]) => (xs.length ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) / xs.length : 0);
  /** Yes with no size added yet: the Pcs Wgt column goes; the sizes bar asks for sizes. */
  const noWeightCol = !!edit?.sizeWise && !sizeWise && model.weights.sizeLabels[0] === "All sizes";
  /* Column widths, rem. The merged Fabric tab (Costing 3, user 2026-10-21) gives
     Component consumption only the width its short values need — a component, a
     fabric name, a four-digit weight — so Fabric processing cost beside it gets the rest.
     One "All sizes" column keeps room for its "Avg Pcs Wgt" heading. */
  const cw = merged
    ? { piece: 6.5, comp: 9.5, fab: 10, size: sizeWise ? 4.5 : 5.5, avg: 5 }
    : { piece: 8, comp: 16, fab: 14, size: 5.5, avg: 6.5 };
  const consumptionCols = (model.pieceCount > 1 ? 1 : 0) + 2 + (noWeightCol ? 0 : model.weights.sizeLabels.length) + (sizeWise ? 1 : 0) + (edit ? 1 : 0);

  /* NO LOSS % COLUMN AFTER THE SIZES (client 2026-10-17): the cutting-waste allowance is
     no longer shown or typed here, and since the same day it is not priced either —
     cutting waste is the summary's Garment Rejection % (see calc.ts `WeightInput`). */
  const secConsumption = (
        <section className="blk cons" aria-label="Component consumption">
          <details open>
            <summary data-tone="fabric">
              Component consumption
            </summary>
            <div className="scroll">
              {/* COMPACT (user 2026-10-17, screenshot 3602): Piece 8rem, Fabric 14rem, 5.5rem a
                  size, Avg 6.5rem, ✕ 2.5rem. Component is 16rem too (same day, "why this
                  much"): taking what was left of the 54rem column made it ~40rem wide for a
                  name like NECK TAPE, so the table is the sum of its columns. An explicit
                  width, because table-layout:fixed does nothing on a width:auto table and an
                  input's intrinsic width would widen the column again. */}
              <table style={{ width: `${(model.pieceCount > 1 ? cw.piece : 0) + cw.comp + cw.fab + (noWeightCol ? 0 : model.weights.sizeLabels.length) * cw.size + (sizeWise ? cw.avg : 0) + (edit ? 2.5 : 0)}rem` }}>
                <colgroup>
                  {model.pieceCount > 1 ? <col style={{ width: `${cw.piece}rem` }} /> : null}
                  <col style={{ width: `${cw.comp}rem` }} />
                  <col style={{ width: `${cw.fab}rem` }} />
                  {(noWeightCol ? [] : model.weights.sizeLabels).map((l) => (
                    <col key={l} style={{ width: `${cw.size}rem` }} />
                  ))}
                  {sizeWise ? <col style={{ width: `${cw.avg}rem` }} /> : null}
                  {edit ? <col style={{ width: "2.5rem" }} /> : null}
                </colgroup>
                <thead>
                  <tr>
                    {model.pieceCount > 1 ? <th>Piece</th> : null}
                    <th>Component</th>
                    <th>Fabric</th>
                    {(noWeightCol ? [] : model.weights.sizeLabels).map((l) => (
                      <th key={l} className="r">{weightHead(l)}</th>
                    ))}
                    {sizeWise ? <th className="r" title="Avg PCS Wgt — the sizes' grams over the size count">Avg PCS Wgt</th> : null}
                    {actHead}
                  </tr>
                </thead>
                <tbody {...gridBody}>
                  {weightRows.map((r, i) => (
                    <tr
                      key={r.wkeys[0] ?? i}
                      data-grid-row
                      {...tailIf(r.componentIds.length === 0 && !r.fabricKey && (edit?.draft.weights.filter((w) => r.wkeys.includes(w.key)) ?? []).every(isBlankWeight))}
                    >
                      {model.pieceCount > 1 ? <td>{edit?.options ? <CellPick label="Piece" options={edit.draft.pieces.map((p) => ({ id: p.key, name: p.piece_name || "GARMENT" }))} value={{ id: r.pieceKey, name: r.piece }} onPick={(v) => v.id && setLine(r, { piece_key: v.id })} /> : r.piece}</td> : null}
                      <td>
                        {/* SEVERAL COMPONENTS ON ONE LINE (client 2026-10-17): Front, Back and
                            Sleeve cut from one fabric are ticked together, so the fabric and the
                            weights are typed once. The list searches as you type. A line keeps
                            at least one component — unticking the last is refused. */}
                        {edit?.options ? (
                          <MultiSelect
                            compact
                            label="Components"
                            hideChips
                            summarizeLabels
                            summaryNoun="components"
                            inputClassName="h-7 text-xs"
                            panelClassName="min-w-64"
                            options={(() => {
                              // A component already on another line of this piece is not offered again.
                              const taken = new Set(weightRows.filter((x) => x !== r && x.pieceKey === r.pieceKey).flatMap((x) => x.componentIds));
                              return edit.options.components.filter((o) => !taken.has(o.id)).map((o) => ({ id: o.id, label: o.name }));
                            })()}
                            values={r.componentIds}
                            onChange={(ids) => ids.length && setLine(r, { component_ids: ids })}
                          />
                        ) : (
                          r.component
                        )}
                      </td>
                      <td>
                        {edit?.options ? (
                          <CellPick
                            label="Fabric"
                            // Not the line's OWN typed name: it equals the text being typed, and an
                            // exact hit makes TypeOrPick show the whole list instead of filtering.
                            options={fabricChoices.filter((o) => o.id !== `q:${r.fabricKey}`)}
                            value={(() => {
                              const cur = edit.draft.fabrics.find((x) => x.key === r.fabricKey);
                              return { id: cur ? (cur.fabric_id ?? `q:${cur.key}`) : null, name: r.fabric };
                            })()}
                            onPick={(v) => pickLineFabric(r, v)}
                          />
                        ) : (
                          r.fabric
                        )}
                      </td>
                      {(noWeightCol ? [] : r.grams).map((g, j) => {
                        const cell = r.cells[j];
                        const w = edit && cell && !cell.dim ? edit.draft.weights.find((x) => x.key === cell.key) : null;
                        return (
                          <td key={j} className="r">
                            {w && edit ? <Ed w="w-20" label={`${r.component} ${model.weights.sizeLabels[j]} — grams`} value={w.weight_g} onChange={(v) => edit.onChange({ ...edit.draft, weights: patchBy(edit.draft.weights, w.key, { weight_g: v }) })} /> : g == null ? "" : g}
                          </td>
                        );
                      })}
                      {sizeWise ? <td className="r dim">{r.grams.some((g) => g != null) ? fx(avgOf(r.grams)) : ""}</td> : null}
                      {edit ? (
                        <td className="act">
                          {r.wkeys.length && weightRows.length > 1 ? <RemoveX label={r.component || "weight line"} onClick={() => edit.onChange({ ...edit.draft, weights: edit.draft.weights.filter((x) => !r.wkeys.includes(x.key)) })} /> : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {edit?.options && !enterFlow ? (
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
                    {/* Each size's own fabric cost lives HERE only; the Avg is the one figure
                        every later tab is costed on (calc.ts SIZES, client 2026-10-17). */}
                    {(noWeightCol ? [] : model.weights.fabricBySize).map((v, j) => (
                      <td key={model.weights.sizeLabels[j]} className="r">{money(v)}</td>
                    ))}
                    {sizeWise ? (
                      <td className="r" title="Avg Piece Rate / PCS — the sizes' fabric cost over the size count, carried to every other tab">
                        {money(s.fabric)}
                      </td>
                    ) : null}
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
   * ✕) that stays visible when folded, then — while open — a Yarn group and a
   * Processes group, each with a count + subtotal on its group line, its lines, and its
   * own "+ Add", and a working line closing it (Yarn + Processes = subtotal · + loss =
   * price). ONE fabric open at a time (AGENTS "Folds are accordions", `useAccordion`):
   * a click on the caret toggles, and the cursor arriving on a band's field claims it.
   * Bought-in collapses to the band alone: the price is typed there, its yarn and process
   * lines are hidden, not deleted. Processes stay priced once per FABRIC, as before.
   *
   * OPTION B, 2026-10-17 (plan "Fabric Processing Layout", user "okay do"): while open,
   * Yarn and Processes sit SIDE BY SIDE under the band, each a small table of only its
   * own columns — the shared column grid left Mix % and Price / KG standing empty on
   * every process line (the "blank yellow" cells, screenshot 3595). The working line
   * runs across both. Loss % is the one box in that line: a loss is the FABRIC's, never
   * a line's, and it still prices the fabric (spec v8 §2.2's dual loss).
   *
   * NO FABRIC IS CHOSEN HERE (same day: "don't allow to choose fabric again, we choose
   * in the fabric fields"). Component consumption's Fabric column picks the structure;
   * a structure new to the sheet becomes a band on its own (`pickLineFabric`). So the
   * band shows the name as text and "+ Add fabric" is gone; ✕ still drops an unused one.
   *
   * Hand-rolled (not ChildGrid) because the band spans columns; it keeps the
   * hand-rolled-grid markers (`data-grid-row`, the ✕'s `data-row-remove` via RemoveX,
   * "+ Add"'s `data-row-add`).
   */
  const fabricWorkbench = (() => {
    if (!edit) return null;
    const opts = edit.options;
    const removeFabric = (key: string) =>
      edit.onChange({
        ...edit.draft,
        fabrics: edit.draft.fabrics.filter((x) => x.key !== key),
        weights: edit.draft.weights.map((w) => (w.fabric_key === key ? { ...w, fabric_key: null } : w)),
      });
    /* A fabric not yet named (a new sheet's seeded blank) is not a band: it is named
       by being picked in Component consumption, which reuses it. */
    const shown = edit.draft.fabrics.filter((x) => x.fabric_id || x.quality.trim());
    /* A held key that names no fabric here is another costing's (the editor does not
       remount between records) — the first fabric opens instead. A null the operator
       chose by folding stays null. */
    const held = fabFold.openKey;
    const openKey = held !== null && !shown.some((x) => x.key === held) ? (shown[0]?.key ?? null) : held;
    const addLink = (label: string, onClick: () => void) =>
      enterFlow ? null : (
        <button type="button" data-row-add className="faddrow" onClick={onClick}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {label}
        </button>
      );
    if (!shown.length) return <p className="fempty">Pick a fabric in Component consumption above. It is priced here.</p>;
    return (
      <div className="appgrid fsheet fband">
        <div className="max-w-full overflow-x-auto">
          <table className="fbands">
            <colgroup>
              <col />
              <col style={{ width: "7rem" }} />
              <col style={{ width: "9rem" }} />
              <col style={{ width: "3rem" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Fabric</th>
                <th className="c">Bought-in</th>
                <th className="r">Price / KG</th>
                <th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {shown.map((d) => {
              const f = figuresOf(d);
              const setY = (key: string, patch: Partial<YarnMixDraft>) => setFabric(f.key, { yarns: patchBy(d.yarns, key, patch) });
              /* THE MIX STOPS AT 100 % (user 2026-10-22, screenshot 3659). A Mix % is held to
                 what the other yarns leave, so the blend can never be typed past 100. */
              const capMix = (key: string | null, v: string) => {
                const n = Number(v);
                if (v.trim() === "" || !Number.isFinite(n)) return v;
                const room = Math.max(0, 100 - yarnMixTotal({ yarns: d.yarns.filter((x) => x.key !== key) }));
                return n > room ? String(room) : n < 0 ? "0" : v;
              };
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
                ? "bought in finished · price includes loss"
                : named.map((y) => `${y.mix_pct.trim() ? `${y.mix_pct}% ` : ""}${y.yarn_name || "yarn"}`).join(" · ");
              const warn = blendOff
                ? blendOff < 0
                  ? `Mix is ${share}%. ${+Math.abs(blendOff).toFixed(2)}% still to place.`
                  : `Mix is ${share}%. ${+blendOff.toFixed(2)}% too much.`
                : priceMissing
                  ? "Type the price per kg."
                  : null;
              // Merged (Costing 3): every fabric open — unless `fabricFold` (Costing 5) asks for the accordion.
              const folds = !d.is_direct && (!merged || fabricFold);
              const open = !d.is_direct && (folds ? openKey === f.key : true);
              /* YARN AND MIX % ARE EDITABLE (client 2026-10-17, screenshot 3616: "allow to
                 user edit also"), reversing the same day's lock (screenshot 3598). Sample
                 Entry's composition only PREFILLS them — once, when the style is picked
                 (`pickStyle` seeds while every fabric line is blank) — so the operator can
                 change a yarn, its Mix %, add one or remove one, like any other fabric.
                 The band no longer tags it "from Sample Entry" (user 2026-10-21: unwanted). */
              const addYarn = () => setFabric(f.key, { yarns: [...(d.yarns.length ? d.yarns : [newYarnMix()]), newYarnMix()] });
              const addProc = () => setFabric(f.key, { processes: [...(d.processes.length ? d.processes : [newFabricProcess()]), newFabricProcess()] });
              return (
                <tbody key={f.key} data-grid-body data-fabric-row={f.key} className={open ? "is-open" : undefined} {...fabFold.focusProps(f.key)}>
                  <tr data-grid-row className="band">
                    {/* The whole name cell opens the fabric (user 2026-10-17): the 22px caret
                        alone was the only target, and a click on the name did nothing. The
                        caret's own click bubbles here, so it carries no handler of its own. */}
                    <td className={folds ? "bandname clickable" : "bandname"} onClick={folds ? () => fabFold.toggle(f.key) : undefined}>
                      <span className="bandhead">
                        {!folds ? (
                          <span className="caret" aria-hidden />
                        ) : (
                          <button
                            type="button"
                            className="caret"
                            aria-expanded={open}
                            aria-label={`${open ? "Fold" : "Open"} ${f.name}`}
                            tabIndex={-1}
                          >
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                        <span className="px-1 font-semibold">{f.name}</span>
                      </span>
                      {blendText ? <span className="blend">{blendText}</span> : null}
                    </td>
                    <td className="tog">
                      <Toggle checked={d.is_direct} onChange={(v) => setFabric(f.key, { is_direct: v })} ariaLabel={`${f.name} bought in at a direct rate`} />
                    </td>
                    <td className={d.is_direct ? "in" : "r fig"}>
                      {d.is_direct ? (
                        <ShownAmount rate={rate} value={d.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })}>{(v, set) => <NumInput aria-label={`${f.name} price per kg`} aria-invalid={priceMissing || undefined} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                      ) : (
                        <b className="bandprice" title={`Yarn ${money(f.yarn)} + Processes ${money(procs)} = ${money(sub)} · +${fx(f.lossPct)}% loss`}>
                          {SYM} {money(f.price)}
                        </b>
                      )}
                    </td>
                    <td className="act">
                      <span className="acts">
                        <RemoveX label={f.name} onClick={() => removeFabric(f.key)} />
                      </span>
                    </td>
                  </tr>

                  {open ? (
                    <tr className="fopen">
                      <td colSpan={4}>
                        <div className="fsplit">
                          <div className="fpart">
                            <div className="grp">
                              Yarn · {named.length || yarnLines.length}
                              <span className="gsum">{money(f.yarn)}</span>
                            </div>
                            <table className="ftab">
                              <colgroup>
                                <col />
                                <col style={{ width: "4.5rem" }} />
                                <col style={{ width: "6rem" }} />
                                <col style={{ width: "6rem" }} />
                                <col style={{ width: "2.5rem" }} />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>Yarn</th>
                                  <th className="r">Mix %</th>
                                  <th className="r">Rate / KG</th>
                                  <th className="r">Amount</th>
                                  <th className="act"><span className="sr-only">Actions</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {yarnLines.map((y, i) => (
                                  <tr key={y?.key ?? `${f.key}-y`} data-grid-row data-hover-row {...tailIf(!!y && isBlankYarn(y))}>
                                    <td className="in">
                                      <TypeOrPick
                                        label="Yarn"
                                        options={notTaken(
                                          (opts?.yarns ?? []).map((o) => ({ id: o.id, name: o.name })),
                                          d.yarns.filter((x) => x.key !== y?.key).map((x) => ({ id: x.item_id, name: x.yarn_name })),
                                        )}
                                        valueId={y?.item_id ?? null}
                                        text={y?.yarn_name ?? ""}
                                        onChange={(v) =>
                                          y
                                            ? setY(y.key, { item_id: v.id, yarn_name: v.name })
                                            : setFabric(f.key, { yarns: [{ ...newYarnMix(), item_id: v.id, yarn_name: v.name }] })
                                        }
                                        placeholder=""
                                        uppercase
                                        strict
                                      />
                                    </td>
                                    <td className="in">
                                      <NumInput
                                        aria-label="Mix percent"
                                        value={y?.mix_pct ?? ""}
                                        min={0}
                                        max={100}
                                        onChange={(e) => {
                                          const v = capMix(y?.key ?? null, e.target.value);
                                          return y ? setY(y.key, { mix_pct: v }) : setFabric(f.key, { yarns: [{ ...newYarnMix(), mix_pct: v }] });
                                        }}
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
                                    <td className="act">
                                      <span className="acts">
                                        {y && d.yarns.length > 1 ? (
                                          <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: d.yarns.filter((x) => x.key !== y.key) })} />
                                        ) : null}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {addLink("Add yarn", addYarn)}
                          </div>

                          <div className="fpart p">
                            <div className="grp p">
                              Processes · {d.processes.filter((q) => q.process_id || q.process_name.trim()).length + flat.length}
                              <span className="gsum">{money(procs)}</span>
                            </div>
                            <table className="ftab">
                              <colgroup>
                                <col />
                                <col style={{ width: "7rem" }} />
                                <col style={{ width: "2.5rem" }} />
                              </colgroup>
                              <thead>
                                <tr>
                                  <th>Process</th>
                                  <th className="r">Rate / KG</th>
                                  <th className="act"><span className="sr-only">Actions</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {procLines.map((q) => (
                                  <tr key={q?.key ?? `${f.key}-p`} data-grid-row data-hover-row {...tailIf(!!q && isBlankProcess(q))}>
                                    <td className="in">
                                      <TypeOrPick
                                        label="Process"
                                        options={notTaken(
                                          (opts?.processes ?? []).map((o) => ({ id: o.id, name: o.name })),
                                          d.processes.filter((x) => x.key !== q?.key).map((x) => ({ id: x.process_id, name: x.process_name })),
                                        )}
                                        valueId={q?.process_id ?? null}
                                        text={q?.process_name ?? ""}
                                        onChange={(v) =>
                                          q ? setP(q.key, { process_id: v.id, process_name: v.name }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), process_id: v.id, process_name: v.name }] })
                                        }
                                        placeholder=""
                                        uppercase
                                        strict
                                      />
                                    </td>
                                    <td className="in">
                                      <ShownAmount
                                        rate={rate}
                                        value={q?.rate ?? ""}
                                        onChange={(v) => (q ? setP(q.key, { rate: v }) : setFabric(f.key, { processes: [{ ...newFabricProcess(), rate: v }] }))}
                                      >
                                        {(v, set) => <NumInput aria-label="Process rate per KG" value={v} onChange={(e) => set(e.target.value)} />}
                                      </ShownAmount>
                                    </td>
                                    <td className="act">
                                      <span className="acts">
                                        {q ? <RemoveX label={q.process_name || "process"} onClick={() => setFabric(f.key, { processes: d.processes.filter((x) => x.key !== q.key) })} /> : null}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {/* Old costings' flat knitting / dyeing / finishing rates, until cleared. */}
                                {flat.map(([k, label]) => (
                                  <tr key={k} data-grid-row>
                                    <td className="dim">{label}</td>
                                    <td className="in">
                                      <ShownAmount rate={rate} value={d[k]} onChange={(v) => setFabric(f.key, { [k]: v } as Partial<FabricDraft>)}>{(v, set) => <NumInput aria-label={`${f.name} ${label}`} value={v} onChange={(e) => set(e.target.value)} />}</ShownAmount>
                                    </td>
                                    <td className="act" />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {addLink("Add process", addProc)}
                          </div>
                        </div>
                        <div className="work">
                          Yarn <b>{money(f.yarn)}</b> + Processes <b>{money(procs)}</b> = <b>{money(sub)}</b> · +{" "}
                          <NumInput aria-label={`${f.name} process loss percent`} className="lossbox" value={d.process_loss_pct} onChange={(e) => setFabric(f.key, { process_loss_pct: e.target.value })} />% loss{" "}
                          <b>{money(f.price != null ? f.price - sub : 0)}</b> <span className="eq">= <b>{money(f.price)} / kg</b></span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {warn ? (
                    <tr>
                      <td colSpan={4} className="warn">
                        {f.name}: {warn}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
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
          {/* Printout only: on screen the photo sits on the Details tab (photoRail). */}
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
      <ShownAmount rate={rate} value={line.rate} onChange={(v) => setPiece(piece.key, { ...byOperation(line.kind), lines: patchBy(piece.lines, line.key, { rate: v }) })}>{(v, set) => <Ed label={label} value={v} onChange={set} />}</ShownAmount>
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
    ? edit.draft.trims.filter(isBlankTrim).map((t) => ({ key: t.key, piece: model.pieceCount > 1 ? pieceName(t.piece_key) : "", name: "", direct: t.is_direct !== false, items: "", pcs: "", consQty: 0, rate: 0, cost: 0 }))
    : [];
  /** The line under an op row, and its piece — null for CMT (direct) / testing rows. */
  const lineOf = (o: OpRow) => {
    const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
    const line = o.field === "line" && o.lineKey ? piece?.lines.find((l) => l.key === o.lineKey) : undefined;
    return piece && line ? { piece, line } : null;
  };
  const procOf = (id: string | null) => (id ? edit?.options?.garmentProcesses.find((x) => x.id === id) : undefined);
  /* FILLING A CMT LINE SWITCHES THE PIECE TO "BY OPERATION" — the ledger's rule
     (costing-ledger.tsx). A new piece starts `cmt_direct`, and the model hides CMT
     lines on a direct piece, so without this a picked operation stopped being blank,
     vanished from the table and a fresh blank took its place: the pick looked
     ignored (user 2026-10-22, "cmt operation can't able to select"). */
  const byOperation = (kind: PieceLineKind) => (kind === "cmt" ? { cmt_direct: false } : {});
  const opName = (o: OpRow) => {
    const pl = edit?.options ? lineOf(o) : null;
    if (!edit?.options || !pl) return o.name;
    const { piece, line } = pl;
    // ONE FLAT LIST, no stage to pick first (client 2026-10-17): the CMT Process
    // master's stages are for production tracking, not for the costing — every
    // CMT operation is offered directly.
    const list = notTaken(
      edit.options.garmentProcesses.filter((x) => x.garment_kind === line.kind),
      piece.lines.filter((l) => l.kind === line.kind && l.key !== line.key).map((l) => ({ id: l.process_id, name: l.process_name })),
    );
    return (
      <CellPick
        label={line.kind === "cmt" ? "CMT operation" : "Process"}
        options={list}
        value={{ id: line.process_id, name: line.process_name }}
        onPick={(v) => {
          const p = procOf(v.id);
          // The master's standard rate is a STARTING figure: it fills a blank rate
          // and never overwrites one the operator typed.
          const prefill = p?.standard_rate != null && !line.rate.trim() ? { rate: String(p.standard_rate) } : {};
          setPiece(piece.key, { ...byOperation(line.kind), lines: patchBy(piece.lines, line.key, { process_id: v.id, process_name: v.name, ...prefill }) });
        }}
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
              x.key === piece.key ? { ...x, lines: x.lines.filter((l) => l.key !== line.key) } : x.key === v.id ? { ...x, ...byOperation(line.kind), lines: [...x.lines, line] } : x,
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
    const others = edit.draft.trims.filter((x) => x.key !== d.key && x.piece_key === d.piece_key).map((x) => ({ id: x.item_id, name: x.description }));
    return <CellPick label="Trim or accessory" options={notTaken(edit.options.trims, others)} value={{ id: d.item_id, name: d.description || t.name }} onPick={(v) => setTrim(d.key, { item_id: v.id, description: v.name })} />;
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
  const addRow = (cols: number, onClick: () => void) =>
    enterFlow ? null : (
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
  /** enterFlow: the operation lines still blank — each table's end row. */
  const blankLineKeys = new Set((edit?.draft.pieces ?? []).flatMap((p) => p.lines.filter(isBlankPieceLine).map((l) => l.key)));
  /** A trim row's Direct Rate: the draft's tick while editing, the saved one otherwise. */
  const trimDirect = (t: TrimRow) => {
    const d = edit?.draft.trims.find((x) => x.key === t.key);
    return d ? d.is_direct !== false : t.direct;
  };
  // trimsByTick: No of Items / No of Pcs / Cons Qty live in the pack box, never as columns.
  const packCols = !trimsByTick;
  /* No of Items / No of Pcs only when a trim has a pack (one-page report, user 2026-10-22:
     "Items, Pcs only will show while applicable"). All direct → both columns are empty. */
  const itemCols = packCols && !(onePage && model.trims.every((t) => t.direct));
  const trimCols = (model.pieceCount > 1 ? 1 : 0) + (packCols ? (itemCols ? 7 : 5) : 4) + (edit ? 1 : 0);

  /* A merged band's summary does not fold (class `cq-fixed` — NEVER `fixed`, which is
     Tailwind's position:fixed and floated every band header off its band, screenshot 3630): nothing on Cost & Quote closes (user
     2026-10-21: "no closing, just scrolling"). Off the Tab path — Tab lands on fields. */
  const fixedSum = merged ? { className: "cq-fixed", tabIndex: -1, onClick: (e: ReactMouseEvent) => e.preventDefault() } : {};
  /* Trims is its own band in both layouts: inside "Operations & trims", and on the
     merged Cost & Quote screen's left side. */
  const packD = pack ? edit?.draft.trims.find((x) => x.key === pack.key) : undefined;
  const packRow = pack ? [...model.trims, ...blankTrims].find((x) => x.key === pack.key) : undefined;
  const setPackTrim = (patch: Partial<NonNullable<typeof packD>>) => packD && edit?.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, packD.key, patch) });
  /** Done / Esc: back to the row — its pack button, or Rate if the trim was ticked meanwhile. */
  const closePack = () => {
    const key = pack?.key;
    setPack(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`tr[data-line-key="${key}"] :is(.cq-pack, input[aria-label*="— rate"])`)?.focus());
  };
  /* THE PACK BOX (Costing 5). A [Click] sub-detail of the open costing with no save of its
     own, so the shape AGENTS.md "A sub-detail Sheet's size" names: `sm`, centred over the
     pane, grown from the button, Done in the footer. The figures write straight into the
     draft and save with the costing's Save. */
  const packBox = (
    <Overlay
      open={!!(pack && packD)}
      onClose={closePack}
      size="sm"
      alignToPane
      origin={pack?.origin ?? null}
      title={`Pack — ${packRow?.name || "trim"}`}
      footer={<SubSheetFooter onDone={closePack} parent="costing" />}
    >
      {packD ? (
        <div className="flex flex-col gap-4">
          {/* One row (user 2026-10-21, screenshot 3639): Items · Pcs · Cons Qty · Rate per pack.
              Four `range` steps (4 × 112 + gaps = 484px) did not fit the sm box's ~400px, so Rate
              per pack wrapped under the rest (screenshot 3646). Each now takes the step its label
              and value need — 88 · 72 · 88 · 112 = 390px with nowrap's 10px gaps. */}
          <FieldRow nowrap>
            <Field label="No of Items" w="hug" htmlFor="cs-pack-items">
              <NumInput id="cs-pack-items" autoFocus value={packD.qty} onChange={(e) => setPackTrim({ qty: e.target.value })} />
            </Field>
            <Field label="No of Pcs" w="num" htmlFor="cs-pack-pcs">
              <NumInput id="cs-pack-pcs" value={packD.pack_size} onChange={(e) => setPackTrim({ pack_size: e.target.value })} />
            </Field>
            <Field label="Cons Qty" w="hug" htmlFor="cs-pack-cons">
              <Input id="cs-pack-cons" readOnly className="text-right tabular-nums" value={packRow?.consQty ? packRow.consQty.toFixed(3) : ""} />
            </Field>
            <Field label={`Rate ${SYM} per pack`} w="range" htmlFor="cs-pack-rate">
              <ShownAmount rate={rate} value={packD.pack_price} onChange={(v) => setPackTrim({ pack_price: v })}>
                {(v, setV) => <NumInput id="cs-pack-rate" value={v} onChange={(e) => setV(e.target.value)} />}
              </ShownAmount>
            </Field>
          </FieldRow>
          <p className="rounded-md bg-[var(--surface-2,#f7f9fb)] px-3 py-2 text-sm text-[var(--muted-foreground,#5d6b79)] tabular-nums">
            {packD.qty || 0} ÷ {packD.pack_size || 0} = {(packRow?.consQty ?? 0).toFixed(3)} × {SYM} {money(Number(packD.pack_price) || 0)} ={" "}
            <b className="text-[var(--foreground,#0f1b26)]">
              {SYM} {money(packRow?.cost ?? 0)}
            </b>{" "}
            a piece
          </p>
        </div>
      ) : null}
    </Overlay>
  );
  const secTrims = (
        <>
          {model.trims.length || edit?.options ? (
            <details open className={merged ? "cq-band cq-op-trims" : undefined}>
              <summary data-tone="trims" {...fixedSum}>
                Trims <span>{SYM} {money(s.trims)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th className="c-piece">Piece</th> : null}
                      <th className="c-name">Trim</th>
                      {/* The old RP labels, word for word (client 2026-10-17). */}
                      <th className="c-tick">Direct Rate</th>
                      {packCols ? (
                        <>
                          {itemCols ? (
                            <>
                              <th className={trimsByTick ? "r c-qty c-pack" : "r c-qty"}>No of Items</th>
                              <th className={trimsByTick ? "r c-qty c-pack" : "r c-qty"}>No of Pcs</th>
                            </>
                          ) : null}
                          <th className={trimsByTick ? "r c-qty c-pack" : "r c-qty"}>Cons Qty</th>
                        </>
                      ) : null}
                      {/* trimsByTick: the unit is said once, in the heading (user 2026-10-22,
                          screenshot 095336) — not as a "/pc" suffix in every Rate cell. */}
                      <th className={trimsByTick ? "r c-num c-rate" : "r c-num"}>Rate {SYM}{trimsByTick ? " /pc" : ""}</th>
                      <th className="r c-num">Cost {SYM}</th>
                      {actHead}
                    </tr>
                  </thead>
                  <tbody {...gridBody}>
                    {[...model.trims, ...blankTrims].map((t) => (
                      <tr key={t.key} data-grid-row data-line-key={t.key} {...tailIf(blankTrims.some((b) => b.key === t.key))}>
                        {model.pieceCount > 1 ? <td>{trimPiece(t)}</td> : null}
                        <td>{trimName(t)}</td>
                        {(() => {
                          /* Direct Rate ticked: no pack, so No of Items / No of Pcs stay empty
                             and Rate is the ₹ per piece. Unticked: Items over Pcs is the Cons
                             Qty (read-only — the back end divides), Rate is the pack's price. */
                          const d = edit?.draft.trims.find((x) => x.key === t.key);
                          const set = (patch: Partial<NonNullable<typeof d>>) => d && edit?.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, d.key, patch) });
                          const direct = trimDirect(t);
                          /* trimsByTick: a tick moves the cursor to the box that now matters — No of
                             Items when the pack fields appear, Rate when they go. */
                          const onTick = (checked: boolean, el: HTMLElement) => {
                            set({ is_direct: checked });
                            if (!trimsByTick) return;
                            if (!checked) {
                              setPack({ key: t.key, origin: el.getBoundingClientRect() });
                              return;
                            }
                            requestAnimationFrame(() => {
                              document.querySelector<HTMLInputElement>(`tr[data-line-key="${t.key}"] input[aria-label*="— rate"]`)?.focus();
                            });
                          };
                          return (
                            <>
                              {/* enterFlow: the tick changes what the row means, so it is reached on
                                  purpose (← from Rate, or the mouse), never by Enter's rhythm — Enter on
                                  a tick box toggles it, which would untick every trim walked past. */}
                              <td className="c" data-focus-optional={enterFlow ? "" : undefined}>
                                {edit && d ? <input type="checkbox" aria-label={`${t.name || "Trim"} — direct rate`} checked={direct} onChange={(e) => onTick(e.target.checked, e.currentTarget)} /> : t.direct ? "✓" : ""}
                              </td>
                              {!packCols ? null : trimsByTick && direct ? (
                                <>
                                  {/* Hidden, not greyed (user 2026-10-21): a direct trim has no pack. */}
                                  <td />
                                  <td />
                                  <td />
                                </>
                              ) : (
                                <>
                                  {itemCols ? (
                                    <>
                                      <td className="r">{edit && d && !direct ? <Ed w="w-16" label={`${t.name} — no of items`} value={d.qty} onChange={(v) => set({ qty: v })} /> : t.items}</td>
                                      <td className="r">{edit && d && !direct ? <Ed w="w-16" label={`${t.name} — no of pcs`} value={d.pack_size} onChange={(v) => set({ pack_size: v })} /> : t.pcs}</td>
                                    </>
                                  ) : null}
                                  <td className="r dim">{t.consQty ? t.consQty.toFixed(3) : ""}</td>
                                </>
                              )}
                              {trimsByTick && !direct ? (
                                <td className="cq-packcell">
                                  {edit && d ? (
                                    <button
                                      type="button"
                                      className="cq-pack"
                                      aria-haspopup="dialog"
                                      aria-label={`${t.name || "Trim"} — pack details`}
                                      onClick={(e) => setPack({ key: t.key, origin: e.currentTarget.getBoundingClientRect() })}
                                    >
                                      {/* Just the button (client 2026-10-22, screenshot 3648): the pack's
                                          figures live inside the box, never printed in the row — the table
                                          keeps the ticked row's shape and Cost ₹ still says the /pc. */}
                                      Pack
                                    </button>
                                  ) : (
                                    <span className="cq-packview">
                                      {t.items} per {t.pcs} @ {SYM} {money(t.rate)} · {money(t.cost)} /pc
                                    </span>
                                  )}
                                </td>
                              ) : (
                              <td className="r">
                                {edit && d ? (
                                  direct ? (
                                    <ShownAmount rate={rate} value={d.rate} onChange={(v) => set({ rate: v })}>{(v, setV) => <Ed w="w-20" label={`${t.name} — rate ${SYM}`} value={v} onChange={setV} />}</ShownAmount>
                                  ) : (
                                    <ShownAmount rate={rate} value={d.pack_price} onChange={(v) => set({ pack_price: v })}>{(v, setV) => <Ed w="w-20" label={`${t.name} — rate ${SYM}`} value={v} onChange={setV} />}</ShownAmount>
                                  )
                                ) : (
                                  money(t.rate)
                                )}
                              </td>
                              )}
                            </>
                          );
                        })()}
                        <td className="r c-cost">{money(t.cost)}</td>
                        {edit ? (
                          <td className="act">
                            <RemoveX label={t.name || "trim"} onClick={() => edit.onChange({ ...edit.draft, trims: edit.draft.trims.filter((x) => x.key !== t.key) })} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {edit?.options ? addRow(trimCols, addTrimLine) : null}
                    {/* No total row (user 2026-10-17): the band's header already carries the
                        same figure, so a footer total printed it twice. */}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {trimsByTick ? packBox : null}
        </>
  );

  const secTri = (
        <section className="tri" aria-label="Processes, CMT and trims">
          {model.ops.some((o) => o.kind === "Embellishment") || edit?.options ? (
            <details open className="cq-op-proc">
              <summary data-tone="fabric" {...fixedSum}>
                Garment processes <span>{SYM} {money(s.process)} / {model.unitWord}</span>
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
                  {/* No Fabric cost row (client 2026-10-17): the Fabric tab owns that subtotal and the
                      Quotation summary carries it, so repeating it here showed one figure twice and
                      made this band's total disagree with the "Operations & trims" chip above. */}
                  <tbody {...gridBody}>
                    {/* Testing is typed under Overheads & charges since 2026-10-22, so it is not a row here. */}
                    {[...model.ops.filter((o) => o.kind === "Embellishment"), ...blankOps("embellishment")].map((o, i) => (
                      <tr key={o.lineKey ?? `${o.field}-${i}`} data-grid-row data-line-key={o.lineKey ?? undefined} {...tailIf(!!o.lineKey && blankLineKeys.has(o.lineKey))}>
                        {model.pieceCount > 1 ? <td>{opPiece(o)}</td> : null}
                        <td>{opName(o)}</td>
                        <td className="r">{opRate(o)}</td>
                        {opRemove(o)}
                      </tr>
                    ))}
                    {edit?.options ? addRow(opCols, () => addOpLine("embellishment")) : null}
                    {/* No total row (user 2026-10-17): the band's header already carries the
                        same figure, so a footer total printed it twice. */}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {model.ops.some((o) => o.kind === "CMT") || edit?.options ? (
            <details open className="cq-op-cmt">
              <summary data-tone="cmt" {...fixedSum}>
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
                      <tr key={o.lineKey ?? `${o.field}-${i}`} data-grid-row data-line-key={o.lineKey ?? undefined} {...tailIf(!!o.lineKey && blankLineKeys.has(o.lineKey))}>
                        {model.pieceCount > 1 ? <td>{opPiece(o)}</td> : null}
                        <td>{opName(o)}</td>
                        <td className="r">{opRate(o)}</td>
                        {opRemove(o)}
                      </tr>
                    ))}
                    {edit?.options ? addRow(opCols, () => addOpLine("cmt")) : null}
                    {/* No total row (user 2026-10-17): the band's header already carries the
                        same figure, so a footer total printed it twice. */}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {secTrims}
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
                    ] as const
                  ).map(([label, pick, strong]) => (
                    <tr key={label} className={strong ? "total" : undefined}>
                      <td>{label}</td>
                      {model.sizes.map((x) => (
                        <td key={x.label} className="r">{money(pick(x))}</td>
                      ))}
                    </tr>
                  ))}
                  {/* THE TABLE ENDS AT TOTAL COST (client 2026-10-17, screenshot 3621): Profit,
                      freight, price charges and Price are the SELLING side, and the Quotation
                      tab's price build already shows them — margin, selling price, quote. */}
                </tbody>
              </table>
            </div>
          </details>
          <details open>
            <summary data-tone="over">
              Overheads &amp; extra charges <span>{SYM} {money(s.bank + s.testing + s.sample + s.wastage + s.overhead + s.extraOverhead)} / {model.unitWord}</span>
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
              {edit && !enterFlow ? <AddCharge draft={edit.draft} onChange={edit.onChange} /> : null}
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
  const quotedOf = (x: SizeFigures) => offeredPrice(x.quoted, x.calc);
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
  /** A Terms row: label · value (typed while revising). The "Applies to" column was
   *  removed (user 2026-10-17). */
  const termRow = (label: string, field: TermField, shown: number | null, always = false) =>
    edit ? (
      <tr data-grid-row key={field}>
        <td>{label}</td>
        <td className="in">
          <ShownAmount rate={field === "freight_per_pc" || field === "insurance_per_pc" ? rate : null} value={edit.draft.header[field]} onChange={(v) => setHeader(field, v)}>
            {(v, set) => <Ed label={label} value={v} onChange={set} />}
          </ShownAmount>
        </td>
      </tr>
    ) : always || (shown != null && shown !== 0) ? (
      <tr data-grid-row key={field}>
        <td>{label}</td>
        <td className="r fig">{shown == null ? "—" : field === "freight_per_pc" || field === "insurance_per_pc" ? money(shown) : fx(shown, 2)}</td>
      </tr>
    ) : null;

  /* The Quotation's three tables, each its own piece: the tab lays them out in `secCommercial`;
     the one-page report puts Terms and Price build in its cost row and the Quote in the rail. */
  const qTerms = (
                <div className="qt">
                  <table aria-label="Terms">
                    <thead>
                      <tr data-grid-row>
                        <th>Terms</th>
                        <th className="r fig">Value</th>
                      </tr>
                    </thead>
                    <tbody data-grid-body data-grid-axis="sheet" onKeyDown={gridKeyNav}>
                      {termRow(`Buyer target ${ccy}`.trim(), "buyer_target_price", model.targetPrice)}
                      {termRow("Margin %", "margin_pct", model.terms.margin, true)}
                      {termRow(`Exchange rate ₹ / ${ccy || "FOB"}`, "exchange_rate", model.exchangeRate, true)}
                      {termRow("Commission %", "commission_pct", model.commissionPct)}
                      {termRow("LC discount %", "discount_pct", model.terms.discount)}
                      {termRow("Freight / pc", "freight_per_pc", model.terms.freight)}
                      {termRow("Insurance / pc", "insurance_per_pc", model.terms.insurance)}
                    </tbody>
                  </table>
                </div>
  );
  const qQuote = (
                <div className="qt">
                  <table aria-label="FOB price per size">
                    <thead>
                      <tr data-grid-row>
                        <th>Quote</th>
                        {sizeHead}
                      </tr>
                    </thead>
                    <tbody data-grid-body data-grid-axis="sheet" onKeyDown={gridKeyNav}>
                      <tr data-grid-row className="grp">
                        <td colSpan={model.sizes.length + 1}>
                          Price · {ccy || "FOB"} per {model.unitWord}
                          {model.exchangeRate != null ? <span className="why"> · at ₹ {fx(model.exchangeRate)} / {ccy}</span> : null}
                        </td>
                      </tr>
                      {/* 4 decimals (user 2026-10-17, screenshot 3597): the calculated USD
                          price is the exact figure the quote is rounded FROM, so it shows
                          the digits a 2dp round hides. The typed quote stays as typed. */}
                      {figRow("Calculated", (x) => x.calc, { digits: 4 })}
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
  );
  const qBuild = (
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
                  </tbody>
                </table>
              </div>
  );
  /* The Quotation's summary column — beside its tables on the tab; on the one-page report it
     is the page's right rail instead, so the FOB stays on screen from Fabric to Quotation. */
  /** The quote summary's two cards: the FOB with its margin meter, then the totals. */
  const qFob = (
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
  );
  const qKv = (
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
  );
  const qRail = (
            <aside className="qrail" aria-label="Quote summary">
              {qFob}
              {qKv}
            </aside>
  );
  const secCommercial = (
        <section className="blk qsheet" aria-label="Commercial quote">
          {model.status === "rejected" && model.decisionRemark ? (
            <div className="banner">
              <b>Sent back for rework:</b> {model.decisionRemark}
            </div>
          ) : null}
          <div className="qgrid">
            <div className="qtables">
              {/* Terms with the Quote under it, then Price build (user 2026-10-17): the FOB
                  price on its own, drawn the same way as the cost table. */}
              <div className="qcol">
                {qTerms}
                {qQuote}
              </div>
              {qBuild}
              {edit ? <p className="qhint">Blue cells take typing. Enter moves down the column, Tab moves along the row — like Excel.</p> : null}
            </div>
            {onePage ? null : qRail}
          </div>
        </section>
  );

  /* ==========================================================================
   * COST & QUOTE — ONE SPLIT SCREEN (`merged`, Costing 3 only; user 2026-10-21,
   * artifact "Costing 3 Cost & Quote"). Operations & trims, Cost & overheads and
   * Quotation were three tabs over ONE calculation: a trim rate changed on one tab
   * moved the margin on another. Now the operator types on the LEFT — one scroll,
   * nothing folds (the bands' summaries are inert) — and every worked-out value sits
   * on the RIGHT, pinned, so each keystroke shows where it lands.
   *  - Garment processes and CMT are ONE table with a Type per row; a direct CMT
   *    rate and Testing are the piece's own fields, so their Type is fixed.
   *  - Garment cost, Price build and the Quote figures are ONE read-only table.
   *  - Ship Mode is on Details, and the exchange rate fills itself (the screen's
   *    `rateNote` says where it came from) — no Fetch button.
   * Off by default: every other caller draws the seven tabs exactly as before.
   * ======================================================================== */
  const allOps: OpRow[] = [...model.ops, ...blankOps("embellishment"), ...blankOps("cmt")];
  const typeWord = (o: OpRow) => (o.kind === "CMT" ? "CMT" : o.kind === "Testing" ? "Testing" : "Garment process");
  const opType = (o: OpRow) => {
    const pl = edit ? lineOf(o) : null;
    if (!edit || !pl) return typeWord(o);
    const { piece, line } = pl;
    return (
      <select
        aria-label={`${o.name || "Operation"} — type`}
        value={line.kind}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        className="cq-type"
        onChange={(e) => {
          const kind = e.target.value as PieceLineKind;
          if (kind === line.kind) return;
          // The operation list is per type, so a picked operation does not survive the move; the rate does.
          setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { kind, process_id: null, process_name: "" }) });
        }}
      >
        <option value="cmt">CMT</option>
        <option value="embellishment">Garment process</option>
      </select>
    );
  };
  const opsCols = (model.pieceCount > 1 ? 1 : 0) + 3 + (edit ? 1 : 0);
  const cqOps =
    allOps.length || edit?.options ? (
      <details open className="cq-band">
        <summary data-tone="cmt" {...fixedSum}>
          Operations{" "}
          <span>
            {SYM} {money(s.cmt + s.process + s.testing)} / {model.unitWord} · CMT {SYM} {money(s.cmt)} · Process &amp; testing {SYM} {money(s.process + s.testing)}
          </span>
        </summary>
        <div className="scroll">
          <table aria-label="Operations">
            <thead>
              <tr>
                {model.pieceCount > 1 ? <th className="c-piece">Piece</th> : null}
                <th className="c-type">Type</th>
                <th className="c-name">Operation</th>
                <th className="r c-num">Rate {SYM}</th>
                {actHead}
              </tr>
            </thead>
            <tbody {...gridBody}>
              {allOps.map((o, i) => (
                <tr key={o.lineKey ?? `${o.field}-${o.pieceKey}-${i}`} data-grid-row data-line-key={o.lineKey ?? undefined} {...tailIf(!!o.lineKey && blankLineKeys.has(o.lineKey))}>
                  {model.pieceCount > 1 ? <td>{opPiece(o)}</td> : null}
                  <td>{opType(o)}</td>
                  <td>{opName(o)}</td>
                  <td className="r">{opRate(o)}</td>
                  {opRemove(o)}
                </tr>
              ))}
              {edit?.options ? addRow(opsCols, () => addOpLine("embellishment")) : null}
            </tbody>
          </table>
        </div>
      </details>
    ) : null;

  /** One labelled box of the left side's field grids: a typed box while editing, the value otherwise. */
  const cqField = (key: string, label: string, box: ReactNode, note?: ReactNode) => (
    <div className="cq-f" key={key}>
      <span className="cq-l">{label}</span>
      {box}
      {note ? <span className="cq-note">{note}</span> : null}
    </div>
  );
  const ro = (v: string) => <span className="cq-ro">{v}</span>;
  const setHdr = (patch: Partial<CostingDraft["header"]>) => edit?.onChange({ ...edit.draft, header: { ...edit.draft.header, ...patch } });
  const extraRows = overheadRows.filter((o) => o.edit.kind === "extra");
  const cqOver = (
    <details open className="cq-band cq-over">
      <summary data-tone="over" {...fixedSum}>
        Overheads &amp; charges{" "}
        <span>
          {SYM} {money(s.bank + s.testing + s.sample + s.wastage + s.overhead + s.extraOverhead)} / {model.unitWord}
          {model.sizes.length > 1 ? ` · ${s.label}` : ""}
        </span>
      </summary>
      <div className="cq-grid">
        {/* ORDER: Bank charges, Testing, Rejection %, Overhead % (user 2026-10-22, screenshot 141134). */}
        {edit
          ? edit.draft.pieces.map((p) =>
              cqField(
                `bank-${p.key}`,
                `Bank charges ${SYM}${edit.draft.pieces.length > 1 ? ` · ${p.piece_name || "piece"}` : ""}`,
                <ShownAmount rate={rate} value={p.bank_cost} onChange={(v) => setPiece(p.key, { bank_cost: v })}>
                  {(v, set) => <Ed w="w-full" label={`Bank charges ${p.piece_name || ""}`.trim()} value={v} onChange={set} />}
                </ShownAmount>,
              ),
            )
          : cqField("bank", `Bank charges ${SYM}`, ro(money(s.bank)))}
        {edit
          ? edit.draft.pieces.map((p) =>
              cqField(
                `testing-${p.key}`,
                `Testing ${SYM}${edit.draft.pieces.length > 1 ? ` · ${p.piece_name || "piece"}` : ""}`,
                <ShownAmount rate={rate} value={p.testing_cost} onChange={(v) => setPiece(p.key, { testing_cost: v })}>
                  {(v, set) => <Ed w="w-full" label={`Testing ${p.piece_name || ""}`.trim()} value={v} onChange={set} />}
                </ShownAmount>,
              ),
            )
          : cqField("testing", `Testing ${SYM}`, ro(money(s.testing)))}
        {cqField("waste", "Rejection %", edit ? <Ed w="w-full" label="Rejection %" value={edit.draft.header.garment_waste_pct} onChange={(v) => setHdr({ garment_waste_pct: v })} /> : ro(fx(model.terms.wastage, 2)))}
        {cqField("overhead", "Overhead %", edit ? <Ed w="w-full" label="Overhead %" value={edit.draft.header.overhead_pct} onChange={(v) => setHdr({ overhead_pct: v })} /> : ro(fx(model.terms.overhead, 2)))}
      </div>
      {extraRows.length ? (
        <div className="scroll">
          <table aria-label="Extra charges" className="cq-extra">
            <thead>
              <tr>
                <th>Extra charge</th>
                <th>Type</th>
                <th className="r">Value</th>
                {actHead}
              </tr>
            </thead>
            <tbody {...gridBody}>
              {extraRows.map((o, i) => {
                const x = edit && o.edit.kind === "extra" ? edit.draft.extras.find((e) => e.key === o.edit.key) : null;
                if (!edit || !x) {
                  return (
                    <tr key={i}>
                      <td>
                        {o.name.toUpperCase()}
                        {o.side === "price" ? <span className="dim"> (price)</span> : null}
                      </td>
                      <td className="dim">{o.type}</td>
                      <td className="r">{o.value}</td>
                    </tr>
                  );
                }
                const set = (patch: Partial<typeof x>) => edit.onChange({ ...edit.draft, extras: patchBy(edit.draft.extras, x.key, patch) });
                return (
                  <tr key={x.key} data-grid-row {...tailIf(isBlankExtra(x))}>
                    <td>
                      <EdText label="Charge name" value={x.name} onChange={(v) => set({ name: v })} />
                    </td>
                    <td>
                      <select
                        aria-label="Charge type"
                        value={x.kind}
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                        data-form-type="other"
                        className="cq-type"
                        onChange={(e) => set({ kind: e.target.value as "flat" | "pct" })}
                      >
                        <option value="flat">Flat ₹</option>
                        <option value="pct">Percent</option>
                      </select>
                    </td>
                    <td className="r">
                      <ShownAmount rate={x.kind === "pct" ? null : rate} value={x.value} onChange={(v) => set({ value: v })}>
                        {(v, setV) => <Ed w="w-20" label={`${x.name || "Charge"} — ${x.kind === "pct" ? "%" : "₹"}`} value={v} onChange={setV} />}
                      </ShownAmount>
                    </td>
                    <td className="act">
                      <RemoveX label={x.name || "charge"} onClick={() => edit.onChange({ ...edit.draft, extras: edit.draft.extras.filter((e) => e.key !== x.key) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {edit && !enterFlow ? <AddCharge draft={edit.draft} onChange={edit.onChange} /> : null}
    </details>
  );

  const isAmount = (field: TermField) => field === "freight_per_pc" || field === "insurance_per_pc";
  const termBox = (label: string, field: TermField, shown: number | null, note?: ReactNode) =>
    cqField(
      field,
      label,
      edit ? (
        <ShownAmount rate={isAmount(field) ? rate : null} value={edit.draft.header[field]} onChange={(v) => setHeader(field, v)}>
          {(v, set) => <Ed w="w-full" label={label} value={v} onChange={set} />}
        </ShownAmount>
      ) : (
        ro(shown == null ? "—" : isAmount(field) ? money(shown) : fx(shown, 2))
      ),
      note,
    );
  const cqTerms = (
    <details open className="cq-band cq-terms">
      <summary data-tone="margin" {...fixedSum}>
        Terms{" "}
        <span>
          Margin {edit ? Number(edit.draft.header.margin_pct) || 0 : model.terms.margin}%
          {model.exchangeRate != null ? ` · ₹ ${fx(model.exchangeRate)} / ${ccy || "FOB"}` : ""}
        </span>
      </summary>
      <div className="cq-grid">
        {termBox(`Buyer target ${ccy}`.trim(), "buyer_target_price", model.targetPrice)}
        {termBox("Margin %", "margin_pct", model.terms.margin)}
        {termBox(`Exchange ₹ / ${ccy || "FOB"}`, "exchange_rate", model.exchangeRate, edit?.rateNote)}
        {termBox("Commission %", "commission_pct", model.commissionPct)}
        {termBox("LC discount %", "discount_pct", model.terms.discount)}
        {termBox(`Freight / pc ${SYM}`, "freight_per_pc", model.terms.freight)}
        {termBox(`Insurance / pc ${SYM}`, "insurance_per_pc", model.terms.insurance)}
      </div>
    </details>
  );

  const cqQuote = (
    <details open className="cq-band">
      <summary data-tone="margin" {...fixedSum}>
        Quoted price <span>{ccy || "FOB"} per {model.unitWord}</span>
      </summary>
      <div className="qt cq-qt">
        <table aria-label="Quoted price per size">
          <thead>
            <tr data-grid-row>
              <th>Size</th>
              <th className="r fig">Calculated</th>
              {edit ? (
                edit.draft.pieces.map((p) => (
                  <th key={p.key} className="r fig">
                    Quoted{edit.draft.pieces.length > 1 ? ` · ${p.piece_name || "piece"}` : ""}
                  </th>
                ))
              ) : (
                <th className="r fig">Quoted</th>
              )}
            </tr>
          </thead>
          <tbody data-grid-body data-grid-axis="sheet" onKeyDown={gridKeyNav}>
            {model.sizes.map((x, i) => (
              <tr data-grid-row key={x.label} className={i === idx ? "cur" : undefined}>
                <td>{model.sizes.length > 1 ? x.label : `Per ${model.unitWord}`}</td>
                {/* 4 decimals: the exact figure the quote is rounded FROM (2026-10-17). */}
                <td className="r fig">{x.calc == null ? "—" : fx(x.calc, 4)}</td>
                {edit ? (
                  edit.draft.pieces.map((p) => {
                    const k = quoteKey(p.key, x.size);
                    return (
                      <td key={k} className="in">
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
                  })
                ) : (
                  <td className="r fig">{x.quoted == null ? "—" : fx(x.quoted, 2)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? <p className="cq-hint">Leave a box blank to quote the calculated price.</p> : null}
    </details>
  );

  /* chargesTable (Costing 5, user 2026-10-21: "make this into single table", then screenshot
     3641: "like Price build · ₹ per piece kind"): the three boxes above as ONE table drawn the
     way Price build is — the `.qt` table, Item | Value, a muted capitals row per section with
     its figure in the Value column, and every typed value an editable CELL (`td.in`, the
     tinted cell the old Quote table used), never a box inside a cell. The unit is in the
     label ("Rejection %"), so there is no Type column. Same fields, same setters. */
  const ctCols = 2 + (edit ? 1 : 0) + (liveAmounts ? 1 : 0);
  /** liveAmounts: a band's ₹ total stands in the amounts column, over the amounts it sums. */
  const ctBand = (label: string, fig: ReactNode, total?: ReactNode, tone?: "over" | "terms" | "quote") => (
    <tr className="grp" data-band={tone}>
      <td>{label}</td>
      <td className="fig">{liveAmounts && total !== undefined ? null : fig}</td>
      {liveAmounts ? <td className="fig amt">{total ?? null}</td> : null}
      {actGap}
    </tr>
  );
  /** A row of the table: the label, then the value — a typed cell while editing, the figure otherwise. */
  /** liveAmounts: what a percentage works out to, in ₹, in its own column RIGHT of the typed
   *  figure — entry, then result. Nothing for a blank or zero entry, so an untouched row stays
   *  as quiet as it was. */
  const amt = (v: number | null | undefined, sign = "") =>
    liveAmounts && v != null && Math.abs(v) >= 0.005 ? <span className="cq-amt">{`${sign}${money(Math.abs(v))}`}</span> : null;
  const ctRow = (key: string, label: ReactNode, value: ReactNode, typed: boolean, amount?: ReactNode) => (
    <tr key={key} data-grid-row={typed || undefined}>
      <td>{label}</td>
      <td className={typed ? "in" : "fig"}>{value}</td>
      {liveAmounts ? <td className="fig amt">{amount}</td> : null}
      {actGap}
    </tr>
  );
  const ctTerm = (label: string, field: TermField, shown: number | null, note?: ReactNode, amount?: ReactNode) =>
    ctRow(
      field,
      <>
        {label}
        {note ? <span className="cq-note">{note}</span> : null}
      </>,
      edit ? (
        <ShownAmount rate={isAmount(field) ? rate : null} value={edit.draft.header[field]} onChange={(v) => setHeader(field, v)}>
          {(v, set) => <Ed w="w-full" label={label} value={v} onChange={set} />}
        </ShownAmount>
      ) : shown == null ? (
        "—"
      ) : isAmount(field) ? (
        money(shown)
      ) : (
        fx(shown, 2)
      ),
      !!edit,
      amount,
    );
  const multiPiece = !!edit && edit.draft.pieces.length > 1;
  const cqOneTable = (
    <div className={liveAmounts ? "cq-onetable cq-live" : "cq-onetable"}>
      <div className="qt">
        <table aria-label="Overheads, terms and quote">
          {/* The title spans the strip, so a fixed-layout table takes its widths from here. */}
          <colgroup>
            <col />
            <col className="cq-vcol" />
            {liveAmounts ? <col className="cq-mcol" /> : null}
            {edit ? <col className="cq-acol" /> : null}
          </colgroup>
          <thead>
            <tr className="cq-title" data-tone="over">
              {/* "/pc" in the title, one line (user 2026-10-22, screenshot 104714): "₹ per piece"
                  wrapped the strip in two once the table was compacted, and the "Value" head
                  said nothing the section rows' own figures do not. */}
              <th colSpan={ctCols}>
                Overheads, terms &amp; quote · {SYM} /{model.unitWord === "piece" ? "pc" : model.unitWord}
              </th>
            </tr>
          </thead>
          <tbody {...gridBody}>
            {ctBand("Overheads & charges", `${money(s.bank + s.testing + s.sample + s.wastage + s.overhead + s.extraOverhead)}${model.sizes.length > 1 ? ` · ${s.label}` : ""}`, money(s.bank + s.testing + s.sample + s.wastage + s.overhead + s.extraOverhead), "over")}
            {/* ORDER: Bank charges, Testing, Rejection %, Overhead % (user 2026-10-22, screenshot 141134). */}
            {edit
              ? edit.draft.pieces.map((p) =>
                  ctRow(
                    `bank-${p.key}`,
                    `Bank charges ${SYM}${multiPiece ? ` · ${p.piece_name || "piece"}` : ""}`,
                    <ShownAmount rate={rate} value={p.bank_cost} onChange={(v) => setPiece(p.key, { bank_cost: v })}>
                      {(v, set) => <Ed w="w-full" label={`Bank charges ${p.piece_name || ""}`.trim()} value={v} onChange={set} />}
                    </ShownAmount>,
                    true,
                  ),
                )
              : ctRow("bank", `Bank charges ${SYM}`, money(s.bank), false)}
            {edit
              ? edit.draft.pieces.map((p) =>
                  ctRow(
                    `testing-${p.key}`,
                    `Testing ${SYM}${multiPiece ? ` · ${p.piece_name || "piece"}` : ""}`,
                    <ShownAmount rate={rate} value={p.testing_cost} onChange={(v) => setPiece(p.key, { testing_cost: v })}>
                      {(v, set) => <Ed w="w-full" label={`Testing ${p.piece_name || ""}`.trim()} value={v} onChange={set} />}
                    </ShownAmount>,
                    true,
                  ),
                )
              : ctRow("testing", `Testing ${SYM}`, money(s.testing), false)}
            {/* SAMPLING COST, UNDER TESTING (0736, user 2026-10-22): a flat ₹ per piece, priced like Testing. */}
            {edit
              ? edit.draft.pieces.map((p) =>
                  ctRow(
                    `sample-${p.key}`,
                    `Sampling cost ${SYM}${multiPiece ? ` · ${p.piece_name || "piece"}` : ""}`,
                    <ShownAmount rate={rate} value={p.sample_cost ?? ""} onChange={(v) => setPiece(p.key, { sample_cost: v })}>
                      {(v, set) => <Ed w="w-full" label={`Sampling cost ${p.piece_name || ""}`.trim()} value={v} onChange={set} />}
                    </ShownAmount>,
                    true,
                  ),
                )
              : ctRow("sample", `Sampling cost ${SYM}`, money(s.sample), false)}
            {ctRow("waste", "Rejection %", edit ? <Ed w="w-full" label="Rejection %" value={edit.draft.header.garment_waste_pct} onChange={(v) => setHdr({ garment_waste_pct: v })} /> : fx(model.terms.wastage, 2), !!edit, amt(s.wastage))}
            {ctRow("overhead", "Overhead %", edit ? <Ed w="w-full" label="Overhead %" value={edit.draft.header.overhead_pct} onChange={(v) => setHdr({ overhead_pct: v })} /> : fx(model.terms.overhead, 2), !!edit, amt(s.overhead))}
            {extraRows.map((o, i) => {
              const x = edit && o.edit.kind === "extra" ? edit.draft.extras.find((e) => e.key === o.edit.key) : null;
              if (!edit || !x) {
                return ctRow(
                  `x-${i}`,
                  <>
                    {o.name.toUpperCase()} <span className="dim">{o.type}</span>
                    {o.side === "price" ? <span className="dim"> (price)</span> : null}
                  </>,
                  o.value,
                  false,
                );
              }
              const set = (patch: Partial<typeof x>) => edit.onChange({ ...edit.draft, extras: patchBy(edit.draft.extras, x.key, patch) });
              return (
                <tr key={x.key} data-grid-row>
                  {/* A typed charge: its name and Flat ₹ / % share the Item cell. */}
                  <td className="in">
                    <div className="ct-extra">
                    <EdText label="Charge name" value={x.name} onChange={(v) => set({ name: v })} />
                    <select
                      aria-label="Charge type"
                      value={x.kind}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                      data-form-type="other"
                      onChange={(e) => set({ kind: e.target.value as "flat" | "pct" })}
                    >
                      <option value="flat">Flat ₹</option>
                      <option value="pct">%</option>
                    </select>
                    </div>
                  </td>
                  <td className="in">
                    <ShownAmount rate={x.kind === "pct" ? null : rate} value={x.value} onChange={(v) => set({ value: v })}>
                      {(v, setV) => <Ed w="w-full" label={`${x.name || "Charge"} — ${x.kind === "pct" ? "%" : "₹"}`} value={v} onChange={setV} />}
                    </ShownAmount>
                  </td>
                  {liveAmounts ? <td className="fig amt">{x.kind === "pct" ? amt(extraChargeAmount(x, s.net)) : null}</td> : null}
                  <td className="act">
                    <RemoveX label={x.name || "charge"} onClick={() => edit.onChange({ ...edit.draft, extras: edit.draft.extras.filter((e) => e.key !== x.key) })} />
                  </td>
                </tr>
              );
            })}
            {edit && !enterFlow ? (
              <tr className="addrow">
                <td colSpan={ctCols}>
                  <Button type="button" variant="outline" size="sm" data-row-add onClick={() => edit.onChange({ ...edit.draft, extras: [...edit.draft.extras, newExtra("overhead")] })}>
                    <Plus className="h-3.5 w-3.5" />
                    Add charge
                  </Button>
                </td>
              </tr>
            ) : null}

            {ctBand("Terms", `Margin ${edit ? Number(edit.draft.header.margin_pct) || 0 : model.terms.margin}%`, undefined, "terms")}
            {ctTerm(`Buyer target ${ccy || "FOB"}`, "buyer_target_price", model.targetPrice)}
            {ctTerm("Margin %", "margin_pct", model.terms.margin, undefined, amt(s.margin))}
            {ctTerm(`Exchange ₹ / ${ccy || "FOB"}`, "exchange_rate", model.exchangeRate, edit?.rateNote)}
            {ctTerm("Commission %", "commission_pct", model.commissionPct, undefined, amt((s.net * model.commissionPct) / 100))}
            {ctTerm("LC discount %", "discount_pct", model.terms.discount, undefined, amt(s.discount, "−"))}
            {ctTerm(`Freight ${SYM} / pc`, "freight_per_pc", model.terms.freight)}
            {ctTerm(`Insurance ${SYM} / pc`, "insurance_per_pc", model.terms.insurance)}

            {ctBand(`Quoted price · ${ccy || "FOB"}`, "", undefined, "quote")}
            {model.sizes.flatMap((x, i) => {
              const sizeName = model.sizes.length > 1 ? `${x.label} · ` : "";
              const cur = i === idx && model.sizes.length > 1 ? "cur" : undefined;
              // 4 decimals: the exact figure the quote is rounded FROM (2026-10-17).
              const calcRow = (
                <tr key={`calc-${x.label}`} className={cur}>
                  <td className="dim">{sizeName}Calculated</td>
                  <td className="fig">{x.calc == null ? "—" : fx(x.calc, 4)}</td>
                  {liveAmounts ? <td className="fig amt" /> : null}
                  {actGap}
                </tr>
              );
              if (!edit) {
                return [
                  calcRow,
                  <tr key={`q-${x.label}`} className={cur}>
                    <td>{sizeName}Quoted</td>
                    <td className="fig">{offeredPrice(x.quoted, x.calc) == null ? "—" : fx(offeredPrice(x.quoted, x.calc) ?? 0, 2)}</td>
                    {liveAmounts ? <td className="fig amt" /> : null}
                  </tr>,
                ];
              }
              // A set quotes each piece: one Quoted cell per piece under the size's Calculated.
              return [
                calcRow,
                ...edit.draft.pieces.map((p) => {
                  const k = quoteKey(p.key, x.size);
                  return (
                    <tr key={k} data-grid-row className={cur}>
                      <td>
                        {sizeName}Quoted{multiPiece ? ` · ${p.piece_name || "piece"}` : ""}
                      </td>
                      <td className="in autoq">
                        {/* Blank follows Calculated, rounded to the cent (user 2026-10-22) — DRAWN
                            here, not as a placeholder: `hint()` blanks every placeholder in the app
                            (2026-10-15), so the figure never showed and the box read as empty
                            (screenshot 3672). Gone the moment a price is typed. A set carries only
                            its total Calculated, so a piece's box shows nothing. */}
                        {!multiPiece && x.calc != null && !(edit.draft.quotes[k] ?? "").trim() ? (
                          <span className="autoq-v" aria-hidden>
                            {(offeredPrice(null, x.calc) ?? 0).toFixed(2)}
                          </span>
                        ) : null}
                        <Ed
                          w="w-full"
                          label={`Quoted price${multiPiece ? ` ${p.piece_name || "piece"}` : ""} ${x.label}`}
                          value={edit.draft.quotes[k] ?? ""}
                          onChange={(v) => {
                            edit.onQuote?.(k);
                            edit.onChange({ ...edit.draft, quotes: { ...edit.draft.quotes, [k]: v } });
                          }}
                        />
                      </td>
                      {liveAmounts ? <td className="fig amt" /> : null}
                      {actGap}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      {edit ? <p className="cq-hint">Leave Quoted blank to quote the calculated price.</p> : null}
    </div>
  );

  /* THE RIGHT SIDE: nothing typed. One Price build table for every size — fabric down to
     the margin on the quote — then where the price goes, then the warnings. A size's
     header picks that size for the whole sheet. */
  const swatch = (t: Tone) => <i className="cq-sw" style={{ background: TONE_VAR[t] }} aria-hidden />;
  const pbRow = (label: ReactNode, pick: (x: SizeFigures) => ReactNode, cls?: string) => (
    <tr className={cls}>
      <td>{label}</td>
      {model.sizes.map((x, i) => (
        <td key={x.label} className={`r fig${i === idx ? " sel" : ""}`}>
          {pick(x)}
        </td>
      ))}
    </tr>
  );
  const pbHead = (t: string) => (
    <tr className="grp">
      <td colSpan={model.sizes.length + 1}>{t}</td>
    </tr>
  );
  const fiOf = (x: SizeFigures) => fobSteps(x, model.exchangeRate).fi;
  const anyDisc = model.sizes.some((x) => x.discount);
  /* liveAmounts (Costing 6, user 2026-10-22: "no need to show again in Price build"): Rejection,
     Overhead, Margin, Discount and Commission now read beside their own entries, so Price build
     keeps the build-up and the totals only. Commission rides inside priceAdj, so the Price
     charges row keeps just the rest (a typed price charge), and goes when that is nothing. */
  const commissionOf = (x: SizeFigures) => (liveAmounts ? (x.net * model.commissionPct) / 100 : 0);
  const otherAdj = (x: SizeFigures) => x.priceAdj - commissionOf(x);
  const anyAdj = model.sizes.some((x) => Math.abs(otherAdj(x)) >= 0.005);
  const anyExtra = model.sizes.some((x) => x.extraOverhead);
  const parts = shownParts(s, model.exchangeRate);
  const partsTotal = parts.reduce((a, p) => a + Math.max(p.value, 0), 0) || 1;
  /* COSTING 4's right side holds the Price build and nothing that repeats it (user 2026-10-21):
     no "Where the price goes" list (its six figures are the Price build's own — a thin bar
     under the heading keeps the split), no Total cost card (the table's own row), and
     Freight & insurance only when some size carries it. The warnings stay, each shown only
     when it has something to say. */
  const anyFi = model.sizes.some((x) => fiOf(x));
  /* "Sizes over buyer target" on ONE size is the "vs target" row above it said again, as a
     card of its own (user 2026-10-22, screenshot 104912) — compact screens count it only
     when there are sizes to count. */
  const kvTarget = target != null && (!narrowValues || model.sizes.length > 1);
  const showKv = !narrowValues || model.sizes.length > 1 || kvTarget || !!(thisRev && model.history.length > 1);
  const cqValues = (
    <aside className="cq-values" aria-label="Worked-out values">
      <div className="qt cq-pb">
        {/* Not on Costing 5 / 6 (chargesTable): "remove it, no need" (user 2026-10-22,
            screenshot 114104) — Price build already says where the price goes in figures. */}
        {narrowValues && !chargesTable ? (
          <div className="cq-bar" role="img" aria-label={`Where the price goes${model.sizes.length > 1 ? `, size ${s.label}` : ""}: ${parts.map((p) => `${p.label} ${((Math.max(p.value, 0) / partsTotal) * 100).toFixed(0)}%`).join(", ")}`}>
            {parts.map((p) => (
              <span key={p.label} title={`${p.label} · ${SYM} ${money(p.value)} · ${((Math.max(p.value, 0) / partsTotal) * 100).toFixed(0)}%`} style={{ width: `${(Math.max(p.value, 0) / partsTotal) * 100}%`, background: TONE_VAR[p.tone] }} />
            ))}
          </div>
        ) : null}
        <table aria-label="Price build per size">
          <thead>
            <tr className="cq-title" data-tone="margin">
              <th>
                Price build · {SYM} per {model.unitWord}
              </th>
              {model.sizes.map((x, i) => (
                <th key={x.label} className={`r fig${i === idx ? " sel" : ""}`}>
                  {model.sizes.length > 1 ? (
                    <button type="button" tabIndex={-1} className="cq-size" aria-current={i === idx ? "true" : undefined} title={`Show size ${x.label}`} onClick={() => onSize?.(i)}>
                      {x.label}
                    </button>
                  ) : (
                    SYM
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pbHead("Cost")}
            {pbRow(<>{swatch("fabric")}Fabric</>, (x) => money(x.fabric))}
            {pbRow(<>{swatch("cmt")}CMT</>, (x) => money(x.cmt))}
            {pbRow(<>{swatch("emb")}Process &amp; testing</>, (x) => money(x.process + x.testing))}
            {pbRow(<>{swatch("trims")}Trims</>, (x) => money(x.trims))}
            {pbRow(<>{swatch("over")}Bank charges</>, (x) => money(x.bank))}
            {model.sizes.some((x) => x.sample) ? pbRow(<>{swatch("over")}Sampling cost</>, (x) => money(x.sample)) : null}
            {pbRow("Factory base cost", (x) => money(x.net), "sum")}
            {liveAmounts ? null : pbRow(<>{swatch("over")}Rejection {model.terms.wastage}%</>, (x) => money(x.wastage))}
            {liveAmounts ? null : pbRow(<>{swatch("over")}Overhead {model.terms.overhead}%</>, (x) => money(x.overhead))}
            {anyExtra ? pbRow(<>{swatch("over")}Extra charges</>, (x) => money(x.extraOverhead)) : null}
            {pbRow("Total cost", (x) => money(x.grossCost), "sum")}
            {pbHead("Price")}
            {liveAmounts ? null : pbRow(<>{swatch("margin")}Margin {model.terms.margin}%</>, (x) => money(x.margin))}
            {anyDisc && !liveAmounts ? pbRow("Discount", (x) => `−${money(x.discount)}`) : null}
            {anyAdj ? pbRow("Price charges", (x) => money(otherAdj(x))) : null}
            {pbRow(`Selling price ${SYM}`, (x) => money(x.price), "sum")}
            {!narrowValues || anyFi ? pbRow("Freight & insurance", (x) => money(fiOf(x))) : null}
            {pbHead(`Quote · ${ccy || "FOB"}${model.exchangeRate != null ? ` at ₹ ${fx(model.exchangeRate)}` : ""}`)}
            {pbRow("Calculated FOB", (x) => (x.calc == null ? "—" : fx(x.calc, 4)))}
            {pbRow("Quoted FOB", (x) => { const q = offeredPrice(x.quoted, x.calc); return q == null ? "—" : fx(q, 2); }, "cur")}
            {target != null
              ? pbRow("vs target", (x) => {
                  const q = quotedOf(x);
                  const gap = q == null ? null : Math.round((q - target) * 100) / 100;
                  return gap == null ? "—" : <span className={gap > 0 ? "bad" : "good"}>{`${gap > 0 ? "+" : gap < 0 ? "−" : ""}${fx(Math.abs(gap), 2)}`}</span>;
                })
              : null}
            {pbRow("Margin on quote", (x) => (x.effectiveMarginPct == null ? "—" : <span className={marginTone(x.effectiveMarginPct)}>{x.effectiveMarginPct.toFixed(1)}%</span>), "sum")}
          </tbody>
        </table>
      </div>
      {narrowValues ? null : (
      <div className="qcard">
        <span className="cq-k">Where the price goes{model.sizes.length > 1 ? ` · ${s.label}` : ""}</span>
        <div className="cq-stack" aria-hidden>
          {parts.map((p) => (
            <span key={p.label} style={{ width: `${(Math.max(p.value, 0) / partsTotal) * 100}%`, background: TONE_VAR[p.tone] }} />
          ))}
        </div>
        <div className="cq-legend">
          {parts.map((p) => (
            <div key={p.label} className="cq-lg">
              {swatch(p.tone)}
              <span>{p.label}</span>
              <span className="r">
                {SYM} {money(p.value)}
              </span>
              <span className="r dim">{((Math.max(p.value, 0) / partsTotal) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
      )}
      {showKv ? (
      <dl className="qcard qkv">
        {model.sizes.length > 1 ? (
          <>
            <dt>Lowest margin</dt>
            <dd className={marginTone(model.sizes[lowestIdx]?.effectiveMarginPct ?? null)}>
              {model.sizes[lowestIdx]?.effectiveMarginPct == null ? "—" : `${model.sizes[lowestIdx].effectiveMarginPct!.toFixed(1)}% (${model.sizes[lowestIdx].label})`}
            </dd>
          </>
        ) : null}
        {kvTarget ? (
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
        {narrowValues ? null : (
          <>
            <dt>Total cost{model.sizes.length > 1 ? ` · ${s.label}` : ""}</dt>
            <dd>
              {SYM} {money(s.grossCost)}
            </dd>
          </>
        )}
      </dl>
      ) : null}
    </aside>
  );
  const cqBanner =
    model.status === "rejected" && model.decisionRemark ? (
      <div className="banner">
        <b>Sent back for rework:</b> {model.decisionRemark}
      </div>
    ) : null;
  const cqWork = (
        <div className="cq-work">
          {opsRow ? (
            <>
              {/* Costing 4: Costing 1's three tables in one row, then Overheads | Terms | Quoted price. */}
              {chargesTable ? (
                /* Costing 5 (user 2026-10-21): the one charges table sits BESIDE Trims, in the
                   same row — processes / CMT | Trims | Overheads, terms & quote. */
                <div className="cq-withcharges">
                  <div className={opsStack ? "cq-row3 cq-opstack" : "cq-row3"}>{secTri}</div>
                  {cqOneTable}
                </div>
              ) : (
                <div className={opsStack ? "cq-row3 cq-opstack" : "cq-row3"}>{secTri}</div>
              )}
              {chargesTable ? null : (
                <div className="cq-row2">
                  {cqOver}
                  {cqTerms}
                  {cqQuote}
                </div>
              )}
            </>
          ) : (
            <>
              {cqOps}
              {secTrims}
              {chargesTable ? (
                cqOneTable
              ) : (
                <>
                  {cqOver}
                  {cqTerms}
                  {cqQuote}
                </>
              )}
            </>
          )}
        </div>
  );
  const secCostQuote = (
    <section className="cq" aria-label="Cost and quote">
      {cqBanner}
      <div className={narrowValues ? "cq-split cq-narrow" : "cq-split"}>
        {cqWork}
        {cqValues}
      </div>
    </section>
  );
  /* The tab bar's end (user 2026-10-21, screenshot 115349): the FOB, its rupees and the
     margin. A CARD the height of a tab (user 2026-10-22: "better alignment, eye catch but
     compact") — label over the figure on the left, margin chip over the rupees on the
     right, its top edge in the margin's own colour so the verdict reads at a glance. */
  const tabFob = (
    <div className="cq-fob" data-tone={eff == null ? undefined : marginTone(eff)} aria-label="Quoted FOB">
      <div className="cq-fob-main">
        <span className="cq-k">
          Quoted FOB{model.sizes.length > 1 ? ` · ${s.label}` : ""}
        </span>
        <b className={fobShown == null ? "nil" : undefined}>{fobShown == null ? "—" : `${ccy} ${fx(fobShown, 2)}`.trim()}</b>
      </div>
      <div className="cq-fob-side">
        <span className={`cq-chip ${marginTone(eff)}`} title={`Floor ${FLOOR_PCT}% · target ${MARGIN_TARGET_PCT}%`}>
          Margin {eff == null ? "—" : `${eff.toFixed(1)}%`}
        </span>
        {ccy && ccy !== "INR" && fobInr != null ? (
          <span className="dim" title={`The costing's own rate: ₹ ${fx(model.exchangeRate ?? 0)} per ${ccy}`}>
            ₹ {fx(fobInr)}
            {model.exchangeRate != null ? ` @ ${fx(model.exchangeRate)}` : ""}
          </span>
        ) : null}
      </div>
      {/* SHOW IN ANOTHER CURRENCY (user 2026-10-22): pick EUR and today's EUR rate is
          fetched, the quote is shown in EUR at that rate — and the whole sheet with it,
          the existing "Sheet in …" view. A view only; the costing's own currency and
          rate are untouched. Blank goes back to rupees. */}
      {(() => {
        const alts = show.codes.filter((c) => c !== "INR" && c !== show.quoted);
        if (!alts.length) return null;
        const alt = show.code !== "INR" && show.code !== show.quoted ? show.code : "";
        const altRate = alt ? (show.today?.rate ?? (cur?.code === alt ? cur.rate : null)) : null;
        const altFob = altRate && fobInr != null ? fobInr / altRate : null;
        return (
          <div className="cq-fob-alt">
            <select
              className="cq-fob-ccy"
              aria-label="Show the quote in"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              value={alt}
              onChange={(e) => show.onPick(e.target.value || "INR")}
            >
              <option value="">Show in…</option>
              {alts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {alt ? (
              show.waiting ? (
                <span className="dim">fetching today&rsquo;s rate…</span>
              ) : altFob != null && altRate ? (
                <>
                  <b className="cq-fob-altv">{`${alt} ${fx(altFob, 2)}`}</b>
                  <span
                    className="dim"
                    title={show.today ? `${show.today.source}${show.today.date ? `, ${fmtDate(show.today.date)}` : ""}` : "The Quotes / Orders register's rate"}
                  >
                    ₹ {fx(altRate)} / {alt} {show.today ? "today" : ""}
                  </span>
                </>
              ) : (
                <span className="dim" title={show.failed ?? undefined}>
                  {show.failed ? "rate unavailable" : fobInr == null ? "no price yet" : "—"}
                </span>
              )
            ) : null}
          </div>
        );
      })()}
    </div>
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

  /* IN THE EDITOR the fields above already ask SMP Number, Style, Date and Currency, and the line
     under them names the buyer, season and unit — so the grid drops those rows there
     (user 2026-10-17, screenshot 3587: a second DATE box under Costing Date, beside an
     empty one). A column left with no rows is not drawn: an empty bordered box reads as
     a field nobody filled. The report and print keep every row. */
  const inEditor = !!edit?.details;
  const specCol = (rows: readonly (readonly [string, string | null, boolean?])[]) => {
    const shown = rows.filter(([, v, editorHas]) => v && !(inEditor && editorHas));
    return shown.length ? (
      <dl className="spec">
        {shown.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    ) : null;
  };
  const specLeft = specCol([
    ["Buyer / importer", model.customer, true],
    ["SMP Number", model.enquiryNo, true],
    ["Style", model.style && model.description && model.style !== model.description ? model.style : null, true],
    ["Fabric", model.fabricFacts.structure],
    ["GSM / counts", model.fabricFacts.gsm],
    ["Composition", model.fabricFacts.composition],
  ]);
  const specRight = specCol([
    ["Date", model.date ? fmtDate(model.date) : null, true],
    ["Season", model.season, true],
    // Not on the Details tab (user 2026-10-17): Ship Mode is set on the Quotation tab. Print keeps it.
    ["Ship", view === "report" ? model.shipMode : null],
    ["Unit", model.isSet ? "SET" : null, true],
    ["Currency", ccy ? `${ccy}${model.exchangeRate ? ` @ ₹ ${fx(model.exchangeRate)}` : ""}` : null, true],
    ["Size group", model.sizeGroup],
    ["Pieces", model.pieceCount > 1 ? String(model.pieceCount) : null],
  ]);
  const specGrid =
    specLeft || specRight ? (
      <div className={view === "report" ? "hdr-grid" : "hdr-grid inline"}>
        {specLeft}
        {specRight}
      </div>
    ) : null;

  /* The merged Fabric tab's body — on the tab, and as the Fabric section of onePage. */
  const fabPane = (
    <div className={fabricAlign ? "cq-fab cq-fab-aligned" : "cq-fab"}>
      {/* fabricAlign: Size-wise over both tables, so their titles share one line. */}
      {fabricAlign && edit?.sizes ? <div className="cq-fabTop">{edit.sizes}</div> : null}
      <div className="cq-fabL">
        {fabricAlign ? null : edit?.sizes}
        {secConsumption}
      </div>
      <div className="cq-fabR">{secFabric}</div>
    </div>
  );
  /* The Details tab's body — the style photo beside the sample, style and fabric facts. */
  const detPane = (
    <div className="detrow">
      <div className="min-w-0">
        {edit?.details}
        {specGrid}
      </div>
      {photoRail}
    </div>
  );

  /* `tone` — the cost colour a tab's card is topped in (Option B, 2026-10-16), the
     same `--cs-*` family as the section bars inside it. A tab that is not one cost
     takes none and stays neutral. No line under the label (user 2026-10-22): the
     tab is its name alone — the figures it used to repeat are inside the tab. */
  const tabDefs: { label: string; tone?: string }[] = merged
    ? [
        // Every tab its own colour (user 2026-10-22, screenshot 113620: blue and green are fine,
        // "the grey for the remaining" was dull). Taken from the sheet's own palette, so no new
        // colour enters the page: Details amber, Revisions purple, Charts rose.
        { label: "Details", tone: "trims" },
        { label: "Fabric", tone: "fabric" },
        { label: "Cost & Quote", tone: "margin" },
        { label: "Revisions", tone: "over" },
        { label: "Charts", tone: "emb" },
      ]
    : [
    { label: "Details" },
    { label: "Fabric", tone: "fabric" },
    { label: "Operations & trims", tone: "cmt" },
    { label: "Cost & overheads", tone: "over" },
    { label: "Quotation", tone: "margin" },
    { label: "Revisions" },
    { label: "Charts" },
  ];
  /** The tab that closes the document (its footer), and the Revisions / Charts tabs, by layout. */
  const quoteTab = merged ? 2 : 4;
  const historyTab = merged ? 3 : 5;
  const chartsTab = merged ? 4 : 6;
  /** onePage: Revisions and Charts, folded closed under the page's last section. */
  const opRevisions =
      model.history.length > 0 ? (
        <details id="cs-op-revisions" className="op-sec op-fold">
          <summary data-tone="over">
            Revisions <span>{model.history.length} on record</span>
          </summary>
          <div className="tpanel">{secHistory}</div>
        </details>
      ) : null;
  const opFolds = (
    <>
      {opRevisions}
      <details id="cs-op-charts" className="op-sec op-fold" onToggle={(e) => setChartsOpen(e.currentTarget.open)}>
        <summary data-tone="emb">
          Charts <span>where the money goes{model.sizes.length > 1 ? ", per size" : ""}</span>
        </summary>
        {chartsOpen ? (
          <div className="tpanel">
            <CostCharts model={model} s={s} idx={idx} onSize={onSize} rows={wfRows} money={money} SYM={SYM} ccy={ccy} />
          </div>
        ) : null}
      </details>
    </>
  );
  /** onePage's jump bar: the sections in page order; a closed fold opens on arrival. */
  const jumpDefs: { id: string; label: string; tone: string }[] = [
    { id: "cs-op-details", label: "Details", tone: "trims" },
    { id: "cs-op-fabric", label: "Fabric", tone: "fabric" },
    ...(merged
      ? [{ id: "cs-op-cost", label: "Cost & Quote", tone: "margin" }]
      : [
          { id: "cs-op-ops", label: "Operations & trims", tone: "cmt" },
          { id: "cs-op-over", label: "Cost & overheads", tone: "over" },
          { id: "cs-op-quote", label: "Quotation", tone: "margin" },
        ]),
    ...(model.history.length > 0 ? [{ id: "cs-op-revisions", label: "Revisions", tone: "over" }] : []),
    { id: "cs-op-charts", label: "Charts", tone: "emb" },
  ];
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (tab + (e.key === "ArrowRight" ? 1 : tabDefs.length - 1)) % tabDefs.length;
    setTab(n);
    document.getElementById(`cs-tab-${n}`)?.focus();
  };
  /* ENTER OFF A TAB'S LAST FIELD OPENS THE NEXT TAB (client 2026-10-22, Sample
     Costing ▸ Details: "intha page kkum next field venum"). Only one panel is
     mounted, so Currency read as the LAST field of the whole costing and Enter
     went to Save. This is a hand-rolled strip, not `Tabs`, so it publishes the
     same edge `Tabs` does (`registerContentEdge`) — Enter, Tab and Shift+Tab
     then cross tabs exactly as on Sample Entry. Only the tabs that hold fields
     take part: Revisions and Charts have nothing to land on, so off the last
     field tab the edge declines and the save ladder runs. */
  const panelRef = useRef<HTMLDivElement>(null);
  const landingRef = useRef<"first" | "last" | null>(null);
  const fieldTabs = tabDefs.flatMap((t, i) => (t.id === "cs-op-revisions" || t.id === "cs-op-charts" ? [] : [i]));
  const tabNavRef = useRef({ tab, fieldTabs, setTab });
  useEffect(() => {
    tabNavRef.current = { tab, fieldTabs, setTab };
  });
  const tabbed = view === "tabs" && !onePage && !!editIn;
  useEffect(() => {
    if (!tabbed) return;
    return registerContentEdge(panelRef.current, (dir) => {
      const nav = tabNavRef.current;
      const at = nav.fieldTabs.indexOf(nav.tab);
      const next = at === -1 ? undefined : nav.fieldTabs[at + dir];
      if (next === undefined) return false;
      landingRef.current = dir === 1 ? "first" : "last";
      nav.setTab(next);
      return true;
    });
  }, [tabbed]);
  // Land in the panel the hand-off just opened — same commit as the switch.
  useEffect(() => {
    const land = landingRef.current;
    if (!land) return;
    landingRef.current = null;
    if (land === "last") focusLastField(panelRef.current);
    else focusFirstField(panelRef.current);
  }, [tab]);

  return (
    <article className={chargesTable ? "cs-sheet cs-qtlook" : "cs-sheet"}>
      <style>{CSS}</style>
      {/* THE LETTERHEAD — OPTION B of the "Costing Report Header" mock-ups (user
          2026-10-16: "Option B is okay"). A white letterhead under the four-colour
          brand stripe the order reports carry (`SheetMasthead`), the document's
          number and status beside the company, the style as the title, and ONE
          coloured card for the figure the reader came for: the FOB, its rupees, the
          rate and the margin. ON SCREEN AND ON PAPER — the old `.mast` letterhead was
          print-only and the screen got a bare bar. The facts band under it replaces
          the header chips; every fact prints only when the costing has it. */}
      <header className="lh" data-screen-hide={letterhead ? undefined : ""}>
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
            {/* ON SCREEN the "Sample Cost Sheet" word and the style · buyer line are gone
                (user 2026-10-17, screenshot 3585: "the titles no need") — the tab bar
                already says what this is, and Details carries the style and the buyer.
                PAPER keeps both: a printout has no tab bar to name the document. */}
            <div className="lh-title">
              {view === "report" ? <span className="lh-kind">Sample Cost Sheet</span> : null}
              <span className="lh-no">
                {model.costingNo ?? "—"} · {model.revision}
              </span>
              <span className={`pill ${stateClass}`}>{model.statusLabel}</span>
            </div>
            {view === "report" ? (
              <h2 className="lh-style">
                {model.description || model.style || "—"}
                {model.customer ? <span> · {model.customer}</span> : null}
              </h2>
            ) : null}
          </div>
          {/* COMPACT (user 2026-10-17): five stacked lines became three — the margin chip
              shares the label's line, and rupees + rate share one muted line whose ₹ and
              @ say what the dropped words "Rupees" / "Exchange rate" did. */}
          <div className="lh-card" data-tone={effTone ?? undefined}>
            <span className="top">
              <span className="k">
                {s.quoted != null ? "Quoted" : "Calculated"} FOB / {model.unitWord}
                {model.sizes.length > 1 ? ` · ${s.label}` : ""}
              </span>
              {eff != null ? (
                <span className="marg" data-tone={effTone ?? undefined}>
                  Margin {eff.toFixed(1)}%
                </span>
              ) : null}
            </span>
            {/* COMPACT (user 2026-10-17): the price and its rupees share one line. */}
            <span className="mid">
              <span className="big">{fobShown == null ? "—" : `${ccy} ${fx(fobShown, 2)}`.trim()}</span>
              {ccy && ccy !== "INR" && (fobInr != null || model.exchangeRate != null) ? (
                <span className="row">
                  {fobInr != null ? <b>₹ {fx(fobInr)}</b> : null}
                  {fobInr != null && model.exchangeRate != null ? <span aria-hidden> · </span> : null}
                  {model.exchangeRate != null ? <span title="Exchange rate">@ {fx(model.exchangeRate)}</span> : null}
                </span>
              ) : null}
            </span>
            {/* THE MARGIN METER (user 2026-10-17: "inside this card … a magic kind of
                thing, the user will get happy"). The margin as a bar on the 0 → 30%
                scale with the floor and target zones, the target as a tick, and one
                sentence saying where it stands. The bar sweeps in when the card opens,
                and a margin that clears the target gets a single shine across the card:
                the reward is the figure being right. Paper and reduced-motion get it
                still. */}
            {eff != null && effTone ? (
              <span
                className="lh-meter"
                style={{
                  ["--m" as string]: `${(Math.max(0, Math.min(eff, GAUGE_MAX)) / GAUGE_MAX) * 100}%`,
                  ["--f" as string]: `${(FLOOR_PCT / GAUGE_MAX) * 100}%`,
                  ["--t" as string]: `${(MARGIN_TARGET_PCT / GAUGE_MAX) * 100}%`,
                }}
              >
                <span className="bar" aria-hidden>
                  <i className="fill" />
                  <i className="tick" />
                </span>
                {/* Short, beside the bar (compact, user 2026-10-17); the full sentence is the tooltip. */}
                <span
                  className="say"
                  title={
                    effTone === "good"
                      ? `${(eff - MARGIN_TARGET_PCT).toFixed(1)} pts above the ${MARGIN_TARGET_PCT}% target`
                      : effTone === "warn"
                        ? `${(MARGIN_TARGET_PCT - eff).toFixed(1)} pts short of the ${MARGIN_TARGET_PCT}% target`
                        : `Under the ${FLOOR_PCT}% floor`
                  }
                >
                  {effTone === "good"
                    ? `✓ +${(eff - MARGIN_TARGET_PCT).toFixed(1)} vs ${MARGIN_TARGET_PCT}%`
                    : effTone === "warn"
                      ? `−${(MARGIN_TARGET_PCT - eff).toFixed(1)} vs ${MARGIN_TARGET_PCT}%`
                      : `under ${FLOOR_PCT}%`}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        {/* The facts strip that sat here (SMP No · Style · Season · Fabric · Ship · Date)
            repeated the Details grid word for word (user 2026-10-17, screenshot 3583:
            "remove this one this duplicated"). Season, Ship and Unit lived only in the
            strip, so they moved into the Details grid rather than being lost. */}
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
            status and style are above; season, ship and date are in the Details grid
            (2026-10-17), so the bar that repeated them is gone. What is left is the one line the letterhead
            does not say — who approved it — and the full spec grid when printing. */}
        {/* A muted line (Draft, Superseded) only repeats the status pill — dropped. So
            does the warn line's headline: "Under Progress — with the buyer since …" is the
            pill again (user 2026-10-17, "remove"); only its below-floor margin warning,
            when there is one, says something the pill does not. */}
        {(model.approval.tone !== "muted" && (model.approval.tone !== "warn" || model.approval.detail)) || view === "report" ? (
          <section className="blk hdrblk" aria-label="Header">
            {model.approval.tone === "warn" && model.approval.detail ? (
              <div className="apv" data-tone="warn">
                <b>{model.approval.detail}</b>
              </div>
            ) : model.approval.tone !== "muted" && model.approval.tone !== "warn" ? (
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
        {/* ONE PAGE (Costing 6, user 2026-10-22): the tabs' sections stacked, a jump bar in
            the tab bar's place. The FOB card rides the bar's end, so the price stays on
            screen down the whole page; Price build is still sticky beside Cost & Quote. */}
        {onePage ? (
          <div className={merged ? "op-page" : "op-page op-report"}>
            {merged ? (
            <nav className="ctabs op-jump" aria-label="Jump to section">
              {jumpDefs.map((j) => (
                <button key={j.id} type="button" className="ctab" data-tone={j.tone} onClick={() => jumpTo(j.id)}>
                  <span>{j.label}</span>
                </button>
              ))}
              {/* The merged layout's FOB card; the report's letterhead already carries one. */}
              {tabFob}
            </nav>
            ) : null}
            {merged ? (
              <>
                <section id="cs-op-details" className="op-sec tpanel" aria-label="Details">
                  {detPane}
                </section>
                <section id="cs-op-fabric" className="op-sec tpanel cq-panel" aria-label="Fabric">
                  {fabPane}
                </section>
                <div id="cs-op-cost" className="op-sec tpanel cq-panel">
                  {secCostQuote}
                </div>
                {opFolds}
              </>
            ) : (
              <>
                {/* THE REPORT ON ONE SCREEN AT 100% (user 2026-10-22, artifact "Cost Sheet Fit"):
                    one header line in place of the letterhead, the tab bar and the Details row;
                    three rows of tables, each table as wide as its content; a 220px rail beside
                    them — photo, the FOB with its meter, the Quote, the totals. */}
                <header className="op-hd" aria-label="Costing">
                  <div className="op-who">
                    {model.company.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={model.company.logo} alt="" className="op-logo" />
                    ) : (
                      <span className="op-mark" aria-hidden>
                        {(model.company.name ?? "R").trim().slice(0, 1)}
                      </span>
                    )}
                    <div className="min0">
                      <b>{model.company.name ?? "Raagam Exports"}</b>
                      <span className="op-no">
                        {model.costingNo ?? "—"} · {model.revision}
                      </span>
                    </div>
                    <span className={`pill ${stateClass}`}>{model.statusLabel}</span>
                  </div>
                  <div className="op-facts">{specGrid}</div>
                  <div className="op-links">
                    {model.history.length > 0 ? (
                      <button type="button" onClick={() => jumpTo("cs-op-revisions")}>
                        Revisions
                      </button>
                    ) : null}
                  </div>
                </header>
                {chartsOnly ? (
                  <div className="tpanel op-charts">
                    <CostCharts model={model} s={s} idx={idx} onSize={onSize} rows={wfRows} money={money} SYM={SYM} ccy={ccy} />
                  </div>
                ) : (
                <div className="op-body">
                  <div className="op-main">
                    {cqBanner}
                    <div id="cs-op-fabric" className="op-sec op-row">
                      {secConsumption}
                      {secFabric}
                    </div>
                    <div id="cs-op-ops" className="op-sec op-row">
                      {secTri}
                    </div>
                    <div id="cs-op-cost" className="op-sec op-row op-cost">
                      {secGarment}
                      {qTerms}
                      {qBuild}
                    </div>
                    {opRevisions}
                  </div>
                  <div className="op-rail">
                    {photoRail}
                    {qFob}
                    {qQuote}
                    {qKv}
                  </div>
                </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {view === "tabs" && !onePage ? (
          <>
            <div className="ctabs" role="tablist" aria-label="Report sections" onKeyDown={onTabKey}>
              {tabDefs.map((t, i) => (
                <button key={t.label} type="button" role="tab" id={`cs-tab-${i}`} aria-selected={tab === i} aria-controls="cs-tabpanel" tabIndex={tab === i ? 0 : -1} className="ctab" data-tone={t.tone} onClick={() => setTab(i)}>
                  <span>{t.label}</span>
                </button>
              ))}
              {merged && tab === 2 ? tabFob : null}
            </div>
            <div ref={panelRef} className={merged && (tab === 1 || tab === 2) ? "tpanel cq-panel" : "tpanel"} role="tabpanel" id="cs-tabpanel" aria-labelledby={`cs-tab-${tab}`}>
              {/* THE STYLE PHOTO IS ON DETAILS (user 2026-10-17: "the fabric picture field move
                  to the details tab"), beside the sample, style and fabric facts it shows;
                  the Fabric tab gives Component consumption the whole row. */}
              {tab === 0 ? detPane : null}
              {/* THE FABRIC TAB SPLIT (Costing 3, user 2026-10-21, artifact "Costing 3 Fabric
                  Split"): Size-Wise and Component consumption on the left, hugging their
                  columns; Fabric processing cost on the right, in the half that stood empty. */}
              {merged && tab === 1 ? fabPane : null}
              {!merged && tab === 1 ? (
                <>
                  {edit?.sizes}
                  {/* ONE COLUMN, ONE WIDTH (user 2026-10-17, screenshot 3607: "in report we align
                      these two sections into one — can't we in cost entry"). Both sections
                      take the stack's width, so their edges and header bars line up the way
                      the report's do. */}
                  <div className={edit ? "fabstack" : undefined}>
                    {secConsumption}
                    {secFabric}
                  </div>
                </>
              ) : null}
              {merged && tab === 2 ? secCostQuote : null}
              {!merged && tab === 2 ? secTri : null}
              {!merged && tab === 3 ? secGarment : null}
              {!merged && tab === 4 ? (
                <>
                  {edit?.terms}
                  {secCommercial}
                </>
              ) : null}
              {tab === historyTab ? secHistory : null}
              {/* CHARTS IS A TAB, NOT A VIEW (user 2026-10-15: "Charts is one of the tabs
                  after Revisions — remove Tabs and Charts from the top, Tabs is default"). */}
              {tab === chartsTab ? (
                <CostCharts model={model} s={s} idx={idx} onSize={onSize} rows={wfRows} money={money} SYM={SYM} ccy={ccy} />
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
      {view !== "tabs" || onePage || tab === quoteTab ? (
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
 * THE TILES, THEN THREE STACKED COLUMNS (user 2026-10-17, screenshot 3584: the
 * old rows left a blank pane under the short cards — "plan it based like hr
 * profile tab alignment"; then "the chart went bottom … i need it in top"). Each
 * column is a stack of its own, as on `person-profile-view.tsx`, so no column
 * waits on another's height and nothing sits over empty space — but the CHARTS
 * lead, and the stacks are balanced to one height so the tab fits a screen:
 *  - How the price is built (one bar per step, all from the left edge);
 *  - Where the price goes (THE APPROVAL'S `GlassRing`, not a copy) · Price
 *    across revisions (see `revInC` for when it moves);
 *  - Cost by size — a size row is a button that switches the whole sheet's size.
 *    (Margin vs target and Fabric rate per kg were removed 2026-10-17.)
 *
 * NO TILE ROW, NO "THIS QUOTATION" CARD (user 2026-10-17, screenshot 3586: "fit
 * the screen … remove duplicated or least used section"). Every tile repeated a
 * chart — FOB and gross cost are build-up rows, margin is the ring's centre AND
 * the gauge, biggest cost is the ring's largest slice — and the quotation card
 * repeated the header (costing no, rev, status) and the Revisions tab. Its one
 * unique line, quoted vs buyer target, moved under the margin gauge.
 * Fabric rate and Price across revisions ALWAYS draw, saying why when they have
 * nothing to plot: a card that hid itself left the column a different shape on
 * every costing, and read as missing rather than empty.
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
const ZONE_TEXT: Record<Zone, string> = { good: "text-success", warn: "text-warning", bad: "text-danger" };
/** The gauge's right edge — a margin past 30% pins to it. */
const GAUGE_MAX = 30;

/** The two steps from the calculated rupee price to the FOB the header shows, both exact
 *  from the engine's own figures (`calc` = (price + freight + insurance) / rate):
 *  fi = freight & insurance = calc × rate − price; qa = the quote's difference =
 *  (quoted − calc) × rate. A step under half a paisa is no step. */
function fobSteps(x: SizeFigures, rate: number | null): { fi: number; qa: number; fob: number } {
  const ok = rate != null && rate > 0 && x.calc != null;
  const fi = ok ? x.calc! * rate! - x.price : 0;
  const qa = ok && x.quoted != null ? (x.quoted - x.calc!) * rate! : 0;
  const z = (v: number) => (Math.abs(v) < 0.005 ? 0 : v);
  return { fi: z(fi), qa: z(qa), fob: x.price + z(fi) + z(qa) };
}

/** `priceParts`, carried on to the header's FOB: freight joins Overheads and the quote's
 *  difference lands on Margin — so the ring, its legend and the size bars share one total. */
function shownParts(x: SizeFigures, rate: number | null) {
  const { fi, qa } = fobSteps(x, rate);
  return priceParts(x).map((p) =>
    p.tone === "over" ? { ...p, value: p.value + fi } : p.tone === "margin" ? { ...p, value: Math.max(p.value + qa, 0) } : p,
  );
}

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
}: {
  model: CostSheetModel;
  s: SizeFigures;
  idx: number;
  onSize?: (i: number) => void;
  rows: ChartRow[];
  money: (v: number | null | undefined) => string;
  SYM: string;
  ccy: string;
}) {
  const [hover, setHover] = useState<Tone | null>(null);
  const [pinned, setPinned] = useState<Tone | null>(null);
  const active = hover ?? pinned;
  const pick = (k: Tone) => setPinned((p) => (p === k ? null : k));
  const lift = (k: Tone | null) => (active ? (active === k ? " on" : " dim") : "");

  const eff = s.effectiveMarginPct;
  const zone = zoneOf(eff);
  const rate = model.exchangeRate;
  const parts = shownParts(s, rate);
  /** What every % on the tab is a share of — the FOB the header shows. */
  const base = fobSteps(s, rate).fob;
  const partTotal = parts.reduce((t, p) => t + p.value, 0) || 1;
  const pctOf = (v: number) => (v / partTotal) * 100;
  const maxShare = Math.max(1, ...parts.map((p) => pctOf(p.value)));
  const marginPart = parts.find((p) => p.tone === "margin");
  /* A PLAIN BAR CHART, NOT A FLOATING WATERFALL (user 2026-10-17: "need proper bar chart,
     now looks not clear, alignment in that bar"). Every bar starts at the left edge and is
     as long as its own rupees against the longest row, so the bars share one baseline and
     compare by length. Floating each step from the running total left small costs as
     slivers mid-track beside totals that restarted at zero. `start` is still computed by
     the caller and simply not drawn. */
  const scaleMax = Math.max(1, ...rows.map((r) => r.width));
  const focus = active ? parts.find((p) => p.tone === active) : null;

  const centre = focus
    ? { label: focus.label.replace("Embellishment & testing", "Emb. & test"), value: `${pctOf(focus.value).toFixed(1)}%`, sub: `${SYM} ${money(focus.value)}`, color: TONE_VAR[focus.tone] }
    : { label: "Margin", value: eff == null ? "—" : `${eff.toFixed(1)}%`, sub: marginPart ? `${SYM} ${money(marginPart.value)}` : "", tone: zone ? ZONE_TEXT[zone] : "" };

  /* WHICH STACK TAKES THE REVISION LINE (user 2026-10-17, screenshot 3590): under the
     ring, unless the third stack is the short one. Since the margin and fabric-rate cards
     left (same day) that stack holds only Cost by size, so it is short exactly when there
     is no size breakdown. */
  const revInC = model.sizes.length <= 1;
  const sizeMax = Math.max(1, ...model.sizes.map((x) => fobSteps(x, rate).fob));
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
      <div className="cg-cols">
        {/* 1 · the price story */}
        <div className="cg-col cg-a">
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
                      <span className="b cg-gloss" style={{ left: 0, width: `${Math.max((r.width / scaleMax) * 100, 0.6)}%`, backgroundColor: fill }} />
                    </span>
                    <span className={`a${r.value < 0 ? " neg" : ""}`}>
                      {r.value < 0 ? "−" : ""}
                      {money(r.width)}
                    </span>
                    <span className="p">{base ? `${((r.width / base) * 100).toFixed(1)}%` : ""}</span>
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
        </div>

        {/* 2 · where it goes, and how it moved */}
        <div className="cg-col cg-b">
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
          {/* 7 · PRICE ACROSS REVISIONS — under the ring, unless the third stack is the short one. */}
          {revInC ? null : <RevisionTrend hist={hist} ccy={ccy} />}
        </div>

        {/* 3 · the margin, the fabric and the sizes */}
        <div className="cg-col cg-c">
          {/* NO MARGIN VS TARGET, NO FABRIC RATE (client 2026-10-17): both cards are gone.
              The margin is the ring's centre and each size's tag below; a kilo's make-up is
              the Fabric tab's own working line (Yarn + Processes … + loss = ₹/kg). */}
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
                      title={`Size ${x.label}: ${SYM} ${money(fobSteps(x, rate).fob)}`}
                    >
                      <span className="n">{x.label}</span>
                      <span className="st" style={{ width: `${(fobSteps(x, rate).fob / sizeMax) * 100}%` }}>
                        {shownParts(x, rate).map((p) => (
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
          {revInC ? <RevisionTrend hist={hist} ccy={ccy} /> : null}
        </div>
      </div>
    </section>
  );
}

/** The quoted price per revision as a line, each point's margin printed under it in its zone colour. */
function RevisionTrend({ hist, ccy }: { hist: CostSheetModel["history"]; ccy: string }) {
  const pts = hist.filter((h) => h.price != null) as (CostSheetModel["history"][number] & { price: number })[];
  // Drawn even with nothing to plot (user 2026-10-17): a card that vanished read as missing.
  // ONE LINE, NOT A BLOCK (user 2026-10-17): still drawn, but a first revision's card was
  // a padded paragraph saying there was nothing to see — the tallest nothing on the tab.
  if (pts.length < 2) {
    return (
      <div className="cg-card cg-glass cg-thin">
        <div className="cg-cap">
          <h4>Price across revisions</h4>
          <span>{hist.length < 2 ? "first revision — nothing to compare yet" : "earlier revisions carry no price"}</span>
        </div>
      </div>
    );
  }
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
/* COSTING 5: the sheet sits inside the editor's own panel, so its outline was a second
   border just inside the first (user 2026-10-22, screenshot 105005: "border is enough"). */
.cs-sheet.cs-qtlook { border:0; border-radius:0; }
/* …and with no border of its own, its inner padding was only a gap: the tab strip stood
   ~40px under the panel's top edge (user 2026-10-22, screenshot 105456: "use this space,
   up the table"). The pad goes, and the sheet rises 12px into the editor pane's own 20px
   (MasterFullScreen's py-5, shared by every editor, so it is left alone) — 8px remains. */
.cs-sheet.cs-qtlook { margin-top:-12px; }
.cs-sheet.cs-qtlook > .pad { padding:0 0 12px; }
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
/* ON SCREEN, ONE LINE OF FACTS (user 2026-10-17, screenshot 3600: "compact this field,
   no need this much"): label · value pairs in a wrapping row, the shape of the
   Customer · Season · Description line above them. The printout keeps the boxes. */
.cs-sheet .hdr-grid.inline { display:flex; flex-wrap:wrap; gap:6px 28px; margin-top:4px; }
.cs-sheet .hdr-grid.inline .spec { display:contents; border:0; }
.cs-sheet .hdr-grid.inline .spec > div { display:flex; align-items:baseline; gap:8px; padding:0; border:0; min-width:0; }
.cs-sheet .hdr-grid.inline .spec dt { align-self:baseline; }
/* Table | 220px rail. A GRID on purpose: as a flex box it inherited .blk's column
   direction and the photo wrapped underneath. Under 900px the rail goes ABOVE the
   table as a short strip, so a phone never has the picture between it and Add fabric. */
.cs-sheet .fabblk { display:grid; grid-template-columns:minmax(0,max-content) 220px; gap:12px; align-items:start; }
.cs-sheet .fabblk > div { min-width:0; }
.cs-sheet .rail { display:flex; flex-direction:column; gap:10px; position:sticky; top:8px; }
.cs-sheet .rail .photo { min-height:0; }
.cs-sheet .rail .photo a { display:block; width:100%; }
/* CONTAIN, NEVER COVER (user 2026-10-17, screenshot 3622: an uploaded picture was cropped
   to a 4:3 box). The whole sketch or photo shows, scaled to fit the box. */
.cs-sheet .rail .photo img { width:100%; height:auto; max-height:240px; object-fit:contain; }
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

/* panels */
/* THREE INDEPENDENT STACKS, THE HR PROFILE'S RULE (person-profile-view.tsx), CHARTS
   ON TOP (user 2026-10-17: "the chart went bottom … i need it in top like plan …
   fitting into the screen"). Each column is a stack of its own, top-aligned, and the
   three are balanced to about one height — the build-up (~14 rows) against the ring +
   the revision line against the quote + margin + fabric — so the tab reads in one
   screen under the tiles. Narrower, the third stack goes full width under the two
   charts; a phone reads them in order. */
.cs-sheet .cg-cols { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,.95fr); grid-template-areas:"a b c"; gap:10px; align-items:start; }
.cs-sheet .cg-a { grid-area:a; } .cs-sheet .cg-b { grid-area:b; } .cs-sheet .cg-c { grid-area:c; }
@media (max-width:1180px){ .cs-sheet .cg-cols { grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-areas:"a b" "c c"; } }
@media (max-width:700px){ .cs-sheet .cg-cols { grid-template-columns:minmax(0,1fr); grid-template-areas:"a" "b" "c"; } }
.cs-sheet .cg-card { padding:10px 12px 12px; min-width:0; display:grid; gap:8px; align-content:start; }
.cs-sheet .cg-col { display:grid; gap:10px; align-content:start; min-width:0; }
.cs-sheet .cg-card.cg-thin { padding:8px 12px; }
.cs-sheet .cg-empty { margin:0; padding:14px 4px; text-align:center; font-size:12px; color:var(--cs-muted); }

.cs-sheet .cg-cap { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.cs-sheet .cg-cap h4 { margin:0; font-size:12.5px; font-weight:700; color:#13304a; }
.cs-sheet .cg-cap > span { font-size:11px; color:var(--cs-muted); }
.cs-sheet .cg button { font:inherit; color:inherit; }
.cs-sheet .cg button:focus-visible { outline:2px solid var(--cs-brand); outline-offset:1px; }

/* 2 · build-up */
.cs-sheet .cg-wf { display:grid; gap:1px; font-size:12.5px; }
.cs-sheet .cg-row { display:grid; grid-template-columns:150px minmax(0,1fr) 64px 44px; align-items:center; gap:8px; height:24px; padding:0 6px; border-radius:7px;
  border:0; background:transparent; text-align:left; cursor:pointer; transition:background-color .15s, opacity .2s; }
@media (max-width:560px){ .cs-sheet .cg-row { grid-template-columns:100px minmax(0,1fr) 56px; } .cs-sheet .cg-row .p { display:none; } }
.cs-sheet .cg-row:hover, .cs-sheet .cg-row.on { background:var(--glass-strong); }
.cs-sheet .cg-row .l { display:flex; gap:6px; align-items:center; min-width:0; font-weight:500; }
.cs-sheet .cg-row .l span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cs-sheet .cg-row .sw { width:8px; height:8px; border-radius:2px; flex:none; }
.cs-sheet .cg-row .tr { position:relative; height:14px; border-radius:4px; background:rgba(15,27,38,.045); }
.cs-sheet .cg-row .b { position:absolute; top:0; bottom:0; border-radius:4px; transition:left .45s cubic-bezier(.22,.8,.3,1), width .45s cubic-bezier(.22,.8,.3,1); }
.cs-sheet .cg-row .a { text-align:right; font-weight:600; font-variant-numeric:tabular-nums; } .cs-sheet .cg-row .a.neg { color:var(--cs-bad); }
.cs-sheet .cg-row .p { text-align:right; color:var(--cs-muted); font-size:11px; font-variant-numeric:tabular-nums; }
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
.cs-sheet .tpanel:has(> .cg) { width:auto; }
.cs-sheet .tpanel .tri > * { flex:1 1 auto; min-width:0; }
/* Fabric tab: row 1 is consumption + the photo; row 2 (.fabblk) is the processing table alone, full width. */
.cs-sheet .tpanel .fabblk { grid-template-columns:minmax(0,1fr); }
.cs-sheet .fabstack { width:min(100%, 54rem); display:flex; flex-direction:column; gap:14px; }
.cs-sheet .fabstack > .blk { width:100%; max-width:none; margin:0; }
/* …except Component consumption, whose table is exactly the sum of its columns (narrowed
   the same day, "why this much"): its card hugs that table, or the table stopped part-way
   across a wider card and left a white gap beside it (screenshot 2026-10-17 15:08). */
.cs-sheet .fabstack > .blk.cons { width:fit-content; max-width:100%; }
.cs-sheet .blk.cons .scroll table { table-layout:fixed; }
.cs-sheet .blk.cons td input { height:28px !important; font-size:12px; }
/* The grams box is DRAWN as a box, like the Component and Fabric pickers beside it — the
   sheet's borderless paper cell read as an empty, unfinished column (same day). */
.cs-sheet .blk.cons .scroll td:has(> input.cs-ed) { padding:3px 6px; }
.cs-sheet .blk.cons .scroll td > input.cs-ed { width:100%; border-color:revert-layer !important; border-radius:revert-layer !important; background:revert-layer !important; box-shadow:revert-layer !important; }
/* GRID WITH A DEFINITE TRACK, NOT A CONTENT-SIZED FLEX ITEM (user 2026-10-17, screenshot
   3622: Currency "updating continuously", jumping between the first and second row). The
   fields sit in a FieldRow, which is a size container (@container/section) and so has no
   width of its own: as a flex:0 1 auto item the column took its width from whatever
   else was in it — the facts line, a picker's chosen text — and the field row wrapped or
   unwrapped as that changed. Same trap as .fhead below. The track is DETAILS_W's 67rem,
   shrinking when the pane is narrower; the photo follows it, and goes under at 900px. */
.cs-sheet .detrow { display:grid; grid-template-columns:minmax(0,67rem) 230px; gap:16px; align-items:start; }
@media (max-width:900px){ .cs-sheet .detrow { grid-template-columns:minmax(0,1fr); } }
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
.cs-sheet .fhead input.cs-ed { box-shadow:inset 0 0 0 1px #cfd8e1 !important; background:#fff !important; }
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
.cs-sheet .qcol { display:flex; flex-direction:column; gap:12px; min-width:0; max-width:100%; }
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
.cs-sheet .qt td.in { padding:0; background:#fff; }
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
.cs-sheet .tpanel section[aria-label="Garment cost"] { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.1fr); gap:12px; align-items:start; }
/* OVERHEADS LEFT, GARMENT COST RIGHT (user 2026-10-17, screenshot 3624). The charges are
   what the operator types; the cost build is the read-only answer they feed. Moved by
   order, not in the markup, so the printout keeps its Garment cost first. Garment cost
   holds no field, so Tab order is unaffected. */
.cs-sheet .tpanel section[aria-label="Garment cost"] > details:nth-of-type(2) { order:-1; }
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
.cs-sheet .fband td.bandname.clickable { cursor:pointer; user-select:none; }
.cs-sheet .fband .bandhead { display:flex; align-items:center; gap:2px; }
.cs-sheet .fband .bandhead :is(input, select) { font-weight:700; }
.cs-sheet .fband .caret { flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; margin-left:4px; border-radius:4px; color:var(--cs-muted); transition:transform .15s; }
.cs-sheet .fband button.caret:hover { background:#e6edf3; }
.cs-sheet .fband tbody.is-open .caret { transform:rotate(90deg); }
.cs-sheet .fband .blend { display:block; padding-left:30px; font-size:11px; color:var(--cs-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .fband .toglabel { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--cs-muted); }
.cs-sheet .fband td.tog { text-align:left; }
.cs-sheet .fband .bandprice { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:13.5px; font-weight:700; color:#3f7d17; }
.cs-sheet .fband table.fbands { width:100%; }
.cs-sheet .fband th.c, .cs-sheet .fband td.tog { text-align:center; }
/* OPEN FABRIC, OPTION B (plan "Fabric Processing Layout", 2026-10-17): Yarn left,
   Processes right, each a table of only its own columns — no blank cells — and the
   working line across both. Below 900px the two stack. */
.cs-sheet .fband tr.fopen > td { padding:12px 12px 10px 30px; background:#f7f9fb; white-space:normal; }
.cs-sheet .fband .fsplit { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:12px; align-items:stretch; }
@media (max-width:900px) { .cs-sheet .fband .fsplit { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .fband .fpart { display:flex; flex-direction:column; gap:6px; min-width:0; padding:8px 10px 6px; background:#fff; border:1px solid var(--cs-rule); border-radius:8px; }
.cs-sheet .fband .fpart > .faddrow, .cs-sheet .fband .fpart > .fnote { margin-top:auto; }
.cs-sheet .fband .fnote { font-size:11px; color:var(--cs-muted); padding:2px 0; }
.cs-sheet .fband .fpart table.ftab { width:100%; }
.cs-sheet .fband .grp { display:flex; justify-content:space-between; align-items:baseline; font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:#037bb8; }
.cs-sheet .fband .grp.p { color:#8a6512; }
.cs-sheet .fband .grp .gsum { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12px; letter-spacing:0; text-transform:none; font-weight:600; color:var(--cs-ink); }
.cs-sheet .fband .fpart.p th { background:#fcf8ee; }
.cs-sheet .fband .work { margin-top:10px; padding:8px 10px; display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:4px; font-size:12px; color:var(--cs-muted); background:#fff; border:1px solid var(--cs-rule); border-radius:8px; }
.cs-sheet .fband .work b { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-weight:600; color:var(--cs-ink); }
.cs-sheet .fband .work .eq b { color:#3f7d17; }
.cs-sheet .fband .work .lossbox { width:3.5rem !important; height:24px !important; min-height:0 !important; padding:0 6px !important; font-size:12px !important; color:#037bb8; }
.cs-sheet .fempty { margin:0; padding:10px 0; font-size:12.5px; color:var(--cs-muted); }
@media (prefers-reduced-motion: reduce) { .cs-sheet .fband .caret { transition:none; } }

/* OPERATIONS & TRIMS, COMPACT (user 2026-10-15, screenshot 3551: "next compact the fields").
   Each table HUGS its columns instead of stretching across the tab: a section no longer
   grows to fill its row, a table is as wide as its headings say — name 200, figure 88,
   Pricing 250, Piece 120, actions 4.5rem — and the add line's boxes are 28px, cell-wide. */
.cs-sheet .tpanel .tri > * { flex:0 1 auto; }
.cs-sheet .tri .scroll table { width:auto; table-layout:fixed; }
/* ONE ROW (user 2026-10-17, screenshot 3610: "these three tables into a single row,
   compact the fields"). This REPLACES the same day's 3608 layout — Garment processes and
   CMT half-and-half over a full-width Trims — which spread three short tables over two
   rows of a wide tab. Each section hugs its own columns and the three sit side by side;
   they wrap only when the pane is too narrow to hold them. Narrower columns too: a name
   160, a figure 80, Trims' quantities 64. */
.cs-sheet .tpanel .tri { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; }
.cs-sheet .tpanel .tri > * { flex:0 0 auto; max-width:100%; }
.cs-sheet .tri th.c-name { width:160px; }
.cs-sheet .tri th.c-num { width:80px; }
.cs-sheet .tri th.c-tick { width:56px; text-align:center; white-space:normal; }
.cs-sheet .tri td.c { text-align:center; }
.cs-sheet .tri th.c-qty { width:64px; white-space:normal; }
.cs-sheet .tri th.c-piece { width:120px; }
.cs-sheet .tri tr.ready td { padding-top:2px; padding-bottom:2px; }
.cs-sheet .tri tr.ready :is(input, select) { height:28px !important; width:100%; min-width:0; }
/* THE ENTRY IN ONE ROW TOO (user 2026-10-17: "in cost entry … update it also in single
   row"). A cell's box follows its column: the rate box (Ed, w-24 = 96px) and a picker's
   own min-width made each column wider than its heading, so the three tables no longer
   fitted side by side while editing and wrapped. */
.cs-sheet .tpanel .tri td > * { min-width:0; max-width:100%; }
/* Not a checkbox (user 2026-10-17, screenshot 3613): stretched to the cell it became a
   56 x 28px tick on Trims' Direct Rate. A tick keeps its own 16px. */
.cs-sheet .tpanel .tri td :is(input:not([type="checkbox"]), select) { width:100% !important; min-width:0 !important; height:28px !important; font-size:12px; }
.cs-sheet .tpanel .tri td input[type="checkbox"] { width:16px; height:16px; margin:0; vertical-align:middle; }

/* The Quoted FOB card's "show in" pick, beside the price (2026-10-15). */
.cs-sheet .qbigrow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cs-sheet .qccy { height:28px; border:1px solid var(--cs-rule); border-radius:6px; background:#fff; padding:0 6px; font-size:12px; font-weight:700; color:#037bb8; cursor:pointer; }
.cs-sheet .qccy:focus-visible { outline:2px solid #037bb8; outline-offset:1px; }

/* ===== OPTION B — LETTERHEAD + PRICE CARD (user 2026-10-16, "Option B is okay";
   artifact "Costing Report Header"). On screen AND in print. The stripe is the order
   reports' own four colours (report-kit.tsx SheetMasthead); the card is the one block
   of strong colour, and it carries the price. ===== */
.cs-sheet .lh { background:#fff; border-bottom:1px solid var(--cs-rule); }
@media screen { .cs-sheet .lh[data-screen-hide] { display:none; } }
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
/* THE FOB CARD IS SETTLED, ITS TEXT IS BOLD (user 2026-10-17: "settle bg colour and the
   text should be bold"). It was a saturated blue gradient carrying pale-blue text at
   600–700 — the loudest block on the page, and its label and rupee line the hardest to
   read. Now the sheet's own light brand tint, a thin brand edge, and dark brand ink at
   700–800, so the price leads by weight rather than by a coloured slab. */
.cs-sheet .lh-card { background:var(--cs-brand-tint); color:var(--cs-brand-ink); border:1px solid #b9dff2; border-radius:12px; padding:8px 12px; min-width:220px; align-self:start; display:flex; flex-direction:column; gap:2px; }
.cs-sheet .lh-card .top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.cs-sheet .lh-card .k { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--cs-brand-ink); font-weight:800; opacity:.8; }
.cs-sheet .lh-card .big { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:22px; font-weight:800; line-height:1.15; color:var(--cs-brand-ink); }
.cs-sheet .lh-card .row { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:12px; color:var(--cs-ink); font-weight:700; white-space:nowrap; }
.cs-sheet .lh-card .row b { color:var(--cs-ink); font-weight:800; }
.cs-sheet .lh-card .marg { flex:none; font-size:11.5px; font-weight:800; color:var(--cs-good); background:var(--cs-good-tint); border:1px solid #bfe3cc; padding:1px 8px; border-radius:999px; }
.cs-sheet .lh-card .marg[data-tone="warn"] { color:var(--cs-warn); background:var(--cs-warn-tint); border-color:#f0d9a8; }
.cs-sheet .lh-card .marg[data-tone="bad"] { color:var(--cs-bad); background:var(--cs-bad-tint); border-color:#f2c6c0; }
/* the margin meter */
.cs-sheet .lh-card { position:relative; overflow:hidden; }
.cs-sheet .lh-card .mid { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.cs-sheet .lh-meter { display:flex; align-items:center; gap:8px; margin-top:3px; --c:var(--cs-good); }
.cs-sheet .lh-card[data-tone="warn"] .lh-meter { --c:var(--cs-warn); }
.cs-sheet .lh-card[data-tone="bad"] .lh-meter { --c:var(--cs-bad); }
.cs-sheet .lh-meter .bar { position:relative; display:block; flex:1; min-width:80px; height:5px; border-radius:999px; background:linear-gradient(90deg, #f6d4cf 0 var(--f), #f7e3b8 var(--f) var(--t), #cfeadb var(--t) 100%); }
.cs-sheet .lh-meter .fill { position:absolute; left:0; top:0; bottom:0; width:var(--m); border-radius:999px; background:var(--c); animation:lhGrow .9s cubic-bezier(.2,.8,.2,1) .15s both; }
.cs-sheet .lh-meter .tick { position:absolute; top:-3px; bottom:-3px; left:var(--t); width:2px; margin-left:-1px; border-radius:1px; background:var(--cs-brand-ink); opacity:.6; }
.cs-sheet .lh-meter .say { font-size:11px; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-weight:800; color:var(--c); white-space:nowrap; }
.cs-sheet .lh-card[data-tone="good"]::after { content:""; position:absolute; inset:0; pointer-events:none; background:linear-gradient(105deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%); transform:translateX(-110%); animation:lhShine 1.3s ease-out 1s 1 both; }
@keyframes lhGrow { from { width:0; } }
@keyframes lhShine { to { transform:translateX(110%); } }
@media (prefers-reduced-motion: reduce) { .cs-sheet .lh-meter .fill { animation:none; } .cs-sheet .lh-card[data-tone="good"]::after { display:none; } }
@media print { .cs-sheet .lh-meter .fill { animation:none; } .cs-sheet .lh-card[data-tone="good"]::after { display:none; } }
@media (max-width:640px) { .cs-sheet .lh-head { grid-template-columns:minmax(0,1fr); } .cs-sheet .lh-card { min-width:0; } }

/* Option B's TABS: small cards on a pale band, each topped in its cost colour
   (data-tone on the tab); the open one raised with a brand edge. */
.cs-sheet .ctab { --tone:var(--cs-rule); }
.cs-sheet .ctab[data-tone="fabric"] { --tone:var(--cs-fabric); } .cs-sheet .ctab[data-tone="cmt"] { --tone:var(--cs-cmt); }
.cs-sheet .ctab[data-tone="over"] { --tone:var(--cs-over); } .cs-sheet .ctab[data-tone="margin"] { --tone:var(--cs-margin); }
.cs-sheet .ctab[data-tone="trims"] { --tone:var(--cs-trims); } .cs-sheet .ctab[data-tone="emb"] { --tone:var(--cs-emb); }
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
/* COST & QUOTE — the merged split screen (Costing 3, 2026-10-21). Left: entry, one scroll.
   Right: values, pinned while the left scrolls; past a screen's height it scrolls itself. */
.cs-sheet .tpanel.cq-panel { width:auto; }
.cs-sheet .ctabs .cq-fob { --tone:var(--cs-rule); margin-left:auto; display:flex; align-items:center; gap:14px; padding:4px 12px 5px; background:#fff; border:1px solid var(--cs-rule); border-top:3px solid var(--tone); border-radius:8px; white-space:nowrap; }
.cs-sheet .cq-fob[data-tone="good"] { --tone:var(--cs-good); } .cs-sheet .cq-fob[data-tone="warn"] { --tone:var(--cs-warn); } .cs-sheet .cq-fob[data-tone="bad"] { --tone:var(--cs-bad); }
.cs-sheet .cq-fob-main { display:flex; flex-direction:column; line-height:1.15; }
.cs-sheet .cq-fob-side { display:flex; flex-direction:column; align-items:flex-end; gap:2px; padding-left:14px; border-left:1px solid var(--cs-rule); line-height:1.15; }
.cs-sheet .cq-k { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--cs-muted); }
.cs-sheet .cq-fob b { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:17px; font-weight:700; color:var(--cs-brand-ink); font-variant-numeric:tabular-nums; }
.cs-sheet .cq-fob b.nil { color:var(--cs-muted); font-weight:500; }
/* A blank Quoted box shows the rounded Calculated price AS the quote (user 2026-10-22) — full
   ink, not a faint hint, because that is the price the buyer is offered until one is typed. */
/* The rounded Calculated, drawn over an empty Quoted box (see the Quoted row): full ink,
   right-aligned like the box's own figures, and click-through so the box still takes focus. */
.cs-sheet td.autoq { position:relative; }
.cs-sheet td.autoq .autoq-v { position:absolute; right:14px; top:50%; transform:translateY(-50%); pointer-events:none; font-weight:600; font-variant-numeric:tabular-nums; color:var(--cs-ink); z-index:1; }
.cs-sheet .cq-fob-alt { display:flex; flex-direction:column; align-items:flex-start; gap:1px; padding-left:14px; border-left:1px solid var(--cs-rule); line-height:1.15; min-width:6.5rem; }
.cs-sheet .cq-fob-ccy { height:22px; padding:0 4px; border:1px solid var(--cs-rule); border-radius:6px; background:#fff; font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--cs-muted); cursor:pointer; }
.cs-sheet .cq-fob-ccy:focus-visible { outline:2px solid var(--cs-brand); outline-offset:1px; }
.cs-sheet .cq-fob .cq-fob-altv { font-size:14px; }
.cs-sheet .cq-fob .dim { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:11.5px; color:var(--cs-muted); }
.cs-sheet .cq-chip { font-size:12px; font-weight:700; padding:2px 9px; border-radius:999px; background:var(--cs-soft); font-variant-numeric:tabular-nums; }
.cs-sheet .cq-chip.good { background:var(--cs-good-tint); color:var(--cs-good); } .cs-sheet .cq-chip.warn { background:var(--cs-warn-tint); color:var(--cs-warn); } .cs-sheet .cq-chip.bad { background:var(--cs-bad-tint); color:var(--cs-bad); }
.cs-sheet .cq-split { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); gap:18px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .cq-split { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cq-work { display:flex; flex-direction:column; gap:14px; min-width:0; }
.cs-sheet .cq-values { display:flex; flex-direction:column; gap:12px; min-width:0; position:sticky; top:8px; max-height:calc(100vh - 16px); overflow:auto; }
@media (max-width:1100px){ .cs-sheet .cq-values { position:static; max-height:none; overflow:visible; } }
@media print { .cs-sheet .cq-values { position:static; max-height:none; overflow:visible; } }
.cs-sheet .cq-band { min-width:0; }
.cs-sheet summary.cq-fixed { cursor:default; list-style:none; }
.cs-sheet summary.cq-fixed::-webkit-details-marker { display:none; }
.cs-sheet summary.cq-fixed::marker { content:""; }
.cs-sheet summary[data-tone="margin"] { --tone:var(--cs-margin); --tint:#e5f4ea; --ink:#1f6b3e; }
/* One even grid of boxes: same width, labels on one line; a note under a box hangs in the row gap. */
.cs-sheet .cq-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:22px 14px; align-items:start; padding:10px 12px 14px; max-width:640px; }
.cs-sheet .cq-f { display:flex; flex-direction:column; gap:3px; position:relative; min-width:0; }
.cs-sheet .cq-l { font-size:11.5px; color:var(--cs-muted); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .cq-ro { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-weight:600; height:28px; display:flex; align-items:center; }
.cs-sheet .cq-note { position:absolute; top:100%; left:0; margin-top:2px; font-size:10.5px; line-height:1.3; color:var(--cs-muted); white-space:nowrap; }
.cs-sheet .cq-note button { font:inherit; font-weight:700; color:var(--cs-brand); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }
.cs-sheet .cq-type { height:28px; border-radius:6px; border:1px solid #037bb8; background:#fff; padding:0 6px; font-size:12px; font-weight:600; color:#0f1b26; }
.cs-sheet .cq-hint { font-size:12px; color:var(--cs-muted); margin:6px 12px 0; }
.cs-sheet .cq-qt { margin:10px 12px 0; }
/* Compact (user 2026-10-21, screenshot 172735: "compact all columns"): the Price build hugs
   its columns instead of stretching to the pane — at 100% every spare pixel went to the
   label column, leaving "Fabric" and its 0.00 a third of a screen apart. Labels size to the
   longest one, figures to 5rem. */
.cs-sheet .cq-pb { width:fit-content; max-width:100%; }
.cs-sheet .cq-pb table { width:auto; }
.cs-sheet .cq-pb tr > :first-child { width:auto; min-width:0; }
.cs-sheet .cq-pb :is(.fig, td.in) { width:5rem; min-width:5rem; max-width:none; }
.cs-sheet .cq-pb td .dim { color:var(--cs-muted); }
.cs-sheet .cq-size { font:inherit; font-weight:700; color:inherit; background:none; border:0; padding:2px 6px; border-radius:6px; cursor:pointer; }
.cs-sheet .cq-size:hover { color:var(--cs-brand); }
.cs-sheet .cq-size[aria-current="true"] { background:var(--cs-brand); color:#fff; }
.cs-sheet .cq-sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:6px; vertical-align:baseline; }
.cs-sheet .cq-stack { display:flex; height:12px; border-radius:6px; overflow:hidden; background:var(--cs-soft); }
.cs-sheet .cq-stack span { display:block; height:100%; }
.cs-sheet .cq-legend { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:3px 8px; font-size:12px; align-items:center; }
.cs-sheet .cq-lg { display:contents; }
.cs-sheet .cq-legend .r { text-align:right; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet .cq-legend .dim { color:var(--cs-muted); }
/* Costing 4 (user 2026-10-21): the values side is a quarter of the width, so everything in
   it is set tight — smaller type, slimmer cells, a label column that wraps rather than
   pushing the sizes off the edge. Below 1100px the split stacks as before. */
.cs-sheet .cq-split.cq-narrow { grid-template-columns:minmax(0,3fr) minmax(0,1fr); gap:14px; }
@media (max-width:1100px){ .cs-sheet .cq-split.cq-narrow { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cq-narrow .cq-values { gap:8px; }
.cs-sheet .cq-narrow .cq-pb table { font-size:11.5px; }
.cs-sheet .cq-narrow .cq-pb th { padding:4px 5px; font-size:11px; }
.cs-sheet .cq-narrow .cq-pb td { height:23px; padding:0 5px; }
.cs-sheet .cq-narrow .cq-pb tr > :first-child { min-width:0; white-space:normal; line-height:1.2; }
.cs-sheet .cq-narrow .cq-pb tr.grp td { height:20px; }
.cs-sheet .cq-narrow .cq-size { padding:1px 4px; }
.cs-sheet .cq-narrow .cq-sw { width:8px; height:8px; margin-right:4px; }
.cs-sheet .cq-narrow .qcard { padding:8px; gap:5px; }
.cs-sheet .cq-narrow .cq-legend { font-size:11px; gap:2px 6px; }
.cs-sheet .cq-narrow .qkv { font-size:11.5px; gap:3px 8px; }
.cs-sheet .cq-bar { display:flex; height:6px; background:var(--cs-soft); }
.cs-sheet .cq-bar span { display:block; height:100%; }
/* Costing 4 (user 2026-10-21): Overheads & charges | Terms | Quoted price in one row. Terms
   carries seven boxes (four to a line), Overheads three, the Quote a three-column table —
   so 3.2 : 4.3 : 3. A narrow pane stacks them. */
.cs-sheet .cq-row2 { display:grid; grid-template-columns:minmax(0,3.2fr) minmax(0,4.3fr) minmax(0,3fr); gap:12px; align-items:stretch; min-width:0; }
.cs-sheet .cq-row2 .cq-qt { margin:10px 10px 0; max-width:calc(100% - 20px); }
.cs-sheet .cq-row2 .cq-hint { margin:6px 10px 10px; }
.cs-sheet .cq-row2 summary[data-tone] { padding:7px 10px; letter-spacing:.03em; gap:8px; white-space:nowrap; }
/* Screenshot 3635: the Extra charge table scrolled sideways with Value cut off, and the
   Quote table lost its Quoted column — both carry column widths sized for a full-width
   band. In this row each table fills its box: the name column takes what the fixed
   figure columns leave, and every box is as wide as its cell. */
/* Rejection % · Overhead % · Bank charges ₹ on ONE line (user 2026-10-21): three even
   columns, tighter gaps — the auto-fill grid put Bank charges on a second line whenever the
   box was under ~380px. A second piece's Bank box wraps under them. */
.cs-sheet .cq-row2 .cq-over .cq-grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px 8px; }
/* Terms' seven boxes the same way (user 2026-10-21: "compact it too"): four even columns,
   tight gaps — Buyer target · Margin · Exchange · Commission, then LC discount · Freight ·
   Insurance. The row gap stays 22px: the exchange rate's source note hangs in it. */
.cs-sheet .cq-row2 .cq-terms .cq-grid { grid-template-columns:repeat(4,minmax(0,1fr)); gap:22px 8px; }
.cs-sheet .cq-row2 table.cq-extra { width:100%; table-layout:fixed; }
.cs-sheet .cq-row2 table.cq-extra th:nth-child(2) { width:5.75rem; }
.cs-sheet .cq-row2 table.cq-extra th:nth-child(3) { width:5rem; }
.cs-sheet .cq-row2 table.cq-extra th:nth-child(4) { width:1.75rem; }
.cs-sheet .cq-row2 table.cq-extra :is(th, td) { padding-left:4px; padding-right:4px; }
.cs-sheet .cq-row2 table.cq-extra td :is(input, select) { width:100% !important; min-width:0 !important; height:28px !important; }
.cs-sheet .cq-row2 .cq-qt { width:auto; }
.cs-sheet .cq-row2 .cq-qt table { width:100%; table-layout:fixed; }
.cs-sheet .cq-row2 .qt tr > :first-child { width:auto; min-width:0; }
.cs-sheet .cq-row2 .qt :is(.fig, td.in) { width:5.5rem; min-width:0; max-width:none; }
@media (max-width:900px){ .cs-sheet .cq-row2 { grid-template-columns:minmax(0,1fr); } }
/* chargesTable (Costing 5, user 2026-10-21, screenshot 3641: "like Price build"): the
   charges, terms and quote as one .qt table, Price build's own look — Item | Value, the
   Value column 7rem of right-aligned figures, every typed value a tinted cell (td.in). */
.cs-sheet .cq-onetable { min-width:0; margin:0; }
.cs-sheet .cq-onetable .qt { width:100%; }
.cs-sheet .cq-onetable .qt table { width:100%; table-layout:fixed; }
.cs-sheet .cq-onetable .qt tr > :first-child { width:auto; min-width:0; white-space:normal; line-height:1.25; }
.cs-sheet .cq-onetable .qt :is(.fig, td.in) { width:7rem; min-width:0; max-width:none; }
.cs-sheet .cq-onetable .qt th:nth-child(2) { width:7rem; }
.cs-sheet .cq-onetable .qt th.act { width:1.75rem; }
.cs-sheet .cq-onetable .qt td.act { border-left:0; }
.cs-sheet .cq-onetable .qt tr.grp td.fig { color:var(--cs-muted); font-size:11px; letter-spacing:0; text-transform:none; font-weight:500; }
.cs-sheet .cq-onetable .qt td.in :is(input, select) { width:100% !important; min-width:0 !important; height:28px !important; border:0 !important; border-radius:0 !important; background:transparent !important; box-shadow:none !important; font-size:12.5px; }
.cs-sheet .cq-onetable .qt td.in input[type="number"] { text-align:right; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet .cq-onetable .qt td.in :is(input, select):focus { box-shadow:inset 0 0 0 2px #037bb8 !important; background:#fff !important; outline:none !important; }
/* A typed charge's name and its Flat ₹ / % share the Item cell. */
.cs-sheet .cq-onetable .qt td.in .ct-extra { display:flex; align-items:center; }
.cs-sheet .cq-onetable .qt td.in .ct-extra input { flex:1 1 auto; }
.cs-sheet .cq-onetable .qt td.in .ct-extra select { flex:0 0 4.75rem; width:4.75rem !important; border-left:1px solid #cfd8e1 !important; }
.cs-sheet .cq-onetable .qt tr.addrow td { height:auto; padding:6px 8px; background:#fff; }
.cs-sheet .cq-onetable .cq-note { display:block; font-size:10.5px; color:var(--cs-muted); line-height:1.2; }
.cs-sheet .cq-onetable .cq-hint { margin:6px 2px 0; }
/* Beside Trims (user 2026-10-21: "move this near to the trims table"): one row —
   processes / CMT and Trims on the left (their own 1 : 1.8 grid), the charges table on the
   right. A narrow pane stacks the table under Trims. */
.cs-sheet .cq-withcharges { display:grid; grid-template-columns:minmax(0,2.6fr) minmax(0,1.4fr); gap:12px; align-items:start; min-width:0; }
/* COSTING 5: the charges table is as wide as its labels need, not 1.4 parts of the row (user
   2026-10-22, screenshot 104714: "compact this field size too"). 18.5rem = 12.25rem of item
   ("Insurance ₹ / pc", a typed charge's name + its Flat ₹ pick) + 4.5rem Value + 1.75rem ✕.
   The processes / trims pair takes what it gave back. */
.cs-sheet.cs-qtlook .cq-withcharges { grid-template-columns:minmax(0,1fr) 18.5rem; }
.cs-sheet .cq-onetable .qt col.cq-vcol { width:4.5rem; }
.cs-sheet .cq-onetable .qt col.cq-acol { width:1.75rem; }
@media (max-width:1100px){ .cs-sheet.cs-qtlook .cq-withcharges { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cq-withcharges > * { min-width:0; margin:0; }
@media (max-width:1100px){ .cs-sheet .cq-withcharges { grid-template-columns:minmax(0,1fr); } }
/* EVERY TABLE LOOKS LIKE PRICE BUILD (user 2026-10-21: "make every table look like this
   one", then "for the fabric tab too"). On Costing 5 (cs-qtlook, set by chargesTable) every
   banded table on the Fabric and Cost & Quote tabs — consumption, fabric processing,
   processes, CMT, trims — keeps its markup and takes the .qt look the charges table has — a white heading line in muted type with
   the band's colour as a small square (Price build's legend dot), muted column heads, 28px
   ruled rows, and every typed value a tinted CELL rather than a box inside one. */
.cs-sheet.cs-qtlook .cq-panel details:not(.plain) { border:1px solid var(--cs-rule); border-radius:8px; background:#fff; }
/* …EXCEPT THE TITLES, WHICH ARE BANDS (user 2026-10-22, screenshots 3649 / 104151: "this kind
   of better aligned ui"): the white muted line with a colour square read as a column head,
   not a title. Each table's title is now a tinted strip in its band's colour — bold capitals
   on the left, its figure in plain sans on the right — the Operations band's look. The rows
   under it keep the Price build look above. Price build and the charges table take the same
   strip through "tr.cq-title" (their title is a <th>, not a <summary>). */
.cs-sheet.cs-qtlook .cq-panel summary[data-tone] { background:var(--tint); color:var(--ink); border-top:0; border-bottom:1px solid var(--cs-rule); border-radius:8px 8px 0 0; text-transform:uppercase; letter-spacing:.06em; font-size:12px; font-weight:800; padding:8px 12px; align-items:center; justify-content:flex-start; }
.cs-sheet.cs-qtlook .cq-panel summary[data-tone] span { margin-left:auto; color:var(--ink); opacity:1; text-transform:none; letter-spacing:0; font-size:12.5px; font-weight:600; font-family:inherit; }
.cs-sheet .qt tr.cq-title[data-tone="over"] { --tint:#efebfa; --ink:#5a44a8; }
.cs-sheet .qt tr.cq-title[data-tone="margin"] { --tint:#e5f4ea; --ink:#1f6b3e; }
.cs-sheet.cs-qtlook .qt tr.cq-title th { background:var(--tint); color:var(--ink); border-bottom:1px solid var(--cs-rule) !important; font-weight:600; font-size:12.5px; padding:8px 12px; }
.cs-sheet.cs-qtlook .qt tr.cq-title th:first-child { text-transform:uppercase; letter-spacing:.06em; font-size:12px; font-weight:800; }
.cs-sheet.cs-qtlook .cq-panel details th { color:var(--cs-muted); font-weight:600; font-size:11.5px; padding:5px 8px; border-bottom:1px solid var(--cs-rule) !important; background:#fff; }
.cs-sheet.cs-qtlook .cq-panel details td { height:28px; padding:0 8px; border-bottom:1px solid var(--cs-rule); font-size:12.5px; }
.cs-sheet.cs-qtlook .cq-panel details tr.ready td { padding-top:0; padding-bottom:0; }
.cs-sheet.cs-qtlook .cq-panel details td:not(:has(table, .work)):has(input:not([type="checkbox"]):not([readonly]), select) { padding:0; background:#fff; }
.cs-sheet.cs-qtlook .cq-panel details td:not(:has(table, .work)) :is(input:not([type="checkbox"]), select) { width:100% !important; min-width:0 !important; height:28px !important; border:0 !important; border-radius:0 !important; background:transparent !important; box-shadow:none !important; font-size:12.5px !important; }
.cs-sheet.cs-qtlook .cq-panel details td.r input { text-align:right; font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet.cs-qtlook .cq-panel details td:not(:has(table, .work)) :is(input:not([type="checkbox"]), select):focus { box-shadow:inset 0 0 0 2px #037bb8 !important; background:#fff !important; outline:none !important; }
.cs-sheet.cs-qtlook .cq-panel details td.r { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; }
.cs-sheet.cs-qtlook .cq-panel details tr.addrow td { height:auto; padding:6px 8px; background:#fff; box-shadow:none; }
/* The charges table's outer box matches: same border, same corners. */
.cs-sheet .cq-withcharges .cq-onetable .qt { border-radius:8px; }
/* The Fabric workbench sits in a borderless (plain) band whose table draws its own box, so
   its heading line has no rule under it; its column heads go white like Price build's. */
.cs-sheet.cs-qtlook .cq-panel details.plain > summary[data-tone] { border-bottom:0; border-radius:6px; padding:8px 12px; margin-bottom:6px; }
.cs-sheet.cs-qtlook .cq-panel .fsheet th { background:#fff; font-size:11.5px; }
/* A cell that HOLDS a table (a fabric's Yarn / Processes panels) or the price line is a
   container, not a typed value: no tint, and its boxes keep their own size — screenshot
   3642, where the loss box stretched to the full width and broke the line in three. */
/* The fabric price line on ONE row (user 2026-10-21, screenshot 3642: "compact this into
   single row"): Yarn 350.00 + Processes 131.00 = 481.00 · + 10 % loss 48.10 = 529.10 / kg,
   never wrapping; a pane too narrow for it scrolls the line, never breaks it. */
.cs-sheet.cs-qtlook .fband .work { flex-wrap:nowrap; white-space:nowrap; overflow-x:auto; margin-top:8px; padding:4px 8px; min-height:30px; }
/* RATES ARE THREE DIGITS (user 2026-10-21: "rate field only going to handle 3 digit, so we
   can compact it more"): 999.99 is the widest figure a rate, a cost or an amount column holds
   on Costing 5 — six mono characters, ~45px, + 16px padding — so every one is cut to 4.5rem
   (the "Rate / KG" heading is the real floor), Mix % to 3.5rem, the ✕ columns to 1.75rem.
   The widths are inline <col>s the other costings share, so they are overridden here by
   position: the fabric band table (Fabric · Bought-in · Price / KG · ✕), a fabric's Yarn
   panel (5 cols) and its Processes panel (3 cols). */
.cs-sheet.cs-qtlook .fbands col:nth-child(2) { width:5rem !important; }
.cs-sheet.cs-qtlook .fbands col:nth-child(3) { width:5.5rem !important; }
.cs-sheet.cs-qtlook .fbands col:nth-child(4) { width:1.5rem !important; }
.cs-sheet.cs-qtlook .ftab colgroup:has(> col:nth-child(5)) > col:nth-child(2) { width:3.5rem !important; }
.cs-sheet.cs-qtlook .ftab colgroup:has(> col:nth-child(5)) > col:is(:nth-child(3), :nth-child(4)) { width:4.5rem !important; }
.cs-sheet.cs-qtlook .ftab colgroup:not(:has(> col:nth-child(4))) > col:nth-child(2) { width:4.5rem !important; }
.cs-sheet.cs-qtlook .ftab col:last-child { width:1.5rem !important; }
.cs-sheet.cs-qtlook .cq-panel .tri th.c-num { width:4.5rem; }
/* Trims' Rate: wide enough for the pack button and the "Rate ₹ /pc" heading (the per-cell
   "/pc" tag is gone, user 2026-10-22). */
.cs-sheet.cs-qtlook .cq-panel .tri th.c-rate { width:4.75rem; }
/* 4.5rem (user 2026-10-22, screenshot 104525: "compact this fields", then "compact it more") — 6rem made every box in
   the column wider just to fit ONE read-only figure. Calculated prints 4 decimals in mono
   ("4708.7300", screenshot 100031 cut it to "4708.73…"), so that figure alone steps down
   to 11px with tighter padding: 9 × ~6.6px + 8px ≈ 67px, inside the 72px column. */
.cs-sheet.cs-qtlook .cq-onetable .qt :is(.fig, td.in), .cs-sheet.cs-qtlook .cq-onetable .qt th:nth-child(2) { width:4.5rem; }
.cs-sheet.cs-qtlook .cq-onetable .qt td.fig { font-size:11px; padding-left:4px; padding-right:4px; }
/* THE ✕ COLUMN IS 1.5rem (user 2026-10-21: "close option field also need compact"): every
   one holds a single 20px RowHoverRemove, so 24px with 2px each side is all it needs — down
   from 28px, 2.5rem and 3rem across the sheet's tables. Consumption's ✕ is an inline <col>
   (its last), overridden like the fabric ones above. */
.cs-sheet.cs-qtlook :is(th, td).act { width:1.5rem !important; min-width:1.5rem !important; padding:0 2px !important; }
.cs-sheet.cs-qtlook .blk.cons:has(th.act) col:last-child { width:1.5rem !important; }
.cs-sheet.cs-qtlook .fsheet .acts { justify-content:center; }
/* A FABRIC'S YARN AND PROCESSES ARE ONE BOX EACH (user 2026-10-21, screenshot 3643: "this
   yarn table is inside another table, look not clear"). It was three frames deep — the
   fabric row's grey well, a white card titled YARN · 2, and the bordered table inside the
   card. Now the card IS the table's box, Price build's shape: one border, the title as its
   heading line (a colour square, the name, the total on the right, a rule under it), the
   column heads straight beneath, "+ Add yarn" closing it under a hairline. The well under
   the fabric row goes white, so the only frames left are the two boxes. */
.cs-sheet.cs-qtlook .fband tr.fopen > td { background:#fff; padding:8px 8px 10px 24px; }
.cs-sheet.cs-qtlook .fband .fsplit { align-items:start; gap:10px; }
.cs-sheet.cs-qtlook .fband .fpart { gap:0; padding:0; border:1px solid var(--cs-rule); border-radius:8px; overflow:hidden; background:#fff; }
.cs-sheet.cs-qtlook .fband .fpart > .grp { padding:5px 8px; border-bottom:1px solid #9aa4b2; align-items:center; justify-content:flex-start; gap:6px; font-size:11.5px; font-weight:600; letter-spacing:normal; text-transform:none; color:var(--cs-muted); }
.cs-sheet.cs-qtlook .fband .fpart > .grp::before { content:""; width:8px; height:8px; border-radius:2px; background:var(--cs-fabric); flex:none; }
.cs-sheet.cs-qtlook .fband .fpart > .grp.p::before { background:var(--cs-trims); }
.cs-sheet.cs-qtlook .fband .fpart > .grp .gsum { margin-left:auto; font-size:11.5px; font-weight:600; }
.cs-sheet.cs-qtlook .fband .fpart table.ftab { border:0; border-radius:0; }
.cs-sheet.cs-qtlook .fband .fpart table.ftab th { background:#fff; }
.cs-sheet.cs-qtlook .fband .fpart table.ftab tr:last-child td { border-bottom:0; }
.cs-sheet.cs-qtlook .fband .fpart > :is(.faddrow, .fnote) { margin-top:0; padding:5px 8px; border-top:1px solid var(--cs-rule); }
.cs-sheet.cs-qtlook .fband .work .lossbox { flex:none; background:#fff !important; border:1px solid #cfd8e1 !important; border-radius:4px !important; text-align:right; }
.cs-sheet .cq-row2 > .cq-band { margin:0; }
/* Row 1 never wraps (user 2026-10-21, screenshot 3633: Trims dropped under the other two).
   Costing 1's .tri row hugs fixed column widths, which sum to more than 75% of the screen;
   here it is a three-column grid instead and each table fills its column — the operation
   name and the trim name take what is left after the fixed figure columns. */
.cs-sheet .cq-row3 .tri { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,3fr) minmax(0,6.5fr); gap:12px; align-items:stretch; }
@media (max-width:900px){ .cs-sheet .cq-row3 .tri { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cq-row3 .tri > * { min-width:0; max-width:none; margin:0; }
.cs-sheet .cq-row3 .tri .scroll table { width:100%; }
.cs-sheet .cq-row3 .tri th.c-name { width:auto; }
/* Screenshot 3634: in the narrowest column "GARMENT PROCESSES ₹ 0.00 / piece" broke over two
   lines and stood taller than its neighbours. Each heading holds one line here (tighter
   tracking and padding), and the three boxes stretch to one height. */
.cs-sheet .cq-row3 summary[data-tone] { padding:7px 10px; letter-spacing:.03em; gap:8px; white-space:nowrap; }
.cs-sheet .cq-row3 summary[data-tone] span { white-space:nowrap; }
/* Costing 5 (user 2026-10-21): CMT operations under Garment processes, Trims beside the
   pair at the full height of both — and with Trims' seven columns given the wider side.
   NOT "cq-stack": that is the price bar's class (height 12px, overflow hidden), and reusing
   it squeezed this whole row to a 12px strip (screenshot 3637). */
.cs-sheet .cq-row3.cq-opstack .tri { grid-template-columns:minmax(0,1fr) minmax(0,1.8fr); grid-template-areas:"proc trims" "cmt trims"; align-items:start; }
.cs-sheet .cq-row3.cq-opstack .cq-op-proc { grid-area:proc; }
.cs-sheet .cq-row3.cq-opstack .cq-op-cmt { grid-area:cmt; }
.cs-sheet .cq-row3.cq-opstack .cq-op-trims { grid-area:trims; align-self:stretch; }
/* A RATE BOX HOLDS THREE DIGITS AND GROWS (user 2026-10-21, after screenshot 3645: "space
   … to enter a maximum of 3 digits only … any fourth number adjust it dynamically"). The
   Rate columns no longer reserve 80px / 4.5rem / 7rem: the box starts at 3 digits plus its
   padding and field-sizing:content (the pickers' own mechanism, data-picker.tsx) widens
   it per digit typed. That needs the table on auto layout — a fixed table cannot be
   widened by its content — and the box off the width:100% every .tri input otherwise
   gets. */
.cs-sheet .cq-row3.cq-opstack .tri .scroll table { table-layout:auto; }
/* THE RATE COLUMN HUGS ITS BOX (user 2026-10-22: "Rate box compact it more"). "width:auto"
   on an auto-layout table at width:100% shares the spare width among every column, so Rate
   stood ~96px around a 3-digit box. "width:1%" + nowrap is the shrink-to-content idiom; the
   name column, which has no width of its own, takes all the slack instead. */
.cs-sheet .cq-row3.cq-opstack .tri :is(th.c-num, th.c-rate) { width:1%; white-space:nowrap; padding-inline:6px; }
/* …so the "Rate ₹" LABEL is what sets the column (user 2026-10-22: "just fit rate label"):
   the box's own floor sits under the label's width, so the box fills exactly the label's
   cell and only a rate too long for it widens the column. */
.cs-sheet .cq-row3.cq-opstack .tri td input.cs-ed[type="number"] { padding-inline:6px !important; }
/* Trims' Cost ₹ hugs its figure the same way (user 2026-10-22, screenshot 101336: "this cost
   field also need to compact"): its heading is already width:1%, so the cells' own 10px
   padding was what still held it wide. */
.cs-sheet .cq-row3.cq-opstack .tri td.c-cost { padding-inline:6px; white-space:nowrap; }
/* …AND THE BOX STILL FILLS ITS CELL (user 2026-10-22, screenshot 3648: "split boxed in
   field"). The cell is the field — painted blue by the qtlook rule — and the column is as
   wide as its widest box or its heading, so a box sized to ITS OWN digits sat inside a wider
   blue cell and focus drew a white box beside a blue one. field-sizing still sets what the
   box asks of the column; min-width:100% then stretches it to the width the column got. */
.cs-sheet .cq-row3.cq-opstack .tri td input.cs-ed[type="number"] { field-sizing:content; width:auto !important; min-width:max(100%, calc(3ch + 12px)) !important; max-width:none; }
/* trimsByTick (Costing 5): the pack group's headings carry a light shade; the Rate heading
   carries the unit ("Rate ₹ /pc"), so no cell repeats it. */
.cs-sheet .tri th.c-pack { background:#f7f9fb; }
/* The pack button (Costing 5): an unticked trim's Rate cell — just "Pack"; the figures are inside the box. */
.cs-sheet .tri td.cq-packcell { padding:2px 4px; }
.cs-sheet .cq-pack { width:100%; height:26px; display:flex; align-items:center; justify-content:center; gap:6px; font:inherit; font-size:12px; background:#f7f9fb; color:var(--cs-ink); border:1px dashed #b8c4cf; border-radius:6px; padding:0 8px; cursor:pointer; }
.cs-sheet .cq-pack:hover, .cs-sheet .cq-pack:focus-visible { border-style:solid; border-color:#037bb8; outline:none; }
.cs-sheet .cq-packview { font-size:12px; color:var(--cs-muted); white-space:nowrap; }
.cs-sheet .tri th.c-rate { width:7rem; }
@media (max-width:900px){ .cs-sheet .cq-row3.cq-opstack .tri { grid-template-columns:minmax(0,1fr); grid-template-areas:"proc" "cmt" "trims"; } }
.cs-sheet .cq-row2 .cq-grid { grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:22px 12px; max-width:none; }
/* The merged Fabric tab: the left hugs Component consumption, the right takes the rest. */
.cs-sheet .cq-fab { display:grid; grid-template-columns:fit-content(46%) minmax(0,1fr); gap:18px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .cq-fab { grid-template-columns:minmax(0,1fr); } }
.cs-sheet .cq-fabL { display:flex; flex-direction:column; gap:14px; min-width:0; }
.cs-sheet .cq-fabL > .blk { width:fit-content; max-width:100%; margin:0; }
.cs-sheet .cq-fabR { min-width:0; container-type:inline-size; }
.cs-sheet .cq-fabR > .blk { width:100%; max-width:none; margin:0; }
/* YARN AND PROCESSES BOTH HUG THEIR FIELDS (user 2026-10-22, screenshot 095554: "compact
   all the field based better"). This reverses 2026-10-21's "Yarn takes the rest of the
   band": a 100 in a 70px Mix % box and a yarn name in an 840px one left the Yarn table
   mostly empty, while Processes, held to 10rem, cut "COMPACTING [OPEN WIDTH]" short.
   Each column now has the width of what it holds — a yarn / process name 14rem
   (~28 capitals), a % 4rem, a rate 5rem, an amount 5.5rem, the ✕ 1.5rem — and the
   two tables sit side by side from the left, wrapping under each other when the band
   is too narrow for both (Yarn 30rem + Processes 20.5rem + the 12px gap).
   The colgroup widths are inline styles, hence !important. */
.cs-sheet .cq-fabR .fband .fsplit { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:flex-start; }
.cs-sheet .cq-fabR .fband .fpart { flex:0 0 auto; max-width:100%; }
.cs-sheet .cq-fabR .fband .fpart .ftab { width:auto; table-layout:fixed; }
.cs-sheet .cq-fabR .fband .fpart .ftab col:first-child { width:14rem !important; }
.cs-sheet .cq-fabR .fband .fpart .ftab col:last-child { width:1.5rem !important; }
.cs-sheet .cq-fabR .fband .fpart:not(.p) .ftab col:nth-child(2) { width:4rem !important; }
.cs-sheet .cq-fabR .fband .fpart:not(.p) .ftab col:nth-child(3) { width:5rem !important; }
.cs-sheet .cq-fabR .fband .fpart:not(.p) .ftab col:nth-child(4) { width:5.5rem !important; }
.cs-sheet .cq-fabR .fband .fpart.p .ftab col:nth-child(2) { width:5rem !important; }
/* …AND THE BAND ENDS WHERE THEY END (user 2026-10-22, screenshot 095823: "Bought-in and
   Price / KG still in end of the screen"). The block and its fabrics table were 100% of
   the pane, so the two figures every fabric line is read by sat a screen's width from its
   name. Both now shrink to their content — the open line's Yarn + Processes pair is the
   widest thing in them — and the fabric-name column takes whatever that leaves, so
   Bought-in and Price / KG stand at the Processes table's right edge. */
.cs-sheet .cq-fabR > .blk { width:fit-content; max-width:100%; }
.cs-sheet .cq-fabR .fband table.fbands { width:auto; table-layout:auto; }
/* THE THREE BANDS OF OVERHEADS, TERMS & QUOTE TELL THEMSELVES APART (user 2026-10-22,
   screenshot 142708: "header overhead, terms, fob — add some colour differentiation").
   Each band row takes its tone from the sheet's own palette — Overheads the overhead
   violet, Terms the margin green, Quoted price the fabric blue — as a light tint across
   the row, a bar at its left edge and the label in that colour. The rows under a band
   stay white, so the colour marks where a group starts and the figures stay readable. */
.cs-sheet .qt tr.grp[data-band] { --band:var(--cs-over); }
.cs-sheet .qt tr.grp[data-band="terms"] { --band:var(--cs-margin); }
.cs-sheet .qt tr.grp[data-band="quote"] { --band:var(--cs-fabric); }
.cs-sheet .qt tr.grp[data-band] td { background:color-mix(in srgb, var(--band) 10%, #fff) !important; color:color-mix(in srgb, var(--band) 75%, #0f1b26) !important; font-weight:700; }
.cs-sheet .qt tr.grp[data-band] td:first-child { box-shadow:inset 3px 0 0 var(--band); }
/* fabricAlign (Costing 6, screenshot 3657): Size-wise spans both columns on a row of its own,
   so the two tables' title strips share a top edge. The fabric table still shrinks to its
   content, as above (user 2026-10-22, screenshot 3658: "why again the Bought-in and
   Price / KG end of the screen") - an earlier cut stretched it to the pane's edge here. */
.cs-sheet .cq-fab-aligned { row-gap:12px; }
.cs-sheet .cq-fab-aligned > .cq-fabTop { grid-column:1 / -1; }
/* COSTING 5 TYPE (user 2026-10-22: "the fonting for the costing need more better user
   visibility … executive"). Three changes, all for reading at a glance:
   - FIGURES IN THE APP'S OWN FACE, not a code font. Monospace made every price read like a
     terminal; tabular-nums keeps the digits the same width, so columns still align.
   - ONE STEP UP: values 13px (was 12–12.5), column heads 12px in near-ink (was 11.5px muted
     grey, which faded beside a 13px label).
   - WEIGHT CARRIES MEANING: a typed value is 600, a worked-out one 500, totals 700 — so the
     eye finds what was entered and what it adds up to without reading every cell.
   Scoped to cs-qtlook: Costing 3 / 4 and the printed sheet keep their type. */
.cs-sheet.cs-qtlook { font-size:13px; font-variant-numeric:tabular-nums lining-nums; }
.cs-sheet.cs-qtlook :is(td, th, dt, dd, summary, summary span, input, select, button, b, small, span:not(.sr-only)) { font-family:inherit !important; }
.cs-sheet.cs-qtlook :is(.cq-panel details td, .qt td) { font-size:13px; font-weight:500; color:var(--cs-ink); }
.cs-sheet.cs-qtlook :is(.cq-panel details td, .qt td) :is(input, select) { font-size:13px !important; font-weight:600; color:var(--cs-ink) !important; }
.cs-sheet.cs-qtlook :is(.cq-panel details th, .qt thead th) { font-size:12px; font-weight:600; color:#334250; }
.cs-sheet.cs-qtlook .qt td.dim, .cs-sheet.cs-qtlook .qt td .dim { color:var(--cs-muted); font-weight:500; }
.cs-sheet.cs-qtlook .qt tr.sum td { font-weight:700; }
/* RATE AND COST HOLD THREE DIGITS AND GROW (user 2026-10-22, screenshot 3653: "3 digit space is
   enough … it will adjust the field dynamically"). width:1% on the number columns was not
   enough: a 100%-wide auto table still spread its slack over every column, so Rate and Cost
   stood ~95px around "0.00". The NAME column now claims the slack (width:100% — the one
   column an auto table may give it all to), so each number column is exactly its content:
   the 3ch box (field-sizing:content above) or the widest figure, growing as digits are typed.
   "Rate ₹ /pc" may wrap like "Direct Rate" beside it, or its heading would hold the column
   open by itself. */
.cs-sheet .cq-row3.cq-opstack .tri th.c-name { width:100%; }
.cs-sheet .cq-row3.cq-opstack .tri th.c-rate { white-space:normal; }
/* NO FLAT GREY (user 2026-10-22, screenshot 3655: "instead of the grey … look dull"). The two
   large grey fills take a light tint of their own colour: a fabric's band row the fabric
   blue of the "Fabric processing cost" title above it, the tab strip the brand blue. */
.cs-sheet.cs-qtlook .fband tr.band td { background:#f0f8fd; }
.cs-sheet.cs-qtlook .fband tr.band:hover td { background:#e3f2fb; }
.cs-sheet.cs-qtlook .fband button.caret:hover { background:#d4ebf8; }
.cs-sheet.cs-qtlook .ctabs { background:#f0f8fd; border-color:#d6eaf6; }
/* liveAmounts (Costing 6, user 2026-10-22, screenshot 112744: "need UI better polish"). The ₹
   amount first floated in the label cell, LEFT of the typed figure and a line high — it read
   as a second value and nobody could tell which number was typed. It is now its own column,
   right of the entry: Rejection % | 4343 | 1476.62, entry then result. Shaded like a
   read-only figure so it never looks typeable, and the band's total stands at its head.
   The charges table grows by that column (18.5 + 4.75rem); Price build lost five rows to it. */
.cs-sheet .cq-onetable .qt col.cq-mcol { width:4.75rem; }
.cs-sheet.cs-qtlook .cq-onetable .qt td.amt { background:#f7f9fb; color:#334250; font-weight:600; font-size:12.5px; text-align:right; padding:0 8px; }
.cs-sheet.cs-qtlook .cq-onetable .qt tr.grp td.amt { background:transparent; color:var(--ink,#5a44a8); font-weight:700; }
.cs-sheet.cs-qtlook .cq-onetable .qt td.amt .cq-amt { color:inherit; }
/* …but only a cell that HOLDS an amount is shaded (user 2026-10-22, screenshot 114240: the
   empty ones read as disabled fields — "why show the blank fields"). A row with nothing to
   work out leaves the cell plain, so it vanishes into the row. */
.cs-sheet.cs-qtlook .cq-onetable .qt td.amt:empty { background:transparent; }
.cs-sheet.cs-qtlook .cq-withcharges:has(.cq-live) { grid-template-columns:minmax(0,1fr) 23.25rem; }
@media (max-width:1100px){ .cs-sheet.cs-qtlook .cq-withcharges:has(.cq-live) { grid-template-columns:minmax(0,1fr); } }
/* Title strips are one strip: no cell dividers inside them (screenshot 112744 showed Price
   build's split in two at the "₹" head). */
.cs-sheet.cs-qtlook .qt tr.cq-title th { border-left:0 !important; border-right:0 !important; }
/* PRICE BUILD, POLISHED (user 2026-10-22, screenshot 113200: "align this section … pro UI/UX
   touch"). It read as a spreadsheet: section heads at full 13px ink (the type rule above
   outranked their small-caps style), a tinted value column (one size is always the "selected"
   one), a rule between label and figure, 8px gutters. Now a statement:
   - ONE GUTTER, 14px, the title's own, so label, figure and section head share two edges;
   - no vertical rules and hairline row rules — the right-aligned figures make the column;
   - section heads small muted capitals with air above, so COST / PRICE / QUOTE group rows
     instead of competing with them;
   - subtotals on a faint shelf under a firmer rule; the bottom line (Margin on quote) a
     footer in the margin colour, the one figure the sheet exists to answer. */
.cs-sheet.cs-qtlook .cq-pb { border-radius:10px; box-shadow:0 1px 2px rgba(15,27,38,.05); }
.cs-sheet.cs-qtlook .cq-pb table { width:100%; }
.cs-sheet.cs-qtlook .cq-pb tr.cq-title th { padding:10px 14px; }
.cs-sheet.cs-qtlook .cq-pb td { height:30px; padding:0 14px; border-bottom:1px solid #eef2f6; border-left:0 !important; }
.cs-sheet.cs-qtlook .cq-pb td.fig, .cs-sheet.cs-qtlook .cq-pb td.sel:not(.in) { background:transparent; font-size:13px; padding-left:20px; }
.cs-sheet.cs-qtlook .cq-pb tr.grp td { height:auto; padding:12px 14px 4px; font-size:10.5px; font-weight:700; letter-spacing:.1em; color:var(--cs-muted); border-bottom:1px solid #eef2f6; background:#fff; }
.cs-sheet.cs-qtlook .cq-pb tbody tr.grp:first-child td { padding-top:8px; }
.cs-sheet.cs-qtlook .cq-pb .cq-sw { width:8px; height:8px; margin-right:8px; vertical-align:1px; }
.cs-sheet.cs-qtlook .cq-pb tr.sum td { background:#f8fafc; border-top:1px solid #c9d3dc; font-weight:700; }
.cs-sheet.cs-qtlook .cq-pb tr.cur td { background:#f0f8fd; }
.cs-sheet.cs-qtlook .cq-pb tbody tr:last-child td { height:38px; background:#f2faf5; border-top:1px solid #cfe7d8; border-bottom:0; font-size:13.5px; }
/* ONE PAGE (Costing 6, 2026-10-22). The jump bar is the tab bar's card row, held at the
   pane's top; every section clears it on arrival, and Price build sticks below it. */
/* overflow:hidden makes the sheet its own scroll box, which pins sticky to a box that never
   scrolls; clip keeps the rounded corners without that. */
.cs-sheet:has(.op-page) { overflow:clip; }
.cs-sheet .op-page { display:flex; flex-direction:column; gap:16px; }
.cs-sheet .op-jump { position:sticky; top:0; z-index:5; align-items:center; box-shadow:0 6px 12px -12px rgb(2 79 120 / .6); }
.cs-sheet .op-sec { scroll-margin-top:72px; min-width:0; }
.cs-sheet .op-page .cq-values { top:72px; max-height:calc(100vh - 80px); }
.cs-sheet .op-fold { border:1px solid var(--cs-rule); border-radius:10px; padding:0 12px; }
.cs-sheet .op-fold[open] { padding-bottom:12px; }
.cs-sheet .op-fold > summary { cursor:pointer; padding:9px 0; font-weight:800; font-size:14px; color:var(--cs-ink); display:flex; gap:8px; align-items:baseline; }
.cs-sheet .op-fold > summary span { font-weight:500; font-size:12px; color:var(--cs-muted); }
@media print { .cs-sheet .op-jump { display:none; } }
/* THE REPORT ON ONE SCREEN AT 100% (user 2026-10-22, artifact "Cost Sheet Fit", from
   screenshot 3671: the sheet zoomed out to fit, asked for at 100%). The tab layouts size
   each table for a tab of its own; here every table is as wide as its content (figure
   columns as wide as their number, 6px cells, 20px rows), the tables of a row sit side by
   side from the left, and the rail follows the widest row instead of the pane's edge.
   The letterhead, the tab bar and the Details row are one header line. */
.cs-sheet:has(.op-report) > .lh { display:none; }
.cs-sheet .op-report { gap:10px; font-size:11.5px; }
.cs-sheet .op-hd { display:flex; align-items:center; gap:14px; padding-bottom:8px; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .op-who { display:flex; align-items:center; gap:8px; flex:0 0 auto; }
.cs-sheet .op-who b { display:block; font-size:12.5px; }
.cs-sheet .op-no { font-family:ui-monospace,"IBM Plex Mono",Consolas,monospace; font-size:11.5px; }
.cs-sheet .op-logo { height:28px; width:auto; }
.cs-sheet .op-mark { width:26px; height:26px; border-radius:7px; background:var(--cs-brand); color:#fff; display:grid; place-items:center; font-weight:800; }
.cs-sheet .op-facts { flex:1 1 auto; min-width:0; padding-left:14px; border-left:1px solid var(--cs-rule); }
.cs-sheet .op-facts .hdr-grid { display:flex; flex-wrap:wrap; gap:2px 16px; }
.cs-sheet .op-facts .spec { display:contents; }
.cs-sheet .op-facts .spec > div { display:flex; align-items:baseline; gap:5px; border:0; padding:0; background:none; }
.cs-sheet .op-facts .spec dt { font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--cs-muted); font-weight:700; }
.cs-sheet .op-facts .spec dd { margin:0; font-size:11.5px; font-weight:600; }
.cs-sheet .op-links { display:flex; gap:6px; flex:0 0 auto; }
.cs-sheet .op-links button { font-size:11.5px; color:var(--cs-brand); background:#fff; border:1px solid var(--cs-rule); border-radius:8px; padding:3px 10px; cursor:pointer; }
.cs-sheet .op-links button:hover { border-color:var(--cs-brand); }
.cs-sheet .op-report .op-body { display:grid; grid-template-columns:minmax(0,max-content) 220px; gap:10px; align-items:start; justify-content:start; }
.cs-sheet .op-report .op-main { display:flex; flex-direction:column; gap:10px; min-width:0; }
.cs-sheet .op-report .op-sec { scroll-margin-top:8px; }
.cs-sheet .op-report .op-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start; min-width:0; }
.cs-sheet .op-report .op-row > * { flex:0 0 auto; max-width:100%; width:auto; margin:0; }
/* The sections that only wrap their bands step aside, so each band is a table in the row. */
.cs-sheet .op-report .op-row > :is(.tri, section[aria-label="Garment cost"]) { display:contents; }
.cs-sheet .op-report .op-row > section[aria-label="Garment cost"] > details:nth-of-type(2) { order:-1; }
/* OPERATIONS ROW STAYS ONE ROW (user 2026-10-22: "move Trims near to CMT"): Garment
   processes | CMT | Trims never wrap apart; if the row is short of room, Trims gives it up
   by wrapping a long trim name, never by dropping to a line of its own. Its Rate ₹ / Cost ₹
   are as wide as the figure and the heading, nothing more. */
.cs-sheet .op-report #cs-op-ops { flex-wrap:nowrap; }
.cs-sheet .op-report #cs-op-ops > .tri > .cq-op-trims, .cs-sheet .op-report #cs-op-ops > .tri > details:last-child { flex:0 1 auto; min-width:0; }
.cs-sheet .op-report #cs-op-ops > .tri > details:last-child td:first-child { white-space:normal; min-width:9rem; }
.cs-sheet .op-report .tri :is(th.c-num, th.c-rate, th.c-tick, td.r, td.c-cost, td.c) { min-width:0 !important; padding-inline:5px !important; white-space:nowrap; }
/* COST ROW STAYS ONE ROW (user 2026-10-22: "compact Overheads, Garment cost, Terms … move
   Price build near to Terms"): the four tables side by side, figures as wide as the number;
   short of room, a long line label wraps instead of Price build dropping to a line alone. */
.cs-sheet .op-report #cs-op-cost { flex-wrap:nowrap; }
.cs-sheet .op-report #cs-op-cost > *, .cs-sheet .op-report #cs-op-cost > section > details { flex:0 1 auto; min-width:0; }
.cs-sheet .op-report #cs-op-cost :is(td, th):first-child { white-space:normal; min-width:7rem; }
.cs-sheet .op-report #cs-op-cost :is(th.r, td.r, th.fig, td.fig) { min-width:0 !important; padding-inline:5px !important; white-space:nowrap; }
.cs-sheet .op-report #cs-op-cost tr.grp td { white-space:normal; }
.cs-sheet .op-report .op-row :is(details, .blk, .qt) { width:auto; max-width:100%; margin:0; }
/* NO UNFINISHED BAND (screenshot 3676): a band is as wide as the wider of its header and its
   table, so a short table under a long header ("Garment processes ₹ 34.00 / piece") used to
   stop short and leave the band's right side empty. The table fills its band instead. */
.cs-sheet .op-report .op-row :is(details, .qt) table { width:100% !important; }
.cs-sheet .op-report .op-row .qt :is(.fig, td.in) { width:auto !important; min-width:0 !important; max-width:none !important; }
/* TITLE BANDS FOR THE QUOTATION'S TABLES (user 2026-10-22: "Terms, Price build add colour
   for the title … Quote … colour difference"). Their title is the first header row, not a
   <summary>, so they were the only grey-headed tables on the page. Each now wears a band
   like the others, in a colour of its own: Terms green, Price build rose, Quote blue. */
.cs-sheet .op-report .qt { --tone:var(--cs-margin); --tint:#e5f4ea; --ink:#1f6b3e; border-top:2px solid var(--tone); border-radius:7px; overflow:hidden; }
.cs-sheet .op-report .qt:has(table[aria-label^="Price build"]) { --tone:var(--cs-emb); --tint:#fcebf1; --ink:#a3305a; }
.cs-sheet .op-report .qt:has(table[aria-label^="FOB price"]) { --tone:var(--cs-brand); --tint:var(--cs-brand-tint); --ink:var(--cs-brand-ink); }
.cs-sheet .op-report .qt thead tr:first-child th { background:var(--tint) !important; color:var(--ink) !important; text-transform:uppercase; letter-spacing:.06em; font-weight:800; font-size:10.5px !important; padding-block:4px !important; }
.cs-sheet .op-report .qt tr.grp td { color:var(--ink); background:transparent; font-size:9.5px !important; padding-block:1px !important; }
/* The Quote, compact: one line per figure, the group line folded into the band's tint. */
.cs-sheet .op-report .op-rail .qt :is(th, td) { padding:1px 6px !important; height:18px; }
.cs-sheet .op-report .op-rail .qt td:first-child { font-size:11px !important; }
.cs-sheet .op-report .fabblk { display:block; }
.cs-sheet .op-report .scroll { overflow-x:visible; }
.cs-sheet .op-report table { width:auto !important; min-width:0 !important; table-layout:auto !important; font-size:11.5px; }
.cs-sheet .op-report col { width:auto !important; }
.cs-sheet .op-report :is(th, td) { width:auto !important; padding:2px 6px !important; height:20px; white-space:nowrap; font-size:11.5px !important; line-height:1.3 !important; }
.cs-sheet .op-report :is(th, td) :is(small, .sub, .why, .dim) { font-size:10px !important; }
.cs-sheet .op-report thead th { font-size:10.5px !important; }
.cs-sheet .op-report td:first-child { padding-right:14px !important; }
.cs-sheet .op-report summary { padding:4px 8px !important; font-size:10.5px !important; }
.cs-sheet .op-report summary span { font-size:11px; }
/* The rail: photo, FOB, Quote and totals — one 220px column, sticky beside the rows. */
.cs-sheet .op-report .op-rail { position:sticky; top:8px; display:flex; flex-direction:column; gap:8px; min-width:0; max-height:none; overflow:visible; }
.cs-sheet .op-report .op-rail .rail { display:block; }
.cs-sheet .op-report .op-rail .rail .photo { min-height:0; height:110px; padding:4px; gap:0; border-style:solid; }
.cs-sheet .op-report .op-rail .rail .photo img { max-height:100px; width:auto; max-width:100%; }
.cs-sheet .op-report .op-rail .rail .photo > span { display:none; }
.cs-sheet .op-report .op-rail .qcard { padding:7px 9px; gap:4px; }
.cs-sheet .op-report .op-rail .qbig { font-size:19px; }
.cs-sheet .op-report .op-rail .qverdict { font-size:10.5px; padding:3px 7px; }
.cs-sheet .op-report .op-rail .qkv { font-size:11px; gap:3px 8px; }
.cs-sheet .op-report .op-rail .qt table { width:100% !important; }
.cs-sheet .op-report .op-rail .qt td:first-child { color:var(--cs-muted); white-space:normal; }
/* The Quote in a 220px rail: its group line wraps and its "why" notes go, so the figure
   column always shows (screenshot 3674: Calculated / Quoted had no figures). */
.cs-sheet .op-report .op-rail .qt { overflow:hidden; }
.cs-sheet .op-report .op-rail .qt :is(.fig, td.in) { width:auto !important; min-width:0 !important; max-width:none !important; }
.cs-sheet .op-report .op-rail .qt :is(th, td) { padding:2px 6px !important; }
.cs-sheet .op-report .op-rail .qt tr.grp td { white-space:normal; font-size:9.5px !important; }
.cs-sheet .op-report .op-rail .qt .why { display:none; }
.cs-sheet .op-report .op-rail .qt td.r, .cs-sheet .op-report .op-rail .qt th.r { text-align:right; white-space:nowrap; }
.cs-sheet .op-report .op-rail .rail .photo { align-items:center; justify-content:center; }
.cs-sheet .op-report .op-rail .rail .photo a { display:flex; justify-content:center; }
@media (max-width:1100px){
  .cs-sheet .op-report .op-body { grid-template-columns:minmax(0,1fr); }
  .cs-sheet .op-report .op-rail { position:static; }
  .cs-sheet .op-hd { flex-wrap:wrap; }
  .cs-sheet .op-facts { border-left:0; padding-left:0; flex-basis:100%; }
}
`;
