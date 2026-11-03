import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { listStockAdjustments } from "@/lib/stores/stock-adjustment-service";
import { StockAdjustmentsList } from "./_components/stock-adjustments-list";

/**
 * Purchase ▸ Purchase Store ▸ Stock Adjustment (0805). Replaces the old one-item Sheet, which
 * wrote an anonymous adjust_in / adjust_out row — no lot, bin, owner, value or document.
 */
export default async function StockAdjustmentsPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listStockAdjustments(),
    can("stores", "create"),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Adjustment"
        description="Increase or decrease a lot to match the scale — moisture gain or loss, recount, damage. Posted at the lot's own rate."
        actions={
          canCreate ? (
            <Link href="/purchase/adjustments/new" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Stock Adjustment
            </Link>
          ) : null
        }
      />
      <StockAdjustmentsList rows={rows} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
