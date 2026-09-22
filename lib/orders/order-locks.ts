import "server-only";
import { createClient } from "@/lib/supabase/server";
import { orderLockMessage } from "@/lib/orders/budget/amendment";
import {
  amendmentBanner,
  areaOpen,
  outOfScopeMessage,
  scopeFromJson,
  type AmendmentArea,
  type OrderAmendmentState,
} from "@/lib/orders/amendments/amendment-entry";

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
 * This is display only. The write path fails CLOSED (`assertOrderWritable`,
 * then the triggers), so an unreadable lock here costs a banner, never a
 * write. Failing the whole page over a banner would take the editor down with
 * it, which is the worse trade.
 *
 * ## THE THIRD STATE (0604 · 0616): `amending`
 *
 * An order under an open Amendment Entry is not in this map by default — it
 * is writable, in the entry's scope. Pass `area` and the map ALSO carries the
 * amending orders whose entry does NOT open that document, with the
 * out-of-scope sentence: a Fabric BOM under a Price Change amendment reads as
 * locked with the entry named, and under a BOM Revision reads as open. The
 * Order Entry editor asks `orderAmendmentStates` instead, because it unlocks
 * PARTS of itself (`UnlockScope`) rather than all or nothing.
 */
export async function orderLockMessages(
  /** Omit for every approved order — they are few, and the list screens need all. */
  orderIds?: readonly string[],
  /** The document the caller edits; adds the amending orders it is closed on. */
  area?: AmendmentArea,
): Promise<Record<string, string>> {
  if (orderIds && orderIds.length === 0) return {};
  const scoped = area ? await amendingClosedOn(area, orderIds) : {};
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
    return { ...scoped, ...out };
  } catch (e) {
    console.error("[order-locks]", e instanceof Error ? e.message : e);
    return scoped;
  }
}

export type { OrderAmendmentState };

/**
 * Every AMENDING document, keyed by id, with its entry's frozen scope — the
 * Order Entry editor's half of the third state. Same grain as the lock: the
 * entry is on every document of the RE (`open_order_amendment` stamps them
 * all), so no sibling walk is needed here.
 *
 * Display only, like the lock map: a failed read shows no banner and unlocks
 * nothing — `assertOrderWritable` and the trigger still refuse.
 */
export async function orderAmendmentStates(
  orderIds?: readonly string[],
): Promise<Record<string, OrderAmendmentState>> {
  if (orderIds && orderIds.length === 0) return {};
  try {
    const s = await createClient();
    let q = s
      .from("garment_order_amendments")
      /* `!re_amendment_id`: the two tables point at each other (the entry's
         garment_order_id, the document's re_amendment_id), so a bare embed is
         the PGRST201 ambiguity AGENTS.md records. The COLUMN is named. */
      .select(
        "id, entry:order_budget_revisions!re_amendment_id(id, entry_no, amendment_type, amendment_types, scope)",
      )
      .eq("re_status", "amending");
    if (orderIds) q = q.in("id", [...orderIds]);
    const { data, error } = await q;
    if (error) {
      console.error("[order-locks] reading amending orders:", error.message);
      return {};
    }
    type Entry = {
      id: string;
      entry_no: string | null;
      amendment_type: string;
      amendment_types: string[] | null;
      scope: unknown;
    };
    const out: Record<string, OrderAmendmentState> = {};
    for (const r of (data ?? []) as unknown as { id: string; entry: Entry | Entry[] | null }[]) {
      const e = Array.isArray(r.entry) ? (r.entry[0] ?? null) : r.entry;
      if (!e) continue;
      const types = e.amendment_types?.length ? e.amendment_types : [e.amendment_type];
      const scope = scopeFromJson(e.scope);
      out[r.id] = {
        entryId: e.id,
        entryNo: e.entry_no,
        types,
        scope,
        banner: amendmentBanner({ entryNo: e.entry_no, types, scope }),
      };
    }
    return out;
  } catch (e) {
    console.error("[order-locks] amending:", e instanceof Error ? e.message : e);
    return {};
  }
}

/** The amending orders whose entry does NOT open `area`, with the refusal. */
async function amendingClosedOn(
  area: AmendmentArea,
  orderIds?: readonly string[],
): Promise<Record<string, string>> {
  const states = await orderAmendmentStates(orderIds);
  const out: Record<string, string> = {};
  for (const [id, st] of Object.entries(states)) {
    if (!areaOpen(st.scope, area)) out[id] = outOfScopeMessage(st, area);
  }
  return out;
}
