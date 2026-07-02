import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getProformaInvoices,
  getBuyerOptions,
  getCurrencyOptions,
  type ProformaWithBuyer,
} from "@/lib/logistics/proforma/service";
import {
  PROFORMA_STATUS_LABELS,
  proformaStatusTone,
} from "@/lib/logistics/proforma/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewProformaForm } from "./new-proforma-form";

const columns: Column<ProformaWithBuyer>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/logistics/proforma/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  { header: "Buyer", cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span> },
  {
    header: "Currency",
    cell: (row) => <span className="text-sm text-muted-foreground">{row.currency_code ?? "—"}</span>,
  },
  {
    header: "Incoterm",
    cell: (row) => <span className="text-sm text-muted-foreground">{row.incoterm ?? "—"}</span>,
  },
  {
    header: "Issue date",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(row.issue_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={proformaStatusTone(row.status)}>
        {PROFORMA_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
];

export default async function ProformaPage() {
  await requirePermission("logistics", "view");

  const [invoices, buyers, currencies] = await Promise.all([
    getProformaInvoices(),
    getBuyerOptions(),
    getCurrencyOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Proforma Invoices"
        description="Pre-shipment proforma invoices to buyers"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <NewProformaForm buyers={buyers} currencies={currencies} />

      <DataTable
        columns={columns}
        rows={invoices}
        getKey={(row) => row.id}
        empty="No proforma invoices yet. Use 'New proforma' above to create the first."
      />
    </div>
  );
}
