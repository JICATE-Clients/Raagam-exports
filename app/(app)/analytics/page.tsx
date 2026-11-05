import { requirePermission } from "@/lib/auth/server";
import { loadBudgets, loadEnquiries, loadMyApprovals, loadOrders, loadPurchase, loadSteps, loadStock } from "@/lib/analytics/sources";
import { LOW_MARGIN_PCT, deliveryBoard, ordersBoard, profitBoard, purchaseBoard, samplesBoard, stockBoard, type LotIn } from "@/lib/analytics/compute";
import { parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { fmtCompactInr, fmtCompactNumber, fmtPct } from "@/lib/dashboard/format";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard, nameColour, type NeedCell, type StripCell } from "@/components/viz/kit";
import { StagePipe, type Stage } from "@/components/analytics/pictures";
import { BoardHeader, Row3, n } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ OVERVIEW — "How is the business doing?" (user 2026-11-05).
 *
 * The boards' headline numbers on one page, in the Store Overview look: the strip, the journey from
 * enquiry to shipment, three cards and what needs doing. Every figure is the board's own function
 * over the board's own source, so the Overview and the board it opens cannot disagree; each source
 * is gated on its own screen, and a cell the person may not see says which screen it needs.
 */
export default async function AnalyticsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const period = parsePeriod((await searchParams).p);
  const t = today();
  const q = period.key === "fy" ? "" : `?p=${period.key}`;

  const [orders, budgets, purchase, stock, approvals, steps, enquiries] = await Promise.all([
    loadOrders(),
    loadBudgets(),
    loadPurchase(),
    loadStock(),
    loadMyApprovals(),
    loadSteps(),
    loadEnquiries(),
  ]);

  const ob = orders.ok ? ordersBoard(orders.data, period, t) : null;
  const pb = budgets.ok ? profitBoard(budgets.data, period) : null;
  const ub = purchase.ok ? purchaseBoard(purchase.data, period, t) : null;
  const db = steps.ok ? deliveryBoard(steps.data, period, t) : null;
  const sb = enquiries.ok ? samplesBoard(enquiries.data.rows, period, t) : null;
  const withValue = stock.ok && stock.data.read.access === "value";
  const kb = stock.ok ? stockBoard(stock.data.read.rows.map((r): LotIn => ({ ...r, value: "value" in r ? r.value : undefined })), withValue) : null;
  const stockFmt = withValue ? fmtCompactInr : (v: number) => n(v, "lot");

  const locked = (label: string, screen: string): StripCell => ({ label, value: "—", hint: `Needs ${screen}`, mood: "quiet" });
  const strip: StripCell[] = [
    ob
      ? { label: `Order book · ${period.label}`, value: fmtCompactInr(ob.totals.value), hint: `${n(ob.totals.orders, "order")} · ${fmtCompactNumber(ob.totals.pieces)} pcs`, href: `/analytics/orders${q}` }
      : locked("Order book", "Order Entry"),
    pb
      ? {
          label: "Margin",
          value: fmtPct(pb.margin),
          hint: pb.low.length ? `${n(pb.low.length, "order")} under ${LOW_MARGIN_PCT}%` : `none under ${LOW_MARGIN_PCT}%`,
          mood: pb.low.length ? "problem" : "good",
          href: `/analytics/profitability${q}`,
        }
      : locked("Margin", "Budgeting"),
    ub
      ? { label: "Purchase still to come", value: fmtCompactInr(ub.openValue), hint: `of ${fmtCompactInr(ub.value)} ordered`, mood: ub.openValue > 0 ? "look" : "good", href: `/analytics/purchase${q}` }
      : locked("Purchase still to come", "Purchase Orders"),
    kb
      ? { label: "Stock idle 90+ days", value: stockFmt(kb.old), hint: kb.old ? "use before buying more" : "nothing idle", mood: kb.old ? "problem" : "good", href: "/analytics/stock" }
      : locked("Stock idle 90+ days", "Stock Statement"),
    approvals
      ? {
          label: "Waiting on you",
          value: fmtCompactNumber(approvals.waiting),
          hint: approvals.overdue ? `${approvals.overdue} past the deadline` : approvals.waiting ? "approvals to decide" : "nothing waiting",
          mood: approvals.overdue ? "problem" : approvals.waiting ? "look" : "good",
          href: "/approvals",
        }
      : locked("Waiting on you", "My Approvals"),
  ];

  /* THE JOURNEY — this period, from enquiry to shipment. A stage the person cannot see is left out. */
  const journey: Stage[] = [];
  if (sb) journey.push({ key: "enq", label: "Enquiries", figure: fmtCompactNumber(sb.enquiries), hint: `${sb.costed} costed`, mood: "normal", items: Array(sb.enquiries).fill(1), href: `/analytics/samples${q}` });
  if (ob) {
    const priced = orders.ok ? orders.data.filter((o) => o.valueInr != null).map((o) => o.valueInr!) : [];
    journey.push({ key: "ord", label: "Orders booked", figure: fmtCompactNumber(ob.totals.orders), hint: fmtCompactInr(ob.totals.value), mood: "normal", items: priced.length ? priced : Array(ob.totals.orders).fill(1), href: `/analytics/orders${q}` });
  }
  if (pb) journey.push({ key: "bud", label: "Budgets decided", figure: fmtCompactNumber(pb.budgets - pb.withMd), hint: pb.withMd ? `${pb.withMd} with the MD` : `margin ${fmtPct(pb.margin)}`, mood: pb.low.length ? "look" : "good", items: pb.byBudget.map((r) => r.income ?? 1), href: `/analytics/profitability${q}` });
  if (ub) journey.push({ key: "po", label: "POs placed", figure: fmtCompactNumber(ub.pos), hint: fmtCompactInr(ub.value), mood: ub.openValue > 0 ? "look" : "good", items: ub.pipeline.filter((s) => s.key !== "waiting").flatMap((s) => s.items), href: `/analytics/purchase${q}` });
  journey.push({ key: "ship", label: "Shipped", figure: "—", hint: "starts with shipments", mood: "quiet", items: [] });

  const needs: NeedCell[] = [
    db
      ? {
          title: "Orders at risk",
          mood: db.atRisk ? "problem" : "good",
          count: db.atRisk ? n(db.atRisk, "order") : "None",
          text: db.atRisk ? db.lateOpen.filter((s) => s.shipsSoon).map((s) => `${s.reNo} ${s.label}`).join(" · ") : "No order near delivery has a late step",
          href: `/analytics/delivery${q}`,
          linkText: "Delivery & T&A",
        }
      : { title: "Orders at risk", mood: "quiet", count: "—", text: "Needs Order Progress" },
    pb
      ? {
          title: "Low margin",
          mood: pb.low.length ? "problem" : "good",
          count: pb.low.length ? n(pb.low.length, "budget") : "None",
          text: pb.low.length ? pb.low.map((r) => `${r.reNos.join(", ") || r.code} ${fmtPct(r.marginPct)}`).join(" · ") : `Every order is above ${LOW_MARGIN_PCT}%`,
          href: `/analytics/profitability${q}`,
          linkText: "Profitability",
        }
      : { title: "Low margin", mood: "quiet", count: "—", text: "Needs Budgeting" },
    ub
      ? {
          title: "POs need a look",
          mood: ub.attention.length ? "look" : "good",
          count: ub.attention.length ? n(ub.attention.length, "PO") : "None",
          text: ub.attention.length
            ? ub.attention.map((a) => `${a.po.code} ${a.why === "over_budget" ? "over budget" : `${a.daysLate} d late`}`).join(" · ")
            : "No PO is over budget or late",
          href: `/analytics/purchase${q}`,
          linkText: "Purchase & Vendors",
        }
      : { title: "POs need a look", mood: "quiet", count: "—", text: "Needs Purchase Orders" },
  ];

  return (
    <div className="space-y-2.5">
      <BoardHeader title="Analytics" question="How is the business doing? Every number opens its board." period={period.key} />
      <Strip cells={strip} />
      <VizCard title="Where is the business right now?" question={`${period.label}, from enquiry to shipment — each stage opens its board`}>
        <div className="py-3">
          <StagePipe stages={journey} />
        </div>
      </VizCard>
      <Row3>
        <VizCard title="When does it ship?" question="Pieces by delivery month" padded>
          {ob ? (
            <GlowBars rows={ob.byDeliveryMonth.map((m) => ({ key: m.key, label: m.label, value: m.value, colour: "var(--primary)" }))} format={(v) => `${fmtCompactNumber(v)} pcs`} empty="No delivery date in this period." />
          ) : (
            <p className="text-sm text-muted-foreground">Needs Order Entry.</p>
          )}
        </VizCard>
        <VizCard title="Where is the money?" question="Order value by buyer" padded>
          {ob ? (
            <GlowBars rows={ob.byBuyer.map((r) => ({ key: r.key, label: r.label, value: r.value, colour: r.key === "__others" ? "var(--border-strong)" : nameColour(r.label) }))} format={fmtCompactInr} empty="No priced order in this period." />
          ) : (
            <p className="text-sm text-muted-foreground">Needs Order Entry.</p>
          )}
        </VizCard>
        <VizCard title="How are margins spread?" question="Budgets by margin band" padded>
          {pb ? (
            <Tape
              parts={pb.bands.map((x) => ({
                label: x.label,
                value: x.value,
                colour: x.key === "loss" || x.key === "low" ? "var(--danger)" : x.key === "mid" ? "var(--warning)" : x.key === "good" ? "var(--primary)" : "var(--success)",
              }))}
              format={(v) => fmtCompactNumber(v)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Needs Budgeting.</p>
          )}
        </VizCard>
      </Row3>
      <NeedsDoing cells={needs} />
    </div>
  );
}
