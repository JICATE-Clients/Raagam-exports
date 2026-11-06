import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { canViewHref } from "@/lib/auth/server";
import { salesValuesByOrder } from "@/lib/orders/budget/service";
import { kpisFromJson } from "@/lib/orders/budget/amendment";
import { isRefusal } from "@/lib/orders/budget/totals";
import { inventoryDashboard, pendingQcCount, type InventoryRead } from "@/lib/reports/stock-statement-service";
import { today } from "@/lib/dashboard/range";
import { workFlowDef } from "@/lib/orders/work-flow/types";

/**
 * ANALYTICS ▸ THE FOUR SOURCES (Phase 1, user 2026-11-05).
 *
 * Every board reads the SAME rows the module's own screens read, through the
 * person's own session — never a SECURITY DEFINER aggregate. That is the whole
 * permission model ("option B"): a figure reaches a person here only if the
 * screen that owns it would have shown it to them. So
 *
 *   - Orders      — Order Entry's view  (`/orders/garment-orders`)
 *   - Margin      — Budgeting's view    (`/orders/budgets`)
 *   - Purchase    — Purchase Orders' view (`/purchase/orders`)
 *   - Stock value — the Stock Statement with Value screen, decided inside the
 *                   database by the same RPC the report and Store Overview call.
 *
 * The old 0042 `analytics_*` functions read past RLS on `reports:view` alone, so
 * a reports-only login saw sales totals no Orders screen would show it. They are
 * no longer called.
 *
 * ONE VALUE RULE EACH. An order's value is `salesValuesByOrder()` — Order Entry's
 * own `orderValue()` — and its margin is the budget's own frozen summary
 * (`kpisFromJson`), the figure the MD approved. Nothing here prices or costs
 * anything a second way.
 *
 * Each loader is `cache()`d, so the Overview and a board can share one read in a
 * render, and returns `null` when the person may not see it — distinct from an
 * empty list, which is a real answer.
 */

export type Access<T> = { ok: true; data: T } | { ok: false; reason: "access" | "error"; message?: string };

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderFact = {
  id: string;
  reNo: string;
  buyerId: string | null;
  buyer: string;
  merchandiser: string;
  /** The staff row of the merchandiser — what a module overview's "Mine" matches on. */
  merchandiserId: string | null;
  season: string;
  /** When the buyer's order came in: PO date, else received date, else entry. */
  orderDate: string;
  deliveryDate: string | null;
  /** INR at the order's own Ex-Rate; null when Order Entry cannot price it. */
  valueInr: number | null;
  qty: number;
  status: string;
};

const CLOSED_SO = new Set(["cancelled", "closed", "rejected"]);

export const loadOrders = cache(async (): Promise<Access<OrderFact[]>> => {
  if (!(await canViewHref("/orders/garment-orders"))) return { ok: false, reason: "access" };
  const sb = await createClient();
  const [docs, values] = await Promise.all([
    sb
      .from("garment_order_amendments")
      .select(
        "id, code, po_date, received_date, created_at, delivery_date, season, re_status, customer_id, merchandiser_id, " +
          "customer:customers!customer_id(name), merch:staff!merchandiser_id(name), " +
          "so:sales_orders!sales_order_id(order_number, status)",
      )
      .eq("is_draft", false),
    salesValuesByOrder(),
  ]);
  if (docs.error) return { ok: false, reason: "error", message: docs.error.message };
  if (!values.ok) return { ok: false, reason: "error", message: values.error };

  type Row = {
    id: string;
    code: string | null;
    po_date: string | null;
    received_date: string | null;
    created_at: string;
    delivery_date: string | null;
    season: string | null;
    re_status: string | null;
    customer_id: string | null;
    merchandiser_id: string | null;
    customer: { name: string | null } | null;
    merch: { name: string | null } | null;
    so: { order_number: string | null; status: string | null } | null;
  };
  const out: OrderFact[] = [];
  for (const r of (docs.data ?? []) as unknown as Row[]) {
    if (CLOSED_SO.has(String(r.so?.status ?? "").toLowerCase())) continue;
    const v = values.byOrder.get(r.id);
    out.push({
      id: r.id,
      reNo: r.so?.order_number?.trim() || r.code || "—",
      buyerId: r.customer_id,
      buyer: r.customer?.name?.trim() || "No buyer",
      merchandiser: r.merch?.name?.trim() || "—",
      merchandiserId: r.merchandiser_id,
      season: r.season?.trim() || "No season",
      orderDate: (r.po_date || r.received_date || r.created_at).slice(0, 10),
      deliveryDate: r.delivery_date,
      valueInr: v?.value ?? null,
      qty: v?.qty ?? 0,
      status: r.re_status ?? "open",
    });
  }
  return { ok: true, data: out };
});

