/**
 * THE SAMPLE PLAN REPORTS AS DOCUMENTS — PDF download and Print, nothing else
 * (the order reports' rule, client 2026-09-19: a requirement document leaves
 * the app only as issued; a spreadsheet gets edited and circulated).
 *
 * Drawn with the order reports' PDF kit (`lib/orders/report-pdf-kit.ts`,
 * AGENTS.md "Report look kit") and the same plumbing (`openPrintTab`,
 * `finishPdf`) as the Yarn & Fabric Requirement, from the SAME object the
 * screen renders (`components/sales/plan-reports.tsx`) — never a recompute.
 *
 * Browser-only: called from the screen's export bar.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  BRAND,
  CONTINUED_TOP,
  ROW_STRIPE,
  cardTableHead,
  cardTableStyles,
  drawCardHeader,
  drawOrderFacts,
  drawSheetLabel,
  drawSheetMasthead,
  drawSummaryTiles,
  roomFor,
} from "@/lib/orders/report-pdf-kit";
import { STAGE_STYLES, rgb, type StageStyle } from "@/lib/orders/fabric-bom/report-colours";
import { fitLogo, loadLetterheadImage } from "@/lib/orders/fabric-bom/letterhead";
import { finalY, finishPdf, openPrintTab, signOffFooter, type PdfOutput } from "@/lib/orders/fabric-bom/reports-export";
import {
  PLAN_KIND_LABEL,
  planApprovalLabel,
  type AccessoriesPlanReport,
  type FabricPlanReport,
  type PlanReportHeader,
} from "./types";

const M = 28;
const q = (v: number | null) => (v == null ? "" : fmtNumber(v));

function fileStem(h: PlanReportHeader): string {
  const key = (h.swoCode || h.iwoCode || "plan").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Sample_${h.kind === "fabric" ? "Fabric" : "Accessories"}_Plan_${key}${h.revisionNo ? `_Rev${h.revisionNo}` : ""}.pdf`;
}

/** Masthead + facts — the screen's `Opening`, on paper. Returns the next y. */
async function opening(doc: jsPDF, h: PlanReportHeader): Promise<number> {
  const logo = await loadLetterheadImage(h.company.logo);
  const fitted = logo ? fitLogo(logo, 96, 32) : null;
  const y = drawSheetMasthead(doc, {
    company: h.company.name,
    unit: h.company.unit,
    logo: logo && fitted ? { dataUrl: logo.dataUrl, w: fitted.w, h: fitted.h } : null,
    kind: `Sample ${PLAN_KIND_LABEL[h.kind]}`,
    reNo: h.swoCode,
    meta: h.planDate ? fmtDate(h.planDate) : null,
    status: h.status === "approved" ? (h.revisionNo ? `Approved · Rev ${h.revisionNo}` : "Approved") : null,
  });
  return drawOrderFacts(doc, y, [
    { label: "SWO No", value: h.swoCode, sub: h.description },
    { label: "Season", value: h.season },
    { label: "Plan Date", value: h.planDate ? fmtDate(h.planDate) : null, sub: h.iwoCode ? `Work order ${h.iwoCode}` : null },
    { label: `Samples (${h.samples.length})`, value: h.samples.map((x) => x.smpNo ?? x.sampleNo).filter(Boolean).join(", ") },
    {
      label: "Approval",
      value: h.isDraft ? "Draft" : planApprovalLabel(h.status, h.revisionNo),
      sub: h.status === "approved" && h.approvedAt ? `Approved ${fmtDate(h.approvedAt)}` : null,
    },
    { label: "Revision", value: h.revisionNo ? `Rev ${h.revisionNo}` : "Rev 0", sub: h.revision?.reason ?? null },
  ]);
}

