import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attributeDimension, type ReportField } from "./registry";
import type {
  ItemLedgerRow,
  ItemMovementRow,
  ItemReportFilters,
  ItemStockRow,
  ItemSummaryRow,
} from "./item-types";

/**
 * Server-side reads for the item reports. Every query goes through a SECURITY
 * DEFINER RPC (migration 0352): stock_ledger's RLS demands stores:view AND
 * can_access_store(), so a reports-only user cannot read the tables directly.
 *
 * PostgREST returns Postgres `numeric` as strings to preserve precision — every
 * measure is coerced here so downstream arithmetic and Excel exports get real
 * numbers. This is the same coercion `lib/analytics/service.ts` performs.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const s = (v: unknown): string | null => (v == null ? null : String(v));

function rows(res: { data: unknown }): Record<string, unknown>[] {
  return Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
}

function rpcArgs(f: ItemReportFilters) {
  return {
    p_from: f.from,
    p_to: f.to,
    p_location: f.location || null,
    p_store: f.store || null,
    p_item_class: f.itemClass || null,
    p_category: f.category || null,
    p_sub_category: f.subCategory || null,
    p_item: f.item || null,
  };
}

function attributesOf(v: unknown): Record<string, string> | null {
  return v && typeof v === "object" ? (v as Record<string, string>) : null;
}

function toSummary(r: Record<string, unknown>): ItemSummaryRow {
  return {
    month: String(r.month ?? ""),
    item_id: String(r.item_id ?? ""),
    store_id: s(r.store_id),
    item_code: s(r.item_code),
    item_name: s(r.item_name),
    item_class_id: s(r.item_class_id),
    item_class_name: s(r.item_class_name),
    category_id: s(r.category_id),
    category_name: s(r.category_name),
    sub_category_id: s(r.sub_category_id),
    sub_category_name: s(r.sub_category_name),
    location_id: s(r.location_id),
    stock_uom_code: s(r.stock_uom_code),
    attributes: attributesOf(r.attributes),
    qty_ordered: n(r.qty_ordered),
    qty_opening: n(r.qty_opening),
    qty_received: n(r.qty_received),
    qty_grn_accepted: n(r.qty_grn_accepted),
    qty_grn_rejected: n(r.qty_grn_rejected),
    qty_issued: n(r.qty_issued),
    qty_returned: n(r.qty_returned),
    qty_transfer_in: n(r.qty_transfer_in),
    qty_transfer_out: n(r.qty_transfer_out),
    qty_adjust_in: n(r.qty_adjust_in),
    qty_adjust_out: n(r.qty_adjust_out),
    qty_planned: n(r.qty_planned),
    qty_sent_out: n(r.qty_sent_out),
    qty_came_back: n(r.qty_came_back),
    qty_in: n(r.qty_in),
    qty_out: n(r.qty_out),
    qty_net: n(r.qty_net),
    value_ordered: n(r.value_ordered),
    value_purchased: n(r.value_purchased),
    value_consumed: n(r.value_consumed),
    value_in: n(r.value_in),
    value_out: n(r.value_out),
    value_net: n(r.value_net),
    movements: n(r.movements),
  };
}

function toStock(r: Record<string, unknown>): ItemStockRow {
  return {
    item_id: String(r.item_id ?? ""),
    store_id: s(r.store_id),
    item_code: s(r.item_code),
    item_name: s(r.item_name),
    item_class_id: s(r.item_class_id),
    item_class_name: s(r.item_class_name),
    category_id: s(r.category_id),
    category_name: s(r.category_name),
    sub_category_id: s(r.sub_category_id),
    sub_category_name: s(r.sub_category_name),
    location_id: s(r.location_id),
    stock_uom_code: s(r.stock_uom_code),
    quantity: n(r.quantity),
    value: n(r.value),
  };
}

/** Shift an ISO date by whole days — used for the opening-balance cut-off. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The flagship dataset: period movements per item × store × month, with opening
 * and closing balances grafted on.
 *
 * Balances come from a separate RPC on purpose — a running balance cannot be
 * produced by the same aggregate that produces period measures, and
 * `stock_balances` only ever holds *today*, so an as-of replay is the only way
 * to get a correct opening figure for a past period.
 */
