import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getOrders } from "@/lib/orders/service";
import { getAdvisedItems } from "@/lib/orders/advised-items/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { AdvisedItemsClient } from "./advised-items-client";

export default async function AdvisedItemsPage() {
  await requirePermission("orders", "view");

  const [items, orders, canCreate, canEdit, canDelete] = await Promise.all([
    getAdvisedItems(),
    getOrders(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Advised Items"
        description="Items advised for an order ahead of BOM & purchase"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <AdvisedItemsClient
        items={items}
        orders={orders}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
