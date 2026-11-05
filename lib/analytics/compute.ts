/**
 * ANALYTICS ▸ THE ARITHMETIC (Phase 1, user 2026-11-05). Pure and client-safe, so
 * `scripts/check-analytics.mts` can pin every rule below with vectors.
 *
 * Every board answers one question over one period and ends in a list to act on.
 * The rules that are easy to get quietly wrong, each stated once here:
 *
 *  - AN UNPRICED ORDER IS COUNTED, NEVER VALUED AT ZERO. Its pieces count, its
 *    value is unknown, and the board says how many orders that is — a total that
 *    silently left one out would read as a smaller order book.
 *  - MARGIN IS WEIGHTED BY INCOME. The average of 36% on ₹16 L and 2% on ₹10 L is
 *    not 19%; the business made Σ profit ÷ Σ income.
 *  - A PO IS LATE when its expected date has passed and quantity is still to come,
 *    or when its last receipt landed after the expected date. A PO with no expected
 *    date is neither on time nor late — it is left out of the rate, not counted good.
 *  - STOCK VALUE IS ONLY SUMMED WHERE IT IS A VALUE. With quantity access only, the
 *    board counts lots: kilos and pieces do not add.
 */

import type { Period } from "./period";
import { inRange } from "./period";

export type Ranked = { key: string; label: string; value: number; href?: string };

export function addTo(m: Map<string, Ranked>, key: string, label: string, v: number, href?: string) {
  const cur = m.get(key);
  if (cur) cur.value += v;
  else m.set(key, { key, label, value: v, href });
}

