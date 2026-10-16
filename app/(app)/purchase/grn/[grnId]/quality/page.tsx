import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { GanForm } from "./gan-form";
import { listGanChecks } from "@/lib/purchase/gan-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import type { GanQualityCheck, GanStatus, GanResult } from "@/lib/purchase/gan-types";
import Link from "next/link";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { statusTone } from "@/lib/ui/status-tone";

const GAN_STATUS_TONE_OVERRIDES = {
  // Pending here is not waiting on an approver (was neutral before the shared table, kept).
  pending: "neutral",
  // In progress here is waiting on someone else (was warning before the shared table, kept).
  in_progress: "warning",
} as const;

function ganStatusTone(status: GanStatus): StatusTone {
  return statusTone(status, GAN_STATUS_TONE_OVERRIDES);
}

const GAN_RESULT_TONE_OVERRIDES = {
  conditional: "warning", // this module's own word — not in the shared table
} as const;

function ganResultTone(result: GanResult | null): StatusTone {
  return statusTone(result, GAN_RESULT_TONE_OVERRIDES);
}

export default async function GanQualityPage({
  params,
}: {
  params: Promise<{ grnId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { grnId } = await params;

  const [checks, canCreate] = await Promise.all([
    listGanChecks(grnId),
    can("materials_purchase", "create"),
  ]);

  const columns: Column<GanQualityCheck>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-medium">{r.code ?? "--"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={ganStatusTone(r.status)}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1).replace("_", " ")}
        </StatusPill>
      ),
    },
    {
      header: "Result",
      cell: (r) =>
        r.overall_result ? (
          <StatusPill tone={ganResultTone(r.overall_result)}>
            {r.overall_result.charAt(0).toUpperCase() + r.overall_result.slice(1)}
          </StatusPill>
        ) : (
          <span className="text-xs text-muted-foreground">--</span>
        ),
    },
    {
      header: "Checked",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.checked_at ? fmtDate(r.checked_at) : "--"}
        </span>
      ),
    },
    {
      header: "Created",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality Checks (GAN)"
        description="Detailed quality parameter inspections for this GRN"
        actions={
          <div className="flex items-center gap-3">
            {canCreate && <GanForm grnId={grnId} />}
            <Link
              href={`/purchase/grn/${grnId}`}
              className="text-sm text-primary hover:underline"
            >
              Back to GRN
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Quality Checks ({checks.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable paginate={false}
            columns={withCreatedColumns(columns, checks)}
            rows={checks}
            getKey={(r) => r.id}
            empty="No quality checks yet."
          />
        </CardBody>
      </Card>
    </div>
  );
}
