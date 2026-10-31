import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { processLossByVendor, type LossRow } from "@/lib/stores/job-work-reports";
import { fmtNumber } from "@/lib/format";

/**
 * Reports ▸ Process Loss by Vendor (doc/stores/dc-plan.md Phase 4). Every Process Receipt
 * (0787) summed per processor × process: what was used, what came back, the loss % against
 * the orders' Allowed Loss %, and the excess qty the draft bills were flagged for. Worst
 * loss % first — the processors to talk to.
 */
export default async function ProcessLossPage() {
  await requirePermission("stores", "view");
  const rows = await processLossByVendor();
  const columns: Column<LossRow>[] = [
    { header: "Vendor", cell: (r) => <span className="text-sm font-medium">{r.vendor}</span> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process}</span> },
    { header: "Receipts", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.receipts}</span> },
    { header: "Used", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.used)}</span> },
    { header: "Received", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received)}</span> },
    { header: "Loss", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.loss)}</span> },
    {
      header: "Loss %",
      align: "right",
      cell: (r) => {
        const over = r.loss_pct != null && r.allowed_pct != null && r.loss_pct > r.allowed_pct;
        return (
          <span className={"tabular-nums text-sm " + (over ? "font-semibold text-danger" : "")}>
            {r.loss_pct == null ? "—" : `${r.loss_pct}%`}
          </span>
        );
      },
    },
    { header: "Allowed %", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.allowed_pct == null ? "—" : `${r.allowed_pct}%`}</span> },
    {
      header: "Excess Loss",
      align: "right",
      cell: (r) => (
        <span className={"tabular-nums text-sm " + (r.excess > 0 ? "font-semibold text-danger" : "")}>
          {r.excess > 0 ? fmtNumber(r.excess) : "—"}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Process Loss by Vendor" description="Actual against allowed loss, per processor and process — worst first" />
      <DataTable columns={columns} rows={rows} getKey={(r) => r.key} empty="No job work has been received back yet." />
    </div>
  );
}
