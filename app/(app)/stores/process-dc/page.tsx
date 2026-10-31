import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getProcessDc, listOpenProcessOrders, listProcessDcs } from "@/lib/stores/process-dc-service";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { ProcessDcScreen } from "./_components/process-dc-screen";
import { ProcessDcSendForm } from "./_components/process-dc-send-form";
import { ProcessReceiptForm } from "./_components/process-receipt-form";
import { getItems } from "@/lib/stores/service";

/**
 * STORES ▸ PROCESS DC — job work sent to a processor against a Process Order
 * (doc/stores/dc-plan.md Phase 2, 0786). `?send=new[&order=<id>]` or `?send=<dcId>` opens
 * the editor; otherwise the register.
 */
export default async function ProcessDcPage({
  searchParams,
}: {
  searchParams: Promise<{ send?: string; order?: string; receive?: string }>;
}) {
  await requirePermission("stores", "view");
  const { send, order, receive } = await searchParams;

  if (receive) {
    const [dc, setup, items] = await Promise.all([getProcessDc(receive), getProductionDcSetup(), getItems()]);
    if (!dc) notFound();
    return (
      <div className="space-y-4">
        <PageHeader title="Process Receipt" description="Job work back from the processor — output, loss and the draft bill" />
        <ProcessReceiptForm dc={dc} items={items} stores={setup.stores} bins={setup.bins} />
      </div>
    );
  }

  if (send) {
    const [orders, setup, dc] = await Promise.all([
      listOpenProcessOrders(),
      getProductionDcSetup(),
      send !== "new" ? getProcessDc(send) : Promise.resolve(null),
    ]);
    if (send !== "new" && !dc) notFound();
    if (!setup.unit) return <p className="text-sm text-muted-foreground">Pick your working unit in the top bar first.</p>;
    return (
      <div className="space-y-4">
        <PageHeader title="Process DC" description="Send material to a processor against its Process Order" />
        <ProcessDcSendForm
          orders={orders}
          stores={setup.stores}
          bins={setup.bins}
          stock={setup.stock}
          existing={dc && dc.status === "draft" ? dc : null}
          initialOrderId={order ?? null}
        />
      </div>
    );
  }

  const [dcs, orders, canCreate] = await Promise.all([listProcessDcs(), listOpenProcessOrders(), can("stores", "create")]);
  return (
    <div className="space-y-4">
      <PageHeader title="Process DC" description="Job work out to dyers, knitters, printers and embroiderers" />
      <ProcessDcScreen dcs={dcs} orders={orders} canCreate={canCreate} />
    </div>
  );
}
