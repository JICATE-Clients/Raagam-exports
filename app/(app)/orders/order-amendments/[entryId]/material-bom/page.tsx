import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendmentHead } from "@/lib/orders/order-amendments/service";
import { AmendmentTabHeader } from "@/components/orders/amendment-tabs";
import {
  getMbaFormData,
  listBomCopySources,
  listMaterialBomAmendments,
  listMaterialBomTasks,
} from "@/lib/orders/material-bom-amendment/service";
import { orderLockMessages } from "@/lib/orders/order-locks";
import { MbaMasterScreen } from "../../../material-bom/mba-master-screen";

/**
 * THE AMENDMENT'S MATERIAL BOM TAB (2026-09-23) — the Material BOM editor,
 * embedded on this order; editable only when the amendment picked Material BOM.
 */
export default async function AmendmentMaterialBomTab({ params }: { params: Promise<{ entryId: string }> }) {
  await requirePermission("orders", "view");
  const { entryId } = await params;
  const head = await getAmendmentHead(entryId);
  if (!head || !head.garment_order_id) notFound();
  const [tasks, boms, copySources, data, canCreate, canEdit, canDelete, mCreate, mEdit, orderLocks] =
    await Promise.all([
      listMaterialBomTasks(),
      listMaterialBomAmendments(),
      listBomCopySources(),
      getMbaFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
      orderLockMessages(undefined, "material_bom"),
    ]);
  return (
    <div className="space-y-3">
      <AmendmentTabHeader head={head} current="material-bom" />
      <MbaMasterScreen
        tasks={tasks}
        boms={boms}
        copySources={copySources}
        data={data}
        perms={{ canCreate, canEdit, canDelete }}
        masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
        orderLocks={orderLocks}
        embed={{ id: head.garment_order_id, returnHref: `/orders/order-amendments/${entryId}` }}
      />
    </div>
  );
}
