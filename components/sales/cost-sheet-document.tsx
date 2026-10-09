"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { fmtDate } from "@/lib/format";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "@/lib/sales/sample-costing/cost-sheet";
import { MARGIN_RED_BELOW_PCT, MARGIN_TARGET_PCT } from "@/lib/sales/sample-costing/calc";
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

const money = (v: number | null | undefined) => fx(v);

export function CostSheetDocument({ model }: { model: CostSheetModel }) {
  // Open on the size that earns least: that is the one the reader came to check.
  const lowest = model.sizes.reduce((best, s, i) => (s.effectiveMarginPct != null && (model.sizes[best].effectiveMarginPct ?? Infinity) > s.effectiveMarginPct ? i : best), 0);
  const [idx, setIdx] = useState(lowest);
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
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {model.sizes.length > 1 ? (
          <ToggleGroup<string>
            label="Size shown"
            value={String(idx)}
            onChange={(v) => setIdx(Number(v))}
            options={model.sizes.map((x, i) => ({ value: String(i), label: x.label }))}
          />
        ) : null}
        <Button variant="outline" size="md" disabled={busy != null} onClick={() => void run("csv")}>
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </Button>
        <Button variant="outline" size="md" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <Button size="md" disabled={busy != null} onClick={() => void run("pdf")}>
          <Download className="h-4 w-4" />
          {busy === "pdf" ? "Building…" : "Download PDF"}
        </Button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>
      <Sheet model={model} s={s} idx={idx} />
    </div>
  );
}

function Sheet({ model, s, idx }: { model: CostSheetModel; s: SizeFigures; idx: number }) {
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
  let off = 0;

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
        <section className="hero">
          <div className="title">
            <div className="thumb">
              {model.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={model.thumbUrl} alt="" />
              ) : (
                <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                  <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
                </svg>
              )}
            </div>
            <div className="min0">
              <div className="eyebrow">Style{model.season ? ` · ${model.season}` : ""}</div>
              <h2>{model.style ?? "—"}</h2>
              <div className="chips">
                {model.sampleNo ? (
                  <span className="chip">
                    Sample <b>{model.sampleNo}</b>
                  </span>
                ) : null}
                <span className="chip">
                  {model.isSet ? "SET" : "PCS"}
                  {model.sizes.length > 1 || model.sizes[0]?.size ? (
                    <>
                      {" · sizes "}
                      <b>{model.sizes.map((x) => x.label).join(", ")}</b>
                    </>
                  ) : null}
                </span>
                {model.shipMode ? (
                  <span className="chip">
                    Ship <b>{model.shipMode}</b>
                  </span>
                ) : null}
              </div>
              <dl className="facts">
                <div>
                  <dt>Customer</dt>
                  <dd>{model.customer ?? "—"}</dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>
                    {ccy || "—"}
                    {model.exchangeRate ? ` @ ₹ ${fx(model.exchangeRate)}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Enquiry</dt>
                  <dd>{model.enquiryNo ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </div>

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
        </section>

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
            <div className="n">{model.terms.margin}% of net</div>
          </div>
        </section>

        <hr />

        <section className="two">
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
          <div className="sec">
            <div className="sec-h">
              <h3>Where the price goes</h3>
              <span>share of the ₹ price</span>
            </div>
            <div className="donut">
              <svg viewBox="0 0 120 120" role="img" aria-label="Share of the price by cost group">
                <circle cx="60" cy="60" r={R} fill="none" stroke="var(--cs-soft)" strokeWidth="16" />
                {parts.map((p) => {
                  const len = (p.value / partTotal) * C;
                  const el = (
                    <circle key={p.label} cx="60" cy="60" r={R} fill="none" stroke={TONE_VAR[p.tone]} strokeWidth="16" strokeDasharray={`${Math.max(len - 1.2, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />
                  );
                  off += len;
                  return el;
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
        </section>

        <hr />

        <section className="sec">
          <div className="sec-h">
            <h3>The working</h3>
            <span>fabric, weight and size comparison</span>
          </div>
          <div className="cards">
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
        </section>

        <section className="sec">
          <div className="sec-h">
            <h3>Full detail</h3>
            <span>every line behind the figures above</span>
          </div>

          <details open>
            <summary>
              Fabric rates <span>₹ per kg</span>
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
                  {model.fabrics.map((f) => (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td className="r">{f.direct ? "" : money(f.yarn)}</td>
                      <td className="r">{f.direct ? "" : money(f.knitting)}</td>
                      <td className="r">{f.direct ? "" : money(f.dyeing)}</td>
                      <td className="r">{f.direct ? "" : money(f.finishing)}</td>
                      <td className="r">{f.direct ? "" : money(f.special)}</td>
                      <td className="r">{f.direct ? "Direct" : fx(f.lossPct)}</td>
                      <td className="r"><b>{money(f.price)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details open>
            <summary>
              Garment weight <span>grams, sizes across</span>
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
                      <td>{r.component}</td>
                      <td>{r.fabric}</td>
                      {r.grams.map((g, j) => (
                        <td key={j} className="r">{g == null ? "" : g}</td>
                      ))}
                      <td className="r">{r.lossPct}</td>
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
            </div>
          </details>

          {model.ops.length ? (
            <details open>
              <summary>
                CMT &amp; embellishment <span>₹ {money(s.cmt + s.process + s.testing)} / {model.unitWord}</span>
              </summary>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {model.pieceCount > 1 ? <th>Piece</th> : null}
                      <th>Operation</th>
                      <th>Kind</th>
                      <th className="r">Rate ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.ops.map((o, i) => (
                      <tr key={i}>
                        {model.pieceCount > 1 ? <td>{o.piece}</td> : null}
                        <td>{o.name}</td>
                        <td className="dim">{o.kind}</td>
                        <td className="r">{money(o.rate)}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 3 : 2}>CMT, embellishment &amp; testing</td>
                      <td className="r">{money(s.cmt + s.process + s.testing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {model.trims.length ? (
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
                        <td>{t.name}</td>
                        <td className="dim">{t.pricing}</td>
                        <td className="r">{t.qty}</td>
                        <td className="r">{money(t.cost)}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={model.pieceCount > 1 ? 4 : 3}>Trims</td>
                      <td className="r">{money(s.trims)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

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
                        {o.name.toUpperCase()}
                        {o.side === "price" ? <span className="dim"> (price)</span> : null}
                      </td>
                      <td className="dim">{o.type}</td>
                      <td className="r">{o.value}</td>
                      {o.perSize.map((v, j) => (
                        <td key={j} className="r">{o.side === "price" && v >= 0 ? "+" : o.side === "price" ? "−" : ""}{money(Math.abs(v))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        {/* WHERE THIS COSTING STANDS IN THE NEGOTIATION (client 2026-10-09: "the
            sample rev will happen in the report"). Every revision of this Costing
            No, the one on this page marked; INTERNAL, so the margin each carried
            is here — the buyer's Quotation prints prices only. Absent for a
            costing that was never revised. */}
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
                        {r.label}
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

        <div className="sign">
          <div><b />Prepared by</div>
          <div><b />Checked by</div>
          <div><b />Approved by</div>
        </div>
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
