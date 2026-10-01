import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { AppUser } from "@/lib/auth/types";
import { addDays, today } from "@/lib/calendar";
import { myStaff, staffNames } from "@/lib/people/order-people";

/**
 * SCORECARDS (user 2026-10-01, a child of Order Management) — how BUYERS,
 * SUPPLIERS and MERCHANDISERS perform, from documents the app already holds.
 * Nothing is stored: every figure is counted on read, so a corrected date
 * corrects the score.
 *
 * WHO SEES WHAT (user's choice, 2026-10-01: "Managers + own"). An Orders
 * approver or a Super Admin sees all three cards. Anyone else sees only the
 * Merchandisers card, and on it only their own row — a merchandiser's score is
 * a judgement about a person, and colleagues do not read each other's.
 *
 * A SCORE WITH NOTHING BEHIND IT IS SAID, NEVER ZERO. A rate is `{num, den}`
 * and a den of 0 renders as "—" with the reason, because 0% on-time for a
 * buyer who has had no shipments reads as a buyer who failed every one.
 * Shipments, buyer receipts, POs and GRNs were all empty on 2026-10-01; those
 * columns fill in the day the documents do.
 *
 * Only an order's CURRENT, non-draft version counts (the T&A Worklist's rule):
 * a superseded version's schedule was replaced, and counting both would score
 * one order twice.
 */

export type Rate = { num: number; den: number };
export type Period = "fy" | "90d" | "all";

export type MerchandiserRow = {
  key: string;
  staffId: string | null;
  name: string;
  orders: number;
  /** T&A tasks due in the period: finished by their target date / all due. */
  taOnTime: Rate;
  /** Due and still open today. */
  taOverdue: number;
  /** Buyer approvals due in the period: SENT by their target date / all due. */
  approvalsOnTime: Rate;
  revisions: number;
};

export type BuyerRow = {
  key: string;
  name: string;
  orders: number;
  revisions: number;
  /** Average days from sending a sample to the buyer's answer. */
  approvalDays: number | null;
  shipOnTime: Rate;
  /** Average days from invoice to the last receipt against it. */
  paymentDays: number | null;
};

export type SupplierRow = {
  key: string;
  name: string;
  pos: number;
  /** POs due in the period whose FIRST receipt came by the expected date / POs due. */
  onTime: Rate;
  received: number;
  rejected: number;
};

export type Scorecards = {
  period: Period;
  from: string;
  to: string;
  isManager: boolean;
  /** The viewer's own staff id — what "own row" means for a non-manager. */
  myStaffId: string | null;
  merchandisers: MerchandiserRow[];
  buyers: BuyerRow[] | null;
  suppliers: SupplierRow[] | null;
  /**
   * The summary tiles (managers only): the whole team's T&A on time, the
   * average buyer reply, shipped on time and supplier on time — each counted
   * over every row, not averaged over the rows' own percentages.
   */
  totals: { taOnTime: Rate; approvalDays: number | null; shipOnTime: Rate; supplierOnTime: Rate } | null;
  /** What has no data yet, said once above the table rather than in every cell. */
  emptySources: { shipments: boolean; receipts: boolean; purchaseOrders: boolean };
  errors: string[];
};

const NOT_ASSIGNED = "Not assigned";

