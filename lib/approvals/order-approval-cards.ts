import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrderBudgetsByIds } from "@/lib/orders/budget/service";
import { kpisFromJson, type BudgetBaseline, type BudgetKpis } from "@/lib/orders/budget/amendment";
import type { Refusal } from "@/lib/orders/budget/totals";
import { breakdownOfBudget, type BudgetBreakdownPair } from "./budget-breakdown";

/**
 * THE MD'S APPROVAL, AS AN ORDER (client 2026-09-29, "MD Approval Screen in
 * Mobile View").
 *
 * The approval SUBJECT stays the budget — the engine, the 0576/0652 lock and
 * the V0 revert are all built on `order_budgets`, and one budget covers one
 * order in practice (the Orders grid was removed from the budget on 09-19).
 * What changes is what the approver SEES: the card leads with the order — RE
 * No, customer, style, quantity, when it ships, who merchandises it — and the
 * budget is the figures underneath. This is the one place that assembles that
 * card, for the phone inbox (`/approvals`) and the desktop register
 * (`/orders/budget-approval`) alike, so the two cannot drift.
 *
 * ## EVERY FIGURE IS THE BUDGET AS SUBMITTED
 *
 * KPIs from `submitted_summary` (stored in the submit's own write), the chart
 * from the stored lines over the SNAPSHOT orders (`breakdownOfBudget`) — never
 * a live re-read, which could move under an approval nobody re-submitted.
 *
 * ## A FIXED NUMBER OF READS, WHATEVER THE QUEUE
 *
 * 1. the budgets, whole (`getOrderBudgetsByIds` — lines, snapshot orders,
 *    revisions, RE No, customer, delivery);
 * 2. the orders' styles and merchandiser;
 * 3. every revision of those orders — for Rev #n AND each order's V0 baseline
 *    (its first frozen baseline), in the same rows;
 * 4. the display names (`creator_names`, SECURITY DEFINER — `profiles` RLS
 *    hides other users' rows).
 * Four round trips for a queue of one or of twenty. The breakdown is pure
 * arithmetic over what those returned.
 */
export type OrderApprovalCard = {
  budgetId: string;
  budgetCode: string | null;
  budgetStatus: string;
  currency: string | null;
  /** `sales_orders.order_number` of each order on the budget. */
  reNos: string[];
  customer: string | null;
  /** "REF / DESCRIPTION", in style order, comma-joined. */
  styles: string | null;
  /** `garment_order_amendments.merchandiser_id` → `employees.name`. */
  merchandiser: string | null;
  /** From the submitted KPIs — a refusal says why there is no figure. */
  orderQty: number | Refusal | null;
  orderUnit: string | Refusal | null;
  /** The EARLIEST delivery date across the budget's orders — ISO date. */
  earliestShipment: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  kpis: BudgetKpis | null;
  /** The open revision this approval decides, or null for a first budget (V0). */
  revision: {
    entryId: string;
    entryNo: string | null;
    revNo: number | null;
    reason: string | null;
    raisedBy: string | null;
    raisedAt: string;
  } | null;
  /** Current cost buckets and, on a revision, V0's — the chart and the variance. */
  breakdown: BudgetBreakdownPair;
  /** V0's order quantity (from its frozen KPIs), for V0's figures per piece. */
  v0Qty: number | Refusal | null;
};

type Entry = {
  id: string;
  entry_no: string | null;
  reason: string | null;
  outcome: string;
  reopened_by: string | null;
  reopened_at: string;
  garment_order_id: string | null;
  baseline: unknown;
};

