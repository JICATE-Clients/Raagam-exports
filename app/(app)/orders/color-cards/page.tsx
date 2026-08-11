import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCustomersWithCardCounts,
  type CustomerCardSummary,
} from "@/lib/orders/color-cards/service";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
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
  /* View + Edit, the Master Data cluster. Edit is a LINK because this page is a
     SERVER component: an `onEdit` closure cannot cross the RSC boundary, a href can.
     Delete is deliberately absent — no delete action exists for this record, and an
     order is retired through Order Closure, not removed. */
  rowActionsColumn((row) => (
    <RowActions label={row.code} editHref={`/orders/color-cards/customer/${row.id}`} />
  )),
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
            <Button variant="outline" size="md">
              ← Orders
            </Button>
          </Link>
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, customers)}
        rows={customers}
        getKey={(row) => row.id}
        empty="No customers yet. Add buyers in Master Data first."
      />
    </div>
  );
}
