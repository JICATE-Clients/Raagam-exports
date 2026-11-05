import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { loadPurchase } from "@/lib/analytics/sources";
import { poTiming, purchaseBoard, type PoIn } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { delta, fmtCompactInr, fmtPct } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { Dot, GlowBars, MOOD_COLOUR, NeedsDoing, Strip, VizCard, classColour, type Mood } from "@/components/viz/kit";
import { StagePipe } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/** ANALYTICS ▸ PURCHASE & VENDORS — "What did we spend, with whom, and who delivers on time?" */
export default async function PurchaseBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const res = await loadPurchase();
  const t = today();

  const header = <BoardHeader title="Purchase & Vendors" question="What did we spend, with whom, and who delivers on time?" period={period.key} view={view} />;
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header}
        {res.reason === "access" ? <NoAccess what="Purchase spend" screen="Purchase Orders" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const b = purchaseBoard(res.data, period, t);
  const rows = res.data.filter((p) => inRange(p.orderDate, period));
  const d = b.prevValue != null ? delta(b.value, b.prevValue) : null;
  const STAGE_MOOD: Record<string, Mood> = { waiting: "look", none_in: "normal", part: "normal", received: "good", closed: "quiet" };
  const over = b.attention.filter((a) => a.why === "over_budget");
  const late = b.attention.filter((a) => a.why === "late");

  /* A vendor's dot: green on time, amber 1–5 days late on average, red past that, grey not due yet. */
  const lateBy = new Map(b.avgLateByVendor.map((v) => [v.key, v.value]));
  const vendorMood = (v: string): Mood => {
    const days = lateBy.get(v);
    if (days == null) return res.data.some((p) => p.vendor === v && poTiming(p, t).state === "on_time") ? "good" : "quiet";
    return days > 5 ? "problem" : "look";
  };

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        <DataTable
          rows={rows}
          getKey={(r) => r.id}
          empty={`No PO in ${period.label}.`}
          columns={withCreatedColumns<PoIn>(
            [
              { header: "PO", cell: (r) => <Link className="font-semibold text-primary hover:underline" href={`/purchase/orders/${r.id}`}>{r.code}</Link> },
              { header: "Vendor", cell: (r) => r.vendor },
              { header: "Order date", cell: (r) => fmtDate(r.orderDate) },
              { header: "Expected", cell: (r) => fmtDate(r.expectedDate) },
              { header: "Value", align: "right", cell: (r) => <span className="tabular-nums">{fmtCompactInr(r.value)}</span> },
              { header: "Received", align: "right", cell: (r) => <span className="tabular-nums">{fmtCompactInr(r.receivedValue)}</span> },
              { header: "Status", cell: (r) => <StatusPill tone={statusWordTone(r)}>{statusWord(r)}</StatusPill> },
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
          { label: `PO value · ${period.label}`, value: fmtCompactInr(b.value), hint: d ? `${d.text} vs ${period.prev!.label}` : n(b.pos, "PO") + " placed", href: "/purchase/orders" },
          {
            label: "Received so far",
            value: fmtPct(b.receivedPct, 0),
            hint: b.openValue > 0 ? `${fmtCompactInr(b.openValue)} still to come` : "everything is in",
            mood: b.openValue > 0 ? "look" : "good",
          },
          {
            label: "Vendors on time",
            value: fmtPct(b.onTimePct, 0),
            hint: b.decided ? `of ${n(b.decided, "PO")} due so far` : "no PO due yet",
            mood: b.onTimePct == null ? "quiet" : b.onTimePct >= 90 ? "good" : b.onTimePct >= 70 ? "look" : "problem",
          },
          { label: "Rejected at QC", value: fmtPct(b.rejectedPct), hint: "of quantity received", mood: b.rejectedPct == null ? "quiet" : b.rejectedPct <= 2 ? "good" : "problem", href: "/stores/qc-pending" },
          {
            label: "Over budget",
            value: n(over.length, "PO"),
            hint: over.length ? `${fmtCompactInr(over.reduce((a, x) => a + x.po.value, 0))} in those POs` : "none",
            mood: over.length ? "problem" : "good",
            href: "/purchase/over-budget",
          },
        ]}
      />
      <VizCard title="Where are the POs right now?" question="Every PO in the period by how much has arrived — one block per PO, sized by its value">
        <div className="py-3">
          <StagePipe
            stages={b.pipeline.map((s) => ({
              key: s.key,
              label: s.label,
              figure: n(s.count, "PO"),
              hint: fmtCompactInr(s.value),
              mood: STAGE_MOOD[s.key],
              items: s.items,
              href: s.key === "waiting" ? "/purchase/po-approval" : "/purchase/orders",
            }))}
          />
        </div>
      </VizCard>
      <Row3>
        <VizCard title="Who do we buy from, and do they deliver?" question="Spend per vendor · the dot is their on-time record" padded>
          {b.vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PO in this period.</p>
          ) : (
            <div className="space-y-2.5">
              {b.vendors.slice(0, 7).map((v) => {
                const max = b.vendors[0].total || 1;
                const mood = vendorMood(v.key);
                return (
                  <div key={v.key} className="grid grid-cols-[minmax(0,8.5rem)_auto_minmax(0,1fr)_5.5rem] items-center gap-2" title={`${v.label} · ${fmtCompactInr(v.total)} · ${fmtCompactInr(v.open)} still to come`}>
                    <Truncated text={v.label} className="block min-w-0 text-[12.5px]" />
                    <Dot colour={MOOD_COLOUR[mood]} />
                    <div className="flex h-3 gap-px rounded-r bg-surface-muted">
                      <div className="h-full rounded-l" style={{ width: `${(v.received / max) * 100}%`, background: "var(--primary)", boxShadow: "0 0 10px -1px var(--primary)" }} />
                      <div className="h-full rounded-r" style={{ width: `${(v.open / max) * 100}%`, background: "var(--viz-2)" }} />
                    </div>
                    <span className="text-right text-[12.5px] font-semibold tabular-nums">{fmtCompactInr(v.total)}</span>
                  </div>
                );
              })}
              <p className="text-[11.5px] text-muted-foreground">Blue is received, orange still to come.</p>
            </div>
          )}
        </VizCard>
        <VizCard title="What are we buying?" question="PO value by item class" padded>
          <GlowBars rows={b.byClass.map((r) => ({ key: r.key, label: r.label, value: r.value, colour: classColour(r.label) }))} format={fmtCompactInr} />
        </VizCard>
        <VizCard title="Who is late, and by how much?" question="Average days after the expected date" padded>
          <GlowBars
            rows={b.avgLateByVendor.slice(0, 6).map((r) => ({ key: r.key, label: r.label, value: r.value, colour: r.value > 5 ? "var(--danger)" : "var(--warning)" }))}
            format={(v) => `${v.toFixed(1)} days`}
            empty="Nobody is late."
          />
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "Over budget",
            mood: over.length ? "problem" : "good",
            count: over.length ? n(over.length, "PO") : "None",
            text: over.length ? over.map((a) => `${a.po.code} ${a.po.vendor}${a.po.overBudgetReason ? ` (${a.po.overBudgetReason})` : ""}`).join(" · ") : "Every PO is inside its budget",
            href: over[0] ? `/purchase/orders/${over[0].po.id}` : undefined,
            linkText: "Open the PO",
          },
          {
            title: "Past expected date",
            mood: late.length ? "look" : "good",
            count: late.length ? n(late.length, "PO") : "None",
            text: late.length ? late.map((a) => `${a.po.vendor} ${a.daysLate} d`).join(" · ") : "Nothing is overdue from a vendor",
            href: late.length ? "/purchase/orders" : undefined,
            linkText: "Purchase Orders",
          },
          {
            title: "Waiting approval",
            mood: b.pipeline[0].count ? "look" : "good",
            count: b.pipeline[0].count ? n(b.pipeline[0].count, "PO") : "None",
            text: b.pipeline[0].count ? `${fmtCompactInr(b.pipeline[0].value)} not yet sent to vendors` : "Nothing waiting for approval",
            href: b.pipeline[0].count ? "/purchase/po-approval" : undefined,
            linkText: "PO Approval",
          },
        ]}
      />
    </div>
  );
}

function statusWord(p: PoIn): string {
  if (!p.placed) return "Waiting approval";
  if (p.status === "closed") return "Closed";
  if (p.openQty <= 0) return "Received";
  return p.receivedValue > 0 ? "Part received" : "Approved";
}
function statusWordTone(p: PoIn) {
  return !p.placed ? ("warning" as const) : p.openQty <= 0 ? ("success" as const) : ("info" as const);
}
