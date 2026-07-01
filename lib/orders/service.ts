import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  ORDER_STATUSES,
  type SalesOrder,
  type SoLineItem,
  type OrderAmendment,
  type TaPlan,
  type TaMilestone,
  type MilestoneStatus,
} from "./types";
import type { Buyer } from "@/lib/masters/types";
import type { Quote } from "@/lib/sales/types";

/** Sales order enriched with buyer for list / detail views. */
export type OrderWithBuyer = SalesOrder & {
  buyers: Pick<Buyer, "id" | "name" | "country"> | null;
};

/** Flattened milestone row for the T&A dashboard table. */
export type DashboardMilestoneRow = {
  id: string;
  sales_order_id: string;
  name: string;
  planned_date: string | null;
  status: MilestoneStatus;
  order_number: string | null;
  buyer_name: string | null;
};

export type OrderStatusCount = { status: string; count: number };

export type DashboardData = {
  openOrders: number;
  overdueCount: number;
  dueThisWeekCount: number;
  pendingAmendments: number;
  statusCounts: OrderStatusCount[];
  milestoneRows: DashboardMilestoneRow[];
};

/** Accepted quote enriched with buyer + opportunity for the new-order form. */
export type QuoteWithContext = Quote & {
  buyers: Pick<Buyer, "id" | "name" | "currency_code"> | null;
  opportunities: { id: string; title: string } | null;
};

/** Lightweight order revision (matches order_revisions table). */
export type OrderRevision = {
  id: string;
  sales_order_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

// ---------- order list / detail ----------

export async function getOrders(): Promise<OrderWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("*, buyers(id, name, country)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as OrderWithBuyer[];
}

export async function getOrder(id: string): Promise<OrderWithBuyer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("*, buyers(id, name, country)")
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as OrderWithBuyer | null;
}

export async function getOrderLines(orderId: string): Promise<SoLineItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("so_line_items")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("created_at");
  return (data ?? []) as SoLineItem[];
}

export async function getAmendments(orderId: string): Promise<OrderAmendment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_amendments")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderAmendment[];
}

export async function getRevisions(orderId: string): Promise<OrderRevision[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_revisions")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("version", { ascending: false });
  return (data ?? []) as OrderRevision[];
}

export async function getTaPlan(orderId: string): Promise<TaPlan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_plans")
    .select("*")
    .eq("sales_order_id", orderId)
    .maybeSingle();
  return (data ?? null) as TaPlan | null;
}

export async function getTaMilestones(orderId: string): Promise<TaMilestone[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_milestones")
    .select("*")
    .eq("sales_order_id", orderId)
    .order("sequence");
  return (data ?? []) as TaMilestone[];
}

export async function getTemplates(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ta_templates")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

// ---------- new-order form helpers ----------

export async function getAcceptedQuotes(): Promise<QuoteWithContext[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotes")
    .select("*, buyers(id, name, currency_code), opportunities(id, title)")
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as QuoteWithContext[];
}

export async function getBuyers(): Promise<Pick<Buyer, "id" | "name" | "code" | "currency_code">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, name, code, currency_code")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export async function getLocations(): Promise<{ id: string; code: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return data ?? [];
}

// ---------- dashboard ----------

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const weekLaterStr = new Date(now.getTime() + 7 * 86_400_000)
    .toISOString()
    .split("T")[0];

  const [
    { count: openOrders },
    { count: overdueCount },
    { count: dueThisWeekCount },
    { count: pendingAmendments },
    { data: allOrders },
    { data: rawMilestones },
  ] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["confirmed", "in_production"]),
    supabase
      .from("ta_milestones")
      .select("id", { count: "exact", head: true })
      .lt("planned_date", todayStr)
      .neq("status", "done"),
    supabase
      .from("ta_milestones")
      .select("id", { count: "exact", head: true })
      .gte("planned_date", todayStr)
      .lte("planned_date", weekLaterStr)
      .neq("status", "done"),
    supabase
      .from("order_amendments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("sales_orders").select("status"),
    // milestones due this week + overdue: planned_date <= weekLater and not done
    supabase
      .from("ta_milestones")
      .select(
        "id, sales_order_id, name, planned_date, status, sales_orders!inner(order_number, buyers!inner(name))",
      )
      .not("planned_date", "is", null)
      .lte("planned_date", weekLaterStr)
      .neq("status", "done")
      .order("planned_date", { ascending: true }),
  ]);

  const statusCounts: OrderStatusCount[] = ORDER_STATUSES.map((status) => ({
    status,
    count: (allOrders ?? []).filter((o) => o.status === status).length,
  }));

  const milestoneRows: DashboardMilestoneRow[] = (
    (rawMilestones ?? []) as Record<string, unknown>[]
  ).map((m) => {
    const so = m.sales_orders as Record<string, unknown> | null;
    const buyer = so?.buyers as Record<string, unknown> | null;
    return {
      id: m.id as string,
      sales_order_id: m.sales_order_id as string,
      name: m.name as string,
      planned_date: m.planned_date as string | null,
      status: m.status as MilestoneStatus,
      order_number: (so?.order_number as string | null) ?? null,
      buyer_name: (buyer?.name as string | null) ?? null,
    };
  });

  return {
    openOrders: openOrders ?? 0,
    overdueCount: overdueCount ?? 0,
    dueThisWeekCount: dueThisWeekCount ?? 0,
    pendingAmendments: pendingAmendments ?? 0,
    statusCounts,
    milestoneRows,
  };
}
