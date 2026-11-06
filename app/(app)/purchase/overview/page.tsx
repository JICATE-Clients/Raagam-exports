import { requirePermission } from "@/lib/auth/server";
import { loadPurchase } from "@/lib/analytics/sources";
import { PO_STAGES, poStage } from "@/lib/analytics/compute";
import { pendingQcCount } from "@/lib/reports/stock-statement-service";
import { today } from "@/lib/dashboard/range";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { myIdentity } from "@/lib/overview/me";
import { purchaseOverview, poWhen, openValue, type PoRow } from "@/lib/overview/purchase";
import { asOfNow, count, daysLate, relDays } from "@/lib/overview/words";
import { GlowBars, MOOD_COLOUR, NeedsDoing, Strip, VizCard, classColour, type Mood } from "@/components/viz/kit";
import { StagePipe } from "@/components/analytics/pictures";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList, whoOf } from "@/components/overview/frame";

/**
 * PURCHASE ▸ OVERVIEW — the module's landing page (decided 2026-11-04, built 2026-11-06; plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW). Replaces the redirect to Raise PO
 * (user 2026-10-28), which sent everyone to one screen whatever they came to do; Raise PO is
 * the first row of the sidebar beside it, one click away as before.
 *
 * "Mine" is the POs the operator raised (`created_by`). The rules — what is open, what is
 * late, what has no real expected date — are `lib/overview/purchase.ts`, pure.
 */
export default async function PurchaseOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("materials_purchase", "view");
  const sp = await searchParams;
  const [res, me, qc] = await Promise.all([loadPurchase(), myIdentity(), pendingQcCount().catch(() => null)]);
  const t = today();
  const asOf = asOfNow();

  if (!res.ok) {
    return (
      <div className="space-y-3">
        <OverviewHeader title="Purchase" question="What are we waiting for, and from whom?" who={null} mine={0} everyone={0} asOf={asOf} />
        {res.reason === "access" ? <NoAccess what="The purchase overview" screen="Purchase Orders" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const live = (p: PoRow) => (p.placed && p.openQty > 0 && p.status !== "closed") || p.status === "pending_approval";
  const all = res.data as PoRow[];
  const mineRows = me.profileId ? all.filter((p) => p.createdBy === me.profileId) : [];
  const mineLive = mineRows.filter(live).length;
  const who = whoOf(sp.who, mineLive);
  const rows = who === "mine" ? mineRows : all;
  const o = purchaseOverview(rows, t, qc);

  /* The picture: every PO in scope by how far it has got, one block per PO sized by its value. */
  const STAGE_MOOD: Record<string, Mood> = { waiting: "look", none_in: "normal", part: "normal", received: "good", closed: "quiet" };
  const stages = PO_STAGES.map((st) => {
    const list = rows.filter((p) => poStage(p) === st.key);
    return {
      key: st.key,
      label: st.label,
      figure: count(list.length, "PO"),
      hint: fmtCompactInr(list.reduce((a, p) => a + p.value, 0)),
      mood: STAGE_MOOD[st.key],
      items: list.map((p) => p.value),
      href: st.key === "waiting" ? "/purchase/po-approval" : "/purchase/orders",
    };
  });

  /* Who owes us goods: open value per vendor, the bar coloured by that vendor's worst state. */
  const byVendor = new Map<string, { value: number; mood: Mood }>();
  const rank: Record<Mood, number> = { problem: 3, look: 2, normal: 1, good: 0, quiet: 0 };
  for (const p of o.open) {
    const w = poWhen(p, t);
    const m: Mood = w === "late" ? "problem" : w === "undated" ? "look" : "normal";
    const cur = byVendor.get(p.vendor) ?? { value: 0, mood: "normal" as Mood };
    cur.value += openValue(p);
    if (rank[m] > rank[cur.mood]) cur.mood = m;
    byVendor.set(p.vendor, cur);
  }
  const vendorBars = [...byVendor.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 7)
    .map(([v, x]) => ({ key: v, label: v, value: x.value, colour: MOOD_COLOUR[x.mood] }));

  /* What we are buying: the open POs' value by item class, colour fixed by the class. */
  const byClass = new Map<string, number>();
  for (const p of o.open) for (const [cls, amt] of p.byClass) byClass.set(cls, (byClass.get(cls) ?? 0) + amt);
  const classBars = [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ key: c, label: c, value: v, colour: classColour(c) }));

  return (
    <div className="space-y-2.5">
      <OverviewHeader
        title="Purchase"
        question="What are we waiting for, and from whom?"
        who={mineRows.length ? who : null}
        mine={mineLive}
        everyone={all.filter(live).length}
        asOf={asOf}
      />
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="Where is each PO?" question="Every purchase order by how far it has got, one block per PO, sized by its value">
        <div className="py-3">
          <StagePipe stages={stages} />
        </div>
      </VizCard>
      <Row3>
        <WhenList
          title="What is due, and when?"
          question="Open POs by their expected date"
          empty="Nothing is still to come."
          more="/purchase/orders"
          items={o.open.map((p) => {
            const w = poWhen(p, t);
            return {
              key: p.id,
              when: w,
              name: p.vendor,
              code: p.code,
              href: `/purchase/orders/${p.id}`,
              note:
                w === "late"
                  ? `${daysLate(p.expectedDate!, t)} d late · ${fmtCompactInr(openValue(p))}`
                  : w === "undated"
                    ? `no real date · ${fmtCompactInr(openValue(p))}`
                    : `${relDays(p.expectedDate!, t)} · ${fmtCompactInr(openValue(p))}`,
            };
          })}
        />
        <VizCard title="Who owes us goods?" question="Value still to come per vendor · red late, amber no real date" padded>
          <GlowBars rows={vendorBars} format={fmtCompactInr} empty="No vendor owes us anything." />
        </VizCard>
        <VizCard title="What are we waiting for?" question="Open POs' value by item class" padded>
          <GlowBars rows={classBars} format={fmtCompactInr} empty="Nothing is still to come." />
        </VizCard>
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/purchase/inventory", label: "Store Overview" },
          { href: "/analytics/purchase", label: "Purchase & Vendors board" },
        ]}
      />
    </div>
  );
}
