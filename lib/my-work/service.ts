import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { AppUser } from "@/lib/auth/types";
import { today } from "@/lib/calendar";
import { myStaff, type MyStaff } from "@/lib/people/order-people";
import { getWorklist } from "@/lib/ta/worklist";
import { getMyQueue } from "@/lib/approvals/service";
import { getUnreadCount, listNotifications } from "@/lib/notifications/service";

/**
 * MY WORK — EVERYTHING THAT IS ON ONE PERSON TODAY (user 2026-10-01: "user
 * based dashboard, TA follow up, order entry, assigned works").
 *
 * One loader, six questions, each answered by the module that already owns it
 * — never re-derived here:
 *
 *   orders     `garment_order_amendments.merchandiser_id` = my staff id
 *   ta         `getWorklist({ mineOnly })`, the T&A Worklist's own "Mine"
 *   approvals  `approval_my_queue`, the Approvals queue's own predicate
 *   cad        `order_cad_allocations.pattern_maker_id` = me, not dispatched
 *   revisions  `order_budget_revisions` I raised that are still open
 *   alerts     my unread notifications
 *
 * "Me" is `myStaff()` — the one login → staff rule (0674) the alerts use too,
 * so a card and the notification that pointed at it can never disagree about
 * who someone is. A login that matches no staff record still gets the three
 * cards that hang off the LOGIN (approvals, revisions, alerts).
 *
 * EACH CARD FAILS ON ITS OWN. A card that cannot load reports `error` and the
 * rest of the page still renders — the same stance the approval cards take on
 * enrichment reads. A section the person has no permission for is `null`
 * (absent), which is different from an empty list (nothing on them today).
 */

export type Section<T> = { items: T[]; total: number; error?: string } | null;

export type MyOrder = {
  salesOrderId: string;
  reNo: string | null;
  buyer: string | null;
  deliveryDate: string | null;
  status: string;
};

export type MyTask = {
  id: string;
  activity: string;
  reNo: string | null;
  buyer: string | null;
  targetDate: string;
  daysLate: number;
};

export type MyCad = {
  id: string;
  styleRefNo: string;
  version: number;
  reNo: string | null;
  targetDate: string | null;
  patternStatus: string | null;
};

export type MyRevision = { id: string; entryNo: string | null; reNo: string | null; reason: string | null; raisedAt: string };

export type MyAlert = { id: string; title: string; body: string | null; href: string | null; createdAt: string };

export type MyWork = {
  today: string;
  me: MyStaff | null;
  orders: Section<MyOrder>;
  ta: (Section<MyTask> & { overdue: number; dueToday: number }) | null;
  approvals: (Section<never> & { overdue: number }) | null;
  cad: Section<MyCad>;
  revisions: Section<MyRevision>;
  alerts: Section<MyAlert>;
};

