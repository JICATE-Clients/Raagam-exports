import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCustomersWithCardCounts,
  type CustomerCardSummary,
} from "@/lib/orders/color-cards/service";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";

const columns: Column<CustomerCardSummary>[] = [
  {
    header: "Customer",
    cell: (row) => (
      <Link
        href={`/orders/color-cards/customer/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Customer Name",
    cell: (row) => (
      <Link
        href={`/orders/color-cards/customer/${row.id}`}
        className="text-sm font-medium hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  {
    header: "Country",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{row.country ?? "—"}</span>
    ),
  },
  {
    header: "Cards",
    align: "right",
    cell: (row) => (
      <Link
        href={`/orders/color-cards/customer/${row.id}`}
        className="inline-flex items-center gap-1 tabular-nums text-sm text-primary hover:underline"
      >
        {row.card_count}
        <span aria-hidden>→</span>
      </Link>
    ),
  },
];

export default async function ColorCardsPage() {
  await requirePermission("orders", "view");

  const customers = await getCustomersWithCardCounts();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Define Customer Colour Cards"
        description="Select a customer to define their buyer-approved colour palettes"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <DataTable
        columns={columns}
        rows={customers}
        getKey={(row) => row.id}
        empty="No customers yet. Add buyers in Master Data first."
      />
    </div>
  );
}
