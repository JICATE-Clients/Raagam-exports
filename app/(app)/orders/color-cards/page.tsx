import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getBuyers } from "@/lib/orders/service";
import { getColorCards, type ColorCardWithBuyer } from "@/lib/orders/color-cards/service";
import { colorCardStatusTone } from "@/lib/orders/color-cards/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewColorCardForm } from "./new-color-card-form";

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
  { header: "Buyer", cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span> },
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

export default async function ColorCardsPage() {
  await requirePermission("orders", "view");

  const [cards, buyers] = await Promise.all([getColorCards(), getBuyers()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Colour Cards"
        description="Buyer-approved colour palettes reused across orders"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewColorCardForm buyers={buyers} />

      <DataTable
        columns={columns}
        rows={cards}
        getKey={(row) => row.id}
        empty="No colour cards yet. Use 'New colour card' above to create the first."
      />
    </div>
  );
}
