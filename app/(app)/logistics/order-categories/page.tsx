import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getOrderCategoryAssignments,
  getActiveCategories,
  getOrderOptions,
} from "@/lib/logistics/export-categories/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { OrderCategoriesClient } from "./order-categories-client";

export default async function OrderCategoriesPage() {
  await requirePermission("logistics", "view");

  const [assignments, categories, orders, canCreate, canDelete, canExport] =
    await Promise.all([
      getOrderCategoryAssignments(),
      getActiveCategories(),
      getOrderOptions(),
      can("logistics", "create"),
      can("logistics", "delete"),
      can("logistics", "export"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Order Category Assignment"
        description="Assign export categories to orders"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <OrderCategoriesClient
        assignments={assignments}
        categories={categories}
        orders={orders}
        canCreate={canCreate}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
