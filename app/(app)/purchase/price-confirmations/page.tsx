import { requirePermission, can } from "@/lib/auth/server";
import { listPriceConfirmations } from "@/lib/purchase/price-confirmation-service";
import { getVendorsForPicker } from "@/lib/purchase/po-service";
import { PriceConfirmationForm } from "./price-confirmation-form";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  PC_STATUS_LABELS,
  APPLICABILITY_LABELS,
} from "@/lib/purchase/price-confirmation-types";
import type { PcStatus, ApplicabilityType } from "@/lib/purchase/price-confirmation-types";
import type { PcWithVendor } from "@/lib/purchase/price-confirmation-service";
import Link from "next/link";

function pcStatusTone(status: PcStatus): StatusTone {
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

export default async function PriceConfirmationsPage() {
  await requirePermission("materials_purchase", "view");
  const [pcs, vendors, canCreate] = await Promise.all([
    listPriceConfirmations(),
    getVendorsForPicker(),
    can("materials_purchase", "create"),
  ]);

  const columns: Column<PcWithVendor>[] = [
    {
      header: "Code",
      cell: (r) => (
        <Link
          href={`/purchase/price-confirmations/${r.id}`}
          className="font-medium text-primary hover:underline"
        >
          {r.code ?? "--"}
        </Link>
      ),
    },
    {
      header: "Vendor",
      cell: (r) => <span className="text-sm">{r.vendor_name ?? "--"}</span>,
    },
    {
      header: "PO Type",
      cell: (r) => (
        <span className="text-sm capitalize">{r.po_type ?? "all"}</span>
      ),
    },
    {
      header: "Applicability",
      cell: (r) =>
        r.applicability ? (
          <span className="text-xs">
            {APPLICABILITY_LABELS[r.applicability as ApplicabilityType]}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">--</span>
        ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={pcStatusTone(r.status)}>
          {PC_STATUS_LABELS[r.status]}
        </StatusPill>
      ),
    },
    {
      header: "Created",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {fmtDate(r.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price Confirmations"
        description="Confirm vendor rates before creating purchase orders"
        actions={canCreate ? <PriceConfirmationForm vendors={vendors} /> : undefined}
      />

      <DataTable
        columns={columns}
        rows={pcs}
        getKey={(r) => r.id}
        empty="No price confirmations yet."
      />
    </div>
  );
}
