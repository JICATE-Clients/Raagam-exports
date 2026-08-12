import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCompletions,
  getCompletableOrders,
  getBuyerOptions,
  type CompletionRow,
} from "@/lib/orders/completions/service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Truncated } from "@/components/ui/truncated";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { NewCompletionForm } from "./new-completion-form";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
const columns: Column<CompletionRow>[] = [
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
      // `truncate` + a `title` is an ellipsis with a tooltip the keyboard and
      // touch can never reach. <Truncated> writes the clamp itself, measures the
      // box, and reveals on hover OR press-and-hold — and only when something is
      // actually hidden (AGENTS.md, "Truncated values").
      <Truncated
        text={row.remarks ?? "—"}
        className="block max-w-[16rem] text-sm text-muted-foreground"
      />
    ),
  },
  /* View only. This list has no detail route to edit into, and no delete action
     exists for the record — the eye still earns its place: it answers "what is in
     this row?" without opening anything. */
  rowActionsColumn((row) => <RowActions label={row.code} />),
];

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
        description="Mark a garment order complete and closed."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="md">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <NewCompletionForm orders={orders} buyers={buyers} />

      <DataTable
        columns={withCreatedColumns(columns, completions)}
        rows={completions}
        getKey={(row) => row.id}
        empty="No completions yet."
      />
    </div>
  );
}
