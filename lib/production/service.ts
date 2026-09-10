import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import {
  summariseProgress,
  upstreamStage,
  type ProductionLine,
  type ProductionEntry,
  type ProductionStage,
  type EntryStatus,
  type StageProgress,
} from "./types";

// ---- enriched types returned by service ----

export type EntryWithRelations = ProductionEntry & {
  production_lines: Pick<ProductionLine, "id" | "code" | "name"> | null;
  garment_order_amendments: {
    id: string;
    code: string | null;
    sales_order: { order_number: string | null } | null;
  } | null;
};

/** How much of the upstream stage's own output this stage can still draw on. */
export type StageAvailability = {
  stage: ProductionStage;
  upstreamStage: ProductionStage | null;
  /** null when `stage` is Cutting — there is no upstream to check. */
  upstreamQty: number | null;
  ownQty: number;
  /** `upstreamQty - ownQty`, floored at 0. null when there is no upstream. */
  availableQty: number | null;
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
  return withCreators((data ?? []) as ProductionLine[]);
}

const ENTRY_SELECT =
  "*, production_lines(id, code, name), " +
  "garment_order_amendments(id, code, sales_order:sales_orders(order_number))";

export async function getEntries(
  filters: {
    /** A `garment_order_amendments.id` (0548) — not a sales order id. */
    amendmentId?: string;
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
    .select(ENTRY_SELECT)
    .order("created_at", { ascending: false });

  if (filters.amendmentId) query = query.eq("amendment_id", filters.amendmentId);
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
    .select(ENTRY_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as EntryWithRelations[];
}

export type StageWip = { qty: number; lastEntryDate: string | null };

/**
 * Batch cumulative-good-qty lookups across (amendment, stage) pairs, through
 * `stage_cumulative_good_qty` (0548) — the ONE function that answers "how much
 * has this stage produced", and this is the one batching wrapper around it.
 * `getStageAvailability` below, `lib/ta/worklist.ts`'s derived bypass, and the
 * Order Entry T&A tab's bypass display all call this rather than each running
 * its own `.rpc()` loop, so the three screens can never sum it differently.
 * De-dupes pairs before calling — a caller building pairs from several rows
 * that share a (amendment, stage) is common (several T&A rows can name the
 * same activity in principle) and would otherwise double the RPC traffic for
 * an answer that is the same both times.
 */
export async function stageWipByPair(
  pairs: { amendmentId: string; stage: ProductionStage }[],
): Promise<Map<string, StageWip>> {
  const map = new Map<string, StageWip>();
  const unique = new Map(pairs.map((p) => [`${p.amendmentId}|${p.stage}`, p]));
  if (!unique.size) return map;

  const supabase = await createClient();
  await Promise.all(
    [...unique.entries()].map(async ([key, { amendmentId, stage }]) => {
      const { data, error } = await supabase.rpc("stage_cumulative_good_qty", {
        p_amendment_id: amendmentId,
        p_stage: stage,
      });
      if (error) return;
      const row = (data as { cumulative_qty: number; last_entry_date: string | null }[] | null)?.[0];
      map.set(key, {
        qty: Number(row?.cumulative_qty ?? 0),
        lastEntryDate: row?.last_entry_date ?? null,
      });
    }),
  );
  return map;
}

/**
 * How much of `upstreamStage(stage)`'s own cumulative good output this stage
 * has NOT yet drawn on — the WIP ceiling `recordEntry()` guards against, shown
 * to the operator BEFORE they type rather than only as a rejection after Save.
 */
export async function getStageAvailability(
  amendmentId: string,
  stage: ProductionStage,
): Promise<StageAvailability> {
  const upstream = upstreamStage(stage);
  const wip = await stageWipByPair(
    upstream
      ? [{ amendmentId, stage }, { amendmentId, stage: upstream }]
      : [{ amendmentId, stage }],
  );

  const ownQty = wip.get(`${amendmentId}|${stage}`)?.qty ?? 0;
  const upstreamQty = upstream ? (wip.get(`${amendmentId}|${upstream}`)?.qty ?? 0) : null;

  return {
    stage,
    upstreamStage: upstream,
    upstreamQty,
    ownQty,
    availableQty: upstreamQty != null ? Math.max(0, upstreamQty - ownQty) : null,
  };
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

/**
 * Active orders (not cancelled/closed) for the order picker dropdown.
 *
 * `OrderPickerItem.id` IS AN AMENDMENT ID, not a sales order id (0548) — the
 * picker resolves each order to its CURRENT amendment
 * (`currentAmendmentsBySalesOrder`, the same tie-break `lib/ta/worklist.ts`
 * uses) because that is what `production_entries.amendment_id` now FKs to. An
 * order whose current amendment is still a draft is left out: floor output is
 * a fact about a finalised document, and a draft amendment can still be
 * discarded or rewritten under it.
 */
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

  const orderList = (data ?? []) as unknown as RawOrder[];
  if (!orderList.length) return [];

  const current = await currentAmendmentsBySalesOrder(
    supabase,
    orderList.map((o) => o.id),
  );

  const items: OrderPickerItem[] = [];
  for (const o of orderList) {
    const amendment = current.get(o.id);
    if (!amendment || amendment.isDraft) continue;
    items.push({
      id: amendment.id,
      order_number: o.order_number,
      buyer_name: o.buyers?.name ?? null,
      order_qty: o.order_qty,
    });
  }
  return items;
}

/** Alias used in page.tsx — same as getOrdersForPicker. */
export async function getActiveOrders(): Promise<OrderPickerItem[]> {
  return getOrdersForPicker();
}

/**
 * Per-order confirmed progress across all stages, for the merchandiser view.
 *
 * Entries key on `amendment_id` (0548), not `sales_order_id` — so this
 * resolves each order's CURRENT amendment (same helper `getOrdersForPicker`
 * uses) and reads entries against that amendment id, falling back to the
 * legacy `sales_order_id` column for any pre-0548 row a backfill could not
 * resolve to an amendment. A superseded amendment's entries are excluded,
 * consistent with how `lib/ta/worklist.ts` treats a superseded amendment's
 * schedule as replaced rather than current.
 */
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

  const current = await currentAmendmentsBySalesOrder(supabase, orderIds);
  const orderByAmendment = new Map<string, string>();
  for (const [orderId, a] of current) orderByAmendment.set(a.id, orderId);
  const amendmentIds = [...orderByAmendment.keys()];

  type RawEntry = Pick<ProductionEntry, "stage" | "good_qty" | "reject_qty" | "status"> & {
    amendment_id: string | null;
    sales_order_id: string | null;
  };

  const [{ data: currentEntries }, { data: legacyEntries }] = await Promise.all([
    amendmentIds.length
      ? supabase
          .from("production_entries")
          .select("amendment_id, sales_order_id, stage, good_qty, reject_qty, status")
          .in("amendment_id", amendmentIds)
      : Promise.resolve({ data: [] as RawEntry[] }),
    supabase
      .from("production_entries")
      .select("amendment_id, sales_order_id, stage, good_qty, reject_qty, status")
      .in("sales_order_id", orderIds)
      .is("amendment_id", null),
  ]);

  const entryList = [
    ...((currentEntries ?? []) as unknown as RawEntry[]),
    ...((legacyEntries ?? []) as unknown as RawEntry[]),
  ];
  const resolvedOrderId = (e: RawEntry) =>
    (e.amendment_id && orderByAmendment.get(e.amendment_id)) || e.sales_order_id;

  return orderList.map((o) => {
    const orderEntries = entryList.filter((e) => resolvedOrderId(e) === o.id);
    const progress = summariseProgress(orderEntries);

    // Flag a gap wherever a downstream stage's confirmed good qty trails its
    // own upstream stage's — only meaningful once the downstream stage has
    // started. `upstreamStage()` walks PRODUCTION_STAGES so this covers all
    // 5 stages, not just the original cutting/sewing/packing three.
    const goodByStage = new Map(progress.map((p) => [p.stage, p.good]));
    const has_gap = progress.some((p) => {
      const up = upstreamStage(p.stage);
      if (!up) return false;
      const upGood = goodByStage.get(up) ?? 0;
      return p.good > 0 && p.good < upGood;
    });

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
