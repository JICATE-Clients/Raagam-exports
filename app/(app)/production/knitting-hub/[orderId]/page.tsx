import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getOrdersForPicker } from "@/lib/purchase/po-service";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { getProcessDc, listBinStock, listLotStock, listOpenProcessOrders } from "@/lib/stores/process-dc-service";
import { getKnitCandidates, getKnitGauges, getKnitters, getKnittingOrder } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

const OPEN_FOR_DC = ["issued", "in_process", "partially_received"];

export default async function KnittingOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePermission("stores", "view");
  const { orderId } = await params;
  const doc = await getKnittingOrder(orderId);
  if (!doc) notFound();
  // Tab 2 sends the yarn IN PLACE (user 2026-11-11): the Job Work DC form's data, for this
  // order only — its open lines, this unit's stock and lots, and a draft DC to carry on with.
  const dcOpen = OPEN_FOR_DC.includes(doc.status) && !doc.close_pending;
  const draftId = doc.dcs.find((d) => d.status === "draft")?.id ?? null;
  const [orders, knitters, gauges, canEdit, cand, setup, openOrders, lots, draft, binStock] = await Promise.all([
    getOrdersForPicker(),
    getKnitters(doc.vendor_id),
    getKnitGauges(),
    can("stores", "edit"),
    doc.sales_order_id ? getKnitCandidates(doc.sales_order_id, doc.id) : Promise.resolve(null),
    getProductionDcSetup(),
    dcOpen ? listOpenProcessOrders() : Promise.resolve([]),
    dcOpen ? listLotStock() : Promise.resolve([]),
    dcOpen && draftId ? getProcessDc(draftId) : Promise.resolve(null),
    dcOpen ? listBinStock() : Promise.resolve([]),
  ]);
  return (
    <KnittingEditor
      doc={doc}
      orders={orders}
      knitters={knitters}
      gauges={gauges}
      initialCandidates={cand && cand.ok ? cand.candidates : []}
      initialCustomer={cand && cand.ok ? cand.customer : null}
      today={today()}
      canEdit={canEdit}
      stores={setup.stores}
      bins={setup.bins}
      dcSend={{
        order: openOrders.find((o) => o.id === doc.id) ?? null,
        stock: setup.stock,
        lots,
        binStock,
        draft: draft && draft.status === "draft" ? draft : null,
      }}
    />
  );
}
