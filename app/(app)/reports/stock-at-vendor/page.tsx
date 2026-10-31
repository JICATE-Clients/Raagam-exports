import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { stockAtVendor, type AtVendorRow } from "@/lib/stores/job-work-reports";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * Reports ▸ Stock at Vendor (doc/stores/dc-plan.md Phase 4). Every Process DC line still out
 * at a dyer, knitter, printer or embroiderer: sent − returned, how long it has been out, and
 * how many days past its expected return. Read straight off the DCs (0786 · 0787).
 */
export default async function StockAtVendorPage() {
  await requirePermission("stores", "view");
  const rows = await stockAtVendor();
  const vendors = new Set(rows.map((r) => r.vendor)).size;
  const overdue = rows.filter((r) => r.overdue_days).length;
  const columns: Column<AtVendorRow>[] = [
    { header: "Vendor", cell: (r) => <span className="text-sm font-medium">{r.vendor}</span> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process}</span> },
    {
      header: "DC No",
      cell: (r) => (
        <Link href={`/stores/process-dc/${r.dc_id}/print`} className="font-mono text-xs text-primary hover:underline">
          {r.dc_code ?? "—"}
        </Link>
      ),
    },
    { header: "DC Date", cell: (r) => <span className="text-sm">{fmtDate(r.dc_date)}</span> },
    { header: "Process Order", cell: (r) => <span className="font-mono text-xs">{r.process_order ?? "—"}</span> },
    { header: "Item", cell: (r) => <span className="text-sm">{r.item}</span> },
    { header: "Sent", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sent)}</span> },
    { header: "Back", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.returned)}</span> },
    { header: "At Vendor", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.at_vendor)}</span> },
    { header: "Days Out", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.age_days ?? "—"}</span> },
    {
      header: "Expected Back",
      cell: (r) =>
        r.overdue_days ? (
          <StatusPill tone="danger">{`${r.overdue_days}d overdue`}</StatusPill>
        ) : (
          <span className="text-sm">{fmtDate(r.expected)}</span>
        ),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Stock at Vendor" description="Material out at processors and not yet back — by vendor, oldest first" />
      <p className="text-sm text-muted-foreground">
        {rows.length === 0
          ? "Nothing is out at a processor."
          : `${fmtNumber(rows.reduce((a, r) => a + r.at_vendor, 0))} qty on ${rows.length} line(s) at ${vendors} vendor(s) · ${overdue} overdue`}
      </p>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.key} empty="Nothing is out at a processor." />
    </div>
  );
}
