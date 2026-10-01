import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { AppUser } from "@/lib/auth/types";
import { addDays, today } from "@/lib/calendar";
import { myStaff } from "@/lib/people/order-people";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import { workFlowDef } from "@/lib/orders/work-flow/types";

/**
 * MY CALENDAR (user 2026-10-01; its own page at /my-calendar — on the
 * Dashboard it "took one page content"). Today · Month · Year; managers get
 * Mine / Team.
 *
 * Five kinds of dated work, each read from the table that owns it — nothing is
 * copied into a calendar table, so a date moved on its own screen moves here:
 *
 *   ta        T&A activity            assigned_staff_id = me      target_date
 *   approval  buyer approval (T&A)    the order's merchandiser    target_date
 *   milestone Work Flow milestone     owner_id = me               target_date
 *   cad       CAD allocation          pattern_maker_id = me       target_date
 *   ship      order delivery date     the order's merchandiser    delivery_date
 *
 * "Team" drops the person filter and is offered to managers only (Orders
 * approver or Super Admin) — the same people the My Work team band is for.
 * Only the CURRENT, non-draft version of an order counts: a superseded
 * version's schedule was replaced (the T&A Worklist's own rule).
 */

export type CalKind = "ta" | "approval" | "milestone" | "cad" | "ship";

export type CalEvent = {
  id: string;
  kind: CalKind;
  date: string;
  title: string;
  reNo: string | null;
  done: boolean;
  href: string;
};

export type CalScope = "mine" | "team";

export type CalendarData = {
  today: string;
  scope: CalScope;
  canTeam: boolean;
  /**
   * The login has no staff record, so "Mine" could only ever be empty — a
   * manager is shown Team instead, and the page says why (design 2026-10-01).
   */
  autoTeam: boolean;
  /** False when the login has no Orders access, or no staff record for "mine". */
  available: boolean;
  reason: string | null;
  events: CalEvent[];
  errors: string[];
};

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Events dated `from`..`to` (inclusive), plus — when `withOverdue` — every
 * unfinished one dated before `from` back to six months, which is what the
 * Today view lists as "Overdue".
 */
