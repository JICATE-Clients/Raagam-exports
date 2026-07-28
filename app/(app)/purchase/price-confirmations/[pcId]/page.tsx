import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getPriceConfirmation } from "@/lib/purchase/price-confirmation-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  PC_STATUS_LABELS,
  APPLICABILITY_LABELS,
} from "@/lib/purchase/price-confirmation-types";
import type {
  PcStatus,
  ApplicabilityType,
  PriceConfirmationItem,
} from "@/lib/purchase/price-confirmation-types";

function pcStatusTone(status: PcStatus): StatusTone {
  switch (status) {
    case "draft": return "neutral";
    case "submitted": return "warning";
    case "approved": return "success";
    case "rejected": return "danger";
  }
}

export default async function PriceConfirmationDetailPage({
  params,
}: {
  params: Promise<{ pcId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { pcId } = await params;

  const pc = await getPriceConfirmation(pcId);
  if (!pc) notFound();

  const itemColumns: Column<PriceConfirmationItem>[] = [
    {
      header: "Item / Description",
      cell: (r) => (
        <span className="text-sm">{r.description ?? r.item_class ?? "--"}</span>
      ),
    },
    {
      header: "Category",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.category ?? "--"}</span>
      ),
    },
    {
      header: "Budget Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtMoney(r.budget_rate)}</span>
      ),
    },
    {
      header: "Quoted Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtMoney(r.quoted_rate)}</span>
      ),
    },
    {
      header: "Confirmed Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtMoney(r.confirmed_rate)}
        </span>
      ),
    },
    {
      header: "Prev. Rate",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.previous_confirmed_rate ? fmtMoney(r.previous_confirmed_rate) : "--"}
        </span>
      ),
    },
    {
      header: "Dev. Charges",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.development_charges > 0 ? fmtMoney(r.development_charges) : "--"}
        </span>
      ),
    },
    {
      header: "Approved",
      cell: (r) => (
        <StatusPill tone={r.is_approved ? "success" : "neutral"}>
          {r.is_approved ? "Yes" : "No"}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={pc.code ?? "Price Confirmation"}
        description={`Vendor: ${pc.vendor_name ?? "--"}`}
        actions={
          <StatusPill tone={pcStatusTone(pc.status)}>
            {PC_STATUS_LABELS[pc.status]}
          </StatusPill>
        }
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd className="font-medium">{pc.vendor_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PO Type</dt>
              <dd className="capitalize">{pc.po_type ?? "All"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Applicability</dt>
              <dd>
                {pc.applicability
                  ? APPLICABILITY_LABELS[pc.applicability as ApplicabilityType]
                  : "--"}
              </dd>
            </div>
            {pc.effective_until && (
              <div>
                <dt className="text-xs text-muted-foreground">Effective Until</dt>
                <dd>{fmtDate(pc.effective_until)}</dd>
              </div>
            )}
            {pc.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved</dt>
                <dd>{fmtDate(pc.approved_at)}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items ({pc.items.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={itemColumns}
            rows={pc.items}
            getKey={(r) => r.id}
            empty="No items added yet."
          />
        </CardBody>
      </Card>

      {pc.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardBody>
            <p className="whitespace-pre-wrap text-sm">{pc.notes}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
