import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCancellations,
  getCancellableOrders,
  getBuyerOptions,
} from "@/lib/orders/cancellations/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { CancellationsTable } from "./cancellations-table";

export default async function OrderCancellationsPage() {
  await requirePermission("orders", "view");

  const [cancellations, orders, buyers] = await Promise.all([
    getCancellations(),
    getCancellableOrders(),
    getBuyerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment Order Cancellation"
        description="Cancel a confirmed order — pick the RE No on the first row, and the order's status is flipped to Cancelled."
        actions={
          /* NO "+ New cancellation" HERE ANY MORE (client 2026-09-22): the
             entry is the table's own first row — see `CancellationsTable`. */
          <Link href="/orders">
            <Button variant="outline" size="md">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      {/* The columns, the entry row and the saved rows all live in the client
          table: the entry row's cells are inputs bound to its state, and the
          saved rows' cells are the same read-only cells this page used to
          declare. */}
      <CancellationsTable cancellations={cancellations} orders={orders} buyers={buyers} />
    </div>
  );
}
