import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  summariseProgress,
  type ProductionLine,
  type ProductionEntry,
  type ProductionStage,
  type EntryStatus,
  type StageProgress,
} from "./types";

// ---- enriched types returned by service ----

export type EntryWithRelations = ProductionEntry & {
  production_lines: Pick<ProductionLine, "id" | "code" | "name"> | null;
  sales_orders: { id: string; order_number: string | null; order_qty: number } | null;
};

export type LineDashboardRow = {
  line_id: string | null;
  line_code: string | null;
  line_name: string | null;
  stage: ProductionStage;
  good_confirmed: number;
  reject_confirmed: number;
  good_recorded: number;
  reject_recorded: number;
  pending_count: number;
};

export type OrderProgressRow = {
  id: string;
  order_number: string | null;
  order_qty: number;
  buyer_name: string | null;
  progress: StageProgress[];
  has_gap: boolean;
};

export type OrderPickerItem = {
  id: string;
  order_number: string | null;
  buyer_name: string | null;
  order_qty: number;
};

// ---- queries ----

export async function listLines(): Promise<ProductionLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_lines")
    .select("*")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as ProductionLine[];
}

export async function getEntries(
  filters: {
    orderId?: string;
    stage?: ProductionStage;
    lineId?: string;
    date?: string;
    status?: EntryStatus;
  } = {},
): Promise<EntryWithRelations[]> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("production_entries")
    .select(
      "*, production_lines(id, code, name), sales_orders(id, order_number, order_qty)",
    )
    .order("created_at", { ascending: false });

  if (filters.orderId) query = query.eq("sales_order_id", filters.orderId);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.lineId) query = query.eq("line_id", filters.lineId);
  if (filters.date) query = query.eq("entry_date", filters.date);
  if (filters.status) query = query.eq("status", filters.status);

  const { data } = await query;
  return (data ?? []) as unknown as EntryWithRelations[];
}

export async function getRecentEntries(
  limit = 20,
): Promise<EntryWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_entries")
    .select(
      "*, production_lines(id, code, name), sales_orders(id, order_number, order_qty)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as EntryWithRelations[];
}

/** Today's output aggregated per line × stage, for the manager dashboard. */
export async function getLineDashboard(date: string): Promise<LineDashboardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_entries")
    .select("line_id, stage, good_qty, reject_qty, status, production_lines(id, code, name)")
    .eq("entry_date", date);

  type RawRow = {
    line_id: string | null;
    stage: ProductionStage;
    good_qty: number;
    reject_qty: number;
    status: EntryStatus;
    production_lines: { id: string; code: string; name: string } | null;
  };

  const entries = (data ?? []) as unknown as RawRow[];

  // aggregate in JS — avoids needing an RPC for sums
  const map = new Map<string, LineDashboardRow>();
  for (const e of entries) {
    const key = `${e.line_id ?? "__none__"}::${e.stage}`;
    if (!map.has(key)) {
      map.set(key, {
        line_id: e.line_id,
        line_code: e.production_lines?.code ?? null,
        line_name: e.production_lines?.name ?? null,
        stage: e.stage,
        good_confirmed: 0,
        reject_confirmed: 0,
        good_recorded: 0,
        reject_recorded: 0,
        pending_count: 0,
      });
    }
    const row = map.get(key)!;
    if (e.status === "confirmed") {
      row.good_confirmed += e.good_qty;
      row.reject_confirmed += e.reject_qty;
    } else {
      row.good_recorded += e.good_qty;
      row.reject_recorded += e.reject_qty;
      row.pending_count += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    (a.line_code ?? "").localeCompare(b.line_code ?? ""),
  );
}

/** Active orders (not cancelled/closed) for the order picker dropdown. */
export async function getOrdersForPicker(): Promise<OrderPickerItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, order_qty, buyers(name)")
    .neq("status", "cancelled")
    .neq("status", "closed")
    .order("created_at", { ascending: false });

  type RawOrder = {
    id: string;
    order_number: string | null;
    order_qty: number;
    buyers: { name: string } | null;
  };

  return ((data ?? []) as unknown as RawOrder[]).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    buyer_name: o.buyers?.name ?? null,
    order_qty: o.order_qty,
  }));
}

/** Alias used in page.tsx — same as getOrdersForPicker. */
export async function getActiveOrders(): Promise<OrderPickerItem[]> {
  return getOrdersForPicker();
}

/** Per-order confirmed progress across all stages, for the merchandiser view. */
export async function getOrderProgress(): Promise<OrderProgressRow[]> {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("sales_orders")
    .select("id, order_number, order_qty, buyers(name)")
    .neq("status", "cancelled")
    .neq("status", "closed")
    .order("created_at", { ascending: false });

  if (!orders?.length) return [];

  type RawOrder = {
    id: string;
    order_number: string | null;
    order_qty: number;
    buyers: { name: string } | null;
  };

  const orderList = orders as unknown as RawOrder[];
  const orderIds = orderList.map((o) => o.id);

  const { data: entries } = await supabase
    .from("production_entries")
    .select("sales_order_id, stage, good_qty, reject_qty, status")
    .in("sales_order_id", orderIds);

  type RawEntry = Pick<ProductionEntry, "stage" | "good_qty" | "reject_qty" | "status"> & {
    sales_order_id: string;
  };

  const entryList = (entries ?? []) as unknown as RawEntry[];

  return orderList.map((o) => {
    const orderEntries = entryList.filter((e) => e.sales_order_id === o.id);
    const progress = summariseProgress(orderEntries);

    // flag if a downstream stage's confirmed good qty trails an upstream stage's
    // (only meaningful when the downstream stage has started)
    const cuttingGood = progress.find((p) => p.stage === "cutting")?.good ?? 0;
    const sewingGood = progress.find((p) => p.stage === "sewing")?.good ?? 0;
    const packingGood = progress.find((p) => p.stage === "packing")?.good ?? 0;
    const has_gap =
      (sewingGood > 0 && sewingGood < cuttingGood) ||
      (packingGood > 0 && packingGood < sewingGood);

    return {
      id: o.id,
      order_number: o.order_number,
      order_qty: o.order_qty,
      buyer_name: o.buyers?.name ?? null,
      progress,
      has_gap,
    };
  });
}
