import type { jsPDF } from "jspdf";

/**
 * THE "CAD PENDING" STAMP on a Fabric BOM report (doc/order/cad.md §4.3
 * rationale, 0628): a report generated while any style's pattern is not yet
 * Ready says so, and says its consumption figures are estimates. (It waited
 * for the buyer's approval until 2026-09-25; there is no Send CAD step now —
 * `cadOrderPending` in guard.ts.)
 *
 * A BORDERED RED BADGE, NOT A DIAGONAL WATERMARK — the spec says "watermark",
 * and the house rule overrides the word for the reason the Garment Order
 * Sheet's "Draft — not confirmed" badge records (components/orders/gos-sheet.tsx):
 * these sheets are photocopied on the floor, and a faint diagonal is the first
 * thing a photocopier loses. A solid-bordered box in the top band survives a
 * mono copy and cannot be mistaken for decoration.
 *
 * One wording, drawn by `CadPendingBadge` on screen and by
 * `drawCadPendingStamp` on EVERY page of a PDF — so the two never disagree.
 */
export const CAD_PENDING_TITLE = "CAD PENDING";
export const CAD_PENDING_NOTE = "Consumption figures are estimates until every style's pattern is Ready.";

/**
 * Draw the stamp on the CURRENT page, top centre, as ONE LINE in the empty band
 * above the letterhead's top rule (y 20 in fabric-bom/reports-export.ts) — so
 * it overlaps nothing on the first page or on a continuation page. The caller
 * loops pages.
 */
export function drawCadPendingStamp(doc: jsPDF): void {
  const W = doc.internal.pageSize.getWidth();
  const label = `${CAD_PENDING_TITLE} — ${CAD_PENDING_NOTE}`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const w = doc.getTextWidth(label) + 16;
  const h = 13;
  const x = (W - w) / 2;
  const y = 4;
  doc.setDrawColor(179, 38, 30);
  doc.setLineWidth(1);
  doc.setFillColor(253, 243, 242);
  doc.rect(x, y, w, h, "FD");
  doc.setTextColor(179, 38, 30);
  doc.text(label, W / 2, y + 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
}
