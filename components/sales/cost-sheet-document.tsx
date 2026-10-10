"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { AddCharge, AddFabric, AddOperation, AddTrim, AddWeight, EdText, Pick, RemoveX, type EditOptions } from "@/components/sales/cost-sheet-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { fmtDate } from "@/lib/format";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_RED_BELOW_PCT, MARGIN_TARGET_PCT, hasYarnMix, quoteKey } from "@/lib/sales/sample-costing/calc";
import type { CostingDraft, FabricDraft, PieceDraft } from "@/lib/sales/sample-costing/types";
import { changeText } from "@/lib/sales/sample-costing/revision-history";
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
  // opens first; Print prints the view on screen, the PDF is unaffected.
  const [view, setView] = useState<SheetView>("report");
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
            { value: "report", label: "Report" },
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
              <Button variant="outline" size="md" onClick={() => window.print()}>
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

type SheetView = "report" | "charts";

function Sheet({ model, s, idx, edit, view }: { model: CostSheetModel; s: SizeFigures; idx: number; edit?: CostSheetEdit; view: SheetView }) {
  const setFabric = (key: string, patch: Partial<FabricDraft>) => edit?.onChange({ ...edit.draft, fabrics: patchBy(edit.draft.fabrics, key, patch) });
  const setPiece = (key: string, patch: Partial<PieceDraft>) => edit?.onChange({ ...edit.draft, pieces: patchBy(edit.draft.pieces, key, patch) });
  const eff = s.effectiveMarginPct;
  const pin = eff == null ? null : (Math.min(Math.max(eff, 0), 30) / 30) * 100;
  const ccy = model.currency ?? "";
  const stateClass = model.status === "approved" ? "good" : model.status === "submitted" ? "warn" : model.status === "rejected" ? "bad" : "brand";
  const delta = s.delta;
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
          clears the floor, else the MD by name. INTERNAL; the Quotation says only
          "Approved on …". */}
      <div className="apv" data-tone={model.approval.tone}>
        <b>Approval: {model.approval.text}</b>
        {model.approval.detail ? <span>{model.approval.detail}</span> : null}
      </div>

      <div className="pad">
        {/* 1 · HEADER — the RAAGAM COSTING FORMAT's top block (client 2026-10-09). Only the
            lines this costing has a value for print: an empty "Buying Agent" row is chrome. */}
        <section className="blk hdrblk" aria-label="Header">
          <div className="hdr-title">
            <div className="min0">
              <div className="eyebrow">Garment costing{model.season ? ` · ${model.season}` : ""}</div>
              <h2>{model.description || model.style || "—"}</h2>
              <div className="chips">
                {model.sampleNo ? (
                  <span className="chip">
                    Sample <b>{model.sampleNo}</b>
                  </span>
                ) : null}
                <span className="chip">{model.isSet ? "SET" : "PCS"}</span>
                {/* CHARTS FIT ONE SCREEN, so the two spec tables give way to their two
                    facts that matter at a glance; the Report keeps the full block. */}
                {view === "charts" && model.customer ? (
                  <span className="chip">
                    Buyer <b>{model.customer}</b>
                  </span>
                ) : null}
                {view === "charts" && model.fabricFacts.structure ? (
                  <span className="chip">
                    Fabric <b>{model.fabricFacts.structure}</b>
                  </span>
                ) : null}
                {model.shipMode ? (
                  <span className="chip">
                    Ship <b>{model.shipMode}</b>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {view === "report" ? (
          <div className="hdr-grid">
            <dl className="spec">
              {(
                [
                  ["Buyer / importer", model.customer],
                  ["Enquiry", model.enquiryNo],
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
          ) : null}
        </section>

        {view === "charts" ? (
        <section className="dash" aria-label="Price charts">
          <div className="col">
          <div className="sec">
            <div className="sec-h">
              <h3>How the price is built</h3>
              <span>
                ₹ per {model.unitWord}
                {model.sizes.length > 1 ? ` · size ${s.label}` : ""}
              </span>
            </div>
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
          <div className="sec">
            <div className="sec-h">
              <h3>Where the price goes</h3>
              <span>share of the ₹ price</span>
            </div>
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
                  <span><i style={{ background: "var(--cs-over)" }} />Gross cost</span>
                  <span><i style={{ background: "var(--cs-margin)" }} />Margin and price charges</span>
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
                        <span><i style={{ background: "var(--cs-fabric)" }} />Yarn <b>{money(f.yarn)}</b></span>
                        <span><i style={{ background: "var(--cs-cmt)" }} />Knitting <b>{money(f.knitting)}</b></span>
                        <span><i style={{ background: "var(--cs-over)" }} />Dyeing <b>{money(f.dyeing)}</b></span>
                        <span><i style={{ background: "var(--cs-trims)" }} />Finishing{f.special ? " + special" : ""} <b>{money(f.finishing + f.special)}</b></span>
                        <span><i style={{ background: "var(--cs-muted)", opacity: 0.5 }} />Loss <b>{money(loss)}</b></span>
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

        {view === "report" ? (
        <>
        <section className="blk" aria-label="Component consumption">
          <details open>
            <summary>
              Component consumption <span>grams per size, with loss %</span>
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
                  </tr>
                </thead>
                <tbody>
                  {model.weights.rows.map((r, i) => (
                    <tr key={i}>
                      {model.pieceCount > 1 ? <td>{r.piece}</td> : null}
                      <td>
                        {edit && r.wkeys.length ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {r.component}
                            <RemoveX label={r.component || "weight line"} onClick={() => edit.onChange({ ...edit.draft, weights: edit.draft.weights.filter((x) => !r.wkeys.includes(x.key)) })} />
                          </span>
                        ) : (
                          r.component
                        )}
                      </td>
                      <td>{r.fabric}</td>
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
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={(model.pieceCount > 1 ? 1 : 0) + 2}>Fabric cost ₹ / {model.unitWord}</td>
                    {model.sizes.map((x) => (
                      <td key={x.label} className="r">{money(x.fabric)}</td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
              {edit?.options ? <AddWeight draft={edit.draft} onChange={edit.onChange} options={edit.options} sizes={model.sizes.map((x) => x.size)} /> : null}
            </div>
          </details>
        </section>

        <section className="blk fabblk" aria-label="Fabric processing cost">
          <div>
            <details open>
              <summary>
                Fabric processing cost <span>₹ per kg · yarn, knitting, dyeing, finishing, loss</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fabric</th>
                      <th className="r">Yarn</th>
                      <th className="r">Knitting</th>
                      <th className="r">Dyeing</th>
                      <th className="r">Finishing</th>
                      <th className="r">Special</th>
                      <th className="r">Loss %</th>
                      <th className="r">Price / kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.fabrics.flatMap((f) => {
                      /* THE DRAFT ROW THIS LINE IS — present only while revising, when its
                         cells turn into inputs. A direct fabric edits its Price / kg; a built
                         fabric edits its Yarn (when it has no blend) and its Loss %, and the
                         yarns / processes behind it open as a line of inputs beneath. */
                      const d = edit?.draft.fabrics.find((x) => x.key === f.key);
                      const blend = d ? !d.is_direct && hasYarnMix(d) : false;
                      const rows = [
                        <tr key={f.key}>
                          <td>
                            {d && edit?.options ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <Pick label="Fabric structure" value={d.fabric_id} empty={d.quality || "Fabric structure"} options={edit.options.fabrics} w="w-40" onPick={(id, name) => setFabric(f.key, { fabric_id: id, quality: name })} />
                                <RemoveX label={f.name} onClick={() => edit.onChange({ ...edit.draft, fabrics: edit.draft.fabrics.filter((x) => x.key !== f.key) })} />
                              </span>
                            ) : (
                              f.name
                            )}
                          </td>
                          <td className="r">
                            {f.direct ? "" : d && !blend ? <Ed label={`${f.name} — yarn rate ₹/kg`} value={d.yarn_rate} onChange={(v) => setFabric(f.key, { yarn_rate: v })} /> : money(f.yarn)}
                          </td>
                          <td className="r">{f.direct ? "" : money(f.knitting)}</td>
                          <td className="r">{f.direct ? "" : money(f.dyeing)}</td>
                          <td className="r">{f.direct ? "" : money(f.finishing)}</td>
                          <td className="r">{f.direct ? "" : money(f.special)}</td>
                          <td className="r">
                            {f.direct ? "Direct" : d ? <Ed w="w-20" label={`${f.name} — process loss %`} value={d.process_loss_pct} onChange={(v) => setFabric(f.key, { process_loss_pct: v })} /> : fx(f.lossPct)}
                          </td>
                          <td className="r">
                            {f.direct && d ? <Ed label={`${f.name} — direct rate ₹/kg`} value={d.direct_rate} onChange={(v) => setFabric(f.key, { direct_rate: v })} /> : <b>{money(f.price)}</b>}
                          </td>
                        </tr>,
                      ];
                      if (d && edit) {
                        const opts = edit.options;
                        rows.push(
                          <tr key={`${f.key}-parts`} className="sub">
                            <td colSpan={8}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <input type="checkbox" checked={d.is_direct} onChange={(e) => setFabric(f.key, { is_direct: e.target.checked })} />
                                  <span className="dim">Direct rate (bought-in)</span>
                                </label>
                                {!d.is_direct ? (
                                  <>
                                    {d.yarns.map((y, k) => (
                                      <span key={y.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                        {opts ? <Pick label="Yarn" value={y.item_id} empty={y.yarn_name || `Yarn ${k + 1}`} options={opts.yarns} w="w-40" onPick={(id, name) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { item_id: id, yarn_name: name }) })} /> : <span className="dim">{y.yarn_name || `Yarn ${k + 1}`}</span>}
                                        <Ed w="w-16" label={`${y.yarn_name || "Yarn"} share %`} value={y.mix_pct} onChange={(v) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { mix_pct: v }) })} />
                                        <span className="dim">%</span>
                                        <Ed w="w-20" label={`${y.yarn_name || "Yarn"} rate ₹/kg`} value={y.rate} onChange={(v) => setFabric(f.key, { yarns: patchBy(d.yarns, y.key, { rate: v }) })} />
                                        <RemoveX label={y.yarn_name || "yarn"} onClick={() => setFabric(f.key, { yarns: d.yarns.filter((x) => x.key !== y.key) })} />
                                      </span>
                                    ))}
                                    {opts ? <Pick label="Add yarn" value={null} empty="+ Yarn" options={opts.yarns} w="w-28" onPick={(id, name) => setFabric(f.key, { yarns: [...d.yarns, { ...newYarnMix(), item_id: id, yarn_name: name }] })} /> : null}
                                    {d.processes.map((q, k) => (
                                      <span key={q.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                        {opts ? <Pick label="Process" value={q.process_id} empty={q.process_name || `Process ${k + 1}`} options={opts.processes} w="w-40" onPick={(id, name) => setFabric(f.key, { processes: patchBy(d.processes, q.key, { process_id: id, process_name: name }) })} /> : <span className="dim">{q.process_name || `Process ${k + 1}`}</span>}
                                        <Ed w="w-20" label={`${q.process_name || "Process"} rate ₹/kg`} value={q.rate} onChange={(v) => setFabric(f.key, { processes: patchBy(d.processes, q.key, { rate: v }) })} />
                                        <RemoveX label={q.process_name || "process"} onClick={() => setFabric(f.key, { processes: d.processes.filter((x) => x.key !== q.key) })} />
                                      </span>
                                    ))}
                                    {opts ? <Pick label="Add process" value={null} empty="+ Process" options={opts.processes} w="w-28" onPick={(id, name) => setFabric(f.key, { processes: [...d.processes, { ...newFabricProcess(), process_id: id, process_name: name }] })} /> : null}
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>,
                        );
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
                {edit?.options ? <AddFabric draft={edit.draft} onChange={edit.onChange} options={edit.options} /> : null}
              </div>
            </details>
          </div>
            <aside className="photo" aria-label="Style sketch or photo">
              {model.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={model.thumbUrl} alt="" />
              ) : (
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                  <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
                </svg>
              )}
              <span>Sketch / photo</span>
            </aside>
        </section>

        <section className="tri" aria-label="Fabric, CMT and trims">
          {model.ops.some((o) => o.kind !== "CMT") || edit?.options ? (
            <details open>
              <summary>
                Fabric &amp; garment processes <span>₹ {money(s.fabric + s.process + s.testing)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th>Piece</th> : null}
                      <th>Operation</th>
                      <th className="r">Rate ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {model.pieceCount > 1 ? <td /> : null}
                      <td>Fabric cost{model.sizes.length > 1 ? ` · ${s.label}` : ""}</td>
                      <td className="r">{money(s.fabric)}</td>
                    </tr>
                    {model.ops.filter((o) => o.kind !== "CMT").map((o, i) => (
                      <tr key={i}>
                        {model.pieceCount > 1 ? <td>{o.piece}</td> : null}
                        <td>
                          {edit && o.field === "line" && o.lineKey ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                          )}
                        </td>
                        <td className="r">
                          {(() => {
                            const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
                            if (!edit || !piece) return money(o.rate);
                            const label = `${o.name}${o.piece ? ` (${o.piece})` : ""} — rate ₹`;
                            if (o.field === "cmt") return <Ed label={label} value={piece.cmt} onChange={(v) => setPiece(piece.key, { cmt: v })} />;
                            if (o.field === "testing") return <Ed label={label} value={piece.testing_cost} onChange={(v) => setPiece(piece.key, { testing_cost: v })} />;
                            const line = piece.lines.find((l) => l.key === o.lineKey);
                            return line ? <Ed label={label} value={line.rate} onChange={(v) => setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { rate: v }) })} /> : money(o.rate);
                          })()}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 2 : 1}>Fabric, processes &amp; testing</td>
                      <td className="r">{money(s.fabric + s.process + s.testing)}</td>
                    </tr>
                  </tbody>
                </table>
                {edit?.options ? <AddOperation draft={edit.draft} onChange={edit.onChange} options={edit.options} /> : null}
              </div>
            </details>
          ) : null}
          {model.ops.some((o) => o.kind === "CMT") || edit?.options ? (
            <details open>
              <summary>
                CMT operations <span>₹ {money(s.cmt)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th>Piece</th> : null}
                      <th>Operation</th>
                      <th className="r">Rate ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.ops.filter((o) => o.kind === "CMT").map((o, i) => (
                      <tr key={i}>
                        {model.pieceCount > 1 ? <td>{o.piece}</td> : null}
                        <td>
                          {edit && o.field === "line" && o.lineKey ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                          )}
                        </td>
                        <td className="r">
                          {(() => {
                            const piece = edit?.draft.pieces.find((x) => x.key === o.pieceKey);
                            if (!edit || !piece) return money(o.rate);
                            const label = `${o.name}${o.piece ? ` (${o.piece})` : ""} — rate ₹`;
                            if (o.field === "cmt") return <Ed label={label} value={piece.cmt} onChange={(v) => setPiece(piece.key, { cmt: v })} />;
                            if (o.field === "testing") return <Ed label={label} value={piece.testing_cost} onChange={(v) => setPiece(piece.key, { testing_cost: v })} />;
                            const line = piece.lines.find((l) => l.key === o.lineKey);
                            return line ? <Ed label={label} value={line.rate} onChange={(v) => setPiece(piece.key, { lines: patchBy(piece.lines, line.key, { rate: v }) })} /> : money(o.rate);
                          })()}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 2 : 1}>CMT</td>
                      <td className="r">{money(s.cmt)}</td>
                    </tr>
                  </tbody>
                </table>
                {edit?.options ? <AddOperation draft={edit.draft} onChange={edit.onChange} options={edit.options} /> : null}
              </div>
            </details>
          ) : null}
          {model.trims.length || edit?.options ? (
            <details open>
              <summary>
                Trims &amp; accessories <span>₹ {money(s.trims)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th>Piece</th> : null}
                      <th>Trim</th>
                      <th>Pricing</th>
                      <th className="r">Consumption</th>
                      <th className="r">Cost ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.trims.map((t, i) => (
                      <tr key={i}>
                        {model.pieceCount > 1 ? <td>{t.piece}</td> : null}
                        <td>
                          {edit ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              {t.name}
                              <RemoveX label={t.name || "trim"} onClick={() => edit.onChange({ ...edit.draft, trims: edit.draft.trims.filter((x) => x.key !== t.key) })} />
                            </span>
                          ) : (
                            t.name
                          )}
                        </td>
                        <td className="dim">
                          {(() => {
                            const d = edit?.draft.trims.find((x) => x.key === t.key);
                            if (!edit || !d) return t.pricing;
                            const set = (patch: Partial<typeof d>) => edit.onChange({ ...edit.draft, trims: patchBy(edit.draft.trims, d.key, patch) });
                            // Direct: the flat ₹ per piece. Packed: the pack price (consumption below does the rest).
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 4 : 3}>Trims</td>
                      <td className="r">{money(s.trims)}</td>
                    </tr>
                  </tbody>
                </table>
                {edit?.options ? <AddTrim draft={edit.draft} onChange={edit.onChange} options={edit.options} /> : null}
              </div>
            </details>
          ) : null}
        </section>

        <section className="blk" aria-label="Garment cost">
          <details open>
            <summary>
              Garment cost <span>₹ per {model.unitWord}{model.sizes.length > 1 ? " · every size" : ""}</span>
            </summary>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    {model.sizes.map((x) => (
                      <th key={x.label} className="r">{model.sizes.length > 1 ? x.label : "₹"}</th>
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
                    <td>Price ₹</td>
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
              Overheads &amp; extra charges <span>₹ {money(s.bank + s.wastage + s.overhead + s.extraOverhead)} / {model.unitWord}</span>
            </summary>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Type</th>
                    <th className="r">Value</th>
                    {model.sizes.map((x) => (
                      <th key={x.label} className="r">{model.sizes.length > 1 ? `${x.label} ₹` : "₹ / " + model.unitWord}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {model.overheads.map((o, i) => (
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
                            return only ? <Ed w="w-20" label={label} value={only.bank_cost} onChange={(v) => edit.onChange({ ...dr, pieces: patchBy(dr.pieces, only.key, { bank_cost: v }) })} /> : o.value;
                          }
                          const x = dr.extras.find((e) => e.key === o.edit.key);
                          return x ? <Ed w="w-20" label={label} value={x.value} onChange={(v) => edit.onChange({ ...dr, extras: patchBy(dr.extras, x.key, { value: v }) })} /> : o.value;
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

        <section className="blk" aria-label="Commercial quote and negotiation">
          <div className="sec-h">
            <h3>Commercial quote &amp; negotiation</h3>
            <span>price, target, commission and the revisions behind it</span>
          </div>
        {model.belowFloor ? (
          <div className="banner">
            <b>{model.status === "approved" ? "Approved under the floor." : "Needs the MD."}</b> The lowest size{model.lowestSize ? ` (${model.lowestSize})` : ""} earns {fx(model.lowestMarginPct)}%, under the {FLOOR_PCT}% floor.
          </div>
        ) : null}
        {model.status === "rejected" && model.decisionRemark ? (
          <div className="banner">
            <b>Sent back for rework:</b> {model.decisionRemark}
          </div>
        ) : null}

          <div className="comm">
          <div className="quote">
            <div className="quote-top">
              <div>
                <div className="eyebrow">{s.quoted != null ? "Quoted" : "Calculated"} FOB per {model.unitWord}</div>
                <div className="big">{s.quoted != null || s.calc != null ? `${ccy} ${fx(s.quoted ?? s.calc, 2)}`.trim() : "—"}</div>
                {inrOf(s.quoted ?? s.calc) != null ? (
                  <div className="inr">
                    ₹ {money(inrOf(s.quoted ?? s.calc))} <small>per {model.unitWord} · at ₹ {fx(model.exchangeRate)} / {ccy}</small>
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
          <div className="box neg">
            <h4>
              Negotiation <span>{ccy || "price"} per {model.unitWord}{model.sizes.length > 1 ? ` · size ${s.label}` : ""}</span>
            </h4>
            <table>
              <tbody>
                <tr>
                  <td>Calculated price</td>
                  <td className="r">{s.calc != null ? fx(s.calc, 2) : "—"}</td>
                </tr>
                <tr>
                  <td>Quoted price</td>
                  <td className="r"><b>{s.quoted != null ? fx(s.quoted, 2) : s.calc != null ? fx(s.calc, 2) : "—"}</b></td>
                </tr>
                {edit || model.targetPrice != null ? (
                  <tr>
                    <td>Buyer target price</td>
                    <td className="r">
                      {edit ? <Ed w="w-24" label="Buyer target price" value={edit.draft.header.buyer_target_price} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, buyer_target_price: v } })} /> : fx(model.targetPrice, 2)}
                    </td>
                  </tr>
                ) : null}
                {(() => {
                  const target = edit ? Number(edit.draft.header.buyer_target_price) || null : model.targetPrice;
                  const price = s.quoted ?? s.calc;
                  if (target == null || price == null) return null;
                  const gap = Math.round((price - target) * 100) / 100;
                  return (
                    <tr>
                      <td>Difference to target</td>
                      <td className="r" style={{ color: gap > 0 ? "var(--cs-bad)" : "var(--cs-good)", fontWeight: 800 }}>
                        {gap === 0 ? "on target" : `${gap > 0 ? "+" : "−"}${fx(Math.abs(gap), 2)} ${gap > 0 ? "over" : "under"}`}
                      </td>
                    </tr>
                  );
                })()}
                {edit || model.commissionPct > 0 ? (
                  <tr>
                    <td>Commission %</td>
                    <td className="r">
                      {edit ? <Ed w="w-24" label="Commission %" value={edit.draft.header.commission_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, commission_pct: v } })} /> : `${fx(model.commissionPct)} %`}
                    </td>
                  </tr>
                ) : null}
                {edit || model.terms.discount > 0 ? (
                  <tr>
                    <td>LC discount %</td>
                    <td className="r">
                      {edit ? <Ed w="w-24" label="LC discount %" value={edit.draft.header.discount_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, discount_pct: v } })} /> : `${fx(model.terms.discount)} %`}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          </div>
        <section className="kpis">
          <div className="kpi">
            <label>Net cost</label>
            <div className="v">₹ {money(s.net)}</div>
            <div className="n">before rejection and overhead</div>
          </div>
          <div className="kpi">
            <label>Gross cost</label>
            <div className="v">₹ {money(s.grossCost)}</div>
            <div className="n">what a {model.unitWord} costs us</div>
          </div>
          <div className="kpi">
            <label>Price</label>
            <div className="v">₹ {money(s.price)}</div>
            <div className="n">gross cost + margin{s.priceAdj ? " ± price charges" : ""}</div>
          </div>
          {inrOf(s.quoted ?? s.calc) != null ? (
            <div className="kpi">
              <label>FOB in rupees</label>
              <div className="v">₹ {money(inrOf(s.quoted ?? s.calc))}</div>
              <div className="n">{ccy} {fx(s.quoted ?? s.calc)} × {fx(model.exchangeRate)}</div>
            </div>
          ) : null}
          <div className="kpi">
            <label>Margin earned</label>
            <div className="v">₹ {money(s.margin)}</div>
            <div className="n" style={edit ? { display: "flex", alignItems: "center", gap: 6 } : undefined}>
              {edit ? (
                <>
                  <Ed w="w-16" label="Margin % of net" value={edit.draft.header.margin_pct} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, margin_pct: v } })} />
                  <span>% of net</span>
                </>
              ) : (
                `${model.terms.margin}% of net`
              )}
            </div>
          </div>
        </section>
        {edit ? (
          <section className="sec">
            <div className="sec-h">
              <h3>Terms &amp; quote</h3>
              <span>exchange rate, discount, freight, insurance and the quoted price</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", alignItems: "center" }}>
              {(
                [
                  ["Exchange rate", "exchange_rate"],
                  ["Discount %", "discount_pct"],
                  ["Freight / pc", "freight_per_pc"],
                  ["Insurance / pc", "insurance_per_pc"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="dim">{label}</span>
                  <Ed w="w-20" label={label} value={edit.draft.header[field]} onChange={(v) => edit.onChange({ ...edit.draft, header: { ...edit.draft.header, [field]: v } })} />
                </label>
              ))}
              {edit.draft.pieces.flatMap((p) =>
                model.sizes.map((x) => {
                  const k = quoteKey(p.key, x.size);
                  return (
                    <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="dim">Quote{edit.draft.pieces.length > 1 ? ` ${p.piece_name || "piece"}` : ""}{model.sizes.length > 1 ? ` ${x.label}` : ""}</span>
                      <Ed w="w-24" label={`Quoted price ${x.label}`} value={edit.draft.quotes[k] ?? ""} onChange={(v) => { edit.onQuote?.(k); edit.onChange({ ...edit.draft, quotes: { ...edit.draft.quotes, [k]: v } }); }} />
                    </label>
                  );
                }),
              )}
            </div>
          </section>
        ) : null}
        {model.history.length > 0 ? (
          <section className="sec">
            <div className="sec-h">
              <h3>Revision history</h3>
              <span>{model.history.length} revisions of this costing</span>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Revision</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="r">Quoted price</th>
                    <th className="r">Change</th>
                    <th className="r">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {model.history.map((r) => (
                    <tr key={r.id} className={r.current ? "total" : undefined}>
                      <td>
                        {r.current ? (
                          r.label
                        ) : (
                          <Link href={`/sales/sample-costing/${r.id}/reports?tab=cost-sheet`} style={{ color: "var(--cs-brand)", textDecoration: "underline" }}>
                            {r.label}
                          </Link>
                        )}
                        {r.current ? " · this sheet" : ""}
                      </td>
                      <td>{r.date ? fmtDate(r.date) : "—"}</td>
                      <td>{r.statusLabel}</td>
                      <td className="r">{r.price == null ? "—" : `${ccy} ${fx(r.price, 2)}`.trim()}</td>
                      <td className="r">{changeText(r.changePct)}</td>
                      <td className="r">{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        </section>
        </>
        ) : null}

        {view === "report" ? (
          <div className="sign">
            <div><b />Prepared by</div>
            <div><b />Checked by</div>
            <div><b />Approved by</div>
          </div>
        ) : null}
      </div>
      <footer className="foot">
        <span>Internal document. For the buyer, use the Quotation.</span>
        <span>{model.costingNo ?? ""} · {model.revision}</span>
      </footer>
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
.cs-sheet .fabblk { display:grid; grid-template-columns:minmax(0,1fr) 150px; gap:12px; align-items:stretch; }
@media (max-width:860px){ .cs-sheet .fabblk { grid-template-columns:1fr; } }
.cs-sheet .photo { border:1px dashed var(--cs-rule); border-radius:12px; background:var(--cs-soft); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:130px; overflow:hidden; color:var(--cs-muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; font-weight:700; }
.cs-sheet .photo img { width:100%; height:100%; object-fit:cover; flex:1; } .cs-sheet .photo svg { width:46px; height:46px; color:var(--cs-brand); opacity:.7; }
.cs-sheet .tri { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr); gap:12px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .tri { grid-template-columns:1fr; } }
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
/* THE CHARTS VIEW IS ONE SCREEN (client 2026-10-10: "why can't we fit in single
   screen"): build | split + sizes | fabric + weight, side by side, instead of
   stacked bands. Two columns on a narrow pane, one on a phone. */
.cs-sheet .dash { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:start; }
@media (max-width:1100px){ .cs-sheet .dash { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:700px){ .cs-sheet .dash { grid-template-columns:1fr; } }
.cs-sheet .dash .col { display:flex; flex-direction:column; gap:10px; min-width:0; }
.cs-sheet .dash .box { padding:8px 10px; gap:6px; }
.cs-sheet .dash .donut { gap:12px; } .cs-sheet .dash .donut svg { width:112px; height:112px; }
.cs-sheet .dash .wf-row { grid-template-columns:132px minmax(0,1fr) 62px; }
.cs-sheet .dash .hb.cmp { grid-template-columns:24px minmax(0,1fr) auto; }
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
.cs-sheet summary { list-style:none; cursor:pointer; padding:7px 12px; font-weight:800; font-size:13px; display:flex; justify-content:space-between; gap:10px; background:var(--cs-soft); }
.cs-sheet summary::-webkit-details-marker { display:none; } .cs-sheet summary span { color:var(--cs-muted); font-weight:500; font-size:12.5px; }
.cs-sheet .scroll { overflow-x:auto; }
.cs-sheet table { width:100%; border-collapse:collapse; font-size:12px; }
.cs-sheet th { text-align:left; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--cs-muted); padding:5px 12px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; font-weight:700; background:#fff; }
.cs-sheet td { padding:4px 12px; border-bottom:1px solid var(--cs-rule); white-space:nowrap; background:#fff; }
.cs-sheet tr:last-child td { border-bottom:0; } .cs-sheet .r { text-align:right; }
.cs-sheet tr.sub td { background:var(--cs-soft); padding:6px 12px; font-size:12px; }
.cs-sheet tr.total td { background:var(--cs-brand-tint); font-weight:800; color:var(--cs-brand-ink); }
.cs-sheet .apv { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 14px; padding:7px 18px; font-size:12.5px; border-bottom:1px solid var(--cs-rule); }
.cs-sheet .apv span { font-size:12px; opacity:.85; }
.cs-sheet .apv[data-tone="good"] { background:var(--cs-good-tint); color:var(--cs-good); }
.cs-sheet .apv[data-tone="warn"] { background:var(--cs-warn-tint); color:var(--cs-warn); }
.cs-sheet .apv[data-tone="bad"] { background:var(--cs-bad-tint); color:var(--cs-bad); }
.cs-sheet .apv[data-tone="muted"] { background:var(--cs-soft); color:var(--cs-muted); }
.cs-sheet .sign { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:20px; padding-top:2px; }
.cs-sheet .sign div { border-top:1px solid var(--cs-ink); padding-top:6px; font-size:12px; color:var(--cs-muted); } .cs-sheet .sign b { display:block; min-height:1.6em; }
.cs-sheet .foot { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--cs-muted); font-size:11.5px; padding:8px 18px; border-top:1px solid var(--cs-rule); background:var(--cs-soft); }
@media print {
  .cs-sheet { border:0; border-radius:0; }
  .cs-sheet details > summary { pointer-events:none; }
  .cs-sheet .box, .cs-sheet details, .cs-sheet .kpi, .cs-sheet .sec { break-inside:avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}
`;
