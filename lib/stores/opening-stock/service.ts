import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";
import { isInactive } from "@/lib/masters/inactive";
import type {
  OpeningBinOption,
  OpeningGroupOption,
  OpeningItemOption,
  OpeningStock,
  OpeningStockLine,
  OpeningStoreOption,
} from "./types";

export interface OpeningStockRow extends OpeningStock {
  store_name: string | null;
  group_label: string;
  line_count: number;
  total_value: number;
}

type ListRaw = OpeningStock & {
  stores: { name: string | null } | null;
  opening_stock_lines: { quantity: number | null; rate: number | null }[] | null;
};

/** Every order a header can name, labelled as Stock Statement prints it. Invoker: RLS scopes it. */
export async function getOpeningGroupOptions(): Promise<OpeningGroupOption[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("opening_stock_group_options");
  if (error) throw new Error(`Opening stock orders: ${error.message}`);
  return ((data ?? []) as { kind: OpeningGroupOption["kind"]; id: string; label: string; customer_name: string | null; inactive: boolean }[]).map(
    (o) => ({
      kind: o.kind,
      id: o.id,
      code: null,
      name: o.customer_name ? `${o.label} — ${o.customer_name}` : o.label,
      customer_name: o.customer_name,
      inactive: !!o.inactive,
    }),
  );
}

function groupLabel(d: OpeningStock, orders: Map<string, OpeningGroupOption>): string {
  if (d.group_kind === "general") return "General stock";
  const id = d.group_kind === "re" ? d.garment_order_id : d.iwo_id;
  return (id && orders.get(id)?.name) || "—";
}

export async function listOpeningStocks(): Promise<OpeningStockRow[]> {
  const s = await createClient();
  const [docs, orders] = await Promise.all([
    s
      .from("opening_stocks")
      .select("*, stores(name), opening_stock_lines(quantity, rate)")
      // LISTED IN ENTRY ORDER (user 2026-09-22).
      .order("created_at", { ascending: true }),
    getOpeningGroupOptions(),
  ]);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (docs.error) throw new Error(`Opening stock: ${docs.error.message}`);
  const byId = new Map(orders.map((o) => [o.id, o]));
  return withCreators(
    ((docs.data ?? []) as unknown as ListRaw[]).map(({ stores, opening_stock_lines, ...d }) => {
      const lines = opening_stock_lines ?? [];
      return {
        ...d,
        store_name: stores?.name ?? null,
        group_label: groupLabel(d, byId),
        line_count: lines.length,
        total_value: lines.reduce((a, l) => a + Number(l.quantity ?? 0) * Number(l.rate ?? 0), 0),
      };
    }),
  );
}

export async function getOpeningStock(id: string): Promise<{ doc: OpeningStock; lines: OpeningStockLine[] } | null> {
  const s = await createClient();
  const { data: doc, error } = await s.from("opening_stocks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Opening stock: ${error.message}`);
  if (!doc) return null;
  const { data: lines, error: lErr } = await s
    .from("opening_stock_lines")
    .select("id, item_id, store_id, lot_no, ref_no, ref_date, bags, bag_weight, quantity, rate, uom_id, note, sort_order, opening_stock_line_bins(bin_id, qty, sort_order)")
    .eq("opening_stock_id", id)
    .order("sort_order");
  if (lErr) throw new Error(`Opening stock lines: ${lErr.message}`);
  type Raw = Omit<OpeningStockLine, "bins"> & { opening_stock_line_bins: { bin_id: string; qty: number; sort_order: number }[] | null };
  return {
    doc: doc as OpeningStock,
    lines: ((lines ?? []) as unknown as Raw[]).map(({ opening_stock_line_bins, ...l }) => ({
      ...l,
      quantity: Number(l.quantity),
      rate: l.rate == null ? null : Number(l.rate),
      bags: l.bags == null ? null : Number(l.bags),
      bag_weight: l.bag_weight == null ? null : Number(l.bag_weight),
      bins: (opening_stock_line_bins ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((b) => ({ bin_id: b.bin_id, qty: Number(b.qty) })),
    })),
  };
}

/**
 * Items, with class and stock UOM. Read as three flat queries rather than embeds: `items`
 * holds several FKs to `uoms` and to `config_lookups`, so a bare embed is ambiguous
 * (AGENTS.md "A SECOND FK BREAKS EVERY EXISTING EMBED").
 */
export async function getOpeningItems(): Promise<OpeningItemOption[]> {
  const s = await createClient();
  const [items, uoms, classes] = await Promise.all([
    s.from("items").select("id, code, name, is_active, item_class_id, uom_id, stock_uom_id, budget_rate").order("name"),
    s.from("uoms").select("id, code"),
    s.from("config_lookups").select("id, code, name").eq("kind", "item_class"),
  ]);
  if (items.error) throw new Error(`Items: ${items.error.message}`);
  if (uoms.error) throw new Error(`UOMs: ${uoms.error.message}`);
  if (classes.error) throw new Error(`Item classes: ${classes.error.message}`);
  const uomCode = new Map((uoms.data ?? []).map((u) => [u.id as string, u.code as string]));
  const cls = new Map((classes.data ?? []).map((c) => [c.id as string, c as { id: string; code: string | null; name: string | null }]));
  return (
    (items.data ?? []) as {
      id: string;
      code: string | null;
      name: string | null;
      is_active: boolean | null;
      item_class_id: string | null;
      uom_id: string | null;
      stock_uom_id: string | null;
      budget_rate: number | null;
    }[]
  ).map((i) => {
    const c = i.item_class_id ? cls.get(i.item_class_id) : undefined;
    const uom = i.stock_uom_id ?? i.uom_id;
    return {
      id: i.id,
      code: i.code,
      name: i.name ?? "—",
      inactive: isInactive(i),
      item_class_id: i.item_class_id,
      item_class: c?.name ?? null,
      is_yarn: (c?.code ?? "").toUpperCase() === "YARN",
      uom_id: uom,
      uom_code: uom ? (uomCode.get(uom) ?? null) : null,
      budget_rate: i.budget_rate == null ? null : Number(i.budget_rate),
    };
  });
}

/** The working unit's stores and their bins (0800: every bin belongs to a store). */
export async function getOpeningStoresAndBins(): Promise<{ stores: OpeningStoreOption[]; bins: OpeningBinOption[] }> {
  const { location } = await getCurrentLocation();
  if (!location) return { stores: [], bins: [] };
  const s = await createClient();
  const [stores, bins] = await Promise.all([
    s
      .from("stores")
      .select("id, name, store_type")
      .eq("location_id", location.id)
      .eq("is_active", true)
      // Transit is goods on the road, never a place to count opening stock into.
      .neq("store_type", "transit")
      .order("code"),
    s.from("bins").select("id, bin_code, description, inactive, store_id").eq("location_id", location.id).order("bin_code"),
  ]);
  if (stores.error) throw new Error(`Stores: ${stores.error.message}`);
  if (bins.error) throw new Error(`Bins: ${bins.error.message}`);
  return {
    stores: (stores.data ?? []) as OpeningStoreOption[],
    bins: ((bins.data ?? []) as { id: string; bin_code: string; description: string | null; inactive: boolean | null; store_id: string | null }[]).map(
      (b) => ({ id: b.id, code: b.bin_code, description: b.description, inactive: !!b.inactive, store_id: b.store_id }),
    ),
  };
}
