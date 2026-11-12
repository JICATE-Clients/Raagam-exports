import Link from "next/link";
import { canViewHref, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { MODULE_GROUPS } from "@/lib/nav/module-groups";
import { loadOrders, loadSteps } from "@/lib/analytics/sources";
import { monthKey, monthLabel } from "@/lib/analytics/compute";
import { amendmentTypesLabel } from "@/lib/orders/amendments/amendment-entry";
import { today } from "@/lib/dashboard/range";
import { myIdentity } from "@/lib/overview/me";
import { ordersOverview, type DraftBudgetRow, type OrderRow, type RevisionRow } from "@/lib/overview/orders";
import { asOfNow, relDays, whenOf } from "@/lib/overview/words";
import { Dot, GlowBars, MOOD_COLOUR, NeedsDoing, Strip, VizCard, nameColour } from "@/components/viz/kit";
import { ShipCalendar, type CalMonth } from "@/components/analytics/pictures";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList, whoOf } from "@/components/overview/frame";

/**
 * ORDERS ▸ OVERVIEW — the module's landing page (decided 2026-11-04, built 2026-11-06; plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW). Replaces `ModuleHub`, which since
 * 2026-09-15 only redirected to the first sub-module — so "Orders" landed on Order
 * Preparation whatever the operator came to see.
 *
 * "Mine" is the orders whose merchandiser is the operator (`merchandiser_id` → their staff
 * row, `lib/overview/me.ts`). The rules are `lib/overview/orders.ts`, pure.
 */
