import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentLocation } from "@/lib/auth/location";
import { withCreators } from "@/lib/created-by";

/**
 * PRODUCTION DC — material moved between units (doc/stores/dc-plan.md, 0784).
 *
 * One `delivery_challans` row with `dc_kind = 'production'`. Both units read it (RLS): the
 * SENDER (`location_id`) drafts and dispatches it, the RECEIVER (`to_location_id`) receives
 * it. Reads here are separate queries, never embeds — `delivery_challans` carries two FKs to
 * `locations` and two to `profiles`, so a bare embed of either is PGRST201.
 */

export type ProductionDcRow = {
  id: string;
  code: string | null;
  dc_date: string | null;
  status: string;
  location_id: string;
  to_location_id: string;
  from_unit: string;
  to_unit: string;
  vehicle_no: string | null;
  /** This unit sent it (true) or is receiving it (false). */
  outgoing: boolean;
  line_count: number;
  sent_total: number;
  created_at: string;
  created_by: string | null;
};

export type ProductionDcLine = {
  id: string;
  item_id: string;
  item_name: string;
  uom: string | null;
  description: string | null;
  sent_qty: number;
  from_store_id: string | null;
  from_store: string | null;
  bin_id: string | null;
  bin_code: string | null;
  lot_no: string | null;
  received_qty: number;
  shortage_qty: number;
  shortage_reason: string | null;
  to_store: string | null;
  to_bin: string | null;
  sort_order: number;
};

export type ProductionDc = ProductionDcRow & {
  transporter: string | null;
  eway_bill_no: string | null;
  notes: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  lines: ProductionDcLine[];
};

export type UnitOption = { id: string; code: string; name: string };
export type StoreOption = { id: string; code: string; name: string; store_type: string };
export type BinOption = { id: string; code: string };
/** What a store of THIS unit holds — the Send grid's item list and its qty cap. */
export type StockOption = { store_id: string; item_id: string; item_name: string; uom: string | null; qty: number };

async function unitNames(): Promise<Map<string, UnitOption>> {
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("id, code, name").eq("is_active", true).order("code");
  return new Map(((data ?? []) as UnitOption[]).map((l) => [l.id, l]));
}

export async function listProductionDcs(): Promise<ProductionDcRow[]> {
  const supabase = await createClient();
  const [{ location }, units, dcRes] = await Promise.all([
    getCurrentLocation(),
    unitNames(),
    supabase
      .from("delivery_challans")
      .select("id, code, dc_date, status, location_id, to_location_id, vehicle_no, created_at, created_by")
      .eq("dc_kind", "production")
      // LISTED IN ENTRY ORDER (user 2026-09-22).
      .order("created_at", { ascending: true }),
  ]);
  if (dcRes.error) throw new Error(`Production DCs: ${dcRes.error.message}`);
  const rows = (dcRes.data ?? []) as {
    id: string;
    code: string | null;
    dc_date: string | null;
    status: string;
    location_id: string;
    to_location_id: string;
    vehicle_no: string | null;
    created_at: string;
    created_by: string | null;
  }[];
  const ids = rows.map((r) => r.id);
  const linesRes = ids.length
    ? await supabase.from("dc_line_items").select("delivery_challan_id, sent_qty").in("delivery_challan_id", ids)
    : { data: [], error: null };
  if (linesRes.error) throw new Error(`Production DC lines: ${linesRes.error.message}`);
  const agg = new Map<string, { n: number; qty: number }>();
  for (const l of (linesRes.data ?? []) as { delivery_challan_id: string; sent_qty: number }[]) {
    const a = agg.get(l.delivery_challan_id) ?? { n: 0, qty: 0 };
    a.n += 1;
    a.qty += Number(l.sent_qty) || 0;
    agg.set(l.delivery_challan_id, a);
  }
  return withCreators(
    rows.map((r) => ({
      ...r,
      from_unit: units.get(r.location_id)?.name ?? "—",
      to_unit: units.get(r.to_location_id)?.name ?? "—",
      outgoing: r.location_id === location?.id,
      line_count: agg.get(r.id)?.n ?? 0,
      sent_total: agg.get(r.id)?.qty ?? 0,
    })),
  );
}

