import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getGrn, getGrnLines, getGrnStoresAndBins, grnQtyLockReason } from "@/lib/purchase/grn-service";
import { GrnEditForm } from "./grn-edit-form";

/**
 * EDIT A POSTED GRN (0792, user 2026-11-02). The paper (Invoice / DC No, dates, vehicle)
 * always; quantities, lots and bins while nothing downstream has moved — the page says
 * why up front when they are locked, and `grn_edit_posted` refuses the same regardless.
 */
export default async function GrnEditPage({ params }: { params: Promise<{ grnId: string }> }) {
  await requirePermission("materials_purchase", "edit");
  const { grnId } = await params;
  const [grn, lines, place, qtyLock, canCreateBin] = await Promise.all([
    getGrn(grnId),
    getGrnLines(grnId),
    getGrnStoresAndBins(),
    grnQtyLockReason(grnId),
    can("masters", "create"),
  ]);
  if (!grn) notFound();
  if (grn.status !== "posted") notFound();

  return (
    <div className="space-y-4">
      <PageHeader title={`Edit ${grn.code ?? "GRN"}`} description="Correct what was entered. Quantity changes re-post the GRN." />
      <GrnEditForm
        grn={{
          id: grn.id,
          code: grn.code,
          vendor: grn.vendors?.name ?? null,
          invoice_no: grn.invoice_no,
          invoice_date: grn.invoice_date,
          dc_no: grn.dc_no,
          vehicle_ref: (grn as { vehicle_ref?: string | null }).vehicle_ref ?? null,
        }}
        lines={lines.map((l) => ({
          id: l.id,
          description: l.description,
          po_code: l.po_code,
          qc_status: l.qc_status,
          received_qty: Number(l.received_qty) || 0,
          rejected_qty: Number(l.rejected_qty) || 0,
          roll_batch_no: l.roll_batch_no,
          store_id: l.store_id,
          bin_id: l.bin_id,
          bin_split: l.bin_split,
        }))}
        stores={place.stores}
        bins={place.bins}
        qtyLock={qtyLock}
        canCreateBin={canCreateBin}
      />
    </div>
  );
}
