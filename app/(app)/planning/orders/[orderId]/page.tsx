import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import {
  getOrderHeader,
  getFabricBom,
  getMaterialBom,
  getUoms,
  getItems,
} from "@/lib/planning/bom-service";
import { fmtNumber, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { BomTabs } from "./bom-tabs";

export default async function OrderBomPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("planning", "view");
  const { orderId } = await params;

  const [
    order,
    { bom: fabricBom, components: fabricComponents, processes: fabricProcesses },
    { bom: materialBom, items: materialItems },
    uoms,
    masterItems,
  ] = await Promise.all([
    getOrderHeader(orderId),
    getFabricBom(orderId),
    getMaterialBom(orderId),
    getUoms(),
    getItems(),
  ]);

  if (!order) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.order_number ?? "Order"}
        description={order.buyers?.name ?? undefined}
      />

      {/* Order summary strip */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{order.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order qty</dt>
              <dd className="tabular-nums font-medium">
                {fmtNumber(order.order_qty)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ship date</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(order.ship_date)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/* BOM tabs */}
      <BomTabs
        orderId={orderId}
        fabricBom={fabricBom}
        fabricComponents={fabricComponents}
        fabricProcesses={fabricProcesses}
        materialBom={materialBom}
        materialItems={materialItems}
        uoms={uoms}
        masterItems={masterItems}
      />
    </div>
  );
}