export async function getProductionDc(id: string): Promise<ProductionDc | null> {
  const supabase = await createClient();
  const [{ location }, units, dcRes, linesRes] = await Promise.all([
    getCurrentLocation(),
    unitNames(),
    supabase.from("delivery_challans").select("*").eq("id", id).eq("dc_kind", "production").maybeSingle(),
    supabase
      .from("dc_line_items")
      .select(
        "id, item_id, description, sent_qty, from_store_id, bin_id, lot_no, received_qty, shortage_qty, shortage_reason, to_store_id, to_bin_id, sort_order",
      )
      .eq("delivery_challan_id", id)
      .order("sort_order"),
  ]);
  if (dcRes.error) throw new Error(`Production DC: ${dcRes.error.message}`);
  if (!dcRes.data) return null;
  const d = dcRes.data as Record<string, unknown>;
  const raw = (linesRes.data ?? []) as {
    id: string;
    item_id: string;
    description: string | null;
    sent_qty: number;
    from_store_id: string | null;
    bin_id: string | null;
    lot_no: string | null;
    received_qty: number;
    shortage_qty: number;
    shortage_reason: string | null;
    to_store_id: string | null;
    to_bin_id: string | null;
    sort_order: number;
  }[];
  const itemIds = [...new Set(raw.map((l) => l.item_id))];
  // The stores and bins of BOTH units: the receiver's are read through the definer-free
  // tables the user can see; a name the reader may not see simply prints "—".
  const storeIds = [...new Set(raw.flatMap((l) => [l.from_store_id, l.to_store_id]).filter((x): x is string => !!x))];
  const binIds = [...new Set(raw.flatMap((l) => [l.bin_id, l.to_bin_id]).filter((x): x is string => !!x))];
  const [itemRes, storeRes, binRes] = await Promise.all([
    itemIds.length ? supabase.from("items").select("id, name, uom_id, uoms!uom_id(code)").in("id", itemIds) : Promise.resolve({ data: [] }),
    storeIds.length ? supabase.from("stores").select("id, name").in("id", storeIds) : Promise.resolve({ data: [] }),
    binIds.length ? supabase.from("bins").select("id, bin_code").in("id", binIds) : Promise.resolve({ data: [] }),
  ]);
  const items = new Map(
    ((itemRes.data ?? []) as unknown as { id: string; name: string; uoms: { code: string } | null }[]).map((i) => [i.id, i]),
  );
  const stores = new Map(((storeRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const bins = new Map(((binRes.data ?? []) as { id: string; bin_code: string }[]).map((b) => [b.id, b.bin_code]));
  const lines: ProductionDcLine[] = raw.map((l) => ({
    ...l,
    item_name: items.get(l.item_id)?.name ?? l.description ?? "—",
    uom: items.get(l.item_id)?.uoms?.code ?? null,
    sent_qty: Number(l.sent_qty) || 0,
    received_qty: Number(l.received_qty) || 0,
    shortage_qty: Number(l.shortage_qty) || 0,
    from_store: l.from_store_id ? (stores.get(l.from_store_id) ?? null) : null,
    bin_code: l.bin_id ? (bins.get(l.bin_id) ?? null) : null,
    to_store: l.to_store_id ? (stores.get(l.to_store_id) ?? null) : null,
    to_bin: l.to_bin_id ? (bins.get(l.to_bin_id) ?? null) : null,
  }));
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  return {
    id,
    code: str("code"),
    dc_date: str("dc_date"),
    status: String(d.status),
    location_id: String(d.location_id),
    to_location_id: String(d.to_location_id),
    from_unit: units.get(String(d.location_id))?.name ?? "—",
    to_unit: units.get(String(d.to_location_id))?.name ?? "—",
    vehicle_no: str("vehicle_no"),
    transporter: str("transporter"),
    eway_bill_no: str("eway_bill_no"),
    notes: str("notes"),
    dispatched_at: str("dispatched_at"),
    received_at: str("received_at"),
    outgoing: d.location_id === location?.id,
    line_count: lines.length,
    sent_total: lines.reduce((a, l) => a + l.sent_qty, 0),
    created_at: String(d.created_at),
    created_by: str("created_by"),
    lines,
  };
}

/** The working unit, the units it may send to, its stores and bins, and what each store holds. */
export async function getProductionDcSetup(): Promise<{
  unit: UnitOption | null;
  toUnits: UnitOption[];
  stores: StoreOption[];
  bins: BinOption[];
  stock: StockOption[];
}> {
  const supabase = await createClient();
  const [{ location }, units] = await Promise.all([getCurrentLocation(), unitNames()]);
  const unitId = location?.id ?? null;
  if (!unitId) return { unit: null, toUnits: [], stores: [], bins: [], stock: [] };
  const [storeRes, binRes] = await Promise.all([
    supabase
      .from("stores")
      .select("id, code, name, store_type")
      .eq("location_id", unitId)
      .eq("is_active", true)
      // In Transit is where goods WAIT, never a store to send from or receive into.
      .neq("store_type", "transit")
      .order("code"),
    supabase.from("bins").select("id, bin_code, inactive").eq("location_id", unitId).order("bin_code"),
  ]);
  const stores = (storeRes.data ?? []) as StoreOption[];
  const storeIds = stores.map((s) => s.id);
  const balRes = storeIds.length
    ? await supabase
        .from("stock_balances")
        .select("store_id, item_id, quantity, items!item_id(name, uoms!uom_id(code))")
        .in("store_id", storeIds)
        .gt("quantity", 0)
    : { data: [] };
  const stock: StockOption[] = (
    (balRes.data ?? []) as unknown as {
      store_id: string;
      item_id: string;
      quantity: number;
      items: { name: string; uoms: { code: string } | null } | null;
    }[]
  )
    .map((b) => ({
      store_id: b.store_id,
      item_id: b.item_id,
      item_name: b.items?.name ?? "—",
      uom: b.items?.uoms?.code ?? null,
      qty: Number(b.quantity) || 0,
    }))
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
  return {
    unit: units.get(unitId) ?? null,
    toUnits: Array.from(units.values()).filter((u) => u.id !== unitId),
    stores,
    bins: ((binRes.data ?? []) as { id: string; bin_code: string; inactive: boolean | null }[])
      .filter((b) => !b.inactive)
      .map((b) => ({ id: b.id, code: b.bin_code })),
    stock,
  };
}
