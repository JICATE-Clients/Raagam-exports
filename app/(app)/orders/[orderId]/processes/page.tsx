import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getOrder } from "@/lib/orders/service";
import { getOrderProcesses } from "@/lib/orders/garment-processes/service";
import { getProcessAmendments } from "@/lib/orders/garment-processes/amendments-service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { GarmentProcessesClient } from "./garment-processes-client";
import { ProcessAmendments } from "./process-amendments";

export default async function OrderProcessesPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;

  const [order, processes, amendments, canCreate, canDelete, canApprove] =
    await Promise.all([
      getOrder(orderId),
      getOrderProcesses(orderId),
      getProcessAmendments(orderId),
      can("orders", "create"),
      can("orders", "delete"),
      can("orders", "approve"),
    ]);

  if (!order) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment Processes"
        description={`${order.order_number ?? "Order"} · ${order.buyers?.name ?? ""}`}
        actions={
          <Link href={`/orders/${orderId}`}>
            <Button variant="outline" size="sm">
              ← Order
            </Button>
          </Link>
        }
      />

      <GarmentProcessesClient
        orderId={orderId}
        processes={processes}
        canCreate={canCreate}
        canDelete={canDelete}
      />

      <ProcessAmendments
        orderId={orderId}
        amendments={amendments}
        canCreate={canCreate}
        canApprove={canApprove}
      />
    </div>
  );
}