export async function getCalendar(
  user: AppUser,
  opts: { scope: CalScope; from: string; to: string; withOverdue?: boolean },
): Promise<CalendarData> {
  const t = today();
  const [canOrders, canApprove, me] = await Promise.all([can("orders", "view"), can("orders", "approve"), myStaff(user.id)]);
  const canTeam = user.isSuperAdmin || (canOrders && canApprove);
  let scope: CalScope = opts.scope === "team" && canTeam ? "team" : "mine";
  let autoTeam = false;
  if (scope === "mine" && !me && canTeam) {
    scope = "team";
    autoTeam = true;
  }
  const base = { today: t, scope, canTeam, autoTeam, events: [] as CalEvent[], errors: [] as string[] };

  if (!canOrders) return { ...base, available: false, reason: "Your role does not open Orders, so there is no order work to show." };
  if (scope === "mine" && !me)
    return {
      ...base,
      available: false,
      reason: "This login is not linked to a staff record, so no tasks can be matched to you.",
    };

  const meId = me?.id ?? null;
  const mine = scope === "mine";
  const from = opts.withOverdue ? addDays(opts.from, -183) : opts.from;
  const to = opts.to;
  const s = await createClient();
  const events: CalEvent[] = [];
  const errors: string[] = [];

  const amendSel = "amendment:garment_order_amendments!inner(id, sales_order_id, is_draft, merchandiser_id, sales_order:sales_orders(order_number))";
  type AmendJoin = { id: string; sales_order_id: string | null; is_draft: boolean | null; merchandiser_id: string | null; sales_order: One<{ order_number: string | null }> };

  const taQ = (() => {
    let q = s
      .from("garment_order_amendment_ta_activities")
      .select(`id, target_date, actual_date, status, activity:ta_activities(name), ${amendSel}`)
      .gte("target_date", from)
      .lte("target_date", to);
    if (mine) q = q.eq("assigned_staff_id", meId as string);
    return q;
  })();
  const apQ = (() => {
    let q = s
      .from("garment_order_amendment_ta_approvals")
      .select(`id, target_date, status, actual_received_date, approval:ta_approvals(name), ${amendSel}`)
      .gte("target_date", from)
      .lte("target_date", to);
    if (mine) q = q.eq("amendment.merchandiser_id", meId as string);
    return q;
  })();
  const wfQ = (() => {
    let q = s
      .from("order_work_flow_milestones")
      .select("id, code, sales_order_id, target_date, actual_date, status, sales_order:sales_orders(order_number)")
      .gte("target_date", from)
      .lte("target_date", to);
    if (mine) q = q.eq("owner_id", meId as string);
    return q;
  })();
  const cadQ = (() => {
    let q = s
      .from("order_cad_allocations")
      .select(
        "id, style_ref_no, version_no, target_date, dispatch:order_cad_dispatches(id), " +
          "order:garment_order_amendments!garment_order_id(sales_order:sales_orders(order_number))",
      )
      .gte("target_date", from)
      .lte("target_date", to);
    if (mine) q = q.eq("pattern_maker_id", meId as string);
    return q;
  })();
  const shipQ = (() => {
    let q = s
      .from("garment_order_amendments")
      .select("id, sales_order_id, is_draft, delivery_date, sales_order:sales_orders(order_number), customer:customers(name)")
      .gte("delivery_date", from)
      .lte("delivery_date", to)
      .not("sales_order_id", "is", null);
    if (mine) q = q.eq("merchandiser_id", meId as string);
    return q;
  })();

  const [ta, ap, wf, cad, ship] = await Promise.all([taQ, apQ, wfQ, cadQ, shipQ]);

  // Which version of each order is current — one lookup for every source.
  const soIds = new Set<string>();
  for (const r of [...(ta.data ?? []), ...(ap.data ?? [])] as unknown as { amendment: One<AmendJoin> }[]) {
    const so = one(r.amendment)?.sales_order_id;
    if (so) soIds.add(so);
  }
  for (const r of (ship.data ?? []) as { sales_order_id: string | null }[]) if (r.sales_order_id) soIds.add(r.sales_order_id);
  const current = await currentAmendmentsBySalesOrder(s, [...soIds]);
  const isCurrent = (a: { id: string; sales_order_id: string | null; is_draft: boolean | null } | null) =>
    !!a && !a.is_draft && !!a.sales_order_id && current.get(a.sales_order_id)?.id === a.id;

  if (ta.error) errors.push(`T&A: ${ta.error.message}`);
  for (const r of (ta.data ?? []) as unknown as {
    id: string;
    target_date: string;
    actual_date: string | null;
    status: string | null;
    activity: One<{ name: string | null }>;
    amendment: One<AmendJoin>;
  }[]) {
    const a = one(r.amendment);
    if (!isCurrent(a)) continue;
    events.push({
      id: `ta:${r.id}`,
      kind: "ta",
      date: r.target_date,
      title: one(r.activity)?.name ?? "T&A task",
      reNo: one(a!.sales_order)?.order_number ?? null,
      done: !!r.actual_date || r.status === "done",
      href: mine ? "/orders/ta-worklist?scope=mine" : "/orders/ta-worklist",
    });
  }

  if (ap.error) errors.push(`Buyer approvals: ${ap.error.message}`);
  for (const r of (ap.data ?? []) as unknown as {
    id: string;
    target_date: string;
    status: string | null;
    actual_received_date: string | null;
    approval: One<{ name: string | null }>;
    amendment: One<AmendJoin>;
  }[]) {
    const a = one(r.amendment);
    if (!isCurrent(a)) continue;
    events.push({
      id: `ap:${r.id}`,
      kind: "approval",
      date: r.target_date,
      title: `${one(r.approval)?.name ?? "Buyer approval"} approval`,
      reNo: one(a!.sales_order)?.order_number ?? null,
      done: r.status === "approved" || !!r.actual_received_date,
      href: "/orders/ta-followup",
    });
  }

  if (wf.error) errors.push(`Work Flow: ${wf.error.message}`);
  for (const r of (wf.data ?? []) as unknown as {
    id: string;
    code: string;
    target_date: string;
    actual_date: string | null;
    status: string | null;
    sales_order: One<{ order_number: string | null }>;
  }[]) {
    const def = workFlowDef(r.code);
    events.push({
      id: `wf:${r.id}`,
      kind: "milestone",
      date: r.target_date,
      title: def?.label ?? r.code,
      reNo: one(r.sales_order)?.order_number ?? null,
      done: !!r.actual_date || r.status === "done",
      href: def?.href ?? "/orders",
    });
  }

  if (cad.error) errors.push(`CAD: ${cad.error.message}`);
  for (const r of (cad.data ?? []) as unknown as {
    id: string;
    style_ref_no: string;
    version_no: number;
    target_date: string;
    dispatch: One<{ id: string }>;
    order: One<{ sales_order: One<{ order_number: string | null }> }>;
  }[]) {
    events.push({
      id: `cad:${r.id}`,
      kind: "cad",
      date: r.target_date,
      title: `CAD ${r.style_ref_no} V${r.version_no}`,
      reNo: one(one(r.order)?.sales_order ?? null)?.order_number ?? null,
      done: !!one(r.dispatch),
      href: "/orders/cad-lifecycle",
    });
  }

  if (ship.error) errors.push(`Ship dates: ${ship.error.message}`);
  for (const r of (ship.data ?? []) as unknown as {
    id: string;
    sales_order_id: string;
    is_draft: boolean | null;
    delivery_date: string;
    sales_order: One<{ order_number: string | null }>;
    customer: One<{ name: string | null }>;
  }[]) {
    if (!isCurrent({ id: r.id, sales_order_id: r.sales_order_id, is_draft: r.is_draft })) continue;
    events.push({
      id: `ship:${r.id}`,
      kind: "ship",
      date: r.delivery_date,
      title: `Ship${one(r.customer)?.name ? ` · ${one(r.customer)!.name}` : ""}`,
      reNo: one(r.sales_order)?.order_number ?? null,
      // A ship date is a deadline, not a task with a tick: it reads "done"
      // once the day has passed, never red — shipping is tracked on Logistics.
      done: r.delivery_date < t,
      href: `/orders/${r.sales_order_id}`,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  return { ...base, available: true, reason: null, events, errors };
}