/** The Indian financial year `iso` falls in starts on 1 April. */
function fyStart(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Days between two ISO dates (b − a). */
function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** `.in()` in slices, so a long id list never outgrows a request URL. */
async function inChunks<T>(ids: string[], run: (slice: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await run(ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function getScorecards(user: AppUser, period: Period): Promise<Scorecards> {
  const t = today();
  const from = period === "90d" ? addDays(t, -90) : period === "fy" ? fyStart(t) : "1900-01-01";
  const [canApprove, me] = await Promise.all([can("orders", "approve"), myStaff(user.id)]);
  const isManager = user.isSuperAdmin || canApprove;
  const s = await createClient();
  const errors: string[] = [];
  const inPeriod = (d: string | null) => !!d && d >= from && d <= t;

  /* ---- Every order version, then the current one per order. --------------- */
  type Amend = {
    id: string;
    sales_order_id: string | null;
    is_draft: boolean | null;
    amend_date: string | null;
    created_at: string | null;
    customer_id: string | null;
    merchandiser_id: string | null;
    delivery_date: string | null;
    customer: One<{ name: string | null }>;
  };
  const { data: amendData, error: amendErr } = await s
    .from("garment_order_amendments")
    .select("id, sales_order_id, is_draft, amend_date, created_at, customer_id, merchandiser_id, delivery_date, customer:customers(name)")
    .not("sales_order_id", "is", null);
  if (amendErr) throw new Error(`Could not read orders: ${amendErr.message}`);
  const amends = (amendData ?? []) as unknown as Amend[];
  const best = new Map<string, Amend>();
  const key = (a: Amend) => `${a.amend_date ?? ""}|${a.created_at ?? ""}`;
  for (const a of amends) {
    const prev = best.get(a.sales_order_id!);
    if (!prev || key(a) > key(prev)) best.set(a.sales_order_id!, a);
  }
  const current = [...best.values()].filter((a) => !a.is_draft);
  const currentIds = current.map((a) => a.id);
  const soOf = new Map(amends.map((a) => [a.id, a.sales_order_id!]));
  const currentBySo = new Map(current.map((a) => [a.sales_order_id!, a]));
  // "Orders in the period" = still to ship on or after its start.
  const activeOrders = current.filter((a) => !a.delivery_date || a.delivery_date >= from);

  /* ---- The documents scored, in parallel. --------------------------------- */
  const [taRows, apRows, revRows] = await Promise.all([
    inChunks<{ amendment_id: string; target_date: string | null; actual_date: string | null; status: string | null }>(currentIds, (ids) =>
      s.from("garment_order_amendment_ta_activities").select("amendment_id, target_date, actual_date, status").in("amendment_id", ids),
    ).catch((e: Error) => (errors.push(`T&A: ${e.message}`), [])),
    inChunks<{ amendment_id: string; target_date: string | null; actual_sent_date: string | null; actual_received_date: string | null }>(currentIds, (ids) =>
      s.from("garment_order_amendment_ta_approvals").select("amendment_id, target_date, actual_sent_date, actual_received_date").in("amendment_id", ids),
    ).catch((e: Error) => (errors.push(`Buyer approvals: ${e.message}`), [])),
    s
      .from("order_budget_revisions")
      .select("garment_order_id, reopened_at")
      .then(({ data, error }) => {
        if (error) errors.push(`Revisions: ${error.message}`);
        return (data ?? []) as { garment_order_id: string | null; reopened_at: string }[];
      }),
  ]);

  // A revision counts against the ORDER it was raised on, whichever version.
  const revBySo = new Map<string, number>();
  for (const r of revRows) {
    if (!r.garment_order_id || !inPeriod(r.reopened_at.slice(0, 10))) continue;
    const so = soOf.get(r.garment_order_id);
    if (so) revBySo.set(so, (revBySo.get(so) ?? 0) + 1);
  }
  const amendById = new Map(current.map((a) => [a.id, a]));

  /* ---- Merchandisers. ------------------------------------------------------ */
  const merch = new Map<string, MerchandiserRow>();
  const merchRow = (staffId: string | null) => {
    const k = staffId ?? "none";
    let r = merch.get(k);
    if (!r) {
      r = { key: k, staffId, name: NOT_ASSIGNED, orders: 0, taOnTime: { num: 0, den: 0 }, taOverdue: 0, approvalsOnTime: { num: 0, den: 0 }, revisions: 0 };
      merch.set(k, r);
    }
    return r;
  };
  for (const a of activeOrders) {
    const r = merchRow(a.merchandiser_id);
    r.orders++;
    r.revisions += revBySo.get(a.sales_order_id!) ?? 0;
  }
  for (const x of taRows) {
    const a = amendById.get(x.amendment_id);
    if (!a || !inPeriod(x.target_date)) continue;
    const r = merchRow(a.merchandiser_id);
    const doneOn = x.actual_date ?? null;
    r.taOnTime.den++;
    if (doneOn && doneOn <= x.target_date!) r.taOnTime.num++;
    if (!doneOn && x.status !== "done" && x.target_date! < t) r.taOverdue++;
  }
  for (const x of apRows) {
    const a = amendById.get(x.amendment_id);
    if (!a || !inPeriod(x.target_date)) continue;
    const r = merchRow(a.merchandiser_id);
    r.approvalsOnTime.den++;
    if (x.actual_sent_date && x.actual_sent_date <= x.target_date!) r.approvalsOnTime.num++;
  }
  const names = await staffNames([...merch.values()].map((r) => r.staffId)).catch(() => new Map<string, string>());
  for (const r of merch.values()) if (r.staffId) r.name = names.get(r.staffId) ?? "(removed staff)";
  const teamTa = [...merch.values()].reduce((a, r) => ({ num: a.num + r.taOnTime.num, den: a.den + r.taOnTime.den }), { num: 0, den: 0 });
  let merchandisers = [...merch.values()].sort((a, b) => (a.staffId ? 0 : 1) - (b.staffId ? 0 : 1) || a.name.localeCompare(b.name));
  if (!isManager) merchandisers = merchandisers.filter((r) => !!me && r.staffId === me.id);

  if (!isManager) {
    return {
      period, from, to: t, isManager, myStaffId: me?.id ?? null, merchandisers,
      buyers: null, suppliers: null, totals: null,
      emptySources: { shipments: false, receipts: false, purchaseOrders: false },
      errors,
    };
  }

  /* ---- Buyers. ------------------------------------------------------------- */
  const soIds = [...currentBySo.keys()];
  const shipLines = await inChunks<{ sales_order_id: string; shipment_id: string; shipment: One<{ etd: string | null; status: string | null }> }>(soIds, (ids) =>
    s.from("shipment_lines").select("sales_order_id, shipment_id, shipment:shipments(etd, status)").in("sales_order_id", ids),
  ).catch((e: Error) => (errors.push(`Shipments: ${e.message}`), []));
  const shipmentIds = [...new Set(shipLines.map((l) => l.shipment_id))];
  const receivables = await inChunks<{ shipment_id: string; invoice_date: string | null; receipts: { receipt_date: string }[] | null }>(shipmentIds, (ids) =>
    s.from("receivables").select("shipment_id, invoice_date, receipts:receivable_receipts(receipt_date)").in("shipment_id", ids),
  ).catch((e: Error) => (errors.push(`Receipts: ${e.message}`), []));

  type BuyerAcc = BuyerRow & { _approval: number[]; _pay: number[] };
  const buyer = new Map<string, BuyerAcc>();
  const buyerRow = (a: Amend) => {
    const k = a.customer_id ?? "none";
    let r = buyer.get(k);
    if (!r) {
      r = { key: k, name: one(a.customer)?.name ?? "No buyer", orders: 0, revisions: 0, approvalDays: null, shipOnTime: { num: 0, den: 0 }, paymentDays: null, _approval: [], _pay: [] };
      buyer.set(k, r);
    }
    return r;
  };
  for (const a of activeOrders) {
    const r = buyerRow(a);
    r.orders++;
    r.revisions += revBySo.get(a.sales_order_id!) ?? 0;
  }
  for (const x of apRows) {
    const a = amendById.get(x.amendment_id);
    if (!a || !x.actual_sent_date || !x.actual_received_date || !inPeriod(x.actual_received_date)) continue;
    buyerRow(a)._approval.push(days(x.actual_sent_date, x.actual_received_date));
  }
  // On time = the order's FIRST shipment left on or before its delivery date.
  const firstEtd = new Map<string, string>();
  for (const l of shipLines) {
    const etd = one(l.shipment)?.etd;
    if (!etd) continue;
    const prev = firstEtd.get(l.sales_order_id);
    if (!prev || etd < prev) firstEtd.set(l.sales_order_id, etd);
  }
  for (const [so, etd] of firstEtd) {
    const a = currentBySo.get(so);
    if (!a || !a.delivery_date || !inPeriod(etd)) continue;
    const r = buyerRow(a);
    r.shipOnTime.den++;
    if (etd <= a.delivery_date) r.shipOnTime.num++;
  }
  const soByShipment = new Map(shipLines.map((l) => [l.shipment_id, l.sales_order_id]));
  for (const rv of receivables) {
    const last = (rv.receipts ?? []).map((x) => x.receipt_date).sort().at(-1);
    const a = currentBySo.get(soByShipment.get(rv.shipment_id) ?? "");
    if (!a || !rv.invoice_date || !last || !inPeriod(last)) continue;
    buyerRow(a)._pay.push(days(rv.invoice_date, last));
  }
  const allApproval = [...buyer.values()].flatMap((b) => b._approval);
  const buyers: BuyerRow[] = [...buyer.values()]
    .map(({ _approval, _pay, ...r }) => ({ ...r, approvalDays: avg(_approval), paymentDays: avg(_pay) }))
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));

  /* ---- Suppliers. ---------------------------------------------------------- */
  const { data: poData, error: poErr } = await s
    .from("purchase_orders")
    .select("id, vendor_id, expected_date, status, vendor:vendors!vendor_id(name)")
    .gte("expected_date", from)
    .lte("expected_date", t);
  if (poErr) errors.push(`Purchase orders: ${poErr.message}`);
  const pos = ((poData ?? []) as unknown as { id: string; vendor_id: string | null; expected_date: string | null; status: string | null; vendor: One<{ name: string | null }> }[]).filter(
    (p) => p.status !== "cancelled" && p.status !== "draft",
  );
  const grnLines = await inChunks<{ purchase_order_id: string; received_qty: number | null; rejected_qty: number | null; grn: One<{ grn_date: string | null; status: string | null }> }>(
    pos.map((p) => p.id),
    (ids) => s.from("grn_line_items").select("purchase_order_id, received_qty, rejected_qty, grn:grns(grn_date, status)").in("purchase_order_id", ids),
  ).catch((e: Error) => (errors.push(`Goods receipts: ${e.message}`), []));
  const firstGrn = new Map<string, string>();
  const qty = new Map<string, { received: number; rejected: number }>();
  for (const g of grnLines) {
    const head = one(g.grn);
    if (!head || head.status === "cancelled") continue;
    if (head.grn_date) {
      const prev = firstGrn.get(g.purchase_order_id);
      if (!prev || head.grn_date < prev) firstGrn.set(g.purchase_order_id, head.grn_date);
    }
    const q = qty.get(g.purchase_order_id) ?? { received: 0, rejected: 0 };
    q.received += Number(g.received_qty ?? 0);
    q.rejected += Number(g.rejected_qty ?? 0);
    qty.set(g.purchase_order_id, q);
  }
  const supplier = new Map<string, SupplierRow>();
  for (const p of pos) {
    const k = p.vendor_id ?? "none";
    const r = supplier.get(k) ?? { key: k, name: one(p.vendor)?.name ?? "No supplier", pos: 0, onTime: { num: 0, den: 0 }, received: 0, rejected: 0 };
    r.pos++;
    r.onTime.den++;
    const g = firstGrn.get(p.id);
    if (g && p.expected_date && g <= p.expected_date) r.onTime.num++;
    const q = qty.get(p.id);
    if (q) {
      r.received += q.received;
      r.rejected += q.rejected;
    }
    supplier.set(k, r);
  }
  const suppliers = [...supplier.values()].sort((a, b) => b.pos - a.pos || a.name.localeCompare(b.name));

  return {
    period, from, to: t, isManager, myStaffId: me?.id ?? null, merchandisers, buyers, suppliers,
    totals: {
      taOnTime: teamTa,
      approvalDays: avg(allApproval),
      shipOnTime: buyers.reduce((a, r) => ({ num: a.num + r.shipOnTime.num, den: a.den + r.shipOnTime.den }), { num: 0, den: 0 }),
      supplierOnTime: suppliers.reduce((a, r) => ({ num: a.num + r.onTime.num, den: a.den + r.onTime.den }), { num: 0, den: 0 }),
    },
    emptySources: { shipments: shipLines.length === 0, receipts: receivables.length === 0, purchaseOrders: pos.length === 0 },
    errors,
  };
}
