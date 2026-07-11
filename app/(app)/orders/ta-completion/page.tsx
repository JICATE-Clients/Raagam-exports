import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getTaCompletions,
  getTaCompletableOrders,
  getBuyerOptions,
  type TaCompletionRow,
} from "@/lib/orders/ta-completion/service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { NewTaCompletionForm } from "./new-ta-completion-form";

const columns: Column<TaCompletionRow>[] = [
  {
    header: "Completion No",
    cell: (row) => (
      <span className="font-mono text-xs font-medium text-primary">
        {row.code ?? "—"}
      </span>
    ),
  },
  {
    header: "SC No",
    cell: (row) => (
      <span className="font-mono text-xs">
        {row.sales_orders?.order_number ?? "—"}
      </span>
    ),
  },
  {
    header: "Customer",
    cell: (row) => (
      <span className="text-sm">{row.sales_orders?.buyers?.name ?? "—"}</span>
    ),
  },
  {
    header: "Order No",
    cell: (row) => <span className="text-sm">{row.order_no ?? "—"}</span>,
  },
  {
    header: "Date",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.completion_date)}
      </span>
    ),
  },
  {
    header: "Remarks",
    cell: (row) => (
      <span className="block max-w-[16rem] truncate text-sm text-muted-foreground" title={row.remarks ?? undefined}>
        {row.remarks ?? "—"}
      </span>
    ),
  },
];

export default async function TaCompletionPage() {
  await requirePermission("orders", "view");

  const [completions, orders, buyers] = await Promise.all([
    getTaCompletions(),
    getTaCompletableOrders(),
    getBuyerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Completion"
        description="Record the completion of an order's Time & Action schedule."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewTaCompletionForm orders={orders} buyers={buyers} />

      <DataTable
        columns={columns}
        rows={completions}
        getKey={(row) => row.id}
        empty="No TA completions yet."
      />
    </div>
  );
}