export async function getItemMovement(f: ItemReportFilters): Promise<ItemMovementRow[]> {
  const supabase = await createClient();
  const args = rpcArgs(f);
  const asOfArgs = {
    p_location: args.p_location,
    p_store: args.p_store,
    p_item_class: args.p_item_class,
    p_category: args.p_category,
    p_sub_category: args.p_sub_category,
    p_item: args.p_item,
  };

  const [summary, opening, closing] = await Promise.all([
    supabase.rpc("report_item_summary", { ...args, p_vendor: f.vendor || null }),
    supabase.rpc("report_item_stock_as_of", { p_as_of: shiftDays(f.from, -1), ...asOfArgs }),
    supabase.rpc("report_item_stock_as_of", { p_as_of: f.to, ...asOfArgs }),
  ]);

  const openingBy = new Map<string, ItemStockRow>();
  for (const r of rows(opening).map(toStock)) {
    openingBy.set(`${r.item_id}|${r.store_id ?? ""}`, r);
  }
  const closingBy = new Map<string, ItemStockRow>();
  for (const r of rows(closing).map(toStock)) {
    closingBy.set(`${r.item_id}|${r.store_id ?? ""}`, r);
  }

  // A balance belongs to an item × store, but summary rows are item × store ×
  // MONTH. Attaching the balance to every month would make it count once per
  // month the moment anything rolls those rows up — an item with movements in
  // three months would report triple its opening stock. So the balance is
  // attached to the first (earliest, since the RPC orders by month) row of each
  // item × store and zeroed on the rest, which keeps plain summation correct
  // everywhere downstream.
  const balanceSeen = new Set<string>();

  return rows(summary)
    .map(toSummary)
    .map((r) => {
      const k = `${r.item_id}|${r.store_id ?? ""}`;
      if (balanceSeen.has(k)) {
        return {
          ...r,
          qty_opening_balance: 0,
          qty_closing_balance: 0,
          value_closing_balance: 0,
        };
      }
      balanceSeen.add(k);
      const open = openingBy.get(k);
      const close = closingBy.get(k);
      return {
        ...r,
        qty_opening_balance: open?.quantity ?? 0,
        qty_closing_balance: close?.quantity ?? 0,
        value_closing_balance: close?.value ?? 0,
      };
    });
}

/** Drill-down: one row per movement. */
export async function getItemLedger(
  f: ItemReportFilters,
  factKind?: string | null,
): Promise<ItemLedgerRow[]> {
  const supabase = await createClient();
  const res = await supabase.rpc("report_item_ledger", {
    ...rpcArgs(f),
    p_vendor: f.vendor || null,
    p_fact_kind: factKind || null,
  });

  return rows(res).map((r) => ({
    fact_id: String(r.fact_id ?? ""),
    fact_source: String(r.fact_source ?? ""),
    fact_kind: String(r.fact_kind ?? ""),
    direction: String(r.direction ?? ""),
    posts_to_ledger: Boolean(r.posts_to_ledger),
    txn_date: String(r.txn_date ?? ""),
    item_id: String(r.item_id ?? ""),
    item_code: s(r.item_code),
    item_name: s(r.item_name),
    item_class_name: s(r.item_class_name),
    category_name: s(r.category_name),
    sub_category_name: s(r.sub_category_name),
    store_id: s(r.store_id),
    store_name: s(r.store_name),
    location_id: s(r.location_id),
    uom_code: s(r.uom_code),
    quantity: n(r.quantity),
    rate: r.rate == null ? null : n(r.rate),
    value: r.value == null ? null : n(r.value),
    party_type: s(r.party_type),
    party_name: s(r.party_name),
    doc_type: s(r.doc_type),
    doc_id: s(r.doc_id),
    doc_code: s(r.doc_code),
    note: s(r.note),
  }));
}

/** Stock position at any date, by replaying the ledger. */
export async function getItemStockAsOf(
  asOf: string,
  f: Omit<ItemReportFilters, "from" | "to" | "vendor">,
): Promise<ItemStockRow[]> {
  const supabase = await createClient();
  const res = await supabase.rpc("report_item_stock_as_of", {
    p_as_of: asOf,
    p_location: f.location || null,
    p_store: f.store || null,
    p_item_class: f.itemClass || null,
    p_category: f.category || null,
    p_sub_category: f.subCategory || null,
    p_item: f.item || null,
  });
  return rows(res).map(toStock);
}

/**
 * Material attributes currently defined in Masters, as groupable dimensions.
 *
 * Read live rather than hard-coded: this is what makes a newly-added attribute
 * show up as a report axis without touching any report code.
 */
export async function listAttributeDimensions(): Promise<ReportField[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attribute_values")
    .select("value")
    .order("value");

  const names = new Set<string>();
  for (const r of (data ?? []) as { value: string | null }[]) {
    const v = r.value?.trim();
    if (v) names.add(v);
  }
  return [...names].map(attributeDimension);
}

/** Filter dropdown sources for the report toolbar. */
export async function getItemReportFilterOptions() {
  const supabase = await createClient();
  const [locations, stores, itemClasses, categories] = await Promise.all([
    supabase.from("locations").select("id, name").eq("is_active", true).order("name"),
    supabase.from("stores").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("config_lookups")
      .select("id, name")
      .eq("kind", "item_class")
      .eq("is_active", true)
      .order("name"),
    supabase.from("categories").select("id, name").eq("inactive", false).order("name"),
  ]);

  const opts = (res: { data: unknown }) =>
    rows(res).map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));

  return {
    locations: opts(locations),
    stores: opts(stores),
    itemClasses: opts(itemClasses),
    categories: opts(categories),
  };
}
