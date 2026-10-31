import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { materialInTransit, type InTransitRow } from "@/lib/stores/job-work-reports";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * Reports ▸ Material In Transit (doc/stores/dc-plan.md Phase 4). Every Production DC
 * dispatched between Raagam HO, Unit 2 and Unit 3 and not yet received — what is on the
 * road, between which units, and for how many days (0784).
 */
export default async function InTransitPage() {
  await requirePermission("stores", "view");
  const rows = await materialInTransit();
  const columns: Column<InTransitRow>[] = [
    {
      header: "DC No",
      cell: (r) => (
        <Link href={`/stores/production-dc/${r.dc_id}/print`} className="font-mono text-xs text-primary hover:underline">
          {r.dc_code ?? "—"}
        </Link>
      ),
    },
    { header: "DC Date", cell: (r) => <span className="text-sm">{fmtDate(r.dc_date)}</span> },
    { header: "From → To", cell: (r) => <span className="text-sm">{`${r.from_unit} → ${r.to_unit}`}</span> },
    { header: "Item", cell: (r) => <span className="text-sm">{r.item}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.qty)}</span> },
    { header: "Vehicle", cell: (r) => <span className="text-sm">{r.vehicle ?? "—"}</span> },
    { header: "E-way Bill", cell: (r) => <span className="text-sm">{r.eway ?? "—"}</span> },
    { header: "Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.days ?? "—"}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Material In Transit" description="Sent between units and not yet received at the other end" />
      <DataTable columns={columns} rows={rows} getKey={(r) => r.key} empty="Nothing is in transit between units." />
    </div>
  );
}
