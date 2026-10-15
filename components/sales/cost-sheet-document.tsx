"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { AddCharge, AddFabric, AddOperation, AddTrim, AddWeight, EdText, Pick, RemoveX, type EditOptions } from "@/components/sales/cost-sheet-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { fmtDate } from "@/lib/format";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_RED_BELOW_PCT, MARGIN_TARGET_PCT, hasYarnMix, quoteKey } from "@/lib/sales/sample-costing/calc";
import type { CostingDraft, FabricDraft, PieceDraft } from "@/lib/sales/sample-costing/types";
import { RevisionHistory } from "@/components/sales/revision-history";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, SummaryTiles, Td, Th, stripeRow, totalRowStyle, type SheetFact } from "@/components/orders/report-kit";
import { newFabricProcess, newYarnMix } from "@/lib/sales/sample-costing/revision-draft";

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
 * DRAWN WITH THE ORDER REPORTS' KIT (`components/orders/report-kit.tsx`, the
 * screen twin of the `report-pdf-kit` the PDF draws with): SheetMasthead,
 * OrderFacts, SummaryTiles, a SectionCard per table, SignOff, so the page and
 * its PDF show the same blocks in the same order. Only the Charts view and the
 * commercial band's margin gauge keep the sheet's own CSS below.
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

const money = (v: number | null | undefined) => fx(v);

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

/** A number cell edited in place. Paper-coloured whatever the theme: the sheet is paper. */
function Ed({ value, onChange, label, w = "w-24" }: { value: string; onChange: (v: string) => void; label: string; w?: string }) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={`${w} !h-7 !border-[#037bb8] !bg-white !px-2 text-right font-semibold tabular-nums !text-[#0f1b26]`}
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
  lockedHint = "Save the revision to download or print",
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
  /** Said IN PLACE of the downloads while locked — a disabled button's title never shows. */
  lockedHint?: string;
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
  const [view, setView] = useState<SheetView>("tabs");
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = model.sizes[idx] ?? model.sizes[0];

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
        <ToggleGroup<SheetView>
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "tabs", label: "Tabs" },
            { value: "charts", label: "Charts" },
          ]}
        />
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
            <span className="text-sm text-muted-foreground">{lockedHint}</span>
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
                  const back = view;
                  flushSync(() => setView("report"));
                  window.print();
                  setView(back);
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
      <Sheet model={model} s={s} idx={idx} edit={edit} view={view} />
    </div>
  );
}

type SheetView = "tabs" | "report" | "charts";

