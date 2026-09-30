/**
 * The sheet format's opening, shared by every report whose header is a
 * `BomDocHeader` — Yarn & Fabric, Printing, the Entry Register and the
 * Accessories Requirement (user 2026-09-29). Not "use client": it holds no
 * state, so a server-rendered report can use it too (see report-kit.tsx).
 */
import { fmtDate, fmtNumber } from "@/lib/format";
import type { BomDocHeader } from "@/lib/orders/fabric-bom/reports";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import type { ReportStyleImage } from "@/lib/orders/gos/style-images";
import { CadPendingBadge } from "@/components/orders/cad/cad-pending-badge";
import { ReportThumbnail } from "@/components/orders/report-thumbnail";
import { OrderFacts, QtyEquation, SheetLabel, SheetMasthead } from "@/components/orders/report-kit";

/**
 * THE SHEET FORMAT'S OPENING (user 2026-09-29) — masthead, the order's facts
 * beside the style picture, the CAD stamp when due, and the quantity drawn as
 * the sum it is. The screen twin of `drawSheetHeader` (reports-export.ts):
 * same facts, same order, same words.
 */
export function SheetOpening({
  kind,
  header,
  thumbnail,
}: {
  kind: string;
  header: BomDocHeader;
  thumbnail: ReportStyleImage | null;
}) {
  const q = header.qty;
  const pct = (v: number | null) => (v == null ? null : `${v.toFixed(2)}%`);
  return (
    <div className="mb-5">
      <SheetMasthead
        company={{ name: header.company.name, unit: header.company.unit, logo: header.company.logo }}
        kind={kind}
        reNo={header.scNo}
        meta={[header.bomCode, header.computedAt ? `Computed ${fmtDate(header.computedAt)}` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      <OrderFacts
        thumbnail={thumbnail ? <ReportThumbnail image={thumbnail} /> : undefined}
        facts={[
          { label: "Customer", value: header.customer },
          { label: "Order No", value: header.orderNo, mono: true },
          { label: "Style", value: header.styleRefNo, sub: header.styleName, mono: true },
          {
            label: "Earlier Shipment",
            value: header.earlierShipmentDate ? fmtDate(header.earlierShipmentDate) : null,
            sub: header.deliveryFromDate ? `Delivery ${fmtDate(header.deliveryFromDate)}` : null,
            mono: true,
          },
          { label: "Unit", value: ["PCS", header.company.unit].filter(Boolean).join(" · ") },
          { label: "Excess", value: header.excessPct == null ? null : `${fmtNumber(header.excessPct)}%`, mono: true },
        ]}
      />
      {header.cadPending && (
        <div className="border border-t-0 border-border bg-white px-5 py-2">
          <CadPendingBadge />
        </div>
      )}
      <div className="mt-4">
        {isReportRefusal(q) ? (
          <div className="rounded-lg border border-border bg-[#fdf1f1] px-4 py-2.5 text-[12.5px] font-medium text-destructive">
            {q.refused}
          </div>
        ) : (
          <>
            <SheetLabel>Quantity to cut</SheetLabel>
            <QtyEquation
              terms={[
                { label: "Order", value: fmtNumber(q.orderQty), note: "pcs" },
                {
                  label: "Excess",
                  value: fmtNumber(q.excessQty),
                  note: header.excessPct == null ? null : `${fmtNumber(header.excessPct)}%`,
                },
                { label: "Approval", value: fmtNumber(q.approvalQty), note: pct(q.approvalPct) },
                { label: "Rej. Allow", value: fmtNumber(q.rejectionQty), note: pct(q.rejectionPct) },
              ]}
              result={{ label: "Cut Qty", value: fmtNumber(q.cutQty), note: "pcs" }}
            />
          </>
        )}
      </div>
    </div>
  );
}
