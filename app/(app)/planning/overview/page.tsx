import { canViewHref, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { loadOrders } from "@/lib/analytics/sources";
import { listFabricBomTasks } from "@/lib/orders/fabric-bom/service";
import { listMaterialBomTasks } from "@/lib/orders/material-bom-amendment/service";
import { today } from "@/lib/dashboard/range";
import { myIdentity } from "@/lib/overview/me";
import { STEP_LABEL, bomCell, budgetCell, planningOverview, type IwoRow, type ReadyRow, type StepKey } from "@/lib/overview/planning";
import { asOfNow } from "@/lib/overview/words";
import { GlowBars, MOOD_COLOUR, NeedsDoing, Strip, VizCard } from "@/components/viz/kit";
import { LoadError, NoAccess } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Row3, Say, WhenList, whoOf } from "@/components/overview/frame";
import { ReadinessGrid } from "@/components/overview/readiness-grid";

/**
 * PLANNING ▸ OVERVIEW — "Is each order ready to buy?" (decided 2026-11-04, built 2026-11-06;
 * plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW).
 *
 * Replaces a hand-written grid of stat cards counting tables that 0332 dropped. Every screen
 * registered under Planning is still `unavailable`; the live planning work is under Orders, so
 * this page reads those screens' data — each only when that screen is the operator's to open —
 * and every cell links to it. The rules are `lib/overview/planning.ts`, pure.
 */
const BUDGET_RANK: Record<string, number> = { approved: 4, submitted: 3, rejected: 2, draft: 1 };

