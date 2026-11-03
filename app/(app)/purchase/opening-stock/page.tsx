import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { listOpeningStocks } from "@/lib/stores/opening-stock/service";
import { OpeningStockList } from "./_components/opening-stock-list";

export default async function OpeningStockPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listOpeningStocks(),
    can("stores", "create"),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Opening Stock"
        description="Stock already on hand at go-live, counted into a store with its bin, lot and rate."
        actions={
          canCreate ? (
            <Link href="/purchase/opening-stock/new" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Opening Stock
            </Link>
          ) : null
        }
      />
      <OpeningStockList rows={rows} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