const SHOWN = 5;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function getMyWork(user: AppUser): Promise<MyWork> {
  const [me, canOrders] = await Promise.all([myStaff(user.id), can("orders", "view")]);
  const s = await createClient();

  const orders = async (): Promise<Section<MyOrder>> => {
    if (!canOrders || !me) return null;
    try {
      const { data, error } = await s
        .from("garment_order_amendments")
        .select("sales_order_id, re_status, delivery_date, created_at, customer:customers(name), sales_order:sales_orders(order_number)")
        .eq("merchandiser_id", me.id)
        .eq("is_draft", false)
        .not("sales_order_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = {
        sales_order_id: string;
        re_status: string | null;
        delivery_date: string | null;
        customer: One<{ name: string | null }>;
        sales_order: One<{ order_number: string | null }>;
      };
      // One line per ORDER: the newest version of each RE stands for it.
      const seen = new Set<string>();
      const items: MyOrder[] = [];
      for (const r of (data ?? []) as unknown as Row[]) {
        if (seen.has(r.sales_order_id)) continue;
        seen.add(r.sales_order_id);
        items.push({
          salesOrderId: r.sales_order_id,
          reNo: one(r.sales_order)?.order_number ?? null,
          buyer: one(r.customer)?.name ?? null,
          deliveryDate: r.delivery_date,
          status: r.re_status ?? "open",
        });
      }
      // Soonest delivery first — that is the order that needs looking at.
      items.sort((a, b) => (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999"));
      return { items: items.slice(0, SHOWN), total: items.length };
    } catch (e) {
      return { items: [], total: 0, error: msg(e) };
    }
  };

  const ta = async (): Promise<MyWork["ta"]> => {
    if (!canOrders || !me) return null;
    try {
      const wl = await getWorklist({ mineOnly: true });
      if (!wl.available) return null;
      return {
        items: wl.rows.slice(0, SHOWN).map((r) => ({
          id: r.id,
          activity: r.activity,
          reNo: r.orderRef,
          buyer: r.buyer,
          targetDate: r.targetDate,
          daysLate: r.daysLate,
        })),
        total: wl.rows.length,
        overdue: wl.counts.backlog,
        dueToday: wl.counts.today,
      };
    } catch (e) {
      return { items: [], total: 0, overdue: 0, dueToday: 0, error: msg(e) };
    }
  };

  const approvals = async (): Promise<MyWork["approvals"]> => {
    try {
      const q = await getMyQueue({ limit: 200 });
      return { items: [], total: q.total, overdue: q.items.filter((i) => i.is_overdue).length };
    } catch (e) {
      return { items: [], total: 0, overdue: 0, error: msg(e) };
    }
  };

  const cad = async (): Promise<Section<MyCad>> => {
    if (!canOrders || !me) return null;
    try {
      const { data, error } = await s
        .from("order_cad_allocations")
        .select(
          "id, style_ref_no, version_no, target_date, pattern_status, " +
            "dispatch:order_cad_dispatches(id), " +
            "order:garment_order_amendments!garment_order_id(sales_order:sales_orders(order_number))",
        )
        .eq("pattern_maker_id", me.id)
        .order("target_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      type Row = {
        id: string;
        style_ref_no: string;
        version_no: number;
        target_date: string | null;
        pattern_status: string | null;
        dispatch: One<{ id: string }>;
        order: One<{ sales_order: One<{ order_number: string | null }> }>;
      };
      // Dispatched = handed over; what is left is still on the pattern maker.
      const items = ((data ?? []) as unknown as Row[])
        .filter((r) => !one(r.dispatch))
        .map((r) => ({
          id: r.id,
          styleRefNo: r.style_ref_no,
          version: r.version_no,
          reNo: one(one(r.order)?.sales_order ?? null)?.order_number ?? null,
          targetDate: r.target_date,
          patternStatus: r.pattern_status,
        }));
      return { items: items.slice(0, SHOWN), total: items.length };
    } catch (e) {
      return { items: [], total: 0, error: msg(e) };
    }
  };

  const revisions = async (): Promise<Section<MyRevision>> => {
    if (!canOrders) return null;
    try {
      const { data, error } = await s
        .from("order_budget_revisions")
        .select("id, entry_no, reason, reopened_at, order:garment_order_amendments!garment_order_id(sales_order:sales_orders(order_number))")
        .eq("reopened_by", user.id)
        .eq("outcome", "open")
        .order("reopened_at", { ascending: true });
      if (error) throw error;
      type Row = {
        id: string;
        entry_no: string | null;
        reason: string | null;
        reopened_at: string;
        order: One<{ sales_order: One<{ order_number: string | null }> }>;
      };
      const items = ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        entryNo: r.entry_no,
        reNo: one(one(r.order)?.sales_order ?? null)?.order_number ?? null,
        reason: r.reason,
        raisedAt: r.reopened_at,
      }));
      return { items: items.slice(0, SHOWN), total: items.length };
    } catch (e) {
      return { items: [], total: 0, error: msg(e) };
    }
  };

  const alerts = async (): Promise<Section<MyAlert>> => {
    try {
      const [unread, list] = await Promise.all([getUnreadCount(), listNotifications(20)]);
      const items = list
        .filter((n) => !n.read_at)
        .slice(0, SHOWN)
        .map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, createdAt: n.created_at }));
      return { items, total: unread };
    } catch (e) {
      return { items: [], total: 0, error: msg(e) };
    }
  };

  const [o, t, a, c, r, al] = await Promise.all([orders(), ta(), approvals(), cad(), revisions(), alerts()]);
  return { today: today(), me, orders: o, ta: t, approvals: a, cad: c, revisions: r, alerts: al };
}
