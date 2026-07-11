import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getOrder } from "@/lib/orders/service";
import { getAdvisedItemsByOrder } from "@/lib/orders/advised-items/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { AdvisedItemsEditor } from "../advised-items-editor";

export default async function OrderAdvisedItemsPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;

  const [order, items, canCreate, canEdit, canDelete] = await Promise.all([
    getOrder(orderId),
    getAdvisedItemsByOrder(orderId),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  if (!order) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prepare Advised Items"
        description={`${order.order_number ?? "—"} · ${order.buyers?.name ?? "Unknown customer"}`}
        actions={
          <Link href="/orders/advised-items">
            <Button variant="outline" size="sm">
              ← Prepare Advised Items
            </Button>
          </Link>
        }
      />

      <AdvisedItemsEditor
        fixedOrder={{ id: order.id, order_number: order.order_number }}
        items={items}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