/** Largest first; past `max` rows the tail folds into one "Others (n)" row. */
export function topWithOthers(rows: Iterable<Ranked>, max = 6): Ranked[] {
  const sorted = [...rows].filter((r) => r.value !== 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  return [...head, { key: "__others", label: `Others (${tail.length})`, value: tail.reduce((a, r) => a + r.value, 0) }];
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthKey = (iso: string) => iso.slice(0, 7);
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Orders & Buyers
// ---------------------------------------------------------------------------

export type OrderIn = {
  id: string;
  reNo: string;
  buyerId: string | null;
  buyer: string;
  merchandiser: string;
  season: string;
  orderDate: string;
  deliveryDate: string | null;
  valueInr: number | null;
  qty: number;
};

export type OrderTotals = { value: number; orders: number; pieces: number; unpriced: number };

export function orderTotals(rows: readonly OrderIn[]): OrderTotals {
  let value = 0, pieces = 0, unpriced = 0;
  for (const r of rows) {
    if (r.valueInr == null) unpriced++;
    else value += r.valueInr;
    pieces += r.qty;
  }
  return { value, orders: rows.length, pieces, unpriced };
}

export function ordersBoard(all: readonly OrderIn[], period: Period, todayIso: string, buyerId?: string | null) {
  const pick = (r: { from: string | null; to: string | null }) =>
    all.filter((o) => inRange(o.orderDate, r) && (!buyerId || o.buyerId === buyerId));
  const rows = pick(period);
  const prev = period.prev ? orderTotals(pick(period.prev)) : null;

  const byBuyer = new Map<string, Ranked>();
  const bySeason = new Map<string, Ranked>();
  const byMonth = new Map<string, number>();
  for (const o of rows) {
    addTo(byBuyer, o.buyerId ?? "none", o.buyer, o.valueInr ?? 0, o.buyerId ? `?buyer=${o.buyerId}` : undefined);
    addTo(bySeason, o.season, o.season, o.qty);
    if (o.deliveryDate) byMonth.set(monthKey(o.deliveryDate), (byMonth.get(monthKey(o.deliveryDate)) ?? 0) + o.qty);
  }
  const horizon = new Date(Date.parse(todayIso) + 30 * 86_400_000).toISOString().slice(0, 10);
  const shippingSoon = all
    .filter((o) => o.deliveryDate && o.deliveryDate >= todayIso && o.deliveryDate <= horizon && (!buyerId || o.buyerId === buyerId))
    .sort((a, b) => (a.deliveryDate! < b.deliveryDate! ? -1 : 1));
  const overdue = all.filter((o) => o.deliveryDate && o.deliveryDate < todayIso && (!buyerId || o.buyerId === buyerId)).length;
  const week = new Date(Date.parse(todayIso) + 7 * 86_400_000).toISOString().slice(0, 10);
  const byMerch = new Map<string, Ranked>();
  let pricedValue = 0, pricedPieces = 0;
  for (const o of rows) {
    addTo(byMerch, o.merchandiser, o.merchandiser, 1);
    if (o.valueInr != null) {
      pricedValue += o.valueInr;
      pricedPieces += o.qty;
    }
  }

  return {
    totals: orderTotals(rows),
    prev,
    byBuyer: topWithOthers(byBuyer.values()),
    bySeason: topWithOthers(bySeason.values(), 5),
    byDeliveryMonth: [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => ({ key: k, label: monthLabel(k), value: v })),
    shippingSoon,
    shipsThisWeek: shippingSoon.filter((o) => o.deliveryDate! <= week),
    overdue,
    notPriced: rows.filter((o) => o.valueInr == null),
    byMerchandiser: topWithOthers(byMerch.values(), 6),
    /** ₹ per piece over the orders that carry a price — an unpriced order's pieces would drag it down. */
    avgPerPiece: pricedPieces > 0 ? pricedValue / pricedPieces : null,
  };
}

// ---------------------------------------------------------------------------
// Profitability
// ---------------------------------------------------------------------------

export type BudgetIn = {
  id: string;
  code: string;
  status: "submitted" | "approved";
  budgetDate: string;
  reNos: string[];
  buyers: string[];
  income: number | null;
  profit: number | null;
  marginPct: number | null;
};

export const LOW_MARGIN_PCT = 5;

/** Σ profit ÷ Σ income over the budgets whose both figures are known. */
export function weightedMargin(rows: readonly BudgetIn[]): number | null {
  let inc = 0, pro = 0;
  for (const r of rows) {
    if (r.income == null || r.profit == null || r.income <= 0) continue;
    inc += r.income;
    pro += r.profit;
  }
  return inc > 0 ? (pro / inc) * 100 : null;
}

export const MARGIN_BANDS = [
  { key: "loss", label: "Loss", test: (p: number) => p < 0 },
  { key: "low", label: "0–5%", test: (p: number) => p >= 0 && p < 5 },
  { key: "mid", label: "5–15%", test: (p: number) => p >= 5 && p < 15 },
  { key: "good", label: "15–30%", test: (p: number) => p >= 15 && p < 30 },
  { key: "high", label: "30%+", test: (p: number) => p >= 30 },
] as const;

export function profitBoard(all: readonly BudgetIn[], period: Period) {
  const rows = all.filter((b) => inRange(b.budgetDate, period));
  const prevRows = period.prev ? all.filter((b) => inRange(b.budgetDate, period.prev!)) : null;
  const known = rows.filter((b) => b.marginPct != null);

  const byBuyer = new Map<string, { inc: number; pro: number }>();
  for (const b of rows) {
    if (b.income == null || b.profit == null) continue;
    const name = b.buyers.length === 1 ? b.buyers[0] : b.buyers.length ? "Several buyers" : "No buyer";
    const cur = byBuyer.get(name) ?? { inc: 0, pro: 0 };
    cur.inc += b.income;
    cur.pro += b.profit;
    byBuyer.set(name, cur);
  }

  return {
    margin: weightedMargin(rows),
    prevMargin: prevRows ? weightedMargin(prevRows) : null,
    profit: rows.reduce((a, b) => a + (b.profit ?? 0), 0),
    income: rows.reduce((a, b) => a + (b.income ?? 0), 0),
    /** Income less profit over the budgets whose both figures are known — the cost side of the rupee. */
    expenses: rows.reduce((a, b) => a + (b.income != null && b.profit != null ? b.income - b.profit : 0), 0),
    budgets: rows.length,
    unknown: rows.length - known.length,
    low: known.filter((b) => b.marginPct! < LOW_MARGIN_PCT).sort((a, b) => a.marginPct! - b.marginPct!),
    withMd: rows.filter((b) => b.status === "submitted").length,
    byBudget: [...known].sort((a, b) => b.marginPct! - a.marginPct!),
    byBuyer: [...byBuyer.entries()]
      .filter(([, v]) => v.inc > 0)
      .map(([k, v]) => ({ key: k, label: k, value: (v.pro / v.inc) * 100 }))
      .sort((a, b) => b.value - a.value),
    bands: MARGIN_BANDS.map((band) => ({ key: band.key, label: band.label, value: known.filter((b) => band.test(b.marginPct!)).length })),
  };
}

// ---------------------------------------------------------------------------
// Purchase & Vendors
// ---------------------------------------------------------------------------

export type PoIn = {
  id: string;
  /** False while waiting approval: shown in the pipeline, never counted as spend. */
  placed: boolean;
  status: string;
  code: string;
  vendor: string;
  orderDate: string;
  expectedDate: string | null;
  value: number;
  receivedValue: number;
  openQty: number;
  overBudgetReason: string | null;
  byClass: Map<string, number>;
  lastGrn: string | null;
  receivedQty: number;
  rejectedQty: number;
};

export type PoTiming = { state: "on_time" | "late" | "open" | "undated"; daysLate: number };

/** See the header: late = past expected with qty to come, or last receipt after it. */
export function poTiming(p: PoIn, todayIso: string): PoTiming {
  if (!p.expectedDate) return { state: "undated", daysLate: 0 };
  const exp = p.expectedDate.slice(0, 10);
  if (p.openQty > 0) {
    if (todayIso > exp) return { state: "late", daysLate: daysBetween(exp, todayIso) };
    return { state: "open", daysLate: 0 };
  }
  if (p.lastGrn && p.lastGrn.slice(0, 10) > exp) return { state: "late", daysLate: daysBetween(exp, p.lastGrn) };
  return { state: "on_time", daysLate: 0 };
}

export type PoStage = "waiting" | "none_in" | "part" | "received" | "closed";
export const PO_STAGES: { key: PoStage; label: string }[] = [
  { key: "waiting", label: "Waiting approval" },
  { key: "none_in", label: "Approved, nothing in" },
  { key: "part", label: "Part received" },
  { key: "received", label: "Fully received" },
  { key: "closed", label: "Closed" },
];

export function purchaseBoard(all: readonly PoIn[], period: Period, todayIso: string) {
  const inPeriod = all.filter((p) => inRange(p.orderDate, period));
  const rows = inPeriod.filter((p) => p.placed);
  const prevValue = period.prev ? all.filter((p) => p.placed && inRange(p.orderDate, period.prev!)).reduce((a, p) => a + p.value, 0) : null;

  /* THE PIPELINE: every PO in the period by how far it has got. One stage each, in order. */
  const stage = (p: PoIn): PoStage =>
    !p.placed ? "waiting" : p.status === "closed" ? "closed" : p.openQty <= 0 ? "received" : p.receivedValue > 0 ? "part" : "none_in";
  const pipeline = PO_STAGES.map((st) => {
    const list = inPeriod.filter((p) => stage(p) === st.key);
    return { ...st, count: list.length, value: list.reduce((a, p) => a + p.value, 0), items: list.map((p) => p.value) };
  });

  let value = 0, received = 0, recQty = 0, rejQty = 0, onTime = 0, decided = 0;
  const vendors = new Map<string, { received: number; open: number }>();
  const classes = new Map<string, Ranked>();
  const lateDays = new Map<string, { sum: number; n: number }>();
  const attention: { po: PoIn; why: "over_budget" | "late"; daysLate: number }[] = [];

  for (const p of rows) {
    value += p.value;
    const rec = Math.min(p.receivedValue, p.value || p.receivedValue);
    received += rec;
    recQty += p.receivedQty;
    rejQty += p.rejectedQty;
    const v = vendors.get(p.vendor) ?? { received: 0, open: 0 };
    v.received += rec;
    v.open += Math.max(0, p.value - rec);
    vendors.set(p.vendor, v);
    for (const [cls, amt] of p.byClass) addTo(classes, cls, cls, amt);

    const t = poTiming(p, todayIso);
    if (t.state === "on_time" || t.state === "late") {
      decided++;
      if (t.state === "on_time") onTime++;
      const d = lateDays.get(p.vendor) ?? { sum: 0, n: 0 };
      d.sum += t.daysLate;
      d.n++;
      lateDays.set(p.vendor, d);
    }
    if (p.overBudgetReason) attention.push({ po: p, why: "over_budget", daysLate: t.daysLate });
    else if (t.state === "late" && p.openQty > 0) attention.push({ po: p, why: "late", daysLate: t.daysLate });
  }

  const vendorRows = [...vendors.entries()]
    .map(([k, v]) => ({ key: k, label: k, received: v.received, open: v.open, total: v.received + v.open }))
    .sort((a, b) => b.total - a.total);

  return {
    value,
    prevValue,
    pipeline,
    pos: rows.length,
    received,
    receivedPct: value > 0 ? (received / value) * 100 : null,
    openValue: Math.max(0, value - received),
    onTimePct: decided > 0 ? (onTime / decided) * 100 : null,
    decided,
    rejectedPct: recQty > 0 ? (rejQty / recQty) * 100 : null,
    vendors: vendorRows,
    byClass: topWithOthers(classes.values(), 6),
    avgLateByVendor: [...lateDays.entries()]
      .map(([k, d]) => ({ key: k, label: k, value: d.sum / d.n }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value),
    attention: attention.sort((a, b) => (a.why === b.why ? b.daysLate - a.daysLate : a.why === "over_budget" ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export type LotIn = {
  key: string;
  item: string;
  item_class: string;
  store: string;
  bin: string;
  lot: string;
  age_days: number;
  band: "0-30" | "31-60" | "61-90" | "90+";
  group_kind: "re" | "swo" | "iwo" | "general";
  order_no: string;
  qty: number;
  uom: string;
  /** Present only with value access. */
  value?: number;
};

export const STOCK_BANDS = ["0-30", "31-60", "61-90", "90+"] as const;

export function stockBoard(lots: readonly LotIn[], withValue: boolean) {
  const measure = (l: LotIn) => (withValue ? (l.value ?? 0) : 1);
  let total = 0, old = 0, general = 0;
  const classBands = new Map<string, number[]>();
  const owners = new Map<string, number>();
  const stores = new Map<string, Ranked>();
  for (const l of lots) {
    const m = measure(l);
    total += m;
    if (l.band === "90+") old += m;
    if (l.group_kind === "general") general += m;
    const bands = classBands.get(l.item_class) ?? [0, 0, 0, 0];
    bands[STOCK_BANDS.indexOf(l.band)] += m;
    classBands.set(l.item_class, bands);
    owners.set(l.group_kind, (owners.get(l.group_kind) ?? 0) + m);
    addTo(stores, l.store, l.store, m);
  }
  return {
    total,
    old,
    oldPct: total > 0 ? (old / total) * 100 : null,
    general,
    byClass: [...classBands.entries()]
      .map(([k, b]) => ({ key: k, label: k, bands: b, total: b.reduce((a, x) => a + x, 0) }))
      .sort((a, b) => b.total - a.total),
    owners,
    byStore: topWithOthers(stores.values(), 6),
    oldLots: lots.filter((l) => l.band === "90+").sort((a, b) => measure(b) - measure(a) || b.age_days - a.age_days),
  };
}

// ---------------------------------------------------------------------------
// Delivery & T&A
// ---------------------------------------------------------------------------

export type StepIn = {
  orderId: string | null;
  reNo: string;
  buyer: string;
  deliveryDate: string | null;
  source: "Work flow" | "T&A";
  label: string;
  target: string;
  actual: string | null;
  owner: string;
};

/**
 * A STEP IS ON TIME when it was done on or before its target; LATE when it was done
 * after it, or is still not done with the target behind us. A step not done and not
 * yet due is neither, and stays out of the on-time rate (same rule as a PO).
 */
export type StepState = "on_time" | "done_late" | "late_open" | "upcoming";

export function stepState(s: StepIn, todayIso: string): { state: StepState; daysLate: number } {
  const target = s.target.slice(0, 10);
  if (s.actual) {
    const a = s.actual.slice(0, 10);
    return a > target ? { state: "done_late", daysLate: daysBetween(target, a) } : { state: "on_time", daysLate: 0 };
  }
  return todayIso > target ? { state: "late_open", daysLate: daysBetween(target, todayIso) } : { state: "upcoming", daysLate: 0 };
}

export type Lane = {
  key: string;
  orderId: string | null;
  reNo: string;
  buyer: string;
  deliveryDate: string | null;
  steps: { label: string; target: string; state: StepState }[];
  late: number;
};

export function deliveryBoard(all: readonly StepIn[], period: Period, todayIso: string) {
  const rows = all.filter((s) => inRange(s.target, period));
  const horizon = new Date(Date.parse(todayIso) + 30 * 86_400_000).toISOString().slice(0, 10);

  let onTime = 0, decided = 0, delaySum = 0, delayN = 0;
  const bySteps = new Map<string, { onTime: number; late: number }>();
  const byOwner = new Map<string, Ranked>();
  const lateOpen: (StepIn & { daysLate: number; shipsSoon: boolean })[] = [];
  const riskOrders = new Set<string>();

  for (const s of rows) {
    const { state, daysLate } = stepState(s, todayIso);
    if (state === "upcoming") continue;
    decided++;
    const cur = bySteps.get(s.label) ?? { onTime: 0, late: 0 };
    if (state === "on_time") {
      onTime++;
      cur.onTime++;
    } else {
      cur.late++;
      delaySum += daysLate;
      delayN++;
    }
    bySteps.set(s.label, cur);
    if (state === "late_open") {
      const shipsSoon = !!s.deliveryDate && s.deliveryDate <= horizon;
      lateOpen.push({ ...s, daysLate, shipsSoon });
      addTo(byOwner, s.owner, s.owner, 1);
      if (shipsSoon) riskOrders.add(s.orderId ?? s.reNo);
    }
  }

  /* THE RUNWAY: one lane per open order — every dated step, wherever its target falls, up to
     the delivery flag. An order already shipped past its date with nothing open drops out. */
  const lanes = new Map<string, Lane>();
  for (const s of all) {
    const key = s.orderId ?? s.reNo;
    const lane = lanes.get(key) ?? { key, orderId: s.orderId, reNo: s.reNo, buyer: s.buyer, deliveryDate: s.deliveryDate, steps: [], late: 0 };
    const st = stepState(s, todayIso);
    lane.steps.push({ label: s.label, target: s.target.slice(0, 10), state: st.state });
    if (st.state === "late_open") lane.late++;
    lanes.set(key, lane);
  }
  const runway = [...lanes.values()]
    .filter((l) => l.late > 0 || l.steps.some((x) => x.state === "upcoming") || (l.deliveryDate ?? "") >= todayIso)
    .map((l) => ({ ...l, steps: l.steps.sort((a, b) => (a.target < b.target ? -1 : 1)), atRisk: l.late > 0 && !!l.deliveryDate && l.deliveryDate <= horizon }))
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.late - a.late || (a.deliveryDate ?? "9") .localeCompare(b.deliveryDate ?? "9"));

  return {
    runway,
    onTimePct: decided > 0 ? (onTime / decided) * 100 : null,
    decided,
    lateNow: lateOpen.length,
    lateOrders: new Set(lateOpen.map((s) => s.orderId ?? s.reNo)).size,
    atRisk: riskOrders.size,
    avgDelay: delayN > 0 ? delaySum / delayN : null,
    bySteps: [...bySteps.entries()]
      .map(([k, v]) => ({ key: k, label: k, parts: [v.onTime, v.late], late: v.late }))
      .sort((a, b) => b.late - a.late || b.parts[0] - a.parts[0]),
    byOwner: topWithOthers(byOwner.values(), 6),
    lateOpen: lateOpen.sort((a, b) => Number(b.shipsSoon) - Number(a.shipsSoon) || b.daysLate - a.daysLate),
  };
}

// ---------------------------------------------------------------------------
// Samples & Enquiries
// ---------------------------------------------------------------------------

export type EnquiryIn = {
  id: string;
  code: string;
  title: string;
  buyer: string;
  merchandiser: string;
  received: string;
  costing: { id: string; status: "draft" | "submitted" | "approved" | "rejected"; firstAt: string; submittedAt: string | null; marginPct: number | null } | null;
  becameOrder: boolean;
};

/**
 * EACH FUNNEL STEP COUNTS ENQUIRIES THAT GOT AT LEAST THAT FAR, so the bars only ever
 * shrink: an approved costing was also costed and also submitted. "Became an order"
 * reads `sales_orders.opportunity_id` and nothing else — an order typed without
 * naming its enquiry cannot be counted, and the board says so rather than guessing.
 */
export function samplesBoard(all: readonly EnquiryIn[], period: Period, todayIso: string) {
  const rows = all.filter((e) => inRange(e.received, period));
  const costed = rows.filter((e) => e.costing);
  const sent = costed.filter((e) => e.costing!.status !== "draft");
  const approved = costed.filter((e) => e.costing!.status === "approved");
  const orders = rows.filter((e) => e.becameOrder);

  const days = costed.map((e) => daysBetween(e.received, e.costing!.firstAt)).filter((d) => d >= 0);
  const byBuyer = new Map<string, { n: number; won: number }>();
  for (const e of rows) {
    const cur = byBuyer.get(e.buyer) ?? { n: 0, won: 0 };
    cur.n++;
    if (e.costing?.status === "approved" || e.becameOrder) cur.won++;
    byBuyer.set(e.buyer, cur);
  }
  const status = (s: "draft" | "submitted" | "approved" | "rejected") => costed.filter((e) => e.costing!.status === s).length;
  const merch = new Map<string, { sum: number; n: number }>();
  for (const e of costed) {
    const d = daysBetween(e.received, e.costing!.firstAt);
    if (d < 0) continue;
    const m = merch.get(e.merchandiser) ?? { sum: 0, n: 0 };
    m.sum += d;
    m.n++;
    merch.set(e.merchandiser, m);
  }

  return {
    enquiries: rows.length,
    costed: costed.length,
    approved: approved.length,
    orders: orders.length,
    avgDaysToCosting: days.length ? days.reduce((a, d) => a + d, 0) / days.length : null,
    funnel: [
      { key: "enq", label: "Enquiry", value: rows.length },
      { key: "costed", label: "Costed", value: costed.length },
      { key: "sent", label: "Costing submitted", value: sent.length },
      { key: "approved", label: "Costing approved", value: approved.length },
      { key: "order", label: "Became an order", value: orders.length },
    ],
    byBuyer: [...byBuyer.entries()]
      .map(([k, v]) => ({ key: k, label: `${k} (${v.won}/${v.n})`, value: (v.won / v.n) * 100 }))
      .sort((a, b) => b.value - a.value),
    states: { draft: status("draft"), submitted: status("submitted"), approved: status("approved"), rejected: status("rejected"), none: rows.length - costed.length },
    waiting: rows
      .filter((e) => e.costing?.status === "submitted")
      .map((e) => ({ ...e, waitingDays: e.costing!.submittedAt ? Math.max(0, daysBetween(e.costing!.submittedAt, todayIso)) : null }))
      .sort((a, b) => (b.waitingDays ?? 0) - (a.waitingDays ?? 0)),
    notCosted: rows.filter((e) => !e.costing).sort((a, b) => (a.received < b.received ? -1 : 1)),
    daysByMerchandiser: [...merch.entries()].map(([k, v]) => ({ key: k, label: k, value: v.sum / v.n })).sort((a, b) => a.value - b.value),
  };
}

// ---------------------------------------------------------------------------
// People & Workplace
// ---------------------------------------------------------------------------

export type TicketIn = { id: string; refNo: string; kind: string; title: string; status: string; createdAt: string; late: boolean };

/** What still owes work, per kind of ticket — the Resolve Hub's own lists (lib/resolve/types.ts). */
export const TICKET_ACTIVE: Record<string, readonly string[]> = {
  broken: ["open", "in_progress", "blocked", "fixed"],
  complaint: ["open", "assigned", "in_progress", "escalated"],
  service: ["open", "assigned", "in_progress", "on_hold"],
  requirement: ["open", "approved"],
};
export const TICKET_KIND_LABEL: Record<string, string> = {
  broken: "Repair",
  complaint: "Complaint",
  service: "IT help",
  requirement: "Something to buy",
};
export const TICKET_AGE = ["Under 3 days", "3–7 days", "Over 7 days"] as const;

export function openTickets(all: readonly TicketIn[], todayIso: string) {
  const open = all.filter((t) => (TICKET_ACTIVE[t.kind] ?? []).includes(t.status));
  const byKind = new Map<string, number[]>();
  for (const t of open) {
    const age = daysBetween(t.createdAt, todayIso);
    const b = byKind.get(t.kind) ?? [0, 0, 0];
    b[age < 3 ? 0 : age <= 7 ? 1 : 2]++;
    byKind.set(t.kind, b);
  }
  return {
    open: open.length,
    late: open.filter((t) => t.late).length,
    byKind: [...byKind.entries()].map(([k, parts]) => ({ key: k, label: TICKET_KIND_LABEL[k] ?? k, parts })),
    oldest: [...open].sort((a, b) => Number(b.late) - Number(a.late) || (a.createdAt < b.createdAt ? -1 : 1)),
  };
}

/** Approved leave covering today — "who is off". */
export function onLeaveToday(rows: readonly { status: string; start: string; end: string }[], todayIso: string): number {
  return rows.filter((r) => r.status === "approved" && r.start <= todayIso && (r.end || r.start) >= todayIso).length;
}
