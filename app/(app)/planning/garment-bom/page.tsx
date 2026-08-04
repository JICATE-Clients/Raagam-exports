import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listGarmentBoms } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { GarmentBomRow } from "@/lib/planning/bom-service";
import type { BomStatus } from "@/lib/planning/bom-types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

const columns: Column<GarmentBomRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/garment-bom/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "\u2014"}
      </Link>
    ),
  },
  {
    header: "Style",
    cell: (r) => <span className="text-sm">{r.style_code ?? "\u2014"}</span>,
  },
  {
    header: "Customer",
    cell: (r) => <span className="text-sm">{r.customer_name ?? "\u2014"}</span>,
  },
  {
    header: "Amendment",
    cell: (r) => <span className="tabular-nums text-sm">{r.amendment_no}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={bomStatusTone(r.status)}>
        {BOM_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span>
    ),
  },
];

export default async function GarmentBomPage() {
  await requirePermission("planning", "view");

  const [boms, canCreate] = await Promise.all([
    listGarmentBoms(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment BOM"
        description="Style garment processes, components, and placements."
        actions={
          canCreate ? (
            <Link
              href="/planning/garment-bom/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, boms)}
        rows={boms}
        getKey={(r) => r.id}
        empty="No garment BOMs yet."
      />
    </div>
  );
}
