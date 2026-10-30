import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { salesValuesByOrder } from "@/lib/orders/budget/service";
import { addDays, today } from "./range";
import type { DashboardCaps } from "./types";

/**
 * THE BOARD — the figures behind the dashboard's ring row, its two order
 * charts, the buying bars and the insight strip (approved plan 2026-10-30,
 * artifact "Raagam Dashboard Redesign").
 *
 * Every ring is a SHARE OF A REAL WHOLE (73 late of 86 open), never progress
 * against a target: no sales or spend target is stored anywhere, and a ring
 * against an invented goal is the decoration the plan rules out.
 *
 * Each part is `null` when the viewer may not see it (left out of the page) and
 * `"error"` when its read failed — a failed query is shown as such, never as 0,
 * because "nothing late" is a real answer and must not be faked.
 *
 * Unit scoping is RLS's job (allocated units only), exactly as `getMiniStats`
 * reads `sales_orders`; nothing here filters by location by hand.
 */

type Part<T> = T | null | "error";

/** Statuses after which an order no longer carries work. */
const CLOSED = new Set(["closed", "cancelled", "shipped", "completed", "delivered"]);

export interface AgeBucket {
  label: string;
  orders: number;
  value: number;
}

export interface MonthLoad {
  /** `YYYY-MM`. */
  month: string;
  orders: number;
  value: number;
}

export interface OrderBoard {
  open: number;
  /** Open orders that carry a delivery date — the whole the late ring is a share of. */
  dated: number;
  late: number;
  due30: number;
  inProduction: number;
  qty: number;
  /** Order value of the open book; null when it spans currencies (a sum would be wrong). */
  value: number | null;
  currency: string | null;
  ageing: AgeBucket[];
  byMonth: MonthLoad[];
}

export interface PurchaseBoard {
  total: number;
  approved: number;
  pending: number;
  /** PO line value by item class, cancelled POs excluded, largest first. */
  byClass: { label: string; amount: number }[];
}

