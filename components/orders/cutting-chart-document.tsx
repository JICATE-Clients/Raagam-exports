"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cuttingCell, cuttingRows, sumOf, type CuttingChart, type CuttingFigures } from "@/lib/orders/cutting-chart/types";
import {
  chartFacts,
  chartQtyTerms,
  exportCuttingChartCsv,
  exportCuttingChartPdf,
  styleLine,
} from "@/lib/orders/cutting-chart/export";
import {
  OrderFacts,
  QtyEquation,
  ReportTable,
  STAGE_STYLES,
  SectionCard,
  SheetLabel,
  SignOff,
  Swatch,
  Th,
  stripeRow,
  totalRowStyle,
} from "@/components/orders/report-kit";

/** The chart is about the cutting table — the report palette's CUTTING tone,
 *  as its PDF (`exportCuttingChartPdf`) wears it. */
const TONE = STAGE_STYLES.cutting;

/**
 * Orders ▸ <order> ▸ Cutting Chart (client 2026-09-23, legacy RP "CUTTING
 * CHART"). The body is the legacy's — sizes across, and per colour the Order,
 * Approval, Rej.Allow and Total rows. THE SHEET FORMAT (user 2026-09-29, "this
 * is okay apply it"): a masthead to the kit's design keeping the centred
 * "<COMPANY> — CUTTING CHART" title with the RE No large at the right, the
 * facts as a label/value grid, the quantity as the sum it is, and the chart as
 * a CUTTING card — striped rows, style bands and Total rows tinted, a swatch per
 * colour. The PDF draws the same blocks (`exportCuttingChartPdf`).
 *
 * A client island only for the three export buttons; the data arrives whole
 * from the server page and the header facts / style lines come from the same
 * helpers the PDF and Excel use, so screen and paper cannot drift.
 *
 * "Printed <date time>" is stamped by the PDF at the moment it is made — a
 * render-time clock here would be impure and would lie on a cached page.
 *
 * READ-ONLY: no fields, no overlay — nothing for the reload guard to protect.
 */
export function CuttingChartDocument({ chart }: { chart: CuttingChart }) {
  const h = chart.header;
  const c = h.company;
  const rows = cuttingRows(chart);
  const cols = chart.sizes.length + 3;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="outline" size="md" onClick={() => exportCuttingChartCsv(chart)}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          Excel
        </Button>
        <Button variant="outline" size="md" onClick={() => exportCuttingChartPdf(chart, "print")}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
        <Button size="md" onClick={() => exportCuttingChartPdf(chart, "download")}>
          <Download className="h-4 w-4" aria-hidden />
          Download PDF
        </Button>
      </div>

      <div>
        {/* THE MASTHEAD — the kit's design (stage stripe, mark, dark rule) with
            the chart's own identity: "<COMPANY> — CUTTING CHART" centred (user
            2026-09-29), the unit under it, the RE No large at the right. */}
        <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
          <div className="flex h-[5px]" aria-hidden>
            <div className="flex-1 bg-[#d98e04]" />
            <div className="flex-1 bg-[#6b7480]" />
            <div className="flex-1 bg-[#037bb8]" />
            <div className="flex-1 bg-[#85c227]" />
          </div>
          <div className="relative flex min-h-[4.75rem] flex-wrap items-center justify-between gap-3 border-b-2 border-[#17202b] px-5 py-4">
            {c.logo ? (
              // A plain <img>: a stored data URL or an external Company
              // Profile URL, which next/image would need configuring for.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.logo} alt={c.name ?? "Company logo"} className="h-11 w-auto shrink-0 object-contain" />
            ) : (
              <span
                aria-hidden
                className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#037bb8] text-[20px] font-extrabold text-white"
              >
                {(c.name ?? "R").trim().charAt(0)}
                <span className="absolute -bottom-[3px] -right-[3px] h-3 w-3 rounded-[3px] border-2 border-white bg-[#85c227]" />
              </span>
            )}
            <div className="min-w-0 flex-1 text-center">
              <div className="text-[18px] font-extrabold uppercase tracking-[.01em]">
                <span className="text-[#17202b]">{c.name ?? "RAAGAM EXPORTS"}</span>
                <span className="text-[#037bb8]"> — Cutting Chart</span>
              </div>
              {c.unit && (
                <div className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-[#7b8594]">{c.unit}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10.5px] font-bold uppercase tracking-[.1em] text-[#7b8594]">RE No</div>
              <div className="font-mono text-[20px] font-semibold text-[#17202b]">{h.scNo ?? "—"}</div>
            </div>
          </div>
        </div>
        <OrderFacts facts={chartFacts(chart).map((f) => ({ ...f, mono: f.label !== "Customer" }))} />

        <div className="mt-4">
          <SheetLabel>Quantity to cut</SheetLabel>
          <QtyEquation {...chartQtyTerms(chart)} />
        </div>

        <div className="mt-4">
          <SectionCard tone={TONE} title="Cutting Chart" total={cuttingCell(sumOf(chart.total.total))} totalLabel="Cut Qty">
            <ReportTable bare>
              <thead>
                <tr>
                  <Th>Color</Th>
                  <Th>{""}</Th>
                  {chart.sizes.map((z) => (
                    <Th key={z.key} right>
                      {z.label}
                    </Th>
                  ))}
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {chart.styles.map((s, si) => (
                  <StyleBlock key={`${s.styleRefNo ?? ""}-${si}`} cols={cols} line={styleLine(chart, s)}>
                    {s.colours.map((col) => (
                      <FigureRows key={col.combo} first={col.combo} f={col.figures} rows={rows} />
                    ))}
                  </StyleBlock>
                ))}
                <StyleBlock cols={cols} line="RE Total">
                  <FigureRows first="" f={chart.total} rows={rows} />
                </StyleBlock>
              </tbody>
            </ReportTable>
          </SectionCard>
        </div>

        {/* THE THREE SIGNATURES, each over its own rule (the sheet format). */}
        <SignOff />
      </div>
    </div>
  );
}

function StyleBlock({ cols, line, children }: { cols: number; line: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-b border-border" style={totalRowStyle(TONE)}>
        <td colSpan={cols} className="px-2 py-1 font-semibold">
          {line}
        </td>
      </tr>
      {children}
    </>
  );
}

function FigureRows({
  first,
  f,
  rows,
}: {
  first: string;
  f: CuttingFigures;
  rows: { key: keyof CuttingFigures; label: string }[];
}) {
  return (
    <>
      {rows.map((r, i) => {
        const total = r.key === "total";
        return (
          <tr
            key={r.key}
            className={total ? "border-b-2 border-border font-semibold" : "border-b border-border/60"}
            style={total ? totalRowStyle(TONE) : stripeRow(i)}
          >
            <td className="px-2 py-1 font-medium">
              {i === 0 && first ? (
                <>
                  <Swatch name={first} />
                  {first}
                </>
              ) : (
                ""
              )}
            </td>
            <td className={`px-2 py-1 text-right ${total ? "" : "text-[#5b6472]"}`}>{r.label}</td>
            {f[r.key].map((n, zi) => (
              <td key={zi} className="px-2 py-1 text-right tabular-nums">
                {cuttingCell(n)}
              </td>
            ))}
            <td className="px-2 py-1 text-right font-semibold tabular-nums">
              {cuttingCell(sumOf(f[r.key]))}
            </td>
          </tr>
        );
      })}
    </>
  );
}
