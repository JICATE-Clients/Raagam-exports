import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { listKnitBalancesToProgram, listKnittingOrders } from "@/lib/production/knitting-service";
import { KnittingOrdersList } from "./_components/knitting-orders-list";

/**
 * Process ▸ Knitting (doc/process/knitting-plan.md, DB 0825). A knitting order is a
 * process order of type knitting, so it answers to the same `stores` permission that
 * Process Orders and Process DC do.
 */
export default async function KnittingHubPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate, canEdit, canDelete, balances] = await Promise.all([
    listKnittingOrders(),
    can("stores", "create"),
    can("stores", "edit"),
    can("stores", "delete"),
    listKnitBalancesToProgram(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Knitting Orders"
        description="Program fabric for a knitter, send the yarn, receive the fabric — one order from start to finish"
        actions={
          canCreate ? (
            <Link href="/process/knitting-hub/new" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Knitting Order
            </Link>
          ) : null
        }
      />
      <KnittingOrdersList rows={rows} canEdit={canEdit} canDelete={canDelete} balances={balances} canCreate={canCreate} />
    </div>
  );
}
