/**
 * ORDERS ▸ SEASON REPORT — the rules, pure and client-safe.
 *
 * The page filters by season and year on the server; the screen narrows by
 * status and draws charts from these. Both read THIS file, so the numbers on a
 * tile and the rows in the table beneath it cannot come from two rules.
 * `scripts/check-season-report.mts` pins every rule below.
 */

import type { Fulfilment, SeasonFabric, SeasonOrder } from "./types";
import { FULFILMENT_ORDER } from "./types";

/** Trim + upper-case — the comparison every season test in this app makes
 *  (`lib/orders/styles/types.ts`), so a stored "Summer" matches "SUMMER". */
export const normSeason = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/** Does an order belong to the chosen season and year?
 *  `season` "" and `year` null each mean "any". An order with NO year never
 *  matches a chosen year — it is counted and said (`withoutYear`) instead. */
export function inSeason(
  o: { season: string | null; year: number | null },
  season: string,
  year: number | null,
): boolean {
  if (season && normSeason(o.season) !== normSeason(season)) return false;
  if (year != null && o.year !== year) return false;
  return true;
}

/** "Summer 2026", "Summer", "2026" or "All seasons". */
export function seasonLabel(season: string, year: number | null): string {
  const s = season.trim();
  const sTitle = s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
  if (sTitle && year != null) return `${sTitle} ${year}`;
  if (sTitle) return `${sTitle} · all years`;
  if (year != null) return `All seasons ${year}`;
  return "All seasons";
}

/**
 * Where an order stands, for a season.
 *
 * A RE already `shipped`/`closed` is shipped whatever the quantities say (a
 * short shipment closed out is finished business); otherwise it is shipped when
 * every piece has left. Any shipped piece short of that is PART shipped — it
 * still has a balance, so the "Pending / In-Progress" toggle must keep it.
 */
export function fulfilmentOf(i: {
  orderStatus: string | null;
  qty: number;
  shippedQty: number;
  producing: boolean;
}): Fulfilment {
  const st = (i.orderStatus ?? "").toLowerCase();
  if (st === "shipped" || st === "closed") return "shipped";
  if (i.qty > 0 && i.shippedQty >= i.qty) return "shipped";
  if (i.shippedQty > 0) return "partial";
  if (st === "in_production" || i.producing) return "in_production";
  return "pending";
}

export type StatusToggles = { shipped: boolean; pending: boolean };

/** `Shipped Orders` keeps the shipped ones; `Pending / In-Progress` keeps the
 *  rest (part shipped included — they carry a balance). Both off shows nothing,
 *  on purpose: that is what two unticked boxes say. */
export function byStatus(orders: readonly SeasonOrder[], t: StatusToggles): SeasonOrder[] {
  return orders.filter((o) => (o.fulfilment === "shipped" ? t.shipped : t.pending));
}

export type Totals = {
  orders: number;
  customers: number;
  qty: number;
  shippedQty: number;
  balanceQty: number;
  /** Shipped share of the pieces, 0–100, one decimal. 0 when there are none. */
  shippedPct: number;
  late: number;
  atRisk: number;
};

export function totalsOf(orders: readonly SeasonOrder[]): Totals {
  let qty = 0;
  let shippedQty = 0;
  let balanceQty = 0;
  let late = 0;
  let atRisk = 0;
  const customers = new Set<string>();
  for (const o of orders) {
    qty += o.qty;
    shippedQty += Math.min(o.shippedQty, o.qty);
    balanceQty += o.balanceQty;
    if (o.customer) customers.add(o.customer);
    if (o.riskLevel === "late") late++;
    else if (o.riskLevel === "at_risk") atRisk++;
  }
  return {
    orders: orders.length,
    customers: customers.size,
    qty,
    shippedQty,
    balanceQty,
    shippedPct: qty > 0 ? Math.round((shippedQty / qty) * 1000) / 10 : 0,
    late,
    atRisk,
  };
}

/** Pieces per fulfilment state, in the ring's order. */
export function ringSegments(orders: readonly SeasonOrder[]): { key: Fulfilment; qty: number; orders: number }[] {
  return FULFILMENT_ORDER.map((key) => {
    const mine = orders.filter((o) => o.fulfilment === key);
    return { key, qty: mine.reduce((s, o) => s + o.qty, 0), orders: mine.length };
  });
}

