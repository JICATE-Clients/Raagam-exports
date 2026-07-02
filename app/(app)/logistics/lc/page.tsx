import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getLcDetails,
  getBuyerOptions,
  getCurrencyOptions,
  type LcWithBuyer,
} from "@/lib/logistics/lc/service";
import { LC_STATUS_LABELS, lcStatusTone } from "@/lib/logistics/lc/types";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewLcForm } from "./new-lc-form";

const columns: Column<LcWithBuyer>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/logistics/lc/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "LC No.",
    cell: (row) => <span className="font-mono text-xs">{row.lc_number ?? "—"}</span>,
  },
  { header: "Buyer", cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span> },
  {
    header: "Amount",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtMoney(row.amount, row.currency_code)}</span>
    ),
  },
  {
    header: "Expiry",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(row.expiry_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={lcStatusTone(row.status)}>{LC_STATUS_LABELS[row.status]}</StatusPill>
    ),
  },
];

export default async function LcPage() {
  await requirePermission("logistics", "view");

  const [lcs, buyers, currencies] = await Promise.all([
    getLcDetails(),
    getBuyerOptions(),
    getCurrencyOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Letters of Credit"
        description="Pre-shipment LC records"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <NewLcForm buyers={buyers} currencies={currencies} />

      <DataTable
        columns={columns}
        rows={lcs}
        getKey={(row) => row.id}
        empty="No LCs yet. Use 'New LC' above to create the first."
      />
    </div>
  );
}
