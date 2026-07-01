import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getShipmentPnl } from "@/lib/finance/pnl-service";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PnlDetailClient } from "./pnl-detail-client";
import type { ShipmentCost, CostType } from "@/lib/finance/types";
import type { StatusTone } from "@/components/ui/status-pill";

const COST_TYPE_LABELS: Record<CostType, string> = {
  materials: "Materials",
  labour: "Labour",
  overhead: "Overhead",
  freight: "Freight",
  other: "Other",
};

function marginTone(pct: number): StatusTone {
  if (pct < 0) return "danger";
  if (pct < 10) return "warning";
  return "success";
}

const costColumns: Column<ShipmentCost>[] = [
  {
    header: "Type",
    cell: (c) => (
      <span className="text-sm">{COST_TYPE_LABELS[c.cost_type]}</span>
    ),
  },
  {
    header: "Description",
    cell: (c) => <span className="text-sm">{c.description ?? "—"}</span>,
  },
  {
    header: "Source",
    cell: (c) => (
      <StatusPill tone={c.source === "auto" ? "info" : "neutral"}>
        {c.source}
      </StatusPill>
    ),
  },
  {
    header: "Amount (INR)",
    align: "right",
    cell: (c) => (
      <span className="tabular-nums text-sm font-medium">{fmtMoney(c.amount)}</span>
    ),
  },
];

export default async function PnlDetailPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  await requirePermission("finance", "view");
  const { shipmentId } = await params;

  const [pnlRow, canEdit] = await Promise.all([
    getShipmentPnl(shipmentId),
    can("finance", "edit"),
  ]);

  if (!pnlRow) notFound();

  const { shipment, pnl, costs } = pnlRow;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`P&L — ${shipment.code ?? "Shipment"}`}
        description={shipment.buyers?.name ?? undefined}
        actions={
          <Link
            href={`/logistics/${shipment.id}`}
            className="text-sm text-primary hover:underline"
          >
            View shipment
          </Link>
        }
      />

      {/* P&L summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={fmtMoney(pnl.revenue)} tone="neutral" />
        <Stat label="Total cost" value={fmtMoney(pnl.totalCost)} tone="neutral" />
        <Stat
          label="Profit"
          value={fmtMoney(pnl.profit)}
          tone={pnl.profit < 0 ? "danger" : "success"}
        />
        <Stat
          label="Margin"
          value={`${pnl.marginPct.toFixed(1)}%`}
          tone={marginTone(pnl.marginPct)}
        />
      </div>

      {/* Cost breakdown (all lines, including auto) */}
      <Card>
        <CardHeader>
          <CardTitle>Cost breakdown ({costs.length} line{costs.length !== 1 ? "s" : ""})</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={costColumns}
            rows={costs}
            getKey={(c) => c.id}
            empty="No costs recorded. Use 'Pull materials cost' or add a manual line below."
          />
        </CardBody>
      </Card>

      {/* Interactive actions: pull materials + add/delete manual lines */}
      {canEdit && <PnlDetailClient shipmentId={shipmentId} costs={costs} />}
    </div>
  );
}
