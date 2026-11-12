import { requirePermission } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getOrdersForPicker } from "@/lib/purchase/po-service";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { listBinStock } from "@/lib/stores/process-dc-service";
import { getKnitGauges, getKnitters } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

export default async function NewKnittingOrderPage() {
  await requirePermission("stores", "create");
  // The yarn rows pick a store · bin and can send at once (user 2026-11-12), so stock comes too.
  const [orders, knitters, gauges, setup, binStock] = await Promise.all([
    getOrdersForPicker(),
    getKnitters(),
    getKnitGauges(),
    getProductionDcSetup(),
    listBinStock(),
  ]);
  return (
    <KnittingEditor
      doc={null}
      orders={orders}
      knitters={knitters}
      gauges={gauges}
      initialCandidates={[]}
      initialCustomer={null}
      today={today()}
      canEdit
      stores={setup.stores}
      bins={setup.bins}
      binStock={binStock}
    />
  );
}
