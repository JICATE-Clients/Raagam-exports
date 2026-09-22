import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCompletions,
  getCompletableOrders,
  getBuyerOptions,
} from "@/lib/orders/completions/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { CompletionsTable } from "./completions-table";

export default async function OrderCompletionsPage() {
  await requirePermission("orders", "view");

  const [completions, orders, buyers] = await Promise.all([
    getCompletions(),
    getCompletableOrders(),
    getBuyerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment Order Completion"
        description="Mark a garment order complete and closed — pick the RE No on the first row."
        actions={
          /* NO "+ New completion" HERE ANY MORE (client 2026-09-22, "same this
             changes in completion"): the entry is the table's own first row —
             see `CompletionsTable`, and Cancellation for the history. */
          <Link href="/orders">
            <Button variant="outline" size="md">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <CompletionsTable completions={completions} orders={orders} buyers={buyers} />
    </div>
  );
}
