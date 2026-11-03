import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";
import { signedQty, type AdjOrderOption, type AdjStoreOption, type StockAdjustment, type StockAdjustmentLine } from "./stock-adjustment-types";

export interface StockAdjustmentRow extends StockAdjustment {
  store_name: string | null;
  group_label: string;
  line_count: number;
  /** Increases minus decreases, in each line's own UOM — a rough sense of direction only. */
  net_qty: number;
}

/** Every group the header can name — the RPC Opening Stock (0801) declares. */
export async function getAdjustmentOrderOptions(): Promise<AdjOrderOption[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("opening_stock_group_options");
  if (error) throw new Error(`Orders: ${error.message}`);
  return ((data ?? []) as { kind: AdjOrderOption["kind"]; id: string; label: string; customer_name: string | null; inactive: boolean }[]).map(
    (o) => ({ kind: o.kind, id: o.id, label: o.label, customer: o.customer_name, inactive: !!o.inactive }),
  );
}

/** "GENSTK · General Stock", or the order's label. */
export function groupLabel(re: string | null, iwo: string | null, orders: Map<string, AdjOrderOption>): string {
  const id = re ?? iwo;
  if (!id) return "General Stock";
  return orders.get(id)?.label ?? "—";
}

/** The working unit's stores, less Processing / In Transit (a DC's stock — the DB refuses them too). */
export async function getAdjustmentStores(): Promise<AdjStoreOption[]> {
  const { location } = await getCurrentLocation();
  if (!location) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("stores")
    .select("id, name, store_type")
    .eq("location_id", location.id)
    .eq("is_active", true)
    .not("store_type", "in", "(processing,transit)")
    .order("code");
  if (error) throw new Error(`Stores: ${error.message}`);
  return (data ?? []) as AdjStoreOption[];
}

/** RATE and VALUE only to a holder of the Stock Statement with Value screen grant (0793). */
export async function canSeeAdjustmentValue(): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("can_view_report_screen", { p_key: "/reports/stock-statement-value" });
  if (error) return false;
  return data === true;
}

type ListRaw = StockAdjustment & {
  stores: { name: string | null } | null;
  stock_adjustment_lines: { quantity: number; direction: StockAdjustmentLine["direction"] }[] | null;
};

export async function listStockAdjustments(): Promise<StockAdjustmentRow[]> {
  const s = await createClient();
  const [res, orders] = await Promise.all([
    s
      .from("stock_adjustments")
      .select("*, stores(name), stock_adjustment_lines(quantity, direction)")
      // LISTED IN ENTRY ORDER (user 2026-09-22).
      .order("created_at", { ascending: true }),
    getAdjustmentOrderOptions(),
  ]);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (res.error) throw new Error(`Stock adjustments: ${res.error.message}`);
  const byId = new Map(orders.map((o) => [o.id, o]));
  return withCreators(
    ((res.data ?? []) as unknown as ListRaw[]).map(({ stores, stock_adjustment_lines, ...r }) => ({
      ...r,
      store_name: stores?.name ?? null,
      group_label: groupLabel(r.garment_order_id, r.iwo_id, byId),
      line_count: stock_adjustment_lines?.length ?? 0,
      net_qty: (stock_adjustment_lines ?? []).reduce((t, l) => t + signedQty(l.direction, Number(l.quantity) || 0), 0),
    })),
  );
}

type LineRaw = Omit<StockAdjustmentLine, "item_name" | "uom_code" | "lot_no" | "bin_code"> & {
  items: { name: string } | null;
  src: { lot_no: string | null; bins: { bin_code: string } | null; uoms: { code: string } | null } | null;
};

export async function getStockAdjustment(id: string): Promise<{ doc: StockAdjustment; lines: StockAdjustmentLine[] } | null> {
  const s = await createClient();
  const [docRes, linesRes, money] = await Promise.all([
    s.from("stock_adjustments").select("*").eq("id", id).maybeSingle(),
    s
      .from("stock_adjustment_lines")
      .select("*, items(name), src:stock_ledger!source_ledger_id(lot_no, bins(bin_code), uoms(code))")
      .eq("adjustment_id", id)
      .order("sort_order"),
    canSeeAdjustmentValue(),
  ]);
  if (docRes.error) throw new Error(`Stock adjustment: ${docRes.error.message}`);
  if (linesRes.error) throw new Error(`Stock adjustment lines: ${linesRes.error.message}`);
  if (!docRes.data) return null;
  return {
    doc: docRes.data as StockAdjustment,
    lines: ((linesRes.data ?? []) as unknown as LineRaw[]).map(({ items, src, ...l }) => ({
      ...l,
      quantity: Number(l.quantity) || 0,
      item_name: items?.name ?? null,
      uom_code: src?.uoms?.code ?? null,
      lot_no: src?.lot_no ?? null,
      bin_code: src?.bins?.bin_code ?? null,
      rate: money && l.rate != null ? Number(l.rate) : null,
    })),
  };
}
