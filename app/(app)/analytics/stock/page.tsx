import { requirePermission } from "@/lib/auth/server";
import { loadStock } from "@/lib/analytics/sources";
import { stockBoard, type LotIn } from "@/lib/analytics/compute";
import { fmtCompactInr, fmtCompactNumber, fmtPct } from "@/lib/dashboard/format";
import { fmtNumber } from "@/lib/format";
import { GROUP_LABEL, GROUP_ORDER, STATUS_LABEL } from "@/lib/reports/stock-statement-types";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { NeedsDoing, Strip, Tape, VizCard, classColour } from "@/components/viz/kit";
import { AgeTape, ValueByClass, YarnCones } from "@/components/purchase/inventory/inventory-visuals";
import { isAsset, type Row } from "@/components/purchase/inventory/inventory-table";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ STOCK — "Where is cash stuck in stock?"
 *
 * The SAME pictures as Purchase ▸ Purchase Store ▸ Overview's Stock tab — the yarn cones, value by
 * class and the age tape are that screen's own components, fed the same FIFO lots through the same
 * RPC — so the two can never disagree. With the Stock Statement with Value screen it is money; with
 * the quantity report only it counts lots. Stock is a position, so there is no period.
 */
export default async function StockBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const view = viewOf((await searchParams).view);
  const res = await loadStock();

  const header = <BoardHeader title="Stock" question="Where is cash stuck in stock?" period={null} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Stock" screen="Reports ▸ Stock Statement" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const { read, pendingQc } = res.data;
  const withValue = read.access === "value";
  const rows: Row[] = read.rows;
  const lots: LotIn[] = read.rows.map((r) => ({ ...r, value: "value" in r ? r.value : undefined }));
  const b = stockBoard(lots, withValue);
  const fmt = withValue ? fmtCompactInr : (v: number) => n(v, "lot");
  const report = withValue ? "/reports/stock-statement-value" : "/reports/stock-statement";
  const yarn = rows.filter((r) => isAsset(r) && r.item_class.toUpperCase().startsWith("YARN"));
  const yarnKg = yarn.reduce((a, r) => a + r.qty, 0);
  const floor = rows.filter((r) => isAsset(r) && r.bin === "—");
  const owed = rows.filter((r) => !isAsset(r));
  const ownerColour: Record<string, string> = { re: "var(--primary)", swo: "var(--viz-5)", iwo: "var(--viz-3)", general: "var(--warning)" };

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        <DataTable
          rows={lots}
          getKey={(r) => r.key}
          empty="No stock."
          columns={withCreatedColumns<LotIn>(
            [
              { header: "Item", cell: (r) => r.item },
              { header: "Class", cell: (r) => r.item_class },
              { header: "Lot", cell: (r) => r.lot },
              { header: "Store / bin", cell: (r) => `${r.store} · ${r.bin}` },
              { header: "Age", align: "right", cell: (r) => <span className={r.band === "90+" ? "font-semibold tabular-nums text-danger" : "tabular-nums"}>{r.age_days} d</span> },
              { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{fmtNumber(r.qty)} {r.uom}</span> },
              ...(withValue ? [{ header: "Value", align: "right" as const, cell: (r: LotIn) => <span className="tabular-nums">{fmtCompactInr(r.value ?? 0)}</span> }] : []),
              { header: "For", cell: (r) => (r.group_kind === "general" ? "General" : r.order_no) },
            ],
            lots,
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {header}
      {!withValue ? <NoAccess what="Money values" screen="Reports ▸ Stock Statement with Value" /> : null}
      <Strip
        cells={[
          { label: withValue ? "Stock value" : "Lots in stock", value: fmt(b.total), hint: withValue ? `at the approved PO rate · ${n(lots.length, "lot")}` : "today, this unit", href: report },
          {
            label: "Yarn on hand",
            value: yarnKg ? `${fmtNumber(yarnKg)} kg` : "No yarn",
            hint: yarnKg ? n(new Set(yarn.map((r) => r.item)).size, "count") : "nothing in stock",
            accent: classColour("YARN"),
          },
          { label: "General stock", value: fmt(b.general), hint: "no order behind it", mood: b.general > 0 ? "look" : "good" },
          {
            label: "Pending QC",
            value: pendingQc == null ? "—" : n(pendingQc, "line"),
            hint: pendingQc ? "delivered, not yet stock" : "nothing waiting",
            mood: pendingQc ? "look" : "good",
            href: "/stores/qc-pending",
          },
          {
            label: "Idle 90+ days",
            value: fmt(b.old),
            hint: b.old ? `${fmtPct(b.oldPct, 0)} of stock — use before buying more` : "nothing idle",
            mood: b.old ? "problem" : "good",
          },
        ]}
      />
      <YarnCones rows={rows} withValue={withValue} />
      <Row3>
        <ValueByClass rows={rows} withValue={withValue} />
        <AgeTape rows={rows} withValue={withValue} />
        <VizCard title="Who is the stock for?" question={withValue ? "Value by owner" : "Lots by owner"} padded>
          <Tape parts={GROUP_ORDER.map((g) => ({ label: GROUP_LABEL[g], value: b.owners.get(g) ?? 0, colour: ownerColour[g] }))} format={fmt} />
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "Put away",
            mood: floor.length ? "look" : "good",
            count: floor.length ? n(floor.length, "lot") : "None",
            text: floor.length ? floor.map((r) => `${r.item} (${r.reference})`).join(" · ") : "Every lot is in a bin",
            href: floor.length ? "/purchase/inventory" : undefined,
            linkText: "Store Overview",
          },
          {
            title: "Owed by vendor",
            mood: owed.length ? "problem" : "good",
            count: owed.length ? n(owed.length, "lot") : "None",
            text: owed.length ? owed.map((r) => `${r.item} · ${STATUS_LABEL[r.status]} · ${r.reference}`).join(" · ") : "Nothing waiting on a vendor",
            href: owed.length ? "/purchase/dc?type=replacement" : undefined,
            linkText: "Delivery Challans",
          },
          {
            title: "Idle stock",
            mood: b.oldLots.length ? "problem" : "good",
            count: b.oldLots.length ? n(b.oldLots.length, "lot") : "None",
            text: b.oldLots.length ? b.oldLots.map((r) => `${r.item} (${r.age_days} days)`).join(" · ") : "Nothing older than 90 days",
            href: b.oldLots.length ? report : undefined,
            linkText: "Stock Statement",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">{fmtCompactNumber(lots.length)} lots, today, in the unit you are working in.</p>
    </div>
  );
}
