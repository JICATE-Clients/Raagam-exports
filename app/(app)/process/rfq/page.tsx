import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getProcessRfqs, getOrderOptions, type ProcessRfqRow } from "@/lib/process/rfq/service";
import { PRFQ_STATUS_LABELS, prfqStatusTone } from "@/lib/process/rfq/types";
import { fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewProcessRfqForm } from "./new-process-rfq-form";

const columns: Column<ProcessRfqRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link href={`/process/rfq/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
        {r.code ?? "—"}
      </Link>
    ),
  },
  { header: "Order", cell: (r) => <span className="font-mono text-xs">{r.sales_orders?.order_number ?? "—"}</span> },
  { header: "Process", cell: (r) => <span className="text-sm capitalize">{r.process_type}</span> },
  { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quantity)} {r.uom ?? ""}</span> },
  { header: "Budget rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.budget_rate)}</span> },
  {
    header: "Confirmed",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">
        {r.confirmed_rate != null ? fmtNumber(r.confirmed_rate) : "—"}
      </span>
    ),
  },
  { header: "Status", cell: (r) => <StatusPill tone={prfqStatusTone(r.status)}>{PRFQ_STATUS_LABELS[r.status]}</StatusPill> },
];

export default async function ProcessRfqPage() {
  await requirePermission("process_planning", "view");

  const [rfqs, orders] = await Promise.all([getProcessRfqs(), getOrderOptions()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process RFQ"
        description="Request & confirm processing rates from vendors (with budget control)"
        actions={
          <Link href="/process">
            <Button variant="outline" size="sm">
              ← Process Planning
            </Button>
          </Link>
        }
      />

      <NewProcessRfqForm orders={orders} />

      <DataTable
        columns={columns}
        rows={rfqs}
        getKey={(r) => r.id}
        empty="No process RFQs yet. Use 'New RFQ' above to create the first."
      />
    </div>
  );
}
