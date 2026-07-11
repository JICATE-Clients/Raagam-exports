import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCustomer,
  getColorCardsForBuyer,
  type ColorCardWithBuyer,
} from "@/lib/orders/color-cards/service";
import { colorCardStatusTone } from "@/lib/orders/color-cards/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewColorCardForm } from "../../new-color-card-form";

const columns: Column<ColorCardWithBuyer>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/orders/color-cards/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  { header: "Card name", cell: (row) => <span className="text-sm font-medium">{row.name}</span> },
  {
    header: "Season",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{row.season ?? "—"}</span>
    ),
  },
  {
    header: "Colours",
    align: "right",
    cell: (row) => <span className="tabular-nums text-sm">{row.color_count}</span>,
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={colorCardStatusTone(row.status)}>
        {row.status === "active" ? "Active" : "Archived"}
      </StatusPill>
    ),
  },
  {
    header: "Created",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.created_at)}
      </span>
    ),
  },
];

export default async function CustomerColorCardsPage({
  params,
}: {
  params: Promise<{ buyerId: string }>;
}) {
  await requirePermission("orders", "view");
  const { buyerId } = await params;

  const [customer, cards] = await Promise.all([
    getCustomer(buyerId),
    getColorCardsForBuyer(buyerId),
  ]);

  if (!customer) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={customer.name}
        description={`${customer.code ?? "—"}${
          customer.country ? ` · ${customer.country}` : ""
        } · Colour cards`}
        actions={
          <Link href="/orders/color-cards">
            <Button variant="outline" size="sm">
              ← Customers
            </Button>
          </Link>
        }
      />

      <NewColorCardForm
        buyers={[]}
        fixedBuyer={{ id: customer.id, name: customer.name }}
      />

      <DataTable
        columns={columns}
        rows={cards}
        getKey={(row) => row.id}
        empty="No colour cards for this customer yet. Use 'New colour card' above to create the first."
      />
    </div>
  );
}
