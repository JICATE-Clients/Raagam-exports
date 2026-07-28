import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
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

function ganStatusTone(status: GanStatus): StatusTone {
  switch (status) {
    case "pending": return "neutral";
    case "in_progress": return "warning";
    case "completed": return "success";
  }
}

function ganResultTone(result: GanResult | null): StatusTone {
  switch (result) {
    case "pass": return "success";
    case "fail": return "danger";
    case "conditional": return "warning";
    default: return "neutral";
  }
}

export default async function GanQualityPage({
  params,
}: {
  params: Promise<{ grnId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { grnId } = await params;

  const checks = await listGanChecks(grnId);

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
          <Link
            href={`/purchase/grn/${grnId}`}
            className="text-sm text-primary hover:underline"
          >
            Back to GRN
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Quality Checks ({checks.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={columns}
            rows={checks}
            getKey={(r) => r.id}
            empty="No quality checks yet."
          />
        </CardBody>
      </Card>
    </div>
  );
}