export default async function PlanningOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("planning", "view");
  const sp = await searchParams;
  const t = today();
  const asOf = asOfNow();
  const [res, me, canFab, canAcc, canBud, canTa, canIwo] = await Promise.all([
    loadOrders(),
    myIdentity(),
    canViewHref("/orders/fabric-bom"),
    canViewHref("/orders/material-bom"),
    canViewHref("/orders/budgets"),
    canViewHref("/orders/ta-plan"),
    canViewHref("/orders/internal-work-orders"),
  ]);
  const header = (who: "mine" | "everyone" | null, mine: number, everyone: number) => (
    <OverviewHeader title="Planning" question="Is each order ready to buy?" who={who} mine={mine} everyone={everyone} asOf={asOf} />
  );
  if (!res.ok) {
    return (
      <div className="space-y-3">
        {header(null, 0, 0)}
        {res.reason === "access" ? <NoAccess what="The planning overview" screen="Order Entry" /> : <LoadError message={res.message} />}
      </div>
    );
  }

  const all = res.data;
  const mineOrders = me.staffId ? all.filter((o) => o.merchandiserId === me.staffId) : [];
  const who = whoOf(sp.who, mineOrders.length);
  const orders = who === "mine" ? mineOrders : all;
  const ids = orders.map((o) => o.id);

  const s = await createClient();
  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const [fab, acc, links, budgets, iwos] = await Promise.all([
    canFab ? listFabricBomTasks() : Promise.resolve([]),
    canAcc ? listMaterialBomTasks() : Promise.resolve([]),
    ids.length ? s.from("garment_order_amendments").select("id, sales_order_id").in("id", ids) : none,
    canBud && ids.length
      ? s.from("order_budget_orders").select("garment_order_id, budget:order_budgets!budget_id(id, code, status)").in("garment_order_id", ids)
      : none,
    canIwo
      ? s.from("internal_work_orders").select("id, code, status, sales_order_id, is_sample, style_ref_no, remarks, created_at").eq("status", "draft").order("created_at")
      : none,
  ]);
  const failed = [links, budgets, iwos].find((r) => r.error);
  if (failed?.error) {
    return (
      <div className="space-y-3">
        {header(null, 0, 0)}
        <LoadError message={failed.error.message} />
      </div>
    );
  }

  const soOf = new Map(((links.data ?? []) as { id: string; sales_order_id: string | null }[]).map((r) => [r.id, r.sales_order_id]));
  const soIds = [...new Set([...soOf.values()].filter((x): x is string => !!x))];
  const taRes = canTa && soIds.length ? await s.from("ta_plans").select("sales_order_id").in("sales_order_id", soIds) : { data: [], error: null };
  const planned = new Set(((taRes.data ?? []) as { sales_order_id: string }[]).map((r) => r.sales_order_id));

  const bestBudget = new Map<string, { id: string; code: string | null; status: string }>();
  for (const r of (budgets.data ?? []) as unknown as { garment_order_id: string; budget: { id: string; code: string | null; status: string } | null }[]) {
    if (!r.budget) continue;
    const cur = bestBudget.get(r.garment_order_id);
    if (!cur || (BUDGET_RANK[r.budget.status] ?? 0) > (BUDGET_RANK[cur.status] ?? 0)) bestBudget.set(r.garment_order_id, r.budget);
  }
  const fabBy = new Map(fab.map((x) => [x.id, x]));
  const accBy = new Map(acc.map((x) => [x.id, x]));

  const steps: StepKey[] = [...(canFab ? ["fabric" as const] : []), ...(canAcc ? ["accessories" as const] : []), ...(canBud ? ["budget" as const] : []), ...(canTa ? ["ta" as const] : [])];
  const rows: ReadyRow[] = [...orders]
    .sort((a, b) => (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999"))
    .map((o) => {
      const b = bestBudget.get(o.id);
      const so = soOf.get(o.id);
      return {
        orderId: o.id,
        reNo: o.reNo,
        buyer: o.buyer,
        deliveryDate: o.deliveryDate,
        cells: {
          fabric: bomCell(fabBy.get(o.id)?.status, "/orders/fabric-bom"),
          accessories: bomCell(accBy.get(o.id)?.status, "/orders/material-bom"),
          budget: budgetCell(b?.status ?? null, b ? `/orders/budgets?budget=${b.id}` : "/orders/budgets"),
          ta: so && planned.has(so) ? { state: "done", word: "Planned", href: "/orders/ta-plan" } : { state: "none", word: "No plan", href: "/orders/ta-plan" },
          iwo: { state: "na", word: "—" },
        },
      };
    });

  const scopeSo = new Set(ids.map((id) => soOf.get(id)).filter(Boolean));
  const draftIwos: IwoRow[] = ((iwos.data ?? []) as { id: string; code: string | null; sales_order_id: string | null; is_sample: boolean | null; style_ref_no: string | null; remarks: string | null }[])
    .filter((w) => (w.sales_order_id ? scopeSo.has(w.sales_order_id) || who === "everyone" : who === "everyone"))
    .map((w) => ({ id: w.id, code: w.code ?? "IWO", note: [w.is_sample ? "sample" : "", w.style_ref_no ?? "", w.remarks ?? ""].filter(Boolean).join(" · ") }));

  const o = planningOverview(rows, draftIwos);

  return (
    <div className="space-y-2.5">
      {header(mineOrders.length ? who : null, mineOrders.length, all.length)}
      <Say lines={o.say} />
      <Strip compact cells={o.strip.filter((c) => (c.label.startsWith("Fabric") ? canFab : c.label.startsWith("Accessories") ? canAcc : c.label.startsWith("Budget") ? canBud : true))} />
      <VizCard title="Is each order ready to buy?" question="One row per order, soonest delivery first · each cell opens that step">
        <ReadinessGrid rows={rows} steps={steps} todayIso={t} />
      </VizCard>
      <Row3>
        <VizCard title="Which step holds most orders back?" question="Orders where the step is not done yet" padded>
          <GlowBars
            rows={o.holdBack
              .filter((h) => steps.includes(h.step))
              .map((h) => ({ key: h.step, label: STEP_LABEL[h.step], value: h.count, colour: MOOD_COLOUR[h.count ? "look" : "good"], display: `${h.count} of ${rows.length}` }))}
            format={(v) => `${v}`}
            empty="Every step is done on every order."
          />
        </VizCard>
        <WhenList
          title="What changed under a plan?"
          question="Plans computed before the order last changed"
          empty="Every plan matches its order."
          grouped={false}
          items={o.stale.map((x) => ({ key: `${x.row.orderId}-${x.step}`, when: "today", name: x.row.buyer, code: `${x.row.reNo} · ${STEP_LABEL[x.step]}`, note: "recalculate", href: x.row.cells[x.step].href }))}
        />
        <WhenList
          title="Which work orders wait to be issued?"
          question="Internal work orders still in draft, oldest first"
          empty="No internal work order is waiting."
          grouped={false}
          more="/orders/internal-work-orders"
          items={draftIwos.map((w) => ({ key: w.id, when: "undated", name: w.code, code: w.note || undefined, note: "draft", href: `/orders/internal-work-orders/${w.id}` }))}
        />
      </Row3>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          ...(canFab ? [{ href: "/orders/fabric-bom", label: "Fabric Plan" }] : []),
          ...(canAcc ? [{ href: "/orders/material-bom", label: "Accessories Plan" }] : []),
          ...(canBud ? [{ href: "/orders/budgets", label: "Budgeting" }] : []),
        ]}
      />
    </div>
  );
}
