import { requirePermission } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getOrdersForPicker } from "@/lib/purchase/po-service";
import { getKnitGauges, getKnitters } from "@/lib/production/knitting-service";
import { KnittingEditor } from "../_components/knitting-editor";

export default async function NewKnittingOrderPage() {
  await requirePermission("stores", "create");
  const [orders, knitters, gauges] = await Promise.all([getOrdersForPicker(), getKnitters(), getKnitGauges()]);
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
    />
  );
}
