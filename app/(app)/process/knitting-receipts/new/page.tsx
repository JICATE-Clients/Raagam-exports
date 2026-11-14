import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { getKnittingOrder, listKnittingOrders } from "@/lib/production/knitting-service";
import type { KnittingOrder } from "@/lib/production/knitting-types";
import { KnitFabricGrn } from "../../knitting-hub/_components/knit-fabric-grn";

/**
 * Process ▸ Knitting ▸ New Fabric Receipt — the MULTI-ORDER FABRIC GRN (Session 3, 0846): one
 * knitter's DC against several Knitting Orders. `?orders=a,b`; `?order=a` (the link from a
 * Knitting Order) still lands with that order picked.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string; orders?: string }> }) {
  await requirePermission("stores", "edit");
  const sp = await searchParams;
  const ids = [...new Set((sp.orders ?? sp.order ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
  const [list, setup, canEdit, docs] = await Promise.all([
    listKnittingOrders(),
    getProductionDcSetup(),
    can("stores", "edit"),
    Promise.all(ids.map((id) => getKnittingOrder(id))),
  ]);
  // Only orders whose yarn is out and not closed can take a Fabric Receipt.
  const open = list.filter((o) => o.status === "in_process" || o.status === "partially_received");
  const waiting = list.filter((o) => o.status === "issued");
  const openIds = new Set(open.map((o) => o.id));
  // One knitter per GRN: a hand-edited URL mixing knitters keeps the first order's knitter.
  const chosen = docs.filter((d): d is KnittingOrder => !!d && openIds.has(d.id));
  const sameKnitter = chosen.filter((d) => d.vendor_id === chosen[0]?.vendor_id);
  return (
    <KnitFabricGrn
      orders={open}
      waiting={waiting}
      docs={sameKnitter}
      stores={setup.stores}
      bins={setup.bins}
      canEdit={canEdit}
      today={today()}
    />
  );
}
