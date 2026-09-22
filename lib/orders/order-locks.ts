import "server-only";
import { createClient } from "@/lib/supabase/server";
import { orderLockMessage } from "@/lib/orders/budget/amendment";

/**
 * WHICH GARMENT ORDERS ARE LOCKED, AND WHAT THE BANNER SAYS — for the editors'
 * loaders (Phase 5, 2026-09-18).
 *
 * Order Entry / Amendment, the Fabric BOM and the Material BOM each pass
 * `locked` to `MasterFullScreen` when the open record's order has
 * `re_status = 'approved'`. The screens are client components and must not
 * grow a hook to ask (the order screen returns early above 19,000 lines of
 * editor — AGENTS.md, "Hooks above every early return"), so the page asks
 * ONCE, here, and hands down a plain `{ orderId: message }` map the screen
 * reads with a const.
 *
 * ## THE SAME GRAIN AND THE SAME SENTENCE AS THE GUARD
 *
 * The lock is PER RE No (0576's `order_lock_of`): a document is locked when it
 * OR ANY document of the same `sales_order_id` has `re_status = 'approved'`.
 * So an amendment raised beside an approved order is keyed here too, with the
 * approved sibling's budget in its sentence. The message is `orderLockMessage`
 * — the banner the operator reads before typing is word for word the refusal
 * they would get on Save.
 *
 * ## A FAILED READ SHOWS NO BANNER — AND LOCKS NOTHING LESS
 *
 * This is display only. The write path fails CLOSED (`assertOrderUnlocked`,
 * then the triggers), so an unreadable lock here costs a banner, never a
 * write. Failing the whole page over a banner would take the editor down with
 * it, which is the worse trade.
 */
export async function orderLockMessages(
  /** Omit for every approved order — they are few, and the list screens need all. */
  orderIds?: readonly string[],
): Promise<Record<string, string>> {
  if (orderIds && orderIds.length === 0) return {};
  try {
    const s = await createClient();
    /* Every APPROVED document — not narrowed by `orderIds`, because the one
       that locks an asked-for document may be its sibling. They are few. */
    const { data: orders, error } = await s
      .from("garment_order_amendments")
      .select("id, sales_order_id, sales_order:sales_orders(order_number)")
      .eq("re_status", "approved");
    if (error) {
      console.error("[order-locks] reading re_status:", error.message);
      return {};
    }
    const rows = (orders ?? []) as unknown as {
      id: string;
      sales_order_id: string | null;
      sales_order: { order_number: string | null } | { order_number: string | null }[] | null;
    }[];
    if (rows.length === 0) return {};

    /* WHICH budget — for the words only; the lock itself is `re_status`. */
    const { data: links, error: bErr } = await s
      .from("order_budget_orders")
      .select("garment_order_id, budget:order_budgets!inner(code, status, decided_at)")
      .in("garment_order_id", rows.map((r) => r.id))
      .eq("order_budgets.status", "approved");
    if (bErr) console.error("[order-locks] reading approved budgets:", bErr.message);

    type Budget = { code: string | null; decided_at: string | null };
    const budgetOf = new Map<string, Budget>();
    for (const l of (links ?? []) as unknown as {
      garment_order_id: string;
      budget: Budget | Budget[] | null;
    }[]) {
      const b = Array.isArray(l.budget) ? (l.budget[0] ?? null) : l.budget;
      if (b && !budgetOf.has(l.garment_order_id)) budgetOf.set(l.garment_order_id, b);
    }

    /* THE SIBLINGS: every document of an approved RE No is locked by it. */
    const approvedBySo = new Map<string, string>(); // sales_order_id -> approved doc id
    for (const r of rows) {
      if (r.sales_order_id && !approvedBySo.has(r.sales_order_id)) {
        approvedBySo.set(r.sales_order_id, r.id);
      }
    }
    const lockerOf = new Map<string, string>(rows.map((r) => [r.id, r.id])); // doc -> approved doc
    if (approvedBySo.size > 0) {
      const { data: sibs, error: sErr } = await s
        .from("garment_order_amendments")
        .select("id, sales_order_id")
        .in("sales_order_id", [...approvedBySo.keys()]);
      if (sErr) console.error("[order-locks] reading sibling documents:", sErr.message);
      for (const d of (sibs ?? []) as { id: string; sales_order_id: string | null }[]) {
        const locker = d.sales_order_id ? approvedBySo.get(d.sales_order_id) : undefined;
        if (locker && !lockerOf.has(d.id)) lockerOf.set(d.id, locker);
      }
    }

    const rowById = new Map(rows.map((r) => [r.id, r]));
    const wanted = orderIds ? new Set(orderIds) : null;
    const out: Record<string, string> = {};
    for (const [docId, lockerId] of lockerOf) {
      if (wanted && !wanted.has(docId)) continue;
      const r = rowById.get(lockerId);
      if (!r) continue;
      const so = Array.isArray(r.sales_order) ? (r.sales_order[0] ?? null) : r.sales_order;
      const b = budgetOf.get(lockerId);
      out[docId] = orderLockMessage({
        reNo: so?.order_number ?? null,
        budgetCode: b?.code ?? null,
        approvedAt: b?.decided_at ?? null,
      });
    }
    return out;
  } catch (e) {
    console.error("[order-locks]", e instanceof Error ? e.message : e);
    return {};
  }
}
