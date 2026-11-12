import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getOrdersForPicker } from "@/lib/purchase/po-service";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { listBinStock } from "@/lib/stores/process-dc-service";
import { getKnitCandidates, getKnitGauges, getKnitters, getKnittingOrder, listYarnAtKnitter } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

/** Yarn can still go out on these (a draft is issued and sent in the same click). */
const OPEN_FOR_DC = ["draft", "issued", "in_process", "partially_received"];

export default async function KnittingOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePermission("stores", "view");
  const { orderId } = await params;
  const doc = await getKnittingOrder(orderId);
  if (!doc) notFound();
  // ONE SCREEN (user 2026-11-12): each yarn row picks its store · bin and shows what it holds.
  const dcOpen = OPEN_FOR_DC.includes(doc.status) && !doc.close_pending;
  const [orders, knitters, gauges, canEdit, cand, setup, binStock, atKnitter] = await Promise.all([
    getOrdersForPicker(),
    getKnitters(doc.vendor_id),
    getKnitGauges(),
    can("stores", "edit"),
    doc.sales_order_id ? getKnitCandidates(doc.sales_order_id, doc.id) : Promise.resolve(null),
    getProductionDcSetup(),
    dcOpen ? listBinStock() : Promise.resolve([]),
    dcOpen && doc.status !== "draft" ? listYarnAtKnitter(doc) : Promise.resolve([]),
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
      binStock={binStock}
      atKnitter={atKnitter}
    />
  );
}
