/**
 * Downloading the Sample Cost Sheet — PDF and Excel (2026-10-08).
 *
 * Browser-only (jsPDF, blob download): call from a `"use client"` island.
 * Both read the SAME `CostSheetModel` the page renders, so the screen, the
 * paper and the spreadsheet carry one answer. INTERNAL: rates and margin are on
 * it; the buyer's document is the Quotation.
 *
 * The page's charts are drawn here with plain shapes (a stepped bar per line,
 * a stacked share bar) in the same six cost-group colours, so the PDF reads
 * like the screen. Money shows in the buyer's currency AND in rupees.
 */
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { fmtDate } from "@/lib/format";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import {
  BRAND,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  paintRow,
  rgb,
} from "@/lib/orders/report-pdf-kit";
import { FLOOR_PCT, fx, priceParts, type CostSheetModel, type SizeFigures } from "./cost-sheet";

const TONE_HEX = { fabric: "#037bb8", cmt: "#1f9a8a", emb: "#d1527a", trims: "#e0a030", over: "#7c62d0", margin: "#2f9e5b" } as const;

const fileStem = (m: CostSheetModel) => `CostSheet_${(m.costingNo ?? "costing").replace(/[^A-Za-z0-9]+/g, "-")}_${m.revision.replace(/\s+/g, "")}`;
const inr = (m: CostSheetModel, v: number | null) => (v == null || m.exchangeRate == null ? null : v * m.exchangeRate);