export async function loadOrderApprovalCards(
  budgetIds: readonly string[],
): Promise<Record<string, OrderApprovalCard>> {
  const ids = [...new Set(budgetIds)];
  if (ids.length === 0) return {};
  const s = await createClient();

  // 1. The budgets, whole.
  const budgets = await getOrderBudgetsByIds(ids);
  const orderIdsOf = (b: (typeof budgets)[number]) =>
    (b.orders ?? []).map((o) => o.garment_order_id).filter((v): v is string => !!v);
  const allOrderIds = [...new Set(budgets.flatMap(orderIdsOf))];

  // 2 + 3, together: styles & merchandiser, and every revision of these orders.
  type Style = { sno: number; style_ref_no: string | null; style_description: string | null };
  type Facts = {
    id: string;
    styles: Style[] | null;
    merchandiser: { name: string | null } | { name: string | null }[] | null;
  };
  const [factsRes, revRes] = await Promise.all([
    allOrderIds.length
      ? s
          .from("garment_order_amendments")
          .select(
            "id, styles:garment_order_amendment_styles(sno, style_ref_no, style_description), " +
              "merchandiser:employees!merchandiser_id(name)",
          )
          .in("id", allOrderIds)
      : Promise.resolve({ data: [], error: null }),
    allOrderIds.length
      ? s
          .from("order_budget_revisions")
          .select("id, entry_no, reason, outcome, reopened_by, reopened_at, garment_order_id, baseline")
          .in("garment_order_id", allOrderIds)
          .order("reopened_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  // Enrichment reads: a failure costs the card a fact, never the card.
  if (factsRes.error) console.error("[approval-cards] order facts:", factsRes.error.message);
  if (revRes.error) console.error("[approval-cards] revisions:", revRes.error.message);
  const factsOf = new Map(((factsRes.data ?? []) as unknown as Facts[]).map((f) => [f.id, f]));
  const revisions = (revRes.data ?? []) as unknown as Entry[];

  // V0 per order: its FIRST frozen baseline (the `firstBaselineOf` rule).
  const v0Of = new Map<string, BudgetBaseline>();
  for (const r of revisions) {
    if (r.garment_order_id && r.baseline && !v0Of.has(r.garment_order_id)) {
      v0Of.set(r.garment_order_id, r.baseline as BudgetBaseline);
    }
  }

  // The open entry per budget — the latest, should two ever be open. Budget ▸
  // Reopen entries (no order) hang off the budget's own `revisions`.
  const openOf = new Map<string, Entry>();
  for (const b of budgets) {
    const open = ((b.revisions ?? []) as unknown as Entry[])
      .filter((e) => e.outcome === "open")
      .sort((x, y) => y.reopened_at.localeCompare(x.reopened_at))[0];
    if (open) openOf.set(b.id, open);
  }

  // 4. Names — the submitters and the revisions' raisers, in one call.
  const names = await namesOf([
    ...budgets.map((b) => (b as { submitted_by?: string | null }).submitted_by ?? null),
    ...[...openOf.values()].map((e) => e.reopened_by),
  ]);

  const out: Record<string, OrderApprovalCard> = {};
  await Promise.all(
    budgets.map(async (b) => {
      const orders = (b.orders ?? []).flatMap((o) => (o.garment_order ? [o.garment_order] : []));
      const orderIds = orderIdsOf(b);
      const kpis = kpisFromJson(b.submitted_summary);
      const open = openOf.get(b.id) ?? null;
      const first = open?.garment_order_id ? (v0Of.get(open.garment_order_id) ?? null) : null;

      const reNos = [
        ...new Set(orders.map((o) => (o.sales_order?.order_number ?? "").trim()).filter(Boolean)),
      ];
      const customers = [...new Set(orders.map((o) => (o.customer?.name ?? "").trim()).filter(Boolean))];
      const styles = orderIds
        .flatMap((id) => [...(factsOf.get(id)?.styles ?? [])].sort((x, y) => x.sno - y.sno))
        .map((st) =>
          [st.style_ref_no, st.style_description].map((v) => (v ?? "").trim()).filter(Boolean).join(" / "),
        )
        .filter(Boolean);
      const merch = [
        ...new Set(
          orderIds
            .map((id) => {
              const m = factsOf.get(id)?.merchandiser;
              return ((Array.isArray(m) ? m[0] : m)?.name ?? "").trim();
            })
            .filter(Boolean),
        ),
      ];
      // Earliest ship date: the orders' own delivery dates, else the KPIs'.
      const dates = orders.map((o) => o.delivery_date).filter((d): d is string => !!d);
      const earliest = [...dates, ...(kpis?.delivery_dates ?? [])].sort()[0] ?? null;

      // Rev #n is the register's number: this order's entries up to this one.
      const revNo =
        open?.garment_order_id != null
          ? Math.max(
              1,
              revisions.filter((r) => r.garment_order_id === open.garment_order_id && r.reopened_at <= open.reopened_at)
                .length,
            )
          : null;

      const submittedBy = (b as { submitted_by?: string | null }).submitted_by ?? null;
      out[b.id] = {
        budgetId: b.id,
        budgetCode: b.code,
        budgetStatus: b.status,
        currency: b.currency_code,
        reNos: reNos.length ? reNos : (kpis?.re_nos ?? []),
        customer: customers.join(", ") || null,
        styles: [...new Set(styles)].join(", ") || null,
        merchandiser: merch.join(", ") || null,
        orderQty: kpis?.order_qty ?? null,
        orderUnit: kpis?.order_unit ?? null,
        earliestShipment: earliest,
        submittedAt: b.submitted_at ?? null,
        submittedBy: submittedBy ? (names[submittedBy] ?? null) : null,
        kpis,
        revision: open
          ? {
              entryId: open.id,
              entryNo: open.entry_no,
              revNo,
              reason: (open.reason ?? "").trim() || null,
              raisedBy: open.reopened_by ? (names[open.reopened_by] ?? null) : null,
              raisedAt: open.reopened_at,
            }
          : null,
        // V0 handed in from the batch read above; no per-card query.
        breakdown: await breakdownOfBudget(b, first),
        v0Qty: open ? (kpisFromJson(((first ?? open.baseline) as BudgetBaseline | null)?.kpis)?.order_qty ?? null) : null,
      };
    }),
  );
  return out;
}

/** Display names through `creator_names()` — SECURITY DEFINER, because
 *  `profiles_read_own` hides every other user's profile from an embed. */
async function namesOf(ids: (string | null)[]): Promise<Record<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (list.length === 0) return {};
  const s = await createClient();
  const { data, error } = await s.rpc("creator_names", { ids: list });
  if (error) console.error("[approval-cards] names:", error.message);
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) out[p.id] = p.full_name;
  }
  return out;
}
