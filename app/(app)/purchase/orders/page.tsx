import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  listPurchaseOrders,
  getVendorsForPicker,
  getBudgetsForPicker,
  getCurrencies,
  getLocations,
} from "@/lib/purchase/po-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { NewPoForm } from "./new-po-form";
import type { PoWithVendor } from "@/lib/purchase/po-service";
import type { PoStatus } from "@/lib/purchase/types";
import { PO_STATUS_LABELS } from "@/lib/purchase/types";

// StatusPill tones by PO status
function poStatusTone(status: PoStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "pending_approval":
      return "warning";
    case "approved":
      return "info";
    case "partially_received":
      return "warning";
    case "received":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
  }
}

// We need PoWithVendor extended with lines for open balance, but listPurchaseOrders
// doesn't fetch lines. Show "open balance" as a simple count indicator from total
// vs received via the list query — we'll just link to detail instead.

const columns: Column<PoWithVendor>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/purchase/orders/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Vendor",
    cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={poStatusTone(r.status)}>
        {PO_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Order date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.order_date)}</span>
    ),
  },
  {
    header: "Total",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm font-semibold">
        {fmtMoney(r.total_amount, r.currency_code)}
      </span>
    ),
  },
];

export default async function PurchaseOrdersPage() {
  await requirePermission("materials_purchase", "view");

  const [orders, vendors, budgets, currencies, locations, canCreate] =
    await Promise.all([
      listPurchaseOrders(),
      getVendorsForPicker(),
      getBudgetsForPicker(),
      getCurrencies(),
      getLocations(),
      can("materials_purchase", "create"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description="PO tracker — create from budget, approve, track receipt balance."
      />

      {canCreate && (
        <NewPoForm
          vendors={vendors}
          budgets={budgets}
          currencies={currencies}
          locations={locations}
        />
      )}

      <DataTable
        columns={columns}
        rows={orders}
        getKey={(r) => r.id}
        empty="No purchase orders yet. Create one above."
      />
    </div>
  );
}
