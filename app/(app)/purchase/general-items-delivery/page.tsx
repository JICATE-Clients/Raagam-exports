import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDeliveryQueue, listItemClassOptions } from "@/lib/stores/extras-service";
import { GeneralItemsDeliveryClient } from "./general-items-delivery-client";

/**
 * Purchase ▸ General Items Purchase ▸ General Items Delivery (user 2026-11-02).
 *
 * The store hands the goods of an APPROVED Material Requisition Slip to the
 * department that asked. No document of its own: Deliver is the MRS issue step
 * (`issueMrs` — approved → issued, stock-out posted to the ledger), whole slip
 * at a time.
 */
export default async function GeneralItemsDeliveryPage() {
  await requirePermission("stores", "view");
  const [rows, classes, canDeliver] = await Promise.all([
    listDeliveryQueue(),
    listItemClassOptions(),
    can("stores", "edit"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="General Items Delivery"
        description="Hand approved requisitions to the department — the whole slip is issued from its store."
      />
      <GeneralItemsDeliveryClient rows={rows} classes={classes} canDeliver={canDeliver} />
    </div>
  );
}
