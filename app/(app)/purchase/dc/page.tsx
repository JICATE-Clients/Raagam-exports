import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { listDcs } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { DcWithVendor } from "@/lib/purchase/grn-service";
import type { DcStatus } from "@/lib/purchase/types";

const statusTone: Record<
  DcStatus,
  "info" | "warning" | "success"
> = {
  issued: "info",
  partially_returned: "warning",
  closed: "success",
};

const statusLabel: Record<DcStatus, string> = {
  issued: "Issued",
  partially_returned: "Partially Returned",
  closed: "Closed",
};

const columns: Column<DcWithVendor>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/purchase/dc/${r.id}`}
        className="font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  { header: "Vendor / Processor", cell: (r) => r.vendors?.name ?? "—" },
  { header: "Purpose", cell: (r) => r.purpose ?? "—" },
  { header: "Date", cell: (r) => fmtDate(r.dc_date) },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={statusTone[r.status]}>{statusLabel[r.status]}</StatusPill>
    ),
  },
  {
    header: "Outstanding Qty",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">{fmtNumber(r.outstanding_qty)}</span>
    ),
  },
];

export default async function DcListPage() {
  await requirePermission("materials_purchase", "view");
  const dcs = await listDcs();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery Challans"
        description="Track materials sent to processors and record returns."
        actions={
          <Link href="/purchase/dc/new">
            <Button size="sm">New DC</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={dcs}
        getKey={(r) => r.id}
        empty="No delivery challans yet. Create a DC to track material sent to a processor."
      />
    </div>
  );
}
