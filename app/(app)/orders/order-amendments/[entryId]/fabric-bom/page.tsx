import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendmentHead } from "@/lib/orders/order-amendments/service";
import { AmendmentTabHeader } from "@/components/orders/amendment-tabs";
import {
  getFabricBomFormData,
  listFabricBomTasks,
  listFabricBoms,
} from "@/lib/orders/fabric-bom/service";
import { orderLocks } from "@/lib/orders/order-locks";
import { FabricBomScreen } from "../../../fabric-bom/fabric-bom-screen";

/**
 * THE AMENDMENT'S FABRIC BOM TAB (2026-09-23) — the Fabric BOM editor,
 * embedded on this order. Editable when the amendment picked Fabric BOM; read-
 * only otherwise (`orderLocks(…, "fabric_bom")` carries the refusal),
 * its figures recalculated from the Overview.
 */
export default async function AmendmentFabricBomTab({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("orders", "view");
  const { entryId } = await params;
  const head = await getAmendmentHead(entryId);
  if (!head || !head.garment_order_id) notFound();
  const [tasks, boms, data, canCreate, canEdit, canDelete, locks] = await Promise.all([
    listFabricBomTasks(),
    listFabricBoms(),
    getFabricBomFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    orderLocks(undefined, "fabric_bom"),
  ]);
  return (
    <div className="space-y-3">
      <AmendmentTabHeader head={head} current="fabric-bom" />
      <FabricBomScreen
        tasks={tasks}
        boms={boms}
        data={data}
        perms={{ canCreate, canEdit, canDelete }}
        orderLocks={locks.messages}
      raiseFor={locks.raiseFor}
        embed={{ id: head.garment_order_id, returnHref: `/orders/order-amendments/${entryId}` }}
      />
    </div>
  );
}