/** One section: a card header in the tone, then the table under it. */
function card(
  doc: jsPDF,
  y: number,
  tone: StageStyle,
  title: string,
  total: string | null,
  head: string[],
  body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][],
  opts: { right?: number[]; bold?: ReadonlySet<number>; muted?: ReadonlySet<number>; widths?: Record<number, number> } = {},
): number {
  const RIGHT = doc.internal.pageSize.getWidth() - M;
  y = roomFor(doc, y, 90);
  const startY = drawCardHeader(doc, M, y + 4, RIGHT - M, tone, title, total, total ? "Total" : null);
  const columnStyles: Record<number, Record<string, unknown>> = {};
  for (const i of opts.right ?? []) columnStyles[i] = { halign: "right" };
  for (const [i, w] of Object.entries(opts.widths ?? {})) columnStyles[Number(i)] = { ...(columnStyles[Number(i)] ?? {}), cellWidth: w };
  autoTable(doc, {
    head: [head],
    body: body.length ? body : [[{ content: "Nothing planned.", colSpan: head.length }]],
    startY,
    margin: { left: M, right: M, top: CONTINUED_TOP },
    styles: cardTableStyles(),
    headStyles: cardTableHead(),
    theme: "plain",
    columnStyles,
    didParseCell: (d) => {
      if (d.section !== "body") return;
      if (d.row.index % 2 === 1) d.cell.styles.fillColor = rgb(ROW_STRIPE);
      if (opts.bold?.has(d.row.index)) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = rgb(tone.tint);
      }
      if (opts.muted?.has(d.row.index)) d.cell.styles.textColor = [91, 100, 114];
    },
  });
  return finalY(doc, startY) + 6;
}

export async function exportFabricPlanPdf(r: FabricPlanReport, output: PdfOutput = "download"): Promise<void> {
  const tab = openPrintTab(output);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  let y = await opening(doc, r.header);

  y = drawSheetLabel(doc, M, y + 6, "To buy and make for this SWO");
  y = drawSummaryTiles(doc, y, [
    { label: "Fabric required", value: fmtNumber(r.fabricTotalKg), unit: "kg", tone: STAGE_STYLES.greige },
    { label: "Yarn to buy", value: r.yarnTotal ? fmtNumber(r.yarnTotal.qty) : "—", unit: r.yarnTotal?.uom ?? null, tone: STAGE_STYLES.yarn },
    { label: "Fabrics", value: String(new Set(r.fabrics.map((f) => f.fabric)).size), tone: BRAND },
    { label: "Samples", value: String(r.header.samples.length), tone: BRAND },
  ]);

  // Fabric requirement, sample by sample, with a subtotal under each sample.
  const fabBody: string[][] = [];
  const fabTotals = new Set<number>();
  const kgOf = new Map(r.bySample.map((x) => [x.sample, x.kg]));
  r.fabrics.forEach((f, i) => {
    const first = i === 0 || r.fabrics[i - 1].sample !== f.sample;
    fabBody.push([
      first ? f.sample : "",
      f.fabric,
      f.structure ?? "",
      f.stage ?? "",
      f.form ?? "",
      f.gsm == null ? "" : fmtNumber(f.gsm),
      f.colour ?? "",
      f.dia ?? "",
      f.print ?? "",
      q(f.reqKg),
    ]);
    const last = i === r.fabrics.length - 1 || r.fabrics[i + 1].sample !== f.sample;
    if (last && r.bySample.length > 1) {
      fabTotals.add(fabBody.length);
      fabBody.push(["", "", "", "", "", "", "", "", `${f.sample} total`, q(kgOf.get(f.sample) ?? null)]);
    }
  });
  y = card(
    doc,
    y,
    STAGE_STYLES.greige,
    "Fabric requirement — sample by sample",
    `${fmtNumber(r.fabricTotalKg)} kg`,
    ["Sample", "Fabric", "Structure", "Stage", "Form", "GSM", "Colour", "Dia", "Print", "Req Kg"],
    fabBody,
    { right: [5, 9], bold: fabTotals, widths: { 0: 130 } },
  );

  // Yarn purchase, shades under each yarn.
  const yarnBody: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
  const shadeRows = new Set<number>();
  for (const yn of r.yarns) {
    yarnBody.push([yn.yarn, yn.buyStage ?? "", yn.colourBy ?? "", q(yn.plannedKg), q(yn.purchaseQty), yn.uom ?? ""]);
    for (const sh of yn.shades) {
      shadeRows.add(yarnBody.length);
      yarnBody.push([`   ${sh.colour}`, "", "", q(sh.plannedKg), q(sh.purchaseQty), yn.uom ?? ""]);
    }
    if (yn.purchaseQty == null && yn.refusal) {
      yarnBody.push([{ content: yn.refusal, colSpan: 6, styles: { textColor: [150, 30, 30] } }]);
    }
  }
  y = card(
    doc,
    y,
    STAGE_STYLES.yarn,
    "Yarn purchase",
    r.yarnTotal ? `${fmtNumber(r.yarnTotal.qty)}${r.yarnTotal.uom ? ` ${r.yarnTotal.uom}` : ""}` : null,
    ["Yarn", "Bought as", "Colour by", "Planned Kg", "Purchase", "Unit"],
    yarnBody,
    { right: [3, 4], muted: shadeRows },
  );

  // Processing route, step by step per fabric.
  const routeBody = r.routes.flatMap((route) =>
    route.steps.map((st, i) => [
      i === 0 ? route.fabric : "",
      String(i + 1),
      st.stage ?? "",
      st.process,
      st.type ?? "",
      st.lossPct == null ? "" : fmtNumber(st.lossPct),
    ]),
  );
  card(doc, y, STAGE_STYLES.dyed, "Processing route", null, ["Fabric", "Step", "Stage", "Process", "Type", "Loss %"], routeBody, {
    right: [1, 5],
  });

  signOffFooter(doc);
  finishPdf(doc, fileStem(r.header), output, tab);
}