export async function exportCostSheetReportPdf(m: CostSheetModel, sizeIndex = 0): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const CW = W - 2 * M;
  const s: SizeFigures = m.sizes[sizeIndex] ?? m.sizes[0];
  const ccy = m.currency ?? "";
  const logo = await loadLetterheadImage(m.company.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;

  let y = drawSheetMasthead(doc, {
    company: m.company.name,
    unit: m.company.unit,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: "Sample Cost Sheet — internal",
    reNo: [m.costingNo, m.revision].filter(Boolean).join(" · "),
    meta: m.date ? `Dated ${fmtDate(m.date)}` : null,
    status: m.statusLabel,
    margin: M,
  });
  y = drawOrderFacts(
    doc,
    y,
    [
      { label: "Customer", value: m.customer },
      { label: "Style", value: m.style, sub: m.sampleNo },
      { label: "Season", value: m.season },
      { label: "Currency", value: m.currency ? `${m.currency}${m.exchangeRate ? ` @ ₹ ${fx(m.exchangeRate)}` : ""}` : null },
      { label: "Ship mode", value: m.shipMode },
      { label: "Sizes", value: m.sizes.map((x) => x.label).join(", ") },
    ],
    { margin: M, cols: 6 },
  );

  const shown = s.quoted ?? s.calc;
  y = drawSummaryTiles(
    doc,
    y,
    [
      { label: `NET COST ₹${m.sizes.length > 1 ? ` · ${s.label}` : ""}`, value: fx(s.net), note: "before wastage and overhead" },
      { label: "GROSS COST ₹", value: fx(s.grossCost), note: `what a ${m.unitWord} costs us` },
      { label: "PRICE ₹", value: fx(s.price), note: "gross cost + margin ± price charges" },
      { label: `${s.quoted != null ? "QUOTED" : "CALCULATED"} FOB ${ccy}`.trim(), value: shown == null ? "—" : fx(shown), note: s.calc != null ? `calculated ${s.calc.toFixed(4)}` : "add the exchange rate", tone: BRAND },
      { label: "FOB IN RUPEES ₹", value: fx(inr(m, shown)), note: m.exchangeRate ? `${ccy} ${fx(shown)} × ${fx(m.exchangeRate)}` : null },
      { label: "MARGIN ON QUOTE", value: s.effectiveMarginPct == null ? "—" : `${fx(s.effectiveMarginPct)}%`, note: `${FLOOR_PCT}% floor · ${m.terms.margin}% of net` },
    ],
    M,
  );

  // ---- THE PRICE, DRAWN: stepped bars (left) and the share bar (right) ----------------
  const top = y + 4;
  const half = (CW - 16) / 2;
  const wfTop = drawCardHeader(doc, M, top, half, BRAND, "How the price is built", `${m.sizes.length > 1 ? `size ${s.label} · ` : ""}₹ / ${m.unitWord}`);
  type Step = { label: string; value: number; hex: string | null };
  const steps: Step[] = (
    [
      { label: "Fabric", value: s.fabric, hex: TONE_HEX.fabric },
      { label: "CMT", value: s.cmt, hex: TONE_HEX.cmt },
      { label: "Embellishment & testing", value: s.process + s.testing, hex: TONE_HEX.emb },
      { label: "Trims", value: s.trims, hex: TONE_HEX.trims },
      { label: "Bank charges", value: s.bank, hex: TONE_HEX.over },
      { label: "Net cost", value: s.net, hex: null },
      { label: "Wastage + overhead", value: s.wastage + s.overhead, hex: TONE_HEX.over },
      { label: "Extra charges", value: s.extraOverhead, hex: TONE_HEX.over },
      { label: "Gross cost", value: s.grossCost, hex: null },
      { label: `Margin ${m.terms.margin}%`, value: s.margin, hex: TONE_HEX.margin },
      { label: "Discount", value: -s.discount, hex: TONE_HEX.margin },
      { label: "Price charges", value: s.priceAdj, hex: TONE_HEX.margin },
      { label: "Price", value: s.price, hex: null },
    ] as Step[]
  ).filter((r) => r.hex === null || r.value !== 0);
  const rowH = 11.5;
  const labW = 92;
  const valW = 36;
  const laneX = M + 8 + labW;
  const laneW = half - 16 - labW - valW - 6;
  const max = Math.max(s.price, s.grossCost, 1) * 1.02;
  let run = 0;
  let ry = wfTop + 8;
  doc.setFontSize(6.8);
  steps.forEach((r) => {
    const total = r.hex === null;
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
    doc.setFont("helvetica", total ? "bold" : "normal");
    doc.setTextColor(total ? 20 : 90);
    doc.text(r.label, M + 8, ry + 7);
    doc.setFillColor(244, 246, 249);
    doc.rect(laneX, ry, laneW, 8.5, "F");
    doc.setFillColor(...rgb(r.hex ?? BRAND.rule));
    doc.rect(laneX + (start / max) * laneW, ry, Math.max((Math.abs(r.value) / max) * laneW, 1.2), 8.5, "F");
    doc.setTextColor(20);
    doc.text(`${!total && r.value < 0 ? "-" : ""}${fx(Math.abs(r.value))}`, M + half - 8, ry + 7, { align: "right" });
    ry += rowH;
  });
  const wfEnd = ry + 4;

  const gx = M + half + 16;
  const shTop = drawCardHeader(doc, gx, top, half, BRAND, "Where the price goes", "share of the ₹ price");
  const parts = priceParts(s);
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  let bx = gx + 8;
  const barW = half - 16;
  parts.forEach((p) => {
    const w = (p.value / total) * barW;
    doc.setFillColor(...rgb(TONE_HEX[p.tone]));
    doc.rect(bx, shTop + 10, Math.max(w - 1, 0.5), 16, "F");
    bx += w;
  });
  let ly = shTop + 40;
  doc.setFontSize(7.4);
  parts.forEach((p) => {
    doc.setFillColor(...rgb(TONE_HEX[p.tone]));
    doc.rect(gx + 8, ly - 6, 7, 7, "F");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    doc.text(p.label, gx + 20, ly);
    doc.text(`${((p.value / total) * 100).toFixed(1)}%`, gx + half - 60, ly, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20);
    doc.text(fx(p.value), gx + half - 8, ly, { align: "right" });
    ly += 12;
  });
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");

  // ---- the tables --------------------------------------------------------------------
  const table = {
    margin: { left: M, right: M, top: 36 },
    theme: "plain" as const,
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    didParseCell: (d: Parameters<typeof paintRow>[0]) => paintRow(d, { tone: BRAND }),
  };
  const end = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let cursor = Math.max(wfEnd, ly) + 6;
  const card = (title: string, head: string[], body: RowInput[], right: number[], rightText?: string) => {
    if (!body.length) return;
    let t = cursor + 10;
    if (t > H - 90) {
      doc.addPage();
      t = 36;
    }
    const start = drawCardHeader(doc, M, t, CW, BRAND, title, rightText ?? null);
    autoTable(doc, {
      ...table,
      startY: start,
      head: [head],
      body,
      columnStyles: Object.fromEntries(right.map((i) => [i, { halign: "right" as const }])),
    });
    cursor = end();
  };

  // Sizes: the whole story per size, in both currencies.
  card(
    "Price by size",
    ["Size", "Net ₹", "Gross cost ₹", "Price ₹", `Calc ${ccy}`, `Quoted ${ccy}`, "Quoted ₹", "Margin %"],
    m.sizes.map((x) => [
      x.label,
      fx(x.net),
      fx(x.grossCost),
      fx(x.price),
      x.calc == null ? "—" : x.calc.toFixed(4),
      x.quoted == null ? "—" : x.quoted.toFixed(4),
      fx(inr(m, x.quoted)),
      x.effectiveMarginPct == null ? "—" : `${fx(x.effectiveMarginPct)}%`,
    ]),
    [1, 2, 3, 4, 5, 6, 7],
  );
  card(
    "Fabric rates (₹ / kg)",
    ["Fabric", "Yarn", "Knitting", "Dyeing", "Finishing", "Special", "Loss %", "Price / kg"],
    m.fabrics.map((f) => [f.name, f.direct ? "" : fx(f.yarn), f.direct ? "" : fx(f.knitting), f.direct ? "" : fx(f.dyeing), f.direct ? "" : fx(f.finishing), f.direct ? "" : fx(f.special), f.direct ? "Direct" : fx(f.lossPct), fx(f.price)]),
    [1, 2, 3, 4, 5, 6, 7],
  );
  card(
    "Garment weight (grams)",
    [...(m.pieceCount > 1 ? ["Piece"] : []), "Component", "Fabric", ...m.weights.sizeLabels, "Loss %"],
    [
      ...m.weights.rows.map((r) => [...(m.pieceCount > 1 ? [r.piece] : []), r.component, r.fabric, ...r.grams.map((g) => (g == null ? "" : String(g))), r.lossPct]),
      [...(m.pieceCount > 1 ? [""] : []), "Fabric cost ₹", "", ...m.sizes.map((x) => fx(x.fabric)), ""],
    ],
    m.weights.sizeLabels.map((_, i) => i + (m.pieceCount > 1 ? 3 : 2)),
  );
  card(
    "CMT & embellishment (₹ / pc)",
    [...(m.pieceCount > 1 ? ["Piece"] : []), "Operation", "Kind", "Rate ₹"],
    m.ops.map((o) => [...(m.pieceCount > 1 ? [o.piece] : []), o.name, o.kind, fx(o.rate)]),
    [m.pieceCount > 1 ? 3 : 2],
    fx(s.cmt + s.process + s.testing),
  );
  card(
    "Trims & accessories",
    [...(m.pieceCount > 1 ? ["Piece"] : []), "Trim", "Pricing", "Consumption", "Cost ₹"],
    m.trims.map((t) => [...(m.pieceCount > 1 ? [t.piece] : []), t.name, t.pricing, t.qty, fx(t.cost)]),
    [m.pieceCount > 1 ? 3 : 2, m.pieceCount > 1 ? 4 : 3],
    fx(s.trims),
  );
  card(
    "Overheads & extra charges",
    ["Line", "Type", "Value", ...m.sizes.map((x) => (m.sizes.length > 1 ? `${x.label} ₹` : `₹ / ${m.unitWord}`))],
    m.overheads.map((o) => [
      `${o.name.toUpperCase()}${o.side === "price" ? " (price)" : ""}`,
      o.type,
      o.value,
      ...o.perSize.map((v) => `${o.side === "price" ? (v >= 0 ? "+" : "-") : ""}${fx(Math.abs(v))}`),
    ]),
    m.sizes.map((_, i) => i + 2),
  );

  // Sign-off + page numbers
  const pages = doc.getNumberOfPages();
  doc.setPage(pages);
  let sy = Math.min(cursor + 34, H - 40);
  if (sy > H - 36) {
    doc.addPage();
    sy = 80;
  }
  drawSheetLabel(doc, M, sy - 14, "Sign-off");
  ["Prepared by", "Checked by", "Approved by"].forEach((label, i) => {
    const x = M + i * (CW / 3);
    doc.setDrawColor(40);
    doc.setLineWidth(0.5);
    doc.line(x, sy + 14, x + CW / 3 - 24, sy + 14);
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(label, x, sy + 24);
  });
  const total2 = doc.getNumberOfPages();
  for (let i = 1; i <= total2; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(120);
    doc.text(`Internal document — for the buyer, use the Quotation.  Page : ${i}/${total2}`, W - M, H - 14, { align: "right" });
  }

  doc.save(`${fileStem(m)}.pdf`);
}

