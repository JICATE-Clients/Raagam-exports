import Link from "next/link";
import { FileText } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import {
  listPurchaseOrders,
  getVendorsForPicker,
  getBudgetsForPicker,
  getCurrencies,
  getLocations,
  getItems,
  getOrdersForPicker,
  getIwosForPicker,
} from "@/lib/purchase/po-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { StatusTone } from "@/components/ui/status-pill";
import { NewPoForm } from "./new-po-form";
import type { PoWithVendor } from "@/lib/purchase/po-service";
import type { PoStatus } from "@/lib/purchase/types";
import { PO_STATUS_LABELS } from "@/lib/purchase/types";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { statusTone } from "@/lib/ui/status-tone";

// StatusPill tones by PO status
const PO_STATUS_TONE_OVERRIDES = {
  // Approved is a step in this document's life, not its end — work still follows it (was info before the shared table, kept).
  approved: "info",
} as const;

function poStatusTone(status: PoStatus): StatusTone {
  return statusTone(status, PO_STATUS_TONE_OVERRIDES);
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
  {
    /* THE ROW'S REPORT ICON OPENS THE PO'S REPORT — the print (client 2026-10-30:
       "that report icon needs to open the report of the entry"). A plain Link, as
       this is a server page and cannot hand a handler or an icon component to a
       client one. Greyed until approved, saying why (Row actions: a locked action
       stays visible) — the same rule PO Approval's print icon uses. */
    header: "",
    align: "right",
    cell: (r) =>
      ["draft", "pending_approval", "cancelled"].includes(r.status) ? (
        <Tooltip label="Print opens once the PO is approved" touch>
          <span
            aria-disabled
            aria-label={`PO print ${r.code ?? ""} — print opens once the PO is approved`}
            className={`${buttonClasses({ variant: "ghost", size: "icon" })} cursor-not-allowed text-muted-foreground opacity-50`}
          >
            <FileText aria-hidden />
          </span>
        </Tooltip>
      ) : (
        <Tooltip label="PO print">
          <Link
            href={`/purchase/orders/${r.id}/print`}
            aria-label={`PO print ${r.code ?? ""}`}
            className={`${buttonClasses({ variant: "ghost", size: "icon" })} text-primary`}
          >
            <FileText aria-hidden />
          </Link>
        </Tooltip>
      ),
  },
];

export default async function PurchaseOrdersPage() {
  await requirePermission("materials_purchase", "view");

  const [orders, vendors, budgets, currencies, locations, items, salesOrders, iwos, canCreate] =
    await Promise.all([
      listPurchaseOrders(),
      getVendorsForPicker(),
      getBudgetsForPicker(),
      getCurrencies(),
      getLocations(),
      // The material a line buys, and the garment order it buys for (0424) —
      // the two the Material BOM ceiling keys on.
      getItems(),
      getOrdersForPicker(),
      // ...or the Internal Work Order it buys for (0586) — never both.
      getIwosForPicker(),
      can("materials_purchase", "create"),
    ]);

  const table = (
    <DataTable
      columns={withCreatedColumns(columns, orders)}
      rows={orders}
      getKey={(r) => r.id}
      empty="No purchase orders yet."
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description="PO tracker — create from budget, approve, track receipt balance."
      />

      {canCreate ? (
        <NewPoForm
          vendors={vendors}
          budgets={budgets}
          currencies={currencies}
          locations={locations}
          items={items}
          orders={salesOrders}
          iwos={iwos}
          list={table}
        />
      ) : (
        table
      )}
    </div>
  );
}