export async function exportAccessoriesPlanPdf(r: AccessoriesPlanReport, output: PdfOutput = "download"): Promise<void> {
  const tab = openPrintTab(output);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  let y = await opening(doc, r.header);

  const advised = r.items.filter((i) => i.advised).length;
  y = drawSheetLabel(doc, M, y + 6, "To buy for this SWO");
  y = drawSummaryTiles(doc, y, [
    { label: "Accessories", value: String(r.items.length), tone: BRAND },
    { label: "Samples", value: String(r.header.samples.length), tone: BRAND },
    { label: "Advised", value: String(advised), note: advised ? "Cannot be bought until confirmed" : null, tone: advised ? STAGE_STYLES.yarn : BRAND },
    { label: "Without a purchase qty", value: String(r.items.filter((i) => i.purchaseQty == null).length), tone: BRAND },
  ]);

  const body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
  const breakupRows = new Set<number>();
  for (const it of r.items) {
    body.push([
      String(it.sno),
      it.category ?? "",
      it.item,
      it.specification ?? "",
      it.colour ?? "",
      q(it.plannedQty),
      q(it.moq),
      q(it.requiredQty),
      q(it.purchaseQty),
      it.purchaseUom ?? "",
      [it.advised ? "Advised" : null, it.foc ? "FOC" : null, it.sendOut ? "Send out" : null].filter(Boolean).join(" · "),
    ]);
    for (const b of it.breakup) {
      breakupRows.add(body.length);
      body.push(["", "", `   ${b.sample}`, "", [b.colour, b.size].filter(Boolean).join(" · "), q(b.qty), "", "", "", "", ""]);
    }
    if (it.purchaseQty == null && it.refusal) {
      body.push([{ content: it.refusal, colSpan: 11, styles: { textColor: [150, 30, 30] } }]);
    }
  }
  y = card(
    doc,
    y,
    BRAND,
    "Accessories — consolidated, with each sample's share",
    null,
    ["#", "Category", "Accessory", "Specification", "Colour", "Planned", "MOQ", "Required", "Purchase", "Unit", "Flags"],
    body,
    { right: [0, 5, 6, 7, 8], muted: breakupRows },
  );

  if (r.processes.length) {
    card(
      doc,
      y,
      STAGE_STYLES.print,
      "Accessory processing",
      null,
      ["Accessory", "Stage", "Process", "Loss %", "Vendor"],
      r.processes.map((p) => [p.item, p.stage ?? "", p.process, p.lossPct == null ? "" : fmtNumber(p.lossPct), p.vendor ?? ""]),
      { right: [3] },
    );
  }

  signOffFooter(doc);
  finishPdf(doc, fileStem(r.header), output, tab);
}
