import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getAmendmentHead } from "@/lib/orders/order-amendments/service";
import { AmendmentTabHeader } from "@/components/orders/amendment-tabs";
import { GarmentOrderScreen } from "../../../_garment-order/garment-order-screen";
import { loadGarmentOrderProps } from "../../../_garment-order/loader";

/**
 * THE AMENDMENT'S ORDER TAB (2026-09-23) — Order Entry's own editor, EMBEDDED
 * on this amendment's order: only the sections the amendment opened are
 * editable (the same frozen scope the database enforces), and Save / Cancel
 * come back to the amendment. Order Entry itself shows an amending order
 * read-only, so this tab is the one place the change is made.
 */
export default async function AmendmentOrderTab({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("orders", "view");
  const { entryId } = await params;
  const head = await getAmendmentHead(entryId);
  if (!head || !head.garment_order_id) notFound();
  const props = await loadGarmentOrderProps();
  return (
    <div className="space-y-3">
      <AmendmentTabHeader head={head} current="order" />
      <GarmentOrderScreen
        {...props}
        embed={{ id: head.garment_order_id, returnHref: `/orders/order-amendments/${entryId}` }}
      />
    </div>
  );
}