function Sheet({ model, s, idx, edit, view }: { model: CostSheetModel; s: SizeFigures; idx: number; edit?: CostSheetEdit; view: SheetView }) {
  // OPENS ON QUOTATION (user 2026-10-14: "default open the quotation tab") — the
  // last of the five tabs, the price the buyer is quoted.
  const [tab, setTab] = useState(4);
  const setFabric = (key: string, patch: Partial<FabricDraft>) => edit?.onChange({ ...edit.draft, fabrics: patchBy(edit.draft.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => edit?.onChange({ ...edit.draft, pieces: patchBy(edit.draft.pieces, key, patch) });
  const eff = s.effectiveMarginPct;
  const pin = eff == null ? null : (Math.min(Math.max(eff, 0), 30) / 30) * 100;
  const ccy = model.currency ?? "";
  const stateClass = model.status === "approved" ? "good" : model.status === "submitted" ? "warn" : model.status === "rejected" ? "bad" : "brand";
  const delta = s.delta;
  const multi = model.pieceCount > 1;
  /** The USD price in rupees at the sheet's own rate — the figure the ledger carries. */
  const inrOf = (v: number | null) => (v == null || model.exchangeRate == null ? null : v * model.exchangeRate);
  const shown = s.quoted ?? s.calc;

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
  const wfMax = Math.max(s.price, s.grossCost, 1) * 1.02;
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
  const R = 46;
  const C = 2 * Math.PI * R;
  // Each slice starts where the ones before it end — computed up front, not by a
  // counter mutated inside the render's map.
  const offs = parts.map((_, i) => parts.slice(0, i).reduce((t, p) => t + (p.value / partTotal) * C, 0));

  const worst = model.sizes.reduce((m, x) => Math.max(m, x.price), 1) * 1.02;

  /* ── THE BLOCKS, IN THE PDF'S ORDER (`exportCostSheetReportPdf`) ──────────────
     Masthead · facts · approval line · tiles · consumption · fabric processing ·
     fabric & garment processes · CMT · trims · garment cost · overheads ·
     commercial quote · price by size · revision history · sign-off. Every block is
     drawn with the order reports' kit (`report-kit.tsx`), the screen twin of the
     `report-pdf-kit` the PDF draws with, so the page and the printout read as one
     document. The Tabs view shows the same blocks, a few at a time. */

  const thumb = (
    <figure className="m-0 flex w-24 shrink-0 flex-col items-center gap-1" aria-label="Style sketch or photo">
      <div className="grid size-24 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-[#f5f8fb] text-[#037bb8]">
        {model.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          <svg viewBox="0 0 64 64" className="size-10 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
            <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
          </svg>
        )}
      </div>
      <figcaption className="text-[10px] font-bold uppercase tracking-[.08em] text-[#7b8594]">Sketch / photo</figcaption>
    </figure>
  );

  /* 1 · HEADER — the RAAGAM COSTING FORMAT's top block (client 2026-10-09), as the
     PDF's facts. Only the lines this costing has a value for print: an empty
     "Buying Agent" cell is chrome. */
  const allFacts: SheetFact[] = (
    [
      { label: "Buyer / importer", value: model.customer },
      { label: "Description", value: model.description || model.style, sub: model.sampleNo ?? model.enquiryNo },
      { label: "Style", value: model.style && model.description && model.style !== model.description ? model.style : null },
      { label: "Fabric", value: model.fabricFacts.structure, sub: model.fabricFacts.gsm },
      { label: "Composition", value: model.fabricFacts.composition },
      { label: "Season", value: model.season },
      { label: "Currency", value: ccy ? `${ccy}${model.exchangeRate ? ` @ ₹ ${fx(model.exchangeRate)}` : ""}` : null },
      { label: "Ship mode", value: model.shipMode },
      { label: "Size group", value: model.sizeGroup },
      { label: "Costed per", value: model.isSet ? "SET" : "PCS", sub: multi ? `${model.pieceCount} pieces` : null },
    ] as SheetFact[]
  ).filter((f) => f.value);
  // CHARTS FIT ONE SCREEN, so the facts give way to the four that matter at a glance.
  const facts = view === "charts" ? allFacts.filter((f) => ["Buyer / importer", "Description", "Fabric", "Ship mode"].includes(f.label)) : allFacts;
  const factsBlock = <OrderFacts facts={facts} thumbnail={thumb} />;

  /* THE FIGURES THE READER CAME FOR — the PDF's six tiles, plus the margin in
     rupees (the Margin % of net is typed here while revising). */
  const tiles = (
    <SummaryTiles
      tiles={[
        { label: `Net cost ₹${model.sizes.length > 1 ? ` · ${s.label}` : ""}`, value: money(s.net), note: "before rejection and overhead" },
        { label: "Gross cost ₹", value: money(s.grossCost), note: `what a ${model.unitWord} costs us` },
        { label: "Price ₹", value: money(s.price), note: `gross cost + margin${s.priceAdj ? " ± price charges" : ""}` },
        {
          label: `${s.quoted != null ? "Quoted" : "Calculated"} FOB ${ccy}`.trim(),
          value: shown == null ? "—" : fx(shown, 2),
          note: s.calc != null ? `calculated ${s.calc.toFixed(4)}` : "add the exchange rate",
        },
        ...(inrOf(shown) != null ? [{ label: "FOB in rupees ₹", value: money(inrOf(shown)), note: `${ccy} ${fx(shown)} × ${fx(model.exchangeRate)}` }] : []),
        {
          label: "Margin earned ₹",
          value: money(s.margin),
          note: edit ? (
            <span className="inline-flex items-center gap-1.5">
              <Ed w="w-16" label="Margin % of net" value={edit.draft.header.margin_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, margin_pct: v } })} />
              <span>% of net</span>
            </span>
          ) : (
            `${model.terms.margin}% of net`
          ),
        },
        { label: "Margin on quote", value: eff == null ? "—" : `${fx(eff)}%`, note: `${FLOOR_PCT}% floor · ${model.terms.margin}% of net` },
      ]}
    />
  );

  /** The striped body row / the tinted total row — the kit's two row shapes. */
  const rowStyle = (i: number) => stripeRow(i);
  const total = { className: "font-semibold", style: totalRowStyle() };

  const secConsumption = (
    <SectionCard title="Component consumption" totalLabel="grams per size, with loss %">
      <ReportTable bare>
        <thead>
          <tr>
            {multi ? <Th>Piece</Th> : null}
            <Th>Component</Th>
            <Th>Fabric</Th>
            {model.weights.sizeLabels.map((l) => (
              <Th key={l} right>{l}</Th>
            ))}
            <Th right>Loss %</Th>
          </tr>
        </thead>
        <tbody>
          {model.weights.rows.map((r, i) => (
            <tr key={i} style={rowStyle(i)}>
              {multi ? <Td>{r.piece}</Td> : null}
              <Td>
                {edit && r.wkeys.length ? (
                  <span className="inline-flex items-center gap-1.5">
                    {r.component}
                    <RemoveX label={r.component || "weight line"} onClick={() => edit.onChange({ ...edit.draft, weights: edit.draft.weights.filter((x) => !r.wkeys.includes(x.key)) })} />
                  </span>
                ) : (
                  r.component
                )}
              </Td>
              <Td>{r.fabric}</Td>
              {r.grams.map((g, j) => {
                const cell = r.cells[j];
                const w = edit && cell && !cell.dim ? edit.draft.weights.find((x) => x.key === cell.key) : null;
                return (
                  <Td key={j} right>
                    {w && edit ? <Ed w="w-20" label={`${r.component} ${model.weights.sizeLabels[j]} — grams`} value={w.weight_g} onChange={(v) => edit.onChange({ ...edit.draft, weights: patchBy(edit.draft.weights, w.key, { weight_g: v }) })} /> : g == null ? "" : g}
                  </Td>
                );
              })}
              <Td right>
                {edit && r.wkeys.length ? (
                  <Ed w="w-16" label={`${r.component} — loss %`} value={edit.draft.weights.find((x) => x.key === r.wkeys[0])?.wastage_pct ?? ""} onChange={(v) => edit.onChange({ ...edit.draft, weights: edit.draft.weights.map((x) => (r.wkeys.includes(x.key) ? { ...x, wastage_pct: v } : x)) })} />
                ) : (
                  r.lossPct
                )}
              </Td>
            </tr>
          ))}
          <tr {...total}>
            <Td colSpan={(multi ? 1 : 0) + 2}>Fabric cost ₹ / {model.unitWord}</Td>
            {model.sizes.map((x) => (
              <Td key={x.label} right>{money(x.fabric)}</Td>
            ))}
            <Td>{null}</Td>
          </tr>
        </tbody>
      </ReportTable>
      {edit?.options ? (
        <div className="px-3.5 py-2">
          <AddWeight draft={edit.draft} onChange={edit.onChange} options={edit.options} sizes={model.sizes.map((x) => x.size)} />
        </div>
      ) : null}
    </SectionCard>
  );

  const secFabric = (
    <SectionCard title="Fabric processing cost" totalLabel="₹ per kg · yarn, knitting, dyeing, finishing, loss">
      <ReportTable bare>
        <thead>
          <tr>
            <Th>Fabric</Th>
            <Th right>Yarn</Th>
            <Th right>Knitting</Th>
            <Th right>Dyeing</Th>
            <Th right>Finishing</Th>
            <Th right>Special</Th>
            <Th right>Loss %</Th>
            <Th right>Price / kg</Th>
          </tr>
        </thead>
        <tbody>
          {model.fabrics.flatMap((f, fi) => {
            /* THE DRAFT ROW THIS LINE IS — present only while revising, when its
               cells turn into inputs. A direct fabric edits its Price / kg; a built
               fabric edits its Yarn (when it has no blend) and its Loss %, and the
               yarns / processes behind it open as a line of inputs beneath. */
            const d = edit?.draft.fabrics.find((x) => x.key === f.key);
            const blend = d ? !d.is_direct && hasYarnMix(d) : false;
            const rows = [
              <tr key={f.key} style={rowStyle(fi)}>
                <Td>
                  {d && edit?.options ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Pick label="Fabric structure" value={d.fabric_id} empty={d.quality || "Fabric structure"} options={edit.options.fabrics} w="w-40" onPick={(id, name) => setFabric(f.key, { fabric_id: id, quality: name })} />
                      <RemoveX label={f.name} onClick={() => edit.onChange({ ...edit.draft, fabrics: edit.draft.fabrics.filter((x) => x.key !== f.key) })} />
                    </span>
                  ) : (
                    f.name
                  )}
                </Td>
                <Td right>{f.direct ? "" : d && !blend ? <Ed label={`${f.name} — yarn rate ₹/kg`} value={d.yarn_rate} onChange={(v) => setFabric(f.key, { yarn_rate: v })} /> : money(f.yarn)}</Td>
                <Td right>{f.direct ? "" : money(f.knitting)}</Td>
                <Td right>{f.direct ? "" : money(f.dyeing)}</Td>
                <Td right>{f.direct ? "" : money(f.finishing)}</Td>
                <Td right>{f.direct ? "" : money(f.special)}</Td>
                <Td right>{f.direct ? "Direct" : d ? <Ed w="w-20" label={`${f.name} — process loss %`} value={d.process_loss_pct} onChange={(v) => setFabric(f.key, { process_loss_pct: v })} /> : fx(f.lossPct)}</Td>
                <Td right>{f.direct && d ? <Ed label={`${f.name} — direct rate ₹/kg`} value={d.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })} /> : <b>{money(f.price)}</b>}</Td>
              </tr>,
            ];
            if (d && edit) {
              const opts = edit.options;
              rows.push(
                <tr key={`${f.key}-parts`} style={{ background: "#f5f8fb" }}>
                  <Td colSpan={8}>
                    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5">
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={d.is_direct} onChange={(e) => setFabric(f.key, { is_direct: e.target.checked })} />
                        <span className="dim">Direct rate (bought-in)</span>
                      </label>
                      {!d.is_direct ? (
                        <>
                          {d.yarns.map((y, k) => (
                            <span key={y.key} className="inline-flex items-center gap-1.5">
                              {opts ? <Pick label="Yarn" value={y.item_id} empty={y.yarn_name || `Yarn ${k + 1}`} options={opts.yarns} w="w-40" onPick={(id, name) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { item_id: id, yarn_name: name }) })} /> : <span className="dim">{y.yarn_name || `Yarn ${k + 1}`}</span>}
                              <Ed w="w-16" label={`${y.yarn_name || "Yarn"} share %`} value={y.mix_pct} onChange={(v) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { mix_pct: v }) })} />
                              <span className="dim">%</span>
                              <Ed w="w-20" label={`${y.yarn_name || "Yarn"} rate ₹/kg`} value={y.rate} onChange={(v) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { rate: v }) })} />
                              <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: d.yarns.filter((x) => x.key !== y.key) })} />
                            </span>
                          ))}
                          {opts ? <Pick label="Add yarn" value={null} empty="+ Yarn" options={opts.yarns} w="w-28" onPick={(id, name) => setFabric(f.key, { yarns: [...d.yarns, { ...newYarnMix(), item_id: id, yarn_name: name }] })} /> : null}
                          {d.processes.map((q, k) => (
                            <span key={q.key} className="inline-flex items-center gap-1.5">
                              {opts ? <Pick label="Process" value={q.process_id} empty={q.process_name || `Process ${k + 1}`} options={opts.processes} w="w-40" onPick={(id, name) => setFabric(f.key, { processes: patchBy(d.processes, q.key, { process_id: id, process_name: name }) })} /> : <span className="dim">{q.process_name || `Process ${k + 1}`}</span>}
                              <Ed w="w-20" label={`${q.process_name || "Process"} rate ₹/kg`} value={q.rate} onChange={(v) => setFabric(f.key, { processes: patchBy(d.processes, q.key, { rate: v }) })} />
                              <RemoveX label={q.process_name || "process"} onClick={() => setFabric(f.key, { processes: d.processes.filter((x) => x.key !== q.key) })} />
                            </span>
                          ))}
                          {opts ? <Pick label="Add process" value={null} empty="+ Process" options={opts.processes} w="w-28" onPick={(id, name) => setFabric(f.key, { processes: [...d.processes, { ...newFabricProcess(), process_id: id, process_name: name }] })} /> : null}
                        </>
                      ) : null}
                    </div>
                  </Td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </ReportTable>
      {edit?.options ? (
        <div className="px-3.5 py-2">
          <AddFabric draft={edit.draft} onChange={edit.onChange} options={edit.options} />
        </div>
      ) : null}
    </SectionCard>
  );

  /** One operation's rate — a figure, or (while revising) the draft field it is. */
  const opRate = (o: CostSheetModel["ops"][number]) => {
    const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
    if (!edit || !piece) return money(o.rate);
    const label = `${o.name}${o.piece ? ` (${o.piece})` : ""} — rate ₹`;
    if (o.field === "cmt") return <Ed label={label} value={piece.cmt} onChange={(v) => setPiece(piece.key, { cmt: v })} />;
    if (o.field === "testing") return <Ed label={label} value={piece.testing_cost} onChange={(v) => setPiece(piece.key, { testing_cost: v })} />;
    const line = piece.lines.find((l) => l.key === o.lineKey);
    return line ? <Ed label={label} value={line.rate} onChange={(v) => setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { rate: v }) })} /> : money(o.rate);
  };
  const opName = (o: CostSheetModel["ops"][number]) =>
    edit && o.field === "line" && o.lineKey ? (
      <span className="inline-flex items-center gap-1.5">
        {o.name}
        <RemoveX
          label={o.name}
          onClick={() =>
            edit.onChange({
              ...edit.draft,
              pieces: edit.draft.pieces.map((x) => (x.key === o.pieceKey ? { ...x, lines: x.lines.filter((l) => l.key !== o.lineKey) } : x)),
            })
          }
        />
      </span>
    ) : (
      o.name
    );

  const secTri = (
    <div className="tri">
      {model.ops.some((o) => o.kind !== "CMT") || edit?.options ? (
        <SectionCard title="Fabric & garment processes" total={`₹ ${money(s.fabric + s.process + s.testing)} / ${model.unitWord}`}>
          <ReportTable bare>
            <thead>
              <tr>
                {multi ? <Th>Piece</Th> : null}
                <Th>Operation</Th>
                <Th right>Rate ₹</Th>
              </tr>
            </thead>
            <tbody>
              <tr style={rowStyle(0)}>
                {multi ? <Td>{null}</Td> : null}
                <Td>Fabric cost{model.sizes.length > 1 ? ` · ${s.label}` : ""}</Td>
                <Td right>{money(s.fabric)}</Td>
              </tr>
              {model.ops.filter((o) => o.kind !== "CMT").map((o, i) => (
                <tr key={i} style={rowStyle(i + 1)}>
                  {multi ? <Td>{o.piece}</Td> : null}
                  <Td>{opName(o)}</Td>
                  <Td right>{opRate(o)}</Td>
                </tr>
              ))}
              <tr {...total}>
                <Td colSpan={multi ? 2 : 1}>Fabric, processes &amp; testing</Td>
                <Td right>{money(s.fabric + s.process + s.testing)}</Td>
              </tr>
            </tbody>
          </ReportTable>
          {edit?.options ? (
            <div className="px-3.5 py-2">
              <AddOperation draft={edit.draft} onChange={edit.onChange} options={edit.options} />
            </div>
          ) : null}
        </SectionCard>
      ) : null}
      {model.ops.some((o) => o.kind === "CMT") || edit?.options ? (
        <SectionCard title="CMT operations" total={`₹ ${money(s.cmt)} / ${model.unitWord}`}>
          <ReportTable bare>
            <thead>
              <tr>
                {multi ? <Th>Piece</Th> : null}
                <Th>Operation</Th>
                <Th right>Rate ₹</Th>
              </tr>
            </thead>
            <tbody>
              {model.ops.filter((o) => o.kind === "CMT").map((o, i) => (
                <tr key={i} style={rowStyle(i)}>
                  {multi ? <Td>{o.piece}</Td> : null}
                  <Td>{opName(o)}</Td>
                  <Td right>{opRate(o)}</Td>
                </tr>
              ))}
              <tr {...total}>
                <Td colSpan={multi ? 2 : 1}>CMT</Td>
                <Td right>{money(s.cmt)}</Td>
              </tr>
            </tbody>
          </ReportTable>
          {edit?.options ? (
            <div className="px-3.5 py-2">
              <AddOperation draft={edit.draft} onChange={edit.onChange} options={edit.options} />
            </div>
          ) : null}
        </SectionCard>
      ) : null}
      {model.trims.length || edit?.options ? (
        <SectionCard title="Trims & accessories" total={`₹ ${money(s.trims)} / ${model.unitWord}`}>
          <ReportTable bare>
            <thead>
              <tr>
                {multi ? <Th>Piece</Th> : null}
                <Th>Trim</Th>
                <Th>Pricing</Th>
                <Th right>Consumption</Th>
                <Th right>Cost ₹</Th>
              </tr>
            </thead>
            <tbody>
              {model.trims.map((t, i) => {
                const d = edit?.draft.trims.find((x) => x.key === t.key);
                const set = (patch: Partial<NonNullable<typeof d>>) => d && edit?.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, d.key, patch) });
                return (
                  <tr key={i} style={rowStyle(i)}>
                    {multi ? <Td>{t.piece}</Td> : null}
                    <Td>
                      {edit ? (
                        <span className="inline-flex items-center gap-1.5">
                          {t.name}
                          <RemoveX label={t.name || "trim"} onClick={() => edit.onChange({ ...edit.draft, trims: edit.draft.trims.filter((x) => x.key !== t.key) })} />
                        </span>
                      ) : (
                        t.name
                      )}
                    </Td>
                    <Td className="dim">
                      {!edit || !d ? (
                        t.pricing
                      ) : (
                        // Direct: the flat ₹ per piece. Packed: the pack price (consumption beside it does the rest).
                        <span className="inline-flex items-center gap-1.5">
                          <label className="inline-flex items-center gap-1">
                            <input type="checkbox" checked={d.is_direct !== false} onChange={(e) => set({ is_direct: e.target.checked })} />
                            <span>Direct</span>
                          </label>
                          {d.is_direct !== false ? (
                            <Ed w="w-20" label={`${t.name} — direct rate ₹`} value={d.rate} onChange={(v) => set({ rate: v })} />
                          ) : (
                            <>
                              <Ed w="w-20" label={`${t.name} — pack price ₹`} value={d.pack_price} onChange={(v) => set({ pack_price: v })} />
                              <span>÷</span>
                              <Ed w="w-16" label={`${t.name} — pack size`} value={d.pack_size} onChange={(v) => set({ pack_size: v })} />
                            </>
                          )}
                        </span>
                      )}
                    </Td>
                    <Td right>{!edit || !d || d.is_direct !== false ? t.qty : <Ed w="w-20" label={`${t.name} — consumption`} value={d.qty} onChange={(v) => set({ qty: v })} />}</Td>
                    <Td right>{money(t.cost)}</Td>
                  </tr>
                );
              })}
              <tr {...total}>
                <Td colSpan={multi ? 4 : 3}>Trims</Td>
                <Td right>{money(s.trims)}</Td>
              </tr>
            </tbody>
          </ReportTable>
          {edit?.options ? (
            <div className="px-3.5 py-2">
              <AddTrim draft={edit.draft} onChange={edit.onChange} options={edit.options} />
            </div>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );

  const garmentLines = [
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
  ] as const;

  const secGarment = (
    <div className="gc" aria-label="Garment cost">
      <SectionCard title="Garment cost" totalLabel={`₹ per ${model.unitWord}${model.sizes.length > 1 ? " · every size" : ""}`}>
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Line</Th>
              {model.sizes.map((x) => (
                <Th key={x.label} right>{model.sizes.length > 1 ? x.label : "₹"}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {garmentLines.map(([label, pick, strong], i) => (
              <tr key={label} {...(strong ? total : { style: rowStyle(i) })}>
                <Td>{label}</Td>
                {model.sizes.map((x) => (
                  <Td key={x.label} right>{money(pick(x))}</Td>
                ))}
              </tr>
            ))}
            {model.terms.freight + model.terms.insurance > 0 ? (
              <tr>
                <Td>
                  Freight &amp; insurance <span className="dim">(on the price, not earned)</span>
                </Td>
                {model.sizes.map((x) => (
                  <Td key={x.label} right>{money((model.terms.freight + model.terms.insurance) * model.pieceCount)}</Td>
                ))}
              </tr>
            ) : null}
            {model.sizes.some((x) => x.priceAdj - x.discount !== 0) ? (
              <tr>
                <Td>Price charges &amp; discount</Td>
                {model.sizes.map((x) => (
                  <Td key={x.label} right>
                    {x.priceAdj - x.discount >= 0 ? "+" : "−"}
                    {money(Math.abs(x.priceAdj - x.discount))}
                  </Td>
                ))}
              </tr>
            ) : null}
            <tr {...total}>
              <Td>Price ₹</Td>
              {model.sizes.map((x) => (
                <Td key={x.label} right>{money(x.price)}</Td>
              ))}
            </tr>
          </tbody>
        </ReportTable>
      </SectionCard>
      <SectionCard title="Overheads & extra charges" total={`₹ ${money(s.bank + s.wastage + s.overhead + s.extraOverhead)} / ${model.unitWord}`}>
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Line</Th>
              <Th>Type</Th>
              <Th right>Value</Th>
              {model.sizes.map((x) => (
                <Th key={x.label} right>{model.sizes.length > 1 ? `${x.label} ₹` : "₹ / " + model.unitWord}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.overheads.map((o, i) => {
              const x = edit && o.edit.kind === "extra" ? edit.draft.extras.find((e) => e.key === o.edit.key) : null;
              const set = (patch: Partial<NonNullable<typeof x>>) => x && edit?.onChange({ ...edit.draft, extras: patchBy(edit.draft.extras, x.key, patch) });
              return (
                <tr key={i} style={rowStyle(i)}>
                  <Td>
                    {!edit || !x ? (
                      <>
                        {o.name.toUpperCase()}
                        {o.side === "price" ? <span className="dim"> (price)</span> : null}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <EdText label="Charge name" value={x.name} onChange={(v) => set({ name: v })} />
                        <RemoveX label={x.name || "charge"} onClick={() => edit.onChange({ ...edit.draft, extras: edit.draft.extras.filter((e) => e.key !== x.key) })} />
                      </span>
                    )}
                  </Td>
                  <Td className="dim">
                    {!edit || !x ? (
                      o.type
                    ) : (
                      <Select aria-label="Charge type" compact value={x.kind} onChange={(e) => set({ kind: e.target.value as "flat" | "pct" })} className="w-28" inputClassName="h-7 text-xs font-semibold">
                        <option value="flat">Flat ₹</option>
                        <option value="pct">Percent</option>
                      </Select>
                    )}
                  </Td>
                  <Td right>
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
                        return only ? <Ed w="w-20" label={label} value={only.bank_cost} onChange={(v) => edit.onChange({ ...dr, pieces: patchBy(dr.pieces, only.key, { bank_cost: v }) })} /> : o.value;
                      }
                      const ex = dr.extras.find((e) => e.key === o.edit.key);
                      return ex ? <Ed w="w-20" label={label} value={ex.value} onChange={(v) => edit.onChange({ ...dr, extras: patchBy(dr.extras, ex.key, { value: v }) })} /> : o.value;
                    })()}
                  </Td>
                  {o.perSize.map((v, j) => (
                    <Td key={j} right>
                      {o.side === "price" && v >= 0 ? "+" : o.side === "price" ? "−" : ""}
                      {money(Math.abs(v))}
                    </Td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </ReportTable>
        {edit ? (
          <div className="px-3.5 py-2">
            <AddCharge draft={edit.draft} onChange={edit.onChange} />
          </div>
        ) : null}
      </SectionCard>
    </div>
  );

  const target = edit ? Number(edit.draft.header.buyer_target_price) || null : model.targetPrice;
  const gap = target != null && shown != null ? Math.round((shown - target) * 100) / 100 : null;
  const negRows: [string, ReactNode, string?][] = [
    ["Calculated price", s.calc != null ? fx(s.calc, 2) : "—"],
    ["Quoted price", <b key="q">{shown != null ? fx(shown, 2) : "—"}</b>],
    ...(edit || model.targetPrice != null
      ? [["Buyer target price", edit ? <Ed key="t" w="w-24" label="Buyer target price" value={edit.draft.header.buyer_target_price} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, buyer_target_price: v } })} /> : fx(model.targetPrice, 2)] as [string, ReactNode]]
      : []),
    ...(gap != null
      ? [["Difference to target", <b key="g" style={{ color: gap > 0 ? "var(--cs-bad)" : "var(--cs-good)" }}>{gap === 0 ? "on target" : `${gap > 0 ? "+" : "−"}${fx(Math.abs(gap), 2)} ${gap > 0 ? "over" : "under"}`}</b>] as [string, ReactNode]]
      : []),
    ...(edit || model.commissionPct > 0
      ? [["Commission %", edit ? <Ed key="c" w="w-24" label="Commission %" value={edit.draft.header.commission_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, commission_pct: v } })} /> : `${fx(model.commissionPct)} %`] as [string, ReactNode]]
      : []),
    ...(edit || model.terms.discount > 0
      ? [["LC discount %", edit ? <Ed key="d" w="w-24" label="LC discount %" value={edit.draft.header.discount_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, discount_pct: v } })} /> : `${fx(model.terms.discount)} %`] as [string, ReactNode]]
      : []),
  ];

  const secCommercial = (
    <SectionCard
      title="Commercial quote & negotiation"
      totalLabel="price, target, commission and the revisions behind it"
      note={
        model.belowFloor || (model.status === "rejected" && model.decisionRemark) ? (
          <div className="space-y-1">
            {model.belowFloor ? (
              <div className="banner">
                {/* 0725: the buyer decides; the floor is a warning, not an MD gate. */}
                <b>{model.status === "approved" ? "Approved under the floor." : "Under the margin floor."}</b> The lowest size{model.lowestSize ? ` (${model.lowestSize})` : ""} earns {fx(model.lowestMarginPct)}%, under the {FLOOR_PCT}% floor.
              </div>
            ) : null}
            {model.status === "rejected" && model.decisionRemark ? (
              <div className="banner">
                <b>Rejected by the buyer:</b> {model.decisionRemark}
              </div>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="comm p-3.5">
        <div className="quote">
          <div className="quote-top">
            <div>
              <div className="eyebrow">{s.quoted != null ? "Quoted" : "Calculated"} FOB per {model.unitWord}</div>
              <div className="big">{shown != null ? `${ccy} ${fx(shown, 2)}`.trim() : "—"}</div>
              {inrOf(shown) != null ? (
                <div className="inr">
                  ₹ {money(inrOf(shown))} <small>per {model.unitWord} · at ₹ {fx(model.exchangeRate)} / {ccy}</small>
                </div>
              ) : null}
              <div className="sub">
                {s.calc != null ? `Calculated ${s.calc.toFixed(4)}` : "Add the exchange rate to see the price"}
                {delta != null && Math.abs(delta) > 0.00005 && s.deltaPct != null ? ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(4)} (${delta >= 0 ? "+" : ""}${s.deltaPct.toFixed(2)}%)` : ""}
              </div>
            </div>
          </div>
          <div>
            <div className="gauge-head">
              <span>Margin on the quote{model.sizes.length > 1 ? ` · ${s.label}` : ""}</span>
              <b>{eff == null ? "—" : `${eff.toFixed(2)}%`}</b>
            </div>
            <div className="track" aria-hidden>
              <div className="tick" style={{ left: `${(FLOOR_PCT / 30) * 100}%` }}>
                <span>{FLOOR_PCT}% floor</span>
              </div>
              <div className="tick" style={{ left: `${(MARGIN_TARGET_PCT / 30) * 100}%` }}>
                <span>{MARGIN_TARGET_PCT}% target</span>
              </div>
              {pin != null ? (
                <div className="pin" style={{ left: `${pin}%` }}>
                  <span>{eff?.toFixed(1)}%</span>
                  <i />
                </div>
              ) : null}
            </div>
            <div className="scale">
              <span>0%</span>
              <span>{MARGIN_RED_BELOW_PCT}%</span>
              <span>30%</span>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <ReportTable bare>
            <thead>
              <tr>
                <Th>Negotiation</Th>
                <Th right>{`${ccy || "price"} per ${model.unitWord}${model.sizes.length > 1 ? ` · size ${s.label}` : ""}`}</Th>
              </tr>
            </thead>
            <tbody>
              {negRows.map(([label, value], i) => (
                <tr key={label} style={rowStyle(i)}>
                  <Td className="dim">{label}</Td>
                  <Td right>{value}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      </div>
    </SectionCard>
  );

  const secPriceBySize = (
    <SectionCard title="Price by size">
      <ReportTable bare>
        <thead>
          <tr>
            <Th>Size</Th>
            <Th right>Net ₹</Th>
            <Th right>Gross cost ₹</Th>
            <Th right>Price ₹</Th>
            <Th right>{`Calc ${ccy}`.trim()}</Th>
            <Th right>{`Quoted ${ccy}`.trim()}</Th>
            <Th right>Quoted ₹</Th>
            <Th right>Margin %</Th>
          </tr>
        </thead>
        <tbody>
          {model.sizes.map((x, i) => (
            <tr key={x.label} {...(i === idx && model.sizes.length > 1 ? total : { style: rowStyle(i) })}>
              <Td>{x.label}</Td>
              <Td right>{money(x.net)}</Td>
              <Td right>{money(x.grossCost)}</Td>
              <Td right>{money(x.price)}</Td>
              <Td right>{x.calc == null ? "—" : x.calc.toFixed(4)}</Td>
              <Td right>{x.quoted == null ? "—" : x.quoted.toFixed(4)}</Td>
              <Td right>{money(inrOf(x.quoted))}</Td>
              <Td right>{x.effectiveMarginPct == null ? "—" : `${fx(x.effectiveMarginPct)}%`}</Td>
            </tr>
          ))}
        </tbody>
      </ReportTable>
    </SectionCard>
  );

  const secTerms = edit ? (
    <SectionCard title="Terms & quote" totalLabel="exchange rate, discount, freight, insurance and the quoted price">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3.5 text-[12px]">
        {(
          [
            ["Exchange rate", "exchange_rate"],
            ["Discount %", "discount_pct"],
            ["Freight / pc", "freight_per_pc"],
            ["Insurance / pc", "insurance_per_pc"],
          ] as const
        ).map(([label, field]) => (
          <label key={field} className="inline-flex items-center gap-1.5">
            <span className="dim">{label}</span>
            <Ed w="w-20" label={label} value={edit.draft.header[field]} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, [field]: v } })} />
          </label>
        ))}
        {edit.draft.pieces.flatMap((p) =>
          model.sizes.map((x) => {
            const k = quoteKey(p.key, x.size);
            return (
              <label key={k} className="inline-flex items-center gap-1.5">
                <span className="dim">
                  Quote{edit.draft.pieces.length > 1 ? ` ${p.piece_name || "piece"}` : ""}
                  {model.sizes.length > 1 ? ` ${x.label}` : ""}
                </span>
                <Ed
                  w="w-24"
                  label={`Quoted price ${x.label}`}
                  value={edit.draft.quotes[k] ?? ""}
                  onChange={(v) => {
                    edit.onQuote?.(k);
                    edit.onChange({ ...edit.draft, quotes: { ...edit.draft.quotes, [k]: v } });
                  }}
                />
              </label>
            );
          }),
        )}
      </div>
    </SectionCard>
  ) : null;

  // INTERNAL, so the margin each revision carried is here; absent when never revised.
  const secHistory = <RevisionHistory rows={model.history} currency={ccy || null} showMargin hrefFor={(id) => `/sales/sample-costing/${id}/reports?tab=cost-sheet`} />;

  const signBlock = (
    <div className="rounded-lg border border-border bg-white px-5 pb-3 pt-2">
      <SignOff />
      {/* The closing line belongs to the sign-off (user 2026-10-12: "ella tab layum
          katta venda, quote and sign off la mattum") — it closes the document. */}
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-[11px] text-[#7b8594]">
        <span>Internal document. For the buyer, use the Quotation.</span>
        <span className="font-semibold">
          {model.costingNo ?? ""} · {model.revision}
        </span>
      </div>
    </div>
  );

  const tabDefs = [
    { label: "Details", hint: "buyer & style" },
    { label: "Fabric", hint: `₹ ${money(s.fabric)} / ${model.unitWord}` },
    { label: "Operations & trims", hint: `₹ ${money(s.cmt + s.process + s.testing + s.trims)} / ${model.unitWord}` },
    { label: "Cost & overheads", hint: `₹ ${money(s.grossCost)} total` },
    { label: "Quotation", hint: `${shown != null ? `${ccy} ${fx(shown, 2)}`.trim() : "—"} · ${eff == null ? "—" : `${eff.toFixed(1)}%`}` },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (tab + (e.key === "ArrowRight" ? 1 : tabDefs.length - 1)) % tabDefs.length;
    setTab(n);
    document.getElementById(`cs-tab-${n}`)?.focus();
  };

  /* THE APPROVAL LINE (client 2026-10-09: "where is the approver") — where this
     costing stands with the buyer, and who recorded it. INTERNAL; the Quotation
     says only "Approved on …". */
  const approvalLine = (
    <div className="apv rounded-b-md border border-t-0 border-border" data-tone={model.approval.tone}>
      <b>Approval: {model.approval.text}</b>
      {model.approval.detail ? <span>{model.approval.detail}</span> : null}
    </div>
  );

  return (
    <article className="cs-sheet space-y-3">
      <style>{CSS}</style>
      <div>
        <SheetMasthead
          company={model.company}
          kind="Sample Cost Sheet — internal"
          reNo={`${model.costingNo ?? "—"} · ${model.revision}`}
          meta={
            <>
              {model.date ? <span>Dated {fmtDate(model.date)}</span> : null}
              {/* The kit's own pill is green; only an approved sheet earns it. */}
              {model.status !== "approved" ? <span className={`pill ${stateClass}`}>{model.statusLabel}</span> : null}
            </>
          }
          status={model.status === "approved" ? model.statusLabel : null}
        />
        {view === "tabs" ? null : factsBlock}
        {approvalLine}
      </div>

      {view === "charts" ? (
        <section className="dash" aria-label="Price charts">
          <div className="col">
            <div className="box">
              <h4>
                How the price is built
                <span>
                  ₹ per {model.unitWord}
                  {model.sizes.length > 1 ? ` · size ${s.label}` : ""}
                </span>
              </h4>
              <div className="wf">
                {wfRows.map((r) => (
                  <div key={r.label} className={`wf-row${r.total ? " tot" : ""}`}>
                    <span className="lab">{r.label}</span>
                    <div className="lane">
                      <div className="bar" style={{ left: `${(r.start / wfMax) * 100}%`, width: `${(r.width / wfMax) * 100}%`, background: r.total ? "var(--cs-brand)" : TONE_VAR[r.tone as keyof typeof TONE_VAR] }} />
                    </div>
                    <span className="val">
                      {!r.total && r.value < 0 ? "−" : ""}
                      {money(r.width)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="col">
            <div className="box">
              <h4>
                Where the price goes <span>share of the ₹ price</span>
              </h4>
              <div className="donut">
                <svg viewBox="0 0 120 120" role="img" aria-label="Share of the price by cost group">
                  <circle cx="60" cy="60" r={R} fill="none" stroke="var(--cs-soft)" strokeWidth="16" />
                  {parts.map((p, i) => {
                    const len = (p.value / partTotal) * C;
                    return <circle key={p.label} cx="60" cy="60" r={R} fill="none" stroke={TONE_VAR[p.tone]} strokeWidth="16" strokeDasharray={`${Math.max(len - 1.2, 0)} ${C}`} strokeDashoffset={-offs[i]} transform="rotate(-90 60 60)" />;
                  })}
                  <text x="60" y="57" textAnchor="middle" fontSize="7.5" fontWeight="600" style={{ fill: "var(--cs-muted)" }}>
                    PRICE ₹
                  </text>
                  <text x="60" y="71" textAnchor="middle" fontSize="14" fontWeight="800">
                    {money(partTotal)}
                  </text>
                </svg>
                <div className="lg">
                  {parts.map((p) => (
                    <div key={p.label}>
                      <i style={{ background: TONE_VAR[p.tone] }} />
                      <span>{p.label}</span>
                      <span className="p">{((p.value / partTotal) * 100).toFixed(1)}%</span>
                      <span className="a">{money(p.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {model.sizes.length > 1 ? (
              <div className="box">
                <h4>
                  Size comparison <span>quote and margin</span>
                </h4>
                <div>
                  {model.sizes.map((x) => (
                    <div className="hb cmp" key={x.label}>
                      <b>{x.label}</b>
                      <div className="lane">
                        <div className="bar" style={{ left: 0, width: `${(x.grossCost / worst) * 100}%`, background: "var(--cs-over)" }} />
                        <div className="bar" style={{ left: `${(x.grossCost / worst) * 100}%`, width: `${(Math.max(x.price - x.grossCost, 0) / worst) * 100}%`, background: "var(--cs-margin)" }} />
                      </div>
                      <span className="v">
                        {x.quoted != null ? `${ccy} ${fx(x.quoted)}` : "—"}
                        {inrOf(x.quoted) != null ? ` · ₹ ${money(inrOf(x.quoted))}` : ""} · {x.effectiveMarginPct == null ? "—" : `${x.effectiveMarginPct.toFixed(1)}%`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="keys">
                  <span>
                    <i style={{ background: "var(--cs-over)" }} />
                    Gross cost
                  </span>
                  <span>
                    <i style={{ background: "var(--cs-margin)" }} />
                    Margin and price charges
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="col">
            {model.fabrics.map((f) => {
              const sub = f.yarn + f.knitting + f.dyeing + f.finishing + f.special;
              const loss = f.price != null && !f.direct ? Math.max(f.price - sub, 0) : 0;
              const base = f.direct ? (f.price ?? 1) : Math.max(sub + loss, 1);
              const seg = (v: number) => `${(v / base) * 100}%`;
              return (
                <div className="box" key={f.name}>
                  <h4>
                    Fabric rate <span>{f.name}</span>
                  </h4>
                  <div className="big2">
                    ₹ {money(f.price)} <small>per kg{f.direct ? " · direct rate" : f.lossPct ? ` · incl. ${f.lossPct}% process loss` : ""}</small>
                  </div>
                  {f.direct ? null : (
                    <>
                      <div className="stack" aria-hidden>
                        <i style={{ width: seg(f.yarn), background: "var(--cs-fabric)" }} />
                        <i style={{ width: seg(f.knitting), background: "var(--cs-cmt)" }} />
                        <i style={{ width: seg(f.dyeing), background: "var(--cs-over)" }} />
                        <i style={{ width: seg(f.finishing + f.special), background: "var(--cs-trims)" }} />
                        <i style={{ width: seg(loss), background: "var(--cs-muted)", opacity: 0.5 }} />
                      </div>
                      <div className="keys">
                        <span>
                          <i style={{ background: "var(--cs-fabric)" }} />
                          Yarn <b>{money(f.yarn)}</b>
                        </span>
                        <span>
                          <i style={{ background: "var(--cs-cmt)" }} />
                          Knitting <b>{money(f.knitting)}</b>
                        </span>
                        <span>
                          <i style={{ background: "var(--cs-over)" }} />
                          Dyeing <b>{money(f.dyeing)}</b>
                        </span>
                        <span>
                          <i style={{ background: "var(--cs-trims)" }} />
                          Finishing{f.special ? " + special" : ""} <b>{money(f.finishing + f.special)}</b>
                        </span>
                        <span>
                          <i style={{ background: "var(--cs-muted)", opacity: 0.5 }} />
                          Loss <b>{money(loss)}</b>
                        </span>
                      </div>
                      {f.mixNote ? <div className="sub">{f.mixNote}</div> : null}
                    </>
                  )}
                </div>
              );
            })}
            <div className="box">
              <h4>
                Garment weight <span>grams{model.sizes.length > 1 ? ` · size ${s.label}` : ""}</span>
              </h4>
              <div>
                {model.weights.rows.map((r, i) => {
                  const g = r.grams[idx] ?? r.grams.find((x) => x != null) ?? null;
                  const top = Math.max(...model.weights.rows.map((x) => x.grams[idx] ?? 0), 1);
                  return (
                    <div className="hb" key={`${r.component}-${i}`}>
                      <span className="dim">{r.component || r.fabric || "Component"}</span>
                      <div className="lane">
                        <div className="bar" style={{ left: 0, width: `${((g ?? 0) / top) * 100}%`, background: "var(--cs-fabric)" }} />
                      </div>
                      <span className="v">{g == null ? "—" : `${g} g`}</span>
                    </div>
                  );
                })}
              </div>
              <div className="sub">
                {s.grams} g, {s.gramsWithLoss} g with loss, fabric ₹ {money(s.fabric)}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* FULL PAGE (what Print prints): every block stacked, in the PDF's order. */}
      {view === "report" ? (
        <>
          {tiles}
          {secConsumption}
          {secFabric}
          {secTri}
          {secGarment}
          {secCommercial}
          {secPriceBySize}
          {secTerms}
          {secHistory}
          {signBlock}
        </>
      ) : null}

      {/* TABS (client 2026-10-12): the same blocks a few at a time, each read at full
          size and nothing to scroll. The masthead and approval line stay put. */}
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
            {tab === 0 ? <div className="overflow-hidden rounded-lg border-t border-border">{factsBlock}</div> : null}
            {tab === 1 ? (
              <>
                {secConsumption}
                {secFabric}
              </>
            ) : null}
            {tab === 2 ? secTri : null}
            {tab === 3 ? secGarment : null}
            {tab === 4 ? (
              <>
                {tiles}
                {secCommercial}
                {secPriceBySize}
                {secTerms}
                {secHistory}
                {signBlock}
              </>
            ) : null}
          </div>
        </>
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
  background:var(--cs-sheet); color:var(--cs-ink); border:1px solid var(--cs-rule); border-radius:14px; padding:14px 18px; min-width:0; font-variant-numeric:tabular-nums;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media (max-width:560px){ .cs-sheet { padding:12px; } }
.cs-sheet * { box-sizing:border-box; }
.cs-sheet h2,.cs-sheet h3,.cs-sheet h4,.cs-sheet p { margin:0; }
.cs-sheet .dim { color:var(--cs-muted); }
.cs-sheet .pill { display:inline-flex; align-items:center; height:20px; padding-inline:9px; border-radius:10px; font-size:11px; font-weight:700; }
.cs-sheet .pill.good { background:var(--cs-good-tint); color:var(--cs-good); } .cs-sheet .pill.warn { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .pill.bad { background:var(--cs-bad-tint); color:var(--cs-bad); } .cs-sheet .pill.brand { background:var(--cs-brand-tint); color:var(--cs-brand-ink); }
/* THE APPROVAL LINE, closing the masthead + facts block. */
.cs-sheet .apv { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 14px; padding:7px 20px; font-size:12.5px; }
.cs-sheet .apv span { font-size:12px; opacity:.85; }
.cs-sheet .apv[data-tone="good"] { background:var(--cs-good-tint); color:var(--cs-good); }
.cs-sheet .apv[data-tone="warn"] { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .apv[data-tone="bad"] { background:var(--cs-bad-tint); color:var(--cs-bad); }
.cs-sheet .apv[data-tone="muted"] { background:var(--cs-soft); color:var(--cs-muted); }
/* Fabric & garment processes, CMT and trims side by side; Garment cost beside Overheads. */
.cs-sheet .tri { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr); gap:12px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .tri { grid-template-columns:1fr; } }
.cs-sheet .gc { display:flex; flex-direction:column; gap:12px; }
.cs-sheet .tpanel .gc { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); align-items:start; }
@media (max-width:900px){ .cs-sheet .tpanel .gc { grid-template-columns:1fr; } }
/* THE COMMERCIAL BAND: the quote and its margin gauge beside the negotiation, read at a glance. */
.cs-sheet .comm { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); gap:14px; align-items:start; }
@media (max-width:860px){ .cs-sheet .comm { grid-template-columns:1fr; } }
.cs-sheet .quote { background:var(--cs-brand-tint); border-radius:10px; padding:8px 12px; display:flex; flex-direction:column; gap:4px; min-width:0; }
.cs-sheet .quote-top { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.cs-sheet .eyebrow { font-size:11px; letter-spacing:.1em; text-transform:uppercase; font-weight:700; color:var(--cs-muted); }
.cs-sheet .big { font-size:24px; line-height:1; font-weight:800; letter-spacing:-.02em; color:var(--cs-brand-ink); margin-top:1px; }
.cs-sheet .sub { color:var(--cs-muted); font-size:11.5px; margin-top:1px; }
.cs-sheet .inr { font-size:13px; font-weight:700; color:var(--cs-ink); }
.cs-sheet .inr small { font-weight:500; color:var(--cs-muted); font-size:11.5px; }
.cs-sheet .gauge-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12px; }
.cs-sheet .gauge-head b { font-size:15px; }
.cs-sheet .track { position:relative; height:8px; border-radius:6px; margin-top:20px; background:linear-gradient(90deg,#d9534f 0 50%,#e9a93a 50% 73.33%,#2f9e5b 73.33% 100%); opacity:.85; }
.cs-sheet .tick { position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--cs-ink); opacity:.55; }
.cs-sheet .tick span { position:absolute; top:16px; transform:translateX(-50%); font-size:10px; color:var(--cs-muted); white-space:nowrap; font-weight:600; }
.cs-sheet .pin { position:absolute; top:-8px; width:18px; height:24px; transform:translateX(-50%); }
.cs-sheet .pin i { display:block; width:4px; height:100%; margin-inline:auto; background:var(--cs-ink); border-radius:2px; box-shadow:0 0 0 2px #fff; }
.cs-sheet .pin span { position:absolute; bottom:26px; left:50%; transform:translateX(-50%); background:var(--cs-ink); color:#fff; font-size:10.5px; font-weight:700; padding:1px 7px; border-radius:6px; white-space:nowrap; }
.cs-sheet .scale { display:flex; justify-content:space-between; margin-top:16px; font-size:10px; color:var(--cs-muted); }
.cs-sheet .banner { border:1px solid var(--cs-warn); background:var(--cs-warn-tint); border-radius:6px; padding:7px 12px; font-size:12.5px; }
.cs-sheet .banner b { color:var(--cs-warn); }
/* THE CHARTS VIEW IS ONE SCREEN (client 2026-10-10: "why can't we fit in single
   screen"): build | split + sizes | fabric + weight, side by side, instead of
   stacked bands. Two columns on a narrow pane, one on a phone. */
.cs-sheet .dash { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .dash { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:700px){ .cs-sheet .dash { grid-template-columns:1fr; } }
.cs-sheet .dash .col { display:flex; flex-direction:column; gap:10px; min-width:0; }
.cs-sheet .box { border:1px solid var(--cs-rule); border-radius:12px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; min-width:0; background:#fff; }
.cs-sheet .box h4 { font-size:13px; font-weight:800; display:flex; justify-content:space-between; gap:8px; }
.cs-sheet .box h4 span { color:var(--cs-muted); font-weight:500; font-size:12px; }
.cs-sheet .wf { display:flex; flex-direction:column; gap:3px; }
.cs-sheet .wf-row { display:grid; grid-template-columns:132px minmax(0,1fr) 62px; gap:10px; align-items:center; font-size:12.5px; }
.cs-sheet .wf-row .lab { color:var(--cs-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cs-sheet .wf-row .val { text-align:right; font-weight:600; }
.cs-sheet .wf-row.tot .lab { color:var(--cs-ink); font-weight:800; } .cs-sheet .wf-row.tot .val { font-weight:800; }
.cs-sheet .lane { position:relative; height:14px; background:var(--cs-soft); border-radius:5px; }
.cs-sheet .bar { position:absolute; top:0; bottom:0; border-radius:5px; min-width:3px; }
.cs-sheet .donut { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.cs-sheet .donut svg { width:112px; height:112px; flex:none; } .cs-sheet .donut text { fill:var(--cs-ink); }
.cs-sheet .lg { flex:1 1 170px; display:flex; flex-direction:column; gap:4px; font-size:12px; min-width:0; }
.cs-sheet .lg div { display:grid; grid-template-columns:12px 1fr auto auto; gap:8px; align-items:center; }
.cs-sheet .lg i { width:12px; height:12px; border-radius:4px; display:block; }
.cs-sheet .lg .p { color:var(--cs-muted); width:44px; text-align:right; } .cs-sheet .lg .a { font-weight:700; }
.cs-sheet .stack { display:flex; height:22px; border-radius:6px; overflow:hidden; gap:2px; } .cs-sheet .stack i { display:block; height:100%; }
.cs-sheet .keys { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:var(--cs-muted); }
.cs-sheet .keys b { color:var(--cs-ink); } .cs-sheet .keys i { display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:5px; }
.cs-sheet .big2 { font-size:19px; font-weight:800; letter-spacing:-.01em; } .cs-sheet .big2 small { font-size:12px; color:var(--cs-muted); font-weight:500; letter-spacing:0; }
.cs-sheet .hb { display:grid; grid-template-columns:110px minmax(0,1fr) 54px; gap:8px; align-items:center; font-size:12px; margin-bottom:3px; }
.cs-sheet .hb.cmp { grid-template-columns:24px minmax(0,1fr) auto; }
.cs-sheet .hb .lane { height:12px; } .cs-sheet .hb .v { text-align:right; font-weight:600; }
.cs-sheet .ctabs { display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .ctab { border:1px solid transparent; border-bottom:0; background:transparent; border-radius:8px 8px 0 0; padding:7px 16px 8px; margin-bottom:-1px; display:flex; flex-direction:column; align-items:flex-start; color:var(--cs-muted); cursor:pointer; text-align:left; gap:1px; }
/* The NAME is ink and heavy on every tab, not only the open one (user 2026-10-12: "tab field name lam
   therira mari bold"): muted grey at 700 read as disabled. The hint under it stays muted. */
.cs-sheet .ctab > span { color:var(--cs-ink); font-weight:800; font-size:14px; letter-spacing:.01em; }
.cs-sheet .ctab small { color:var(--cs-muted); font-weight:500; font-size:11.5px; font-variant-numeric:tabular-nums; }
.cs-sheet .ctab:hover { background:var(--cs-soft); color:var(--cs-ink); }
.cs-sheet .ctab[aria-selected="true"] { color:var(--cs-brand-ink); background:#fff; border-color:var(--cs-rule); border-bottom:1px solid #fff; box-shadow:inset 0 3px 0 var(--cs-brand); }
.cs-sheet .ctab[aria-selected="true"] > span { color:var(--cs-brand-ink); }
.cs-sheet .ctab:focus-visible { outline:2px solid var(--cs-brand); outline-offset:-2px; }
.cs-sheet .tpanel { display:flex; flex-direction:column; gap:12px; }
@media print {
  .cs-sheet { border:0; border-radius:0; padding:0; }
  .cs-sheet section, .cs-sheet .box { break-inside:avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}
`;
