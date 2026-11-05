import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { loadSteps } from "@/lib/analytics/sources";
import { deliveryBoard, stepState, type StepIn } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { fmtCompactNumber, fmtPct } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard } from "@/components/viz/kit";
import { OrderRunway } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ DELIVERY & T&A — "Will we ship on time? Where do orders get stuck?"
 *
 * Every dated step of every open order — the six internal work-flow milestones and the buyer's
 * T&A activities. The period picks steps by their TARGET date. Needs Orders ▸ Order Progress.
 */
export default async function DeliveryBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const res = await loadSteps();
  const t = today();

  const header = <BoardHeader title="Delivery & T&A" question="Will we ship on time? Where do orders get stuck?" period={period.key} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Order steps" screen="Orders ▸ Order Progress" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const b = deliveryBoard(res.data, period, t);
  const rows = res.data.filter((s) => inRange(s.target, period)).map((s) => ({ ...s, ...stepState(s, t) }));
  const ta = res.data.filter((s) => s.source === "T&A");
  const taDone = ta.filter((s) => s.actual).length;
  const lateBands = [
    { label: "1–3 days", value: b.lateOpen.filter((s) => s.daysLate <= 3).length, colour: "var(--warning)" },
    { label: "4–7 days", value: b.lateOpen.filter((s) => s.daysLate > 3 && s.daysLate <= 7).length, colour: "var(--warning)" },
    { label: "8+ days", value: b.lateOpen.filter((s) => s.daysLate > 7).length, colour: "var(--danger)" },
  ];
  const WORD = { on_time: "Done on time", done_late: "Done late", late_open: "Late", upcoming: "Coming up" } as const;
  const TONE = { on_time: "success", done_late: "warning", late_open: "danger", upcoming: "neutral" } as const;
  type Row = StepIn & ReturnType<typeof stepState>;

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        <DataTable
          rows={rows}
          getKey={(r, i) => `${r.orderId}-${r.label}-${i}`}
          empty={`No step was due in ${period.label}.`}
          columns={withCreatedColumns<Row>(
            [
              { header: "RE No", cell: (r) => (r.orderId ? <Link className="font-semibold text-primary hover:underline" href={`/orders/garment-orders?open=${r.orderId}`}>{r.reNo}</Link> : r.reNo) },
              { header: "Buyer", cell: (r) => r.buyer },
              { header: "Step", cell: (r) => `${r.label} · ${r.source}` },
              { header: "Target", cell: (r) => fmtDate(r.target) },
              { header: "Done", cell: (r) => fmtDate(r.actual) },
              { header: "Owner", cell: (r) => r.owner },
              { header: "State", cell: (r) => <StatusPill tone={TONE[r.state]}>{r.daysLate ? `${WORD[r.state]} · ${r.daysLate} d` : WORD[r.state]}</StatusPill> },
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
      <Strip
        cells={[
          {
            label: "Steps done on time",
            value: fmtPct(b.onTimePct, 0),
            hint: b.decided ? `of ${n(b.decided, "step")} due in ${period.label}` : "no step due yet",
            mood: b.onTimePct == null ? "quiet" : b.onTimePct >= 85 ? "good" : b.onTimePct >= 60 ? "look" : "problem",
          },
          { label: "Steps late now", value: fmtCompactNumber(b.lateNow), hint: b.lateNow ? `across ${n(b.lateOrders, "order")}` : "none", mood: b.lateNow ? "problem" : "good" },
          { label: "Orders at risk", value: fmtCompactNumber(b.atRisk), hint: "ship within 30 days with a late step", mood: b.atRisk ? "problem" : "good", href: "/orders/progress" },
          { label: "Average delay", value: b.avgDelay == null ? "—" : `${b.avgDelay.toFixed(1)} days`, hint: "per late step", mood: b.avgDelay ? "look" : "normal" },
          {
            label: "Buyer T&A done",
            value: `${fmtCompactNumber(taDone)} of ${fmtCompactNumber(ta.length)}`,
            hint: ta.length && !taDone ? "no actual dates entered yet" : "steps with an actual date",
            mood: ta.length && !taDone ? "quiet" : "normal",
          },
        ]}
      />
      <VizCard title="Will each order make its date?" question="One lane per open order: its steps on their target dates, up to the delivery flag">
        <OrderRunway lanes={b.runway.slice(0, 10)} todayIso={t} />
      </VizCard>
      <Row3>
        <VizCard title="Which step runs late?" question="Late steps in the period" padded>
          <GlowBars
            rows={b.bySteps.filter((s) => s.late > 0).slice(0, 7).map((s) => ({ key: s.key, label: s.label, value: s.late, colour: "var(--danger)" }))}
            format={(v) => n(v, "step")}
            empty="No step ran late."
          />
        </VizCard>
        <VizCard title="Whose desk is it on?" question="Open late steps by owner" padded>
          <GlowBars rows={b.byOwner.map((r) => ({ key: r.key, label: r.label, value: r.value, colour: "var(--warning)" }))} format={(v) => n(v, "step")} empty="Nothing late on anyone's desk." />
        </VizCard>
        <VizCard title="How late is late?" question="Open late steps by days past target" padded>
          <Tape parts={lateBands} format={(v) => fmtCompactNumber(v)} />
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "At risk",
            mood: b.atRisk ? "problem" : "good",
            count: b.atRisk ? n(b.atRisk, "order") : "None",
            text: b.atRisk ? b.lateOpen.filter((s) => s.shipsSoon).map((s) => `${s.reNo} ${s.label} ${s.daysLate} d`).join(" · ") : "No order near delivery has a late step",
            href: b.atRisk ? "/orders/progress" : undefined,
            linkText: "Order Progress",
          },
          {
            title: "Late now",
            mood: b.lateNow ? "look" : "good",
            count: b.lateNow ? n(b.lateNow, "step") : "None",
            text: b.lateNow ? b.lateOpen.map((s) => `${s.reNo} ${s.label}`).join(" · ") : "Every step due so far is done",
            href: b.lateOpen[0]?.orderId ? `/orders/garment-orders?open=${b.lateOpen[0].orderId}` : undefined,
            linkText: "Open the order",
          },
          {
            title: "T&A not updated",
            mood: ta.length - taDone ? "quiet" : "good",
            count: ta.length - taDone ? n(ta.length - taDone, "step") : "None",
            text: ta.length - taDone ? "Buyer T&A steps with no actual date entered" : "Every T&A step has its date",
            href: ta.length - taDone ? "/orders/garment-orders" : undefined,
            linkText: "Order Entry",
          },
        ]}
      />
    </div>
  );
}
