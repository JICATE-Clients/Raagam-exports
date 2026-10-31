import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { binStock, type AgeBand, type BinStockRow } from "@/lib/stores/bin-stock-report";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";

/**
 * Reports ▸ Bin Stock & Aging (user 2026-10-31, multi-bin rule §4). Stock per Store ▸ Bin ▸
 * Item ▸ Lot with the day it first came in and its age, oldest first, with the totals per
 * age band on top. Read off `stock_lot_balances` (0790).
 */
const BAND_TONE: Record<AgeBand, StatusTone> = { "0-30": "success", "31-60": "info", "61-90": "warning", "90+": "danger" };
const BANDS: AgeBand[] = ["0-30", "31-60", "61-90", "90+"];

export default async function BinStockPage() {
  await requirePermission("stores", "view");
  const rows = await binStock();
  const byBand = BANDS.map((b) => {
    const rs = rows.filter((r) => r.band === b);
    return { band: b, lots: rs.length, value: rs.reduce((a, r) => a + r.value, 0) };
  });
  const columns: Column<BinStockRow>[] = [
    { header: "Store", cell: (r) => <span className="text-sm">{r.store}</span> },
    { header: "Bin", cell: (r) => <span className="font-mono text-xs">{r.bin ?? "no bin"}</span> },
    { header: "Item", cell: (r) => <span className="text-sm font-medium">{r.item}</span> },
    { header: "Lot No", cell: (r) => <span className="text-sm">{r.lot ?? "—"}</span> },
    {
      header: "Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtNumber(r.qty)} <span className="text-xs font-normal text-muted-foreground">{r.uom ?? ""}</span>
        </span>
      ),
    },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.value ? fmtMoney(r.value) : "—"}</span> },
    { header: "In Since", cell: (r) => <span className="text-sm">{fmtDate(r.first_in)}</span> },
    {
      header: "Age",
      cell: (r) => (r.band ? <StatusPill tone={BAND_TONE[r.band]}>{`${r.age_days} days`}</StatusPill> : <span className="text-muted-foreground">—</span>),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Bin Stock & Aging" description="Stock per store, bin, item and lot — oldest first" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {byBand.map((b) => (
          <div key={b.band} className="rounded-lg border border-border bg-surface px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{b.band} days</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{fmtNumber(b.lots)} lots</div>
            <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(b.value)}</div>
          </div>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.key} empty="No stock is held yet — it appears here once goods are received." />
    </div>
  );
}
