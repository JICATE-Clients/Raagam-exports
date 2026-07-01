import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { listGrns } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { GrnWithVendor } from "@/lib/purchase/grn-service";

const columns: Column<GrnWithVendor>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/purchase/grn/${r.id}`}
        className="font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  { header: "Vendor", cell: (r) => r.vendors?.name ?? "—" },
  { header: "Date", cell: (r) => fmtDate(r.grn_date) },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={r.status === "posted" ? "success" : "warning"}>
        {r.status === "posted" ? "Posted" : "Draft"}
      </StatusPill>
    ),
  },
  {
    header: "Lines",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{fmtNumber(r.line_count)}</span>
    ),
  },
];

export default async function GrnListPage() {
  await requirePermission("materials_purchase", "view");
  const grns = await listGrns();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Goods Receipt Notes"
        description="Receive goods against purchase orders — partial receipts, QC accept/reject."
        actions={
          <Link href="/purchase/grn/new">
            <Button size="sm">New GRN</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={grns}
        getKey={(r) => r.id}
        empty="No GRNs yet. Create a GRN to start receiving goods against purchase orders."
      />
    </div>
  );
}