/** The same figures as a spreadsheet — a CSV Excel opens, one block per section. */
export function exportCostSheetCsv(m: CostSheetModel): void {
  const q = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows: (string | number | null)[][] = [];
  const add = (...r: (string | number | null)[][]) => r.forEach((x) => rows.push(x));
  const blank = () => rows.push([]);
  const ccy = m.currency ?? "";

  add(["Sample Cost Sheet (internal)", m.costingNo, m.revision, m.statusLabel], ["Customer", m.customer], ["Style", m.style, m.sampleNo], ["Season", m.season], ["Currency", ccy, "Exchange rate", m.exchangeRate]);
  blank();
  add(["PRICE BY SIZE", "Net ₹", "Gross cost ₹", "Price ₹", `Calculated ${ccy}`, `Quoted ${ccy}`, "Quoted ₹", "Margin %"]);
  m.sizes.forEach((x) => add([x.label, fx(x.net), fx(x.grossCost), fx(x.price), x.calc == null ? "" : x.calc.toFixed(4), x.quoted == null ? "" : x.quoted.toFixed(4), fx(inr(m, x.quoted)), x.effectiveMarginPct == null ? "" : fx(x.effectiveMarginPct)]));
  blank();
  add(["PRICE BUILD-UP ₹", ...m.sizes.map((x) => x.label)]);
  const line = (label: string, f: (x: SizeFigures) => number) => add([label, ...m.sizes.map((x) => fx(f(x)))]);
  line("Fabric", (x) => x.fabric);
  line("CMT", (x) => x.cmt);
  line("Embellishment", (x) => x.process);
  line("Testing & FOB", (x) => x.testing);
  line("Trims", (x) => x.trims);
  line("Bank charges", (x) => x.bank);
  line("Net cost", (x) => x.net);
  line("Wastage", (x) => x.wastage);
  line("Overhead", (x) => x.overhead);
  line("Extra charges", (x) => x.extraOverhead);
  line("Gross cost", (x) => x.grossCost);
  line("Margin", (x) => x.margin);
  line("Discount", (x) => -x.discount);
  line("Price charges", (x) => x.priceAdj);
  line("Price", (x) => x.price);
  blank();
  add(["FABRIC RATES ₹/kg", "Yarn", "Knitting", "Dyeing", "Finishing", "Special", "Loss %", "Price / kg"]);
  m.fabrics.forEach((f) => add([f.name, fx(f.yarn), fx(f.knitting), fx(f.dyeing), fx(f.finishing), fx(f.special), f.direct ? "Direct" : fx(f.lossPct), fx(f.price)]));
  blank();
  add(["GARMENT WEIGHT g", "Fabric", ...m.weights.sizeLabels, "Loss %"]);
  m.weights.rows.forEach((r) => add([[r.piece, r.component].filter(Boolean).join(" · "), r.fabric, ...r.grams.map((g) => (g == null ? "" : g)), r.lossPct]));
  blank();
  add(["CMT & EMBELLISHMENT", "Kind", "Rate ₹"]);
  m.ops.forEach((o) => add([[o.piece, o.name].filter(Boolean).join(" · "), o.kind, fx(o.rate)]));
  blank();
  add(["TRIMS", "Pricing", "Consumption", "Cost ₹"]);
  m.trims.forEach((t) => add([[t.piece, t.name].filter(Boolean).join(" · "), t.pricing, t.qty, fx(t.cost)]));
  blank();
  add(["OVERHEADS & EXTRA CHARGES", "Type", "Value", ...m.sizes.map((x) => `${x.label} ₹`)]);
  m.overheads.forEach((o) => add([`${o.name}${o.side === "price" ? " (price)" : ""}`, o.type, o.value, ...o.perSize.map((v) => fx(v))]));

  const csv = "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem(m)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