// ---------------------------------------------------------------------------
// Budgets (margin)
// ---------------------------------------------------------------------------

export type BudgetFact = {
  id: string;
  code: string;
  status: "submitted" | "approved";
  budgetDate: string;
  reNos: string[];
  buyers: string[];
  /** Null when the frozen summary refused the figure. */
  income: number | null;
  profit: number | null;
  marginPct: number | null;
};

/**
 * Submitted and approved budgets only. A draft's summary is not what anybody
 * approved — it may be the one frozen before a rework — so it is not a margin.
 */
export const loadBudgets = cache(async (): Promise<Access<BudgetFact[]>> => {
  if (!(await canViewHref("/orders/budgets"))) return { ok: false, reason: "access" };
  const sb = await createClient();
  const { data, error } = await sb
    .from("order_budgets")
    .select(
      "id, code, status, budget_date, created_at, submitted_summary, " +
        "orders:order_budget_orders(garment_order:garment_order_amendments!garment_order_id(customer:customers!customer_id(name)))",
    )
    .in("status", ["submitted", "approved"]);
  if (error) return { ok: false, reason: "error", message: error.message };

  type Row = {
    id: string;
    code: string | null;
    status: "submitted" | "approved";
    budget_date: string | null;
    created_at: string;
    submitted_summary: unknown;
    orders: { garment_order: { customer: { name: string | null } | null } | null }[] | null;
  };
  const fig = (x: number | { refused: string } | undefined) => (x == null || isRefusal(x) ? null : x);
  const out: BudgetFact[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const k = kpisFromJson(r.submitted_summary);
    const buyers = [...new Set((r.orders ?? []).map((o) => o.garment_order?.customer?.name?.trim()).filter((x): x is string => !!x))];
    out.push({
      id: r.id,
      code: r.code ?? "—",
      status: r.status,
      budgetDate: (r.budget_date || r.created_at).slice(0, 10),
      reNos: k?.re_nos ?? [],
      buyers,
      income: k ? fig(k.total_income) : null,
      profit: k ? fig(k.profit) : null,
      marginPct: k ? fig(k.profit_pct) : null,
    });
  }
  return { ok: true, data: out };
});

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

export type PoFact = {
  id: string;
  /** False for a PO still waiting approval: in the pipeline picture, not in spend. */
  placed: boolean;
  code: string;
  vendor: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  /** INR, the PO's own total. */
  value: number;
  /** INR, received quantity × line rate. */
  receivedValue: number;
  /** Quantity still to come, after cancelled and short-closed. */
  openQty: number;
  overBudgetReason: string | null;
  byClass: Map<string, number>;
  /** Last GRN date against this PO, if any. */
  lastGrn: string | null;
  receivedQty: number;
  rejectedQty: number;
  /** Who raised it — what a module overview's "Mine" matches on. */
  createdBy: string | null;
};

/** A PO that went to the vendor. Draft, waiting and cancelled are not spend. */
const PLACED = ["approved", "partially_received", "received", "closed"];