export interface Board {
  orders: Part<OrderBoard>;
  milestones: Part<{ done: number; total: number }>;
  purchase: Part<PurchaseBoard>;
  receivables: Part<{ open: number; collected: number }>;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const DAY_MS = 86_400_000;
const daysLate = (due: string, t: string) => Math.round((Date.parse(t) - Date.parse(due)) / DAY_MS);

const AGE_BUCKETS: { label: string; max: number }[] = [
  { label: "1–30", max: 30 },
  { label: "31–60", max: 60 },
  { label: "61–90", max: 90 },
  { label: "90+", max: Number.POSITIVE_INFINITY },
];

/**
 * An order's figures live in its ORDER ENTRY DOCUMENT (`garment_order_amendments`
 * + its style and price rows) since 0404; `sales_orders` is the shell that
 * carries the RE and the lifecycle status. Every order raised on Order Entry
 * has a blank date, qty and value on the shell, so reading the shell alone
 * showed Head Office "0 open, $0" beside five orders booked that hour
 * (screenshot 3858, 2026-10-30). The shell's own columns are used only for an
 * order that has no document — the older imported rows.
 *
 * Value comes from `salesValuesByOrder` — `orderValue()`, the Order Entry
 * screen's own function — and an order it cannot price makes the book's value
 * unknown rather than quietly smaller (that function's "NULL IS AN ANSWER").
 */
async function loadOrders(): Promise<Part<OrderBoard>> {
  const sb = await createClient();
  const [shells, docs, values] = await Promise.all([
    sb.from("sales_orders").select("id, status, delivery_date, order_qty, total_value, currency_code"),
    sb.from("garment_order_amendments").select("id, sales_order_id, delivery_date, currency_code, is_draft"),
    salesValuesByOrder(),
  ]);
  if (shells.error || docs.error || !values.ok) return "error";

  type Doc = { id: string; sales_order_id: string | null; delivery_date: string | null; currency_code: string | null; is_draft: boolean | null };
  const live = new Map<string, Doc>();
  const draftOnly = new Set<string>();
  for (const d of (docs.data ?? []) as Doc[]) {
    if (!d.sales_order_id) continue;
    if (d.is_draft) draftOnly.add(d.sales_order_id);
    else live.set(d.sales_order_id, d);
  }

  const t = today();
  const horizon = addDays(t, 30);
  const ageing = AGE_BUCKETS.map((b) => ({ label: b.label, orders: 0, value: 0 }));
  const months = new Map<string, MonthLoad>();
  const currencies = new Set<string>();
  let open = 0, dated = 0, late = 0, due30 = 0, inProduction = 0, qty = 0, value = 0;
  let unpriced = false;

  for (const so of shells.data ?? []) {
    if (CLOSED.has(String(so.status ?? "").toLowerCase())) continue;
    const doc = live.get(so.id);
    // A draft has no RE No yet (0700) — it is not part of the book.
    if (!doc && draftOnly.has(so.id)) continue;
    open++;
    if (so.status === "in_production") inProduction++;

    const facts = doc ? values.byOrder.get(doc.id) : undefined;
    const due = (doc ? doc.delivery_date : so.delivery_date) as string | null;
    const cur = (doc ? doc.currency_code : so.currency_code) as string | null;
    const v = doc ? (facts?.gross_value ?? null) : num(so.total_value);
    qty += doc ? (facts?.qty ?? 0) : num(so.order_qty);
    if (cur) currencies.add(cur.toUpperCase());
    if (v == null) unpriced = true;
    else value += v;

    if (!due) continue;
    dated++;
    const m = due.slice(0, 7);
    const slot = months.get(m) ?? { month: m, orders: 0, value: 0 };
    slot.orders++;
    slot.value += v ?? 0;
    months.set(m, slot);
    if (due < t) {
      late++;
      const b = ageing[AGE_BUCKETS.findIndex((x) => daysLate(due, t) <= x.max)];
      b.orders++;
      b.value += v ?? 0;
    } else if (due <= horizon) {
      due30++;
    }
  }

  // One currency and every order priced, or the value is not a number we can say.
  const single = currencies.size <= 1 && !unpriced;
  return {
    open,
    dated,
    late,
    due30,
    inProduction,
    qty,
    value: single ? value : null,
    currency: single ? ((currencies.values().next().value as string | undefined) ?? null) : null,
    ageing,
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

async function loadMilestones(): Promise<Part<{ done: number; total: number }>> {
  const sb = await createClient();
  const [all, done] = await Promise.all([
    sb.from("order_work_flow_milestones").select("id", { count: "exact", head: true }),
    sb.from("order_work_flow_milestones").select("id", { count: "exact", head: true }).eq("status", "done"),
  ]);
  if (all.error || done.error) return "error";
  return { done: done.count ?? 0, total: all.count ?? 0 };
}

async function loadPurchase(): Promise<Part<PurchaseBoard>> {
  const sb = await createClient();
  const [pos, lines] = await Promise.all([
    sb.from("purchase_orders").select("id, status"),
    sb.from("po_line_items").select("purchase_order_id, item_class, amount"),
  ]);
  if (pos.error || lines.error) return "error";

  const cancelled = new Set((pos.data ?? []).filter((p) => p.status === "cancelled").map((p) => p.id));
  const byClass = new Map<string, number>();
  for (const l of lines.data ?? []) {
    if (cancelled.has(l.purchase_order_id)) continue;
    const k = String(l.item_class ?? "Other");
    byClass.set(k, (byClass.get(k) ?? 0) + num(l.amount));
  }
  const live = (pos.data ?? []).filter((p) => p.status !== "cancelled");
  return {
    total: live.length,
    approved: live.filter((p) => p.status === "approved").length,
    pending: live.filter((p) => p.status === "pending_approval").length,
    byClass: [...byClass]
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

async function loadReceivables(): Promise<Part<{ open: number; collected: number }>> {
  const sb = await createClient();
  const { data, error } = await sb.from("receivables").select("amount_inr, received_fc, exchange_rate");
  if (error) return "error";
  const rows = data ?? [];
  return {
    open: rows.reduce((n, r) => n + num(r.amount_inr), 0),
    collected: rows.reduce((n, r) => n + num(r.received_fc) * (num(r.exchange_rate) || 1), 0),
  };
}

/** One read per request, shared by every board section on the page. */
export const getBoard = cache(async (caps: DashboardCaps): Promise<Board> => {
  const [orders, milestones, purchase, receivables] = await Promise.all([
    caps.orders ? loadOrders() : null,
    caps.orders ? loadMilestones() : null,
    caps.materials ? loadPurchase() : null,
    caps.finance ? loadReceivables() : null,
  ]);
  return { orders, milestones, purchase, receivables };
});
