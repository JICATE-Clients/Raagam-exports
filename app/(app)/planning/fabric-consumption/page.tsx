import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listFabricConsumptions } from "@/lib/planning/material-planning-service";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { FabricConsumption } from "@/lib/planning/material-planning-types";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const MP_STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function mpStatusTone(status: MpStatus): StatusTone {
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

const columns: Column<FabricConsumption>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/fabric-consumption/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "\u2014"}
      </Link>
    ),
  },
  {
    header: "HSN Code",
    cell: (r) => <span className="text-sm">{r.hsn_code ?? "\u2014"}</span>,
  },
  {
    header: "Size Group",
    cell: (r) => (
      <span className="text-sm">{r.size_group_no ?? "\u2014"}</span>
    ),
  },
  {
    header: "Coordinates",
    cell: (r) => (
      <span className="tabular-nums text-sm">{r.no_of_coordinates}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={mpStatusTone(r.status)}>
        {MP_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function FabricConsumptionPage() {
  await requirePermission("planning", "view");

  const [consumptions, canCreate] = await Promise.all([
    listFabricConsumptions(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fabric Consumption"
        description="Fabric consumption setup per style."
        actions={
          canCreate ? (
            <Link
              href="/planning/fabric-consumption/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, consumptions)}
        rows={consumptions}
        getKey={(r) => r.id}
        empty="No fabric consumption records yet."
      />
    </div>
  );
}
