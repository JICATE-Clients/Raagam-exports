import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { listStockTransfers } from "@/lib/stores/stock-transfer-service";
import { StockTransfersList } from "./_components/stock-transfers-list";

/**
 * Purchase ▸ Purchase Store ▸ Stock Transfer (0803). Replaces the old one-item Sheet, whose
 * `transferStock()` wrote the two legs as separate inserts and so could leave half a transfer.
 * Plan: doc/stores/stock-transfer-plan.md.
 */
export default async function StockTransfersPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listStockTransfers(),
    can("stores", "create"),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Transfer"
        description="Move stock between General Stock and an order, between two orders, or between stores — lot, GRN, age and rate travel with it."
        actions={
          canCreate ? (
            <Link href="/purchase/transfers/new" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Stock Transfer
            </Link>
          ) : null
        }
      />
      <StockTransfersList rows={rows} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