export default async function OrdersOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission(MODULE_GROUPS["/orders"].module, "view");
  const sp = await searchParams;
  const t = today();
  const asOf = asOfNow();
  const [res, me, stepsRes, canBudgets, canRevisions] = await Promise.all([
    loadOrders(),
    myIdentity(),
    loadSteps(),
    canViewHref("/orders/budgets"),
    canViewHref("/orders/order-amendments"),
  ]);

  if (!res.ok) {
    return (
      <div className="space-y-3">
        <OverviewHeader title="Orders" question="What ships next, and what is waiting on a decision?" who={null} mine={0} everyone={0} asOf={asOf} />
        {res.reason === "access" ? <NoAccess what="The orders overview" screen="Order Entry" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  /* Revisions and unsent budgets — each only when its own screen is the operator's to open. */
  const s = await createClient();
  const [revRes, budRes] = await Promise.all([
    canRevisions
      ? s.from("order_budget_revisions").select("id, entry_no, garment_order_id, amendment_type, amendment_types").eq("outcome", "open")
      : Promise.resolve({ data: [], error: null }),
    canBudgets
      ? s.from("order_budgets").select("id, code, status, orders:order_budget_orders(garment_order_id)").in("status", ["draft", "rejected"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (revRes.error || budRes.error) {
    return (
      <div className="space-y-3">
        <OverviewHeader title="Orders" question="What ships next, and what is waiting on a decision?" who={null} mine={0} everyone={0} asOf={asOf} />
        <LoadError message={(revRes.error ?? budRes.error)?.message} />
      </div>
    );
  }
  const allRevisions: RevisionRow[] = (
    (revRes.data ?? []) as { id: string; entry_no: string | null; garment_order_id: string; amendment_type: string; amendment_types: string[] | null }[]
  ).map((r) => ({
    id: r.id,
    entryNo: r.entry_no ?? "Revision",
    orderId: r.garment_order_id,
    modules: amendmentTypesLabel(r.amendment_types?.length ? r.amendment_types : [r.amendment_type]),
  }));
  const allBudgets: DraftBudgetRow[] = ((budRes.data ?? []) as { id: string; code: string | null; status: string; orders: { garment_order_id: string }[] | null }[]).map(
    (b) => ({ id: b.id, code: budgetName(b.code), status: b.status, orderIds: (b.orders ?? []).map((o) => o.garment_order_id) }),
  );

  const all = res.data as OrderRow[];
  const mineOrders = me.staffId ? all.filter((o) => o.merchandiserId === me.staffId) : [];
  const who = whoOf(sp.who, mineOrders.length);
  const orders = who === "mine" ? mineOrders : all;
  const inScope = new Set(orders.map((o) => o.id));
  const revisions = allRevisions.filter((r) => inScope.has(r.orderId));
  const budgets = allBudgets.filter((b) => b.orderIds.length === 0 ? who === "everyone" : b.orderIds.some((id) => inScope.has(id)));
  const steps = stepsRes.ok
    ? (() => {
        const mine = stepsRes.data.filter((x) => !x.orderId || inScope.has(x.orderId));
        return { total: mine.length, withActual: mine.filter((x) => x.actual).length };
      })()
    : null;

  const o = ordersOverview({ orders, revisions, budgets, steps, todayIso: t });

  /* The picture: one column per delivery month, one block per order, coloured by buyer. */
  const months = new Map<string, CalMonth>();
  for (const x of [...orders].filter((r) => r.deliveryDate).sort((a, b) => a.deliveryDate!.localeCompare(b.deliveryDate!))) {
    const k = monthKey(x.deliveryDate!);
    const m = months.get(k) ?? { key: k, label: monthLabel(k), orders: [] };
    m.orders.push({ id: x.id, reNo: x.reNo, buyer: x.buyer, qty: x.qty, late: whenOf(x.deliveryDate, t) === "late" });
    months.set(k, m);
  }

  /* Who is handling what (Everyone) — or, when it is only mine, which buyers they are for. */
  const tally = new Map<string, number>();
  const named = orders.some((x) => x.merchandiser !== "—");
  const byMerch = who === "everyone" && named;
  for (const x of orders) {
    const k = byMerch ? x.merchandiser : x.buyer;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const loadBars = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([k, v]) => ({ key: k, label: k, value: v, colour: nameColour(k), display: `${v} order${v === 1 ? "" : "s"}` }));

  const byId = new Map(orders.map((x) => [x.id, x]));
  const decisions = [
    ...o.notApproved.map((x) => ({ key: `re-${x.id}`, what: "Approve", name: x.buyer, code: x.reNo, href: `/orders/garment-orders?open=${x.id}` })),
    ...revisions.map((r) => ({ key: `rev-${r.id}`, what: "Revision", name: byId.get(r.orderId)?.buyer ?? "Order", code: `${r.entryNo}${r.modules ? ` · ${r.modules}` : ""}`, href: `/orders/order-amendments/${r.id}` })),
    ...budgets.map((b) => ({ key: `bud-${b.id}`, what: b.status === "rejected" ? "Rework" : "Send", name: b.code, code: b.orderIds.map((id) => byId.get(id)?.reNo).filter(Boolean).join(", "), href: `/orders/budgets?budget=${b.id}` })),
  ];

  return (
    <div className="space-y-2.5">
      <OverviewHeader
        title="Orders"
        question="What ships next, and what is waiting on a decision?"
        who={mineOrders.length ? who : null}
        mine={mineOrders.length}
        everyone={all.length}
        asOf={asOf}
      />
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="When does each order ship?" question="One column per delivery month, one block per order, coloured by buyer · a red ring has passed its date">
        <ShipCalendar months={[...months.values()]} qtyText={(n) => `${n.toLocaleString("en-IN")} pcs`} />
      </VizCard>
      <Row3>
        <WhenList
          title="What ships next?"
          question="By delivery date · the buyer first, the RE No under it"
          empty="No order carries a delivery date."
          more="/orders/garment-orders"
          items={orders
            .filter((x) => x.deliveryDate)
            .sort((a, b) => a.deliveryDate!.localeCompare(b.deliveryDate!))
            .map((x) => ({
              key: x.id,
              when: whenOf(x.deliveryDate, t),
              name: x.buyer,
              code: x.reNo,
              href: `/orders/garment-orders?open=${x.id}`,
              note: `${relDays(x.deliveryDate!, t)} · ${x.qty.toLocaleString("en-IN")} pcs`,
            }))}
        />
        <VizCard title={byMerch ? "Who is handling what?" : "Which buyers are these for?"} question={byMerch ? "Orders on the books per merchandiser" : "Orders on the books per buyer"} padded>
          <GlowBars rows={loadBars} format={(v) => `${v}`} empty="No order is on the books." />
        </VizCard>
        <VizCard title="What is waiting on a decision?" question="Orders to approve, revisions open, budgets not sent">
          <div className="px-3.5 py-2.5">
            {decisions.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-success">
                <Dot colour={MOOD_COLOUR.good} /> Nothing is waiting on a decision.
              </p>
            ) : (
              <ul className="space-y-1">
                {decisions.slice(0, 7).map((d) => (
                  <li key={d.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2 border-b border-dashed border-border pb-1 last:border-b-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-warning">{d.what}</span>
                    <Link href={d.href} className="min-w-0 hover:text-primary hover:underline">
                      <span className="block text-[12.5px] font-semibold">{d.name}</span>
                      {d.code ? <span className="block text-[11px] text-muted-foreground">{d.code}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {decisions.length > 7 ? <p className="mt-1.5 text-xs text-muted-foreground">and {decisions.length - 7} more</p> : null}
          </div>
        </VizCard>
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/orders/garment-orders", label: "Order Entry" },
          { href: "/analytics/orders", label: "Orders & Buyers board" },
          { href: "/analytics/delivery", label: "Delivery & T&A board" },
        ]}
      />
    </div>
  );
}

/** A budget's code is a bare number ("4"), which reads as a count in a sentence — say "Budget 4". */
function budgetName(code: string | null): string {
  const c = (code ?? "").trim();
  return !c ? "Budget" : /^\d+$/.test(c) ? `Budget ${c}` : c;
}
