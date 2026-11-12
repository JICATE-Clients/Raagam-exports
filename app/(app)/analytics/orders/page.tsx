import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { loadOrders } from "@/lib/analytics/sources";
import { monthKey, monthLabel, ordersBoard, type OrderIn } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { delta, fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard, nameColour } from "@/components/viz/kit";
import { ShipCalendar, type CalMonth } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/** ANALYTICS ▸ ORDERS & BUYERS — "How much business is booked, from whom, and when does it ship?" */
export default async function OrdersBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const res = await loadOrders();
  const t = today();

  const header = <BoardHeader title="Orders & Buyers" question="How much business is booked, from whom, and when does it ship?" period={period.key} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Order value" screen="Orders ▸ Order Entry" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const buyerId = sp.buyer || null;
  const buyerName = buyerId ? res.data.find((o) => o.buyerId === buyerId)?.buyer : null;
  const b = ordersBoard(res.data, period, t, buyerId);
  const rows = res.data.filter((o) => (!buyerId || o.buyerId === buyerId) && inRange(o.orderDate, period));
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (sp.p) q.set("p", sp.p);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `?${q.toString()}`;
  };
  const vs = (cur: number, prev: number | undefined) => {
    if (prev == null || !period.prev) return "";
    const d = delta(cur, prev);
    return d ? `${d.text} vs ${period.prev.label}` : `${period.prev.label}: none`;
  };
  const pcs = (q: number) => (q >= 1000 ? `${(q / 1000).toFixed(q >= 10000 ? 0 : 1)}k pcs` : `${q} pcs`);

  /* The calendar: every order in the period on its delivery month, in month order. */
  const months = new Map<string, CalMonth>();
  for (const o of rows) {
    if (!o.deliveryDate) continue;
    const k = monthKey(o.deliveryDate);
    const m = months.get(k) ?? { key: k, label: monthLabel(k), orders: [] };
    m.orders.push({ id: o.id, reNo: o.reNo, buyer: o.buyer, qty: o.qty, late: o.deliveryDate < t });
    months.set(k, m);
  }
  const calendar = [...months.values()].sort((a, z) => (a.key < z.key ? -1 : 1));

  const filterNote = buyerName ? (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      Showing <b>{buyerName}</b> only.
      <Link href={sp.p ? `?p=${sp.p}` : "?"} className="font-semibold text-primary hover:underline">
        Show every buyer
      </Link>
    </p>
  ) : null;

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        {filterNote}
        <DataTable
          rows={rows}
          getKey={(r) => r.id}
          empty={`No order was booked in ${period.label}.`}
          columns={withCreatedColumns<OrderIn>(
            [
              { header: "RE No", cell: (r) => <Link className="font-semibold text-primary hover:underline" href={`/orders/garment-orders?open=${r.id}`}>{r.reNo}</Link> },
              { header: "Buyer", cell: (r) => r.buyer },
              { header: "Merchandiser", cell: (r) => r.merchandiser },
              { header: "Season", cell: (r) => r.season },
              { header: "Order date", cell: (r) => fmtDate(r.orderDate) },
              { header: "Delivery", cell: (r) => fmtDate(r.deliveryDate) },
              { header: "Pieces", align: "right", cell: (r) => <span className="tabular-nums">{fmtCompactNumber(r.qty)}</span> },
              { header: "Value", align: "right", cell: (r) => <span className="tabular-nums">{r.valueInr == null ? "Not priced" : fmtCompactInr(r.valueInr)}</span> },
            ],
            rows,
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {header}
      {filterNote}
      <Strip
        cells={[
          { label: `Order value · ${period.label}`, value: fmtCompactInr(b.totals.value), hint: vs(b.totals.value, b.prev?.value) || "at each order's own rate" },
          {
            label: "Orders (RE)",
            value: fmtCompactNumber(b.totals.orders),
            hint: b.totals.unpriced ? `${n(b.totals.unpriced, "order")} not priced yet` : vs(b.totals.orders, b.prev?.orders) || "all priced",
            mood: b.totals.unpriced ? "look" : "normal",
          },
          { label: "Pieces booked", value: fmtCompactNumber(b.totals.pieces), hint: vs(b.totals.pieces, b.prev?.pieces) || "order quantity" },
          { label: "Average price", value: b.avgPerPiece == null ? "—" : `₹${Math.round(b.avgPerPiece).toLocaleString("en-IN")}/pc`, hint: "priced orders only" },
          {
            label: "Past delivery date",
            value: fmtCompactNumber(b.overdue),
            hint: b.overdue ? "still open" : "nothing overdue",
            mood: b.overdue ? "problem" : "good",
            href: "/orders/progress",
          },
        ]}
      />
      <VizCard title="When does it ship, and for whom?" question="Each chip is an order on its delivery month, coloured by buyer — click one to open it">
        <ShipCalendar months={calendar} qtyText={pcs} />
      </VizCard>
      <Row3>
        <VizCard title="Who are the big buyers?" question="Order value — click a buyer to see only theirs" padded>
          <GlowBars
            rows={b.byBuyer.map((r) => ({
              key: r.key,
              label: r.label,
              value: r.value,
              colour: r.key === "__others" ? "var(--border-strong)" : nameColour(r.label),
              href: r.href ? keep({ buyer: r.key }) : undefined,
            }))}
            format={fmtCompactInr}
            empty="No priced order in this period."
          />
        </VizCard>
        <VizCard title="Which season is it for?" question="Pieces by season" padded>
          <Tape parts={b.bySeason.map((r) => ({ label: r.label, value: r.value, colour: nameColour(r.label) }))} format={(v) => fmtCompactNumber(v)} />
        </VizCard>
        <VizCard title="Who handles the most?" question="Orders per merchandiser" padded>
          <GlowBars rows={b.byMerchandiser.map((r) => ({ key: r.key, label: r.label, value: r.value, colour: "var(--primary)" }))} format={(v) => n(v, "order")} />
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "Ships in 7 days",
            mood: b.shipsThisWeek.length ? "look" : "good",
            count: b.shipsThisWeek.length ? n(b.shipsThisWeek.length, "order") : "None",
            text: b.shipsThisWeek.length ? b.shipsThisWeek.map((o) => `${o.reNo} ${o.buyer}`).join(" · ") : "Nothing is due this week",
            href: b.shipsThisWeek.length ? "/orders/progress" : undefined,
            linkText: "Order Progress",
          },
          {
            title: "Not priced",
            mood: b.notPriced.length ? "look" : "good",
            count: b.notPriced.length ? n(b.notPriced.length, "order") : "None",
            text: b.notPriced.length ? b.notPriced.map((o) => o.reNo).join(" · ") : "Every order has a price",
            href: b.notPriced[0] ? `/orders/garment-orders?open=${b.notPriced[0].id}` : undefined,
            linkText: "Open Order Entry",
          },
          {
            title: "Past delivery date",
            mood: b.overdue ? "problem" : "good",
            count: b.overdue ? n(b.overdue, "order") : "None",
            text: b.overdue ? "Delivery date has passed and the order is still open" : "No open order is past its date",
            href: b.overdue ? "/orders/progress" : undefined,
            linkText: "Order Progress",
          },
        ]}
      />
    </div>
  );
}
