"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cuttingCell, cuttingRows, sumOf, type CuttingChart, type CuttingFigures } from "@/lib/orders/cutting-chart/types";
import { exportCuttingChartCsv, exportCuttingChartPdf, headerColumns, styleLine } from "@/lib/orders/cutting-chart/export";

/**
 * Orders ▸ <order> ▸ Cutting Chart (client 2026-09-23, legacy RP "CUTTING
 * CHART"). The Material / Fabric BOM reports' letterhead and table idiom, so
 * the order's documents read as one family; the body is the legacy's — sizes
 * across, and per colour the Order, Approval, Rej.Allow and Total rows.
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
  const contact = [c.unit, c.address, c.gstin ? `GSTIN ${c.gstin}` : null].filter(Boolean).join("  ·  ");
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
        {/* THE LETTERHEAD — green rule, dark rule, blue title: the family frame. */}
        <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
          <div className="h-[3px] bg-[#85c227]" />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3">
            <div className="flex min-w-0 items-center gap-4">
              {c.logo && (
                // A plain <img>: a stored data URL or an external Company
                // Profile URL, which next/image would need configuring for.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logo} alt={c.name ?? "Company logo"} className="h-12 w-auto shrink-0 object-contain" />
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-bold uppercase tracking-wide text-[#16181d]">
                  {c.name ?? "RAAGAM EXPORTS"}
                </div>
                {contact && <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{contact}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">Cutting Chart</div>
              {h.scNo && <div className="font-mono text-[12px] text-[#5b6472]">{h.scNo}</div>}
            </div>
          </div>
        </div>

        {/* THE LEGACY'S BOXED HEADER — its four columns, each read down. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          {headerColumns(chart).map((col, ci) => (
            <div key={ci} className="space-y-1">
              {col.map(([label, value]) => (
                <div key={label} className="flex min-w-0 gap-1.5">
                  <span className="shrink-0 text-[#8b95a3]">{label}:</span>
                  <span className="min-w-0 font-semibold tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="overflow-x-auto border-x border-b border-border bg-white">
          <table className="w-full min-w-max border-collapse text-[12px]">
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
          </table>
        </div>

        {/* THE THREE SIGNATURES — the legacy's foot, on screen as on paper. */}
        <div className="grid grid-cols-3 gap-4 rounded-b-md border-x border-b border-border bg-white px-5 pb-3 pt-10 text-[12px] font-semibold">
          <div className="border-t border-[#16181d] pt-1">Prepared By</div>
          <div className="border-t border-[#16181d] pt-1 text-center">Checked By</div>
          <div className="border-t border-[#16181d] pt-1 text-right">Approved By</div>
        </div>
      </div>
    </div>
  );
}

function StyleBlock({ cols, line, children }: { cols: number; line: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-b border-border bg-[#f6f7f9]">
        <td colSpan={cols} className="px-2 py-1 font-semibold text-[#16181d]">
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
          >
            <td className="border-x border-border px-2 py-1 font-medium">{i === 0 ? first : ""}</td>
            <td className="border-x border-border px-2 py-1 text-right text-[#5b6472]">{r.label}</td>
            {f[r.key].map((n, zi) => (
              <td key={zi} className="border-x border-border px-2 py-1 text-right tabular-nums">
                {cuttingCell(n)}
              </td>
            ))}
            <td className="border-x border-border px-2 py-1 text-right font-semibold tabular-nums">
              {cuttingCell(sumOf(f[r.key]))}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-border bg-[#f6f7f9] px-2 py-1 font-semibold text-[#5b6472] ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}