export const loadPurchase = cache(async (): Promise<Access<PoFact[]>> => {
  if (!(await canViewHref("/purchase/orders"))) return { ok: false, reason: "access" };
  const sb = await createClient();
  const [pos, grns] = await Promise.all([
    sb
      .from("purchase_orders")
      .select(
        "id, code, status, order_date, expected_date, total_amount, budget_reason, created_by, " +
          "mv:master_vendors!master_vendor_id(name), v:vendors!vendor_id(name), " +
          "lines:po_line_items(quantity, unit_price, received_qty, cancelled_qty, balance_closed_qty, item_class)",
      )
      .in("status", [...PLACED, "pending_approval"]),
    sb.from("grn_line_items").select("purchase_order_id, received_qty, rejected_qty, grn:grns!grn_id(grn_date)").not("purchase_order_id", "is", null),
  ]);
  if (pos.error) return { ok: false, reason: "error", message: pos.error.message };
  if (grns.error) return { ok: false, reason: "error", message: grns.error.message };

  type Grn = { purchase_order_id: string; received_qty: unknown; rejected_qty: unknown; grn: { grn_date: string | null } | null };
  const byPo = new Map<string, { last: string | null; rec: number; rej: number }>();
  for (const g of (grns.data ?? []) as unknown as Grn[]) {
    const cur = byPo.get(g.purchase_order_id) ?? { last: null, rec: 0, rej: 0 };
    const d = g.grn?.grn_date ?? null;
    if (d && (!cur.last || d > cur.last)) cur.last = d;
    cur.rec += num(g.received_qty);
    cur.rej += num(g.rejected_qty);
    byPo.set(g.purchase_order_id, cur);
  }

  type Line = { quantity: unknown; unit_price: unknown; received_qty: unknown; cancelled_qty: unknown; balance_closed_qty: unknown; item_class: string | null };
  type Row = {
    id: string;
    code: string | null;
    status: string;
    order_date: string | null;
    expected_date: string | null;
    total_amount: unknown;
    budget_reason: string | null;
    created_by: string | null;
    mv: { name: string | null } | null;
    v: { name: string | null } | null;
    lines: Line[] | null;
  };
  const out: PoFact[] = [];
  for (const r of (pos.data ?? []) as unknown as Row[]) {
    let receivedValue = 0;
    let openQty = 0;
    const byClass = new Map<string, number>();
    for (const l of r.lines ?? []) {
      const q = num(l.quantity);
      const rec = Math.min(num(l.received_qty), q);
      receivedValue += rec * num(l.unit_price);
      openQty += Math.max(0, q - rec - num(l.cancelled_qty) - num(l.balance_closed_qty));
      const cls = l.item_class?.trim() || "Other";
      byClass.set(cls, (byClass.get(cls) ?? 0) + q * num(l.unit_price));
    }
    const g = byPo.get(r.id);
    out.push({
      id: r.id,
      placed: PLACED.includes(r.status),
      code: r.code ?? "—",
      vendor: r.mv?.name?.trim() || r.v?.name?.trim() || "No vendor",
      status: r.status,
      orderDate: (r.order_date ?? "").slice(0, 10),
      expectedDate: r.expected_date,
      value: num(r.total_amount),
      receivedValue,
      openQty: r.status === "received" || r.status === "closed" ? 0 : openQty,
      overBudgetReason: r.budget_reason?.trim() || null,
      byClass,
      lastGrn: g?.last ?? null,
      receivedQty: g?.rec ?? 0,
      rejectedQty: g?.rej ?? 0,
      createdBy: r.created_by,
    });
  }
  return { ok: true, data: out };
});

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export const loadStock = cache(async (): Promise<Access<{ read: InventoryRead; pendingQc: number | null }>> => {
  try {
    const [read, qc] = await Promise.all([inventoryDashboard(today()), pendingQcCount().catch(() => null)]);
    if (read.access === "none") return { ok: false, reason: "access" };
    return { ok: true, data: { read, pendingQc: qc } };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
});

// ---------------------------------------------------------------------------
// Approvals waiting on this person
// ---------------------------------------------------------------------------

export const loadMyApprovals = cache(async (): Promise<{ waiting: number; overdue: number } | null> => {
  const sb = await createClient();
  const { data, error } = await sb.rpc("approval_my_queue", { p_workflow_key: null, p_tenant_id: null, p_limit: 200, p_offset: 0 });
  if (error) return null;
  const rows = (data ?? []) as { total_count?: number; is_overdue?: boolean }[];
  return { waiting: Number(rows[0]?.total_count ?? 0), overdue: rows.filter((r) => r.is_overdue).length };
});

// ---------------------------------------------------------------------------
// Delivery & T&A (Phase 2, user 2026-11-05: "still missing the remaining modules")
// ---------------------------------------------------------------------------

/**
 * One dated step of an order: the six internal WORK-FLOW milestones (Order Entry to
 * Budget Approval, `order_work_flow_milestones`) and the buyer's T&A activities on
 * Order Entry (`garment_order_amendment_ta_activities`). Gated on Order Progress,
 * the screen that already shows both per order.
 */
export type StepFact = {
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

export const loadSteps = cache(async (): Promise<Access<StepFact[]>> => {
  if (!(await canViewHref("/orders/progress"))) return { ok: false, reason: "access" };
  const sb = await createClient();
  const [docs, wf, ta] = await Promise.all([
    sb
      .from("garment_order_amendments")
      .select("id, code, sales_order_id, delivery_date, customer:customers!customer_id(name), so:sales_orders!sales_order_id(order_number, status)")
      .eq("is_draft", false),
    sb.from("order_work_flow_milestones").select("sales_order_id, code, target_date, actual_date, owner:staff!owner_id(name)"),
    sb
      .from("garment_order_amendment_ta_activities")
      .select("amendment_id, target_date, actual_date, activity:ta_activities!activity_id(short_name, name), owner:staff!assigned_staff_id(name)"),
  ]);
  const err = docs.error ?? wf.error ?? ta.error;
  if (err) return { ok: false, reason: "error", message: err.message };

  type Doc = {
    id: string;
    code: string | null;
    sales_order_id: string | null;
    delivery_date: string | null;
    customer: { name: string | null } | null;
    so: { order_number: string | null; status: string | null } | null;
  };
  const byId = new Map<string, Doc>();
  const bySo = new Map<string, Doc>();
  for (const d of (docs.data ?? []) as unknown as Doc[]) {
    if (CLOSED_SO.has(String(d.so?.status ?? "").toLowerCase())) continue;
    byId.set(d.id, d);
    if (d.sales_order_id) bySo.set(d.sales_order_id, d);
  }
  const head = (d: Doc) => ({
    orderId: d.id,
    reNo: d.so?.order_number?.trim() || d.code || "—",
    buyer: d.customer?.name?.trim() || "No buyer",
    deliveryDate: d.delivery_date,
  });

  const out: StepFact[] = [];
  type Wf = { sales_order_id: string; code: string; target_date: string | null; actual_date: string | null; owner: { name: string | null } | null };
  for (const m of (wf.data ?? []) as unknown as Wf[]) {
    const d = bySo.get(m.sales_order_id);
    if (!d || !m.target_date) continue;
    out.push({
      ...head(d),
      source: "Work flow",
      label: workFlowDef(m.code)?.label ?? m.code,
      target: m.target_date,
      actual: m.actual_date,
      owner: m.owner?.name?.trim() || "—",
    });
  }
  type Ta = {
    amendment_id: string;
    target_date: string | null;
    actual_date: string | null;
    activity: { short_name: string | null; name: string | null } | null;
    owner: { name: string | null } | null;
  };
  for (const a of (ta.data ?? []) as unknown as Ta[]) {
    const d = byId.get(a.amendment_id);
    if (!d || !a.target_date) continue;
    out.push({
      ...head(d),
      source: "T&A",
      label: a.activity?.name?.trim() || a.activity?.short_name?.trim() || "T&A step",
      target: a.target_date,
      actual: a.actual_date,
      owner: a.owner?.name?.trim() || "—",
    });
  }
  return { ok: true, data: out };
});

// ---------------------------------------------------------------------------
// Samples & Enquiries
// ---------------------------------------------------------------------------

export type CostingState = "draft" | "submitted" | "approved" | "rejected";

export type EnquiryFact = {
  id: string;
  code: string;
  title: string;
  buyer: string;
  merchandiser: string;
  /** The staff row of the merchandiser — what Sample ▸ Overview's "Mine" matches on. */
  merchandiserId: string | null;
  received: string;
  /** The current costing (latest, not superseded); null when never costed or costing not visible. */
  costing: { id: string; status: CostingState; firstAt: string; submittedAt: string | null; marginPct: number | null } | null;
  becameOrder: boolean;
};

/**
 * Enquiries (Sample Entry) with their current costing (Costing) and whether an order
 * was raised against them (`sales_orders.opportunity_id`). Costing is read only when
 * the person can open Sample Costing; without it the funnel stops at "Enquiry".
 */
export const loadEnquiries = cache(async (): Promise<Access<{ rows: EnquiryFact[]; costingVisible: boolean }>> => {
  if (!(await canViewHref("/sales/sample-entry"))) return { ok: false, reason: "access" };
  const costingVisible = await canViewHref("/sales/sample-costing");
  const sb = await createClient();
  const [opps, sheets, orders] = await Promise.all([
    sb
      .from("opportunities")
      .select("id, code, title, received_date, receipt_date, created_at, merchandiser_id, customer:customers!customer_id(name), merch:staff!merchandiser_id(name)")
      .eq("is_draft", false),
    costingVisible
      ? sb.from("cost_sheets").select("id, opportunity_id, status, is_draft, created_at, costing_date, submitted_at, profit_loss_pct").not("opportunity_id", "is", null)
      : Promise.resolve({ data: [], error: null }),
    sb.from("sales_orders").select("opportunity_id").not("opportunity_id", "is", null),
  ]);
  const err = opps.error ?? sheets.error ?? orders.error;
  if (err) return { ok: false, reason: "error", message: err.message };

  type Sheet = {
    id: string;
    opportunity_id: string;
    status: string;
    is_draft: boolean | null;
    created_at: string;
    costing_date: string | null;
    submitted_at: string | null;
    profit_loss_pct: unknown;
  };
  const byOpp = new Map<string, Sheet[]>();
  for (const s of (sheets.data ?? []) as Sheet[]) byOpp.set(s.opportunity_id, [...(byOpp.get(s.opportunity_id) ?? []), s]);
  const ordered = new Set(((orders.data ?? []) as { opportunity_id: string }[]).map((o) => o.opportunity_id));
  const stateOf = (s: Sheet): CostingState =>
    s.is_draft ? "draft" : s.status === "submitted" || s.status === "approved" || s.status === "rejected" ? s.status : "draft";

  type Opp = {
    id: string;
    code: string | null;
    title: string | null;
    received_date: string | null;
    receipt_date: string | null;
    created_at: string;
    merchandiser_id: string | null;
    customer: { name: string | null } | null;
    merch: { name: string | null } | null;
  };
  const rows: EnquiryFact[] = ((opps.data ?? []) as unknown as Opp[]).map((o) => {
    const list = (byOpp.get(o.id) ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const cur = list.filter((s) => s.status !== "superseded").at(-1);
    return {
      id: o.id,
      code: o.code ?? "—",
      title: o.title?.trim() || "—",
      buyer: o.customer?.name?.trim() || "No buyer",
      merchandiser: o.merch?.name?.trim() || "—",
      merchandiserId: o.merchandiser_id,
      received: (o.received_date || o.receipt_date || o.created_at).slice(0, 10),
      costing: cur
        ? {
            id: cur.id,
            status: stateOf(cur),
            firstAt: (list[0].costing_date || list[0].created_at).slice(0, 10),
            submittedAt: cur.submitted_at,
            marginPct: cur.profit_loss_pct == null ? null : Number(cur.profit_loss_pct),
          }
        : null,
      becameOrder: ordered.has(o.id),
    };
  });
  return { ok: true, data: { rows, costingVisible } };
});

// ---------------------------------------------------------------------------
// People & Workplace
// ---------------------------------------------------------------------------

export type StaffFact = { id: string; department: string };
export type LeaveFact = { staffId: string | null; status: string; start: string; end: string; days: number };
export type TicketFact = { id: string; refNo: string; kind: string; title: string; status: string; createdAt: string; late: boolean };
export type TripFact = { status: string; planned: string; cost: number };

type Raw = Record<string, unknown>;
type Res = { data: unknown; error: { message: string } | null };

function part<T>(allowed: boolean, res: Res, map: (rows: Raw[]) => T): Access<T> {
  if (!allowed) return { ok: false, reason: "access" };
  if (res.error) return { ok: false, reason: "error", message: res.error.message };
  return { ok: true, data: map((res.data ?? []) as Raw[]) };
}

/** Each part of the People board is its own source with its own screen; any may be absent. */
export const loadPeople = cache(async () => {
  const sb = await createClient();
  const [canStaff, canLeave, canTickets, canTrips] = await Promise.all([
    canViewHref("/hr/staff"),
    canViewHref("/hr/time-off/calendar"),
    canViewHref("/resolve/analytics"),
    canViewHref("/logistics/transport/board"),
  ]);
  const none: Promise<Res> = Promise.resolve({ data: null, error: null });
  const [staff, leave, tickets, trips] = await Promise.all([
    canStaff ? sb.from("staff").select("id, dept:departments!department_id(name)").eq("is_active", true) : none,
    canLeave ? sb.from("timeoff_requests").select("staff_id, status, start_date, end_date, total_days") : none,
    canTickets ? sb.from("rh_tickets").select("id, ref_no, kind, title, status, created_at, due_at, resolution_breached_at") : none,
    canTrips ? sb.from("transport_trips").select("trip_status, planned_at, created_at, total_cost") : none,
  ]);

  const nowIso = new Date().toISOString();
  return {
    staff: part<StaffFact[]>(canStaff, staff, (rows) =>
      rows.map((r) => ({ id: String(r.id), department: String((r.dept as { name?: string } | null)?.name ?? "").trim() || "No department" })),
    ),
    leave: part<LeaveFact[]>(canLeave, leave, (rows) =>
      rows.map((r) => ({
        staffId: (r.staff_id as string | null) ?? null,
        status: String(r.status ?? ""),
        start: String(r.start_date ?? "").slice(0, 10),
        end: String(r.end_date ?? r.start_date ?? "").slice(0, 10),
        days: num(r.total_days),
      })),
    ),
    tickets: part<TicketFact[]>(canTickets, tickets, (rows) =>
      rows.map((r) => {
        const due = (r.due_at as string | null) ?? null;
        return {
          id: String(r.id),
          refNo: String(r.ref_no ?? "—"),
          kind: String(r.kind ?? ""),
          title: String(r.title ?? "—"),
          status: String(r.status ?? ""),
          createdAt: String(r.created_at),
          late: !!r.resolution_breached_at || (!!due && due < nowIso),
        };
      }),
    ),
    trips: part<TripFact[]>(canTrips, trips, (rows) =>
      rows.map((r) => ({ status: String(r.trip_status ?? ""), planned: String(r.planned_at ?? r.created_at ?? "").slice(0, 10), cost: num(r.total_cost) })),
    ),
  };
});