export type CustomerRow = { customer: string; orders: number; qty: number; shippedQty: number };

/** Buyers ranked by pieces committed. Orders with no customer group together. */
export function byCustomer(orders: readonly SeasonOrder[]): CustomerRow[] {
  const m = new Map<string, CustomerRow>();
  for (const o of orders) {
    const k = o.customer ?? "(no customer)";
    const r = m.get(k) ?? { customer: k, orders: 0, qty: 0, shippedQty: 0 };
    r.orders++;
    r.qty += o.qty;
    r.shippedQty += Math.min(o.shippedQty, o.qty);
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty || a.customer.localeCompare(b.customer));
}

export type MonthRow = { month: string; orders: number; qty: Record<Fulfilment, number> };

/** Pieces by delivery month (YYYY-MM), oldest first; undated orders last under "". */
export function byDeliveryMonth(orders: readonly SeasonOrder[]): MonthRow[] {
  const m = new Map<string, MonthRow>();
  for (const o of orders) {
    const k = o.deliveryDate ? o.deliveryDate.slice(0, 7) : "";
    const r =
      m.get(k) ?? { month: k, orders: 0, qty: { shipped: 0, partial: 0, in_production: 0, pending: 0 } };
    r.orders++;
    r.qty[o.fulfilment] += o.qty;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => (a.month === "" ? 1 : b.month === "" ? -1 : a.month.localeCompare(b.month)));
}

/** The next delivery still to make (not shipped), on or after `today`; else the
 *  oldest overdue one. Null when nothing is open. */
export function nextDelivery(
  orders: readonly SeasonOrder[],
  today: string,
): { order: SeasonOrder; days: number } | null {
  const open = orders.filter((o) => o.fulfilment !== "shipped" && o.deliveryDate);
  if (!open.length) return null;
  const upcoming = open.filter((o) => (o.deliveryDate as string) >= today).sort(byDate);
  const pick = upcoming[0] ?? [...open].sort(byDate)[0];
  return { order: pick, days: daysUntil(pick.deliveryDate as string, today) };
}

/** Whole days from `today` to `date` — negative once it has passed. One rule
 *  for the tile, the card and the table, so none of them can call the same
 *  order "late" while another says "due today". */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
const byDate = (a: SeasonOrder, b: SeasonOrder) => (a.deliveryDate as string).localeCompare(b.deliveryDate as string);

/** Years offered beside the ones orders carry: last year → two ahead, so an
 *  order for next season can be booked and found before any carries it. */
export function yearWindow(thisYear: number, present: readonly number[]): number[] {
  const out = new Set<number>(present);
  for (let y = thisYear - 1; y <= thisYear + 2; y++) out.add(y);
  return [...out].sort((a, b) => a - b);
}

/**
 * The fabric a season order still has to receive.
 *
 * `received` comes only from fabric lines bought in KILOGRAMS: the Fabric BOM's
 * requirement is kilograms (0562), and subtracting metres or rolls from it would
 * print a balance that is arithmetic and not true. A mixed order answers NULL
 * with the reason. The balance never goes negative — over-receipt is not a
 * shortfall of the opposite sign.
 */
export function fabricBalance(i: {
  requiredKg: number | null;
  receivedKg: number;
  otherUnitLines: number;
  hasFabricLines: boolean;
  refusedRows: number;
}): SeasonFabric {
  if (i.requiredKg == null) {
    return { requiredKg: null, receivedKg: null, balanceKg: null, note: "No Fabric BOM yet" };
  }
  const notes: string[] = [];
  if (i.refusedRows > 0) notes.push(`${i.refusedRows} requirement row${i.refusedRows === 1 ? "" : "s"} not worked out yet`);
  if (i.otherUnitLines > 0) {
    notes.push("fabric bought in a unit other than kg — receipt not counted");
    return { requiredKg: i.requiredKg, receivedKg: null, balanceKg: null, note: notes.join(" · ") };
  }
  const received = i.hasFabricLines ? i.receivedKg : 0;
  return {
    requiredKg: i.requiredKg,
    receivedKg: received,
    balanceKg: Math.max(0, Math.round((i.requiredKg - received) * 1000) / 1000),
    note: notes.length ? notes.join(" · ") : i.hasFabricLines ? null : "No fabric purchased yet",
  };
}

