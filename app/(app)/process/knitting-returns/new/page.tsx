import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { getKnittingOrder, listKnittingOrders } from "@/lib/production/knitting-service";
import { KnitReceiptEntry } from "../../knitting-hub/_components/knit-receipt-entry";

/** Process ▸ Knitting ▸ New Yarn Return (user 2026-11-12) — posted against one Knitting Order. */
export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  await requirePermission("stores", "edit");
  const { order } = await searchParams;
  const [list, setup, canEdit, doc] = await Promise.all([
    listKnittingOrders(),
    getProductionDcSetup(),
    can("stores", "edit"),
    order ? getKnittingOrder(order) : Promise.resolve(null),
  ]);
  // Only orders whose yarn is out and not closed can take a Yarn Return.
  const open = list.filter((o) => o.status === "in_process" || o.status === "partially_received");
  const waiting = list.filter((o) => o.status === "issued");
  return (
    <div className="space-y-4">
      <PageHeader
        title="New Yarn Return"
        description={"Unknitted yarn the knitter sent back — it goes back on the shelf"}
        actions={<Link href="/process/knitting-returns" className="text-sm text-primary hover:underline">← Yarn Returns</Link>}
      />
      <KnitReceiptEntry mode="yarn_return" orders={open} waiting={waiting} doc={doc} stores={setup.stores} bins={setup.bins} canEdit={canEdit} today={today()} />
    </div>
  );
}
