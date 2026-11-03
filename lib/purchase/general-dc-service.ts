import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";

/**
 * GENERAL DC (0796) and DELIVERY RETURN (0797) — reads.
 *
 * A General DC is `delivery_challans.dc_kind = 'general'`: material sent OUT to someone outside
 * that is neither job work nor a vendor return (repair, sample, loan, gift), RETURNABLE or not.
 * A Delivery Return (`dc_returns`, DRN/…) brings a returnable one back — the same item, no
 * loss, no bill. Reads are separate queries, never embeds: `delivery_challans` carries two FKs
 * to `locations` and two to `profiles` (PGRST201).
 */

export type GeneralDcLine = {
  id: string;
  item_id: string | null;
  item_name: string | null;
  description: string;
  sent_qty: number;
  returned_qty: number;
  /** Written off on a return with Close balance (0797). */
  closed_qty: number;
  uom_id: string | null;
  uom: string | null;
  from_store_id: string | null;
  from_store: string | null;
  bin_id: string | null;
  bin_code: string | null;
  lot_no: string | null;
  approx_value: number | null;
  sort_order: number;
};

export type GeneralDc = {
  id: string;
  code: string | null;
  dc_date: string | null;
  status: string;
  location_id: string;
  unit_name: string;
  is_returnable: boolean;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_gst: string | null;
  party_name: string | null;
  party_address: string | null;
  purpose: string | null;
  expected_return_date: string | null;
  vehicle_no: string | null;
  transporter: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  lines: GeneralDcLine[];
};

export type VendorOption = { id: string; name: string; inactive: boolean };
export type UomOption = { id: string; code: string };

/** The party as printed and listed: the vendor, else the typed name. */
export const partyOf = (dc: Pick<GeneralDc, "vendor_name" | "party_name">) => dc.vendor_name ?? dc.party_name ?? "—";

export async function getGeneralDc(id: string): Promise<GeneralDc | null> {
  const s = await createClient();
  const [dcRes, linesRes] = await Promise.all([
    s
      .from("delivery_challans")
      .select(
        "id, code, dc_date, status, location_id, is_returnable, vendor_id, party_name, party_address, purpose, expected_return_date, vehicle_no, transporter, notes, created_at, created_by",
      )
      .eq("id", id)
      .eq("dc_kind", "general")
      .maybeSingle(),
    s
      .from("dc_line_items")
      .select("id, item_id, description, sent_qty, returned_qty, shortage_qty, uom_id, from_store_id, bin_id, lot_no, approx_value, sort_order")
      .eq("delivery_challan_id", id)
      .order("sort_order"),
  ]);
  if (dcRes.error) throw new Error(`General DC: ${dcRes.error.message}`);
  if (linesRes.error) throw new Error(`General DC lines: ${linesRes.error.message}`);
  if (!dcRes.data) return null;
  const d = dcRes.data as Omit<GeneralDc, "unit_name" | "vendor_name" | "vendor_gst" | "lines">;
  const raw = (linesRes.data ?? []) as {
    id: string;
    item_id: string | null;
    description: string;
    sent_qty: number;
    returned_qty: number;
    shortage_qty: number;
    uom_id: string | null;
    from_store_id: string | null;
    bin_id: string | null;
    lot_no: string | null;
    approx_value: number | null;
    sort_order: number;
  }[];
  const ids = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const itemIds = ids(raw.map((l) => l.item_id));
  const storeIds = ids(raw.map((l) => l.from_store_id));
  const binIds = ids(raw.map((l) => l.bin_id));
  const [itemRes, uomRes, storeRes, binRes, vendorRes, unitRes] = await Promise.all([
    itemIds.length ? s.from("items").select("id, name, uom_id").in("id", itemIds) : Promise.resolve({ data: [] }),
    s.from("uoms").select("id, code"),
    storeIds.length ? s.from("stores").select("id, name").in("id", storeIds) : Promise.resolve({ data: [] }),
    binIds.length ? s.from("bins").select("id, bin_code").in("id", binIds) : Promise.resolve({ data: [] }),
    d.vendor_id ? s.from("master_vendors").select("name, gst_no").eq("id", d.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    s.from("locations").select("name").eq("id", d.location_id).maybeSingle(),
  ]);
  const items = new Map(((itemRes.data ?? []) as { id: string; name: string; uom_id: string | null }[]).map((i) => [i.id, i]));
  const uoms = new Map(((uomRes.data ?? []) as UomOption[]).map((u) => [u.id, u.code]));
  const stores = new Map(((storeRes.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const bins = new Map(((binRes.data ?? []) as { id: string; bin_code: string }[]).map((b) => [b.id, b.bin_code]));
  const vendor = vendorRes.data as { name: string; gst_no: string | null } | null;
  return {
    ...d,
    is_returnable: d.is_returnable !== false,
    unit_name: (unitRes.data as { name: string } | null)?.name ?? "—",
    vendor_name: vendor?.name ?? null,
    vendor_gst: vendor?.gst_no ?? null,
    lines: raw.map((l) => {
      const item = l.item_id ? items.get(l.item_id) : undefined;
      const uomId = l.uom_id ?? item?.uom_id ?? null;
      return {
        id: l.id,
        item_id: l.item_id,
        item_name: item?.name ?? null,
        description: l.description,
        sent_qty: Number(l.sent_qty) || 0,
        returned_qty: Number(l.returned_qty) || 0,
        closed_qty: Number(l.shortage_qty) || 0,
        uom_id: uomId,
        uom: uomId ? (uoms.get(uomId) ?? null) : null,
        from_store_id: l.from_store_id,
        from_store: l.from_store_id ? (stores.get(l.from_store_id) ?? null) : null,
        bin_id: l.bin_id,
        bin_code: l.bin_id ? (bins.get(l.bin_id) ?? null) : null,
        lot_no: l.lot_no,
        approx_value: l.approx_value == null ? null : Number(l.approx_value),
        sort_order: l.sort_order,
      };
    }),
  };
}

/** Vendors for the Party picker (the one a draft holds survives being switched off) and UOMs. */
export async function getGeneralDcOptions(): Promise<{ vendors: VendorOption[]; uoms: UomOption[] }> {
  const s = await createClient();
  const [vRes, uRes] = await Promise.all([
    s.from("master_vendors").select("id, name, inactive").order("name"),
    s.from("uoms").select("id, code, is_active").order("code"),
  ]);
  return {
    vendors: ((vRes.data ?? []) as { id: string; name: string; inactive: boolean | null }[]).map((v) => ({
      id: v.id,
      name: v.name,
      inactive: isInactive(v),
    })),
    uoms: ((uRes.data ?? []) as { id: string; code: string; is_active: boolean | null }[])
      .filter((u) => u.is_active !== false)
      .map((u) => ({ id: u.id, code: u.code })),
  };
}

// ----------------------------------------------------------------- Delivery Return

export type OpenReturnableDc = {
  id: string;
  code: string | null;
  dc_date: string | null;
  party: string;
  purpose: string | null;
  expected_return_date: string | null;
  sent: number;
  out: number;
};

/** Returnable General DCs of this unit with something still out — what "New return" picks from. */
// created-by: exempt -- a pick list for the return form, not a listing; it shows no Created columns
export async function listOpenReturnableDcs(): Promise<OpenReturnableDc[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("delivery_challans")
    .select("id, code, dc_date, vendor_id, party_name, purpose, expected_return_date, created_at")
    .eq("dc_kind", "general")
    .eq("is_returnable", true)
    .in("status", ["issued", "partially_returned"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Open returnable DCs: ${error.message}`);
  const dcs = (data ?? []) as {
    id: string;
    code: string | null;
    dc_date: string | null;
    vendor_id: string | null;
    party_name: string | null;
    purpose: string | null;
    expected_return_date: string | null;
  }[];
  if (dcs.length === 0) return [];
  const vendorIds = [...new Set(dcs.map((d) => d.vendor_id).filter((x): x is string => !!x))];
  const [lineRes, vRes] = await Promise.all([
    s.from("dc_line_items").select("delivery_challan_id, sent_qty, returned_qty, shortage_qty").in("delivery_challan_id", dcs.map((d) => d.id)),
    vendorIds.length ? s.from("master_vendors").select("id, name").in("id", vendorIds) : Promise.resolve({ data: [] }),
  ]);
  if (lineRes.error) throw new Error(`Open returnable DC lines: ${lineRes.error.message}`);
  const vendor = new Map(((vRes.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const agg = new Map<string, { sent: number; out: number }>();
  for (const l of (lineRes.data ?? []) as { delivery_challan_id: string; sent_qty: number; returned_qty: number; shortage_qty: number }[]) {
    const a = agg.get(l.delivery_challan_id) ?? { sent: 0, out: 0 };
    a.sent += Number(l.sent_qty) || 0;
    a.out += Math.max((Number(l.sent_qty) || 0) - (Number(l.returned_qty) || 0) - (Number(l.shortage_qty) || 0), 0);
    agg.set(l.delivery_challan_id, a);
  }
  return dcs.map((d) => ({
    id: d.id,
    code: d.code,
    dc_date: d.dc_date,
    party: (d.vendor_id ? vendor.get(d.vendor_id) : null) ?? d.party_name ?? "—",
    purpose: d.purpose,
    expected_return_date: d.expected_return_date,
    sent: agg.get(d.id)?.sent ?? 0,
    out: agg.get(d.id)?.out ?? 0,
  }));
}

export type DcReturnRow = {
  id: string;
  code: string | null;
  return_date: string;
  dc_id: string;
  dc_code: string | null;
  party: string;
  party_dc_no: string | null;
  status: string;
  line_count: number;
  returned: number;
  closed: number;
  created_at: string;
  created_by: string | null;
};

/** Every Delivery Return of this unit (RLS), in entry order. */
export async function listDcReturns(): Promise<DcReturnRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("dc_returns")
    .select("id, code, return_date, delivery_challan_id, party_dc_no, status, created_at, created_by")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Delivery returns: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    code: string | null;
    return_date: string;
    delivery_challan_id: string;
    party_dc_no: string | null;
    status: string;
    created_at: string;
    created_by: string | null;
  }[];
  if (rows.length === 0) return [];
  const dcIds = [...new Set(rows.map((r) => r.delivery_challan_id))];
  const [dcRes, lineRes] = await Promise.all([
    s.from("delivery_challans").select("id, code, vendor_id, party_name").in("id", dcIds),
    s.from("dc_return_lines").select("return_id, returned_qty, closed_qty").in("return_id", rows.map((r) => r.id)),
  ]);
  if (dcRes.error) throw new Error(`Delivery returns: ${dcRes.error.message}`);
  if (lineRes.error) throw new Error(`Delivery return lines: ${lineRes.error.message}`);
  const dcs = new Map(((dcRes.data ?? []) as { id: string; code: string | null; vendor_id: string | null; party_name: string | null }[]).map((d) => [d.id, d]));
  const vendorIds = [...new Set([...dcs.values()].map((d) => d.vendor_id).filter((x): x is string => !!x))];
  const vRes = vendorIds.length ? await s.from("master_vendors").select("id, name").in("id", vendorIds) : { data: [] };
  const vendor = new Map(((vRes.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const agg = new Map<string, { n: number; ret: number; closed: number }>();
  for (const l of (lineRes.data ?? []) as { return_id: string; returned_qty: number; closed_qty: number }[]) {
    const a = agg.get(l.return_id) ?? { n: 0, ret: 0, closed: 0 };
    a.n += 1;
    a.ret += Number(l.returned_qty) || 0;
    a.closed += Number(l.closed_qty) || 0;
    agg.set(l.return_id, a);
  }
  return withCreators(
    rows.map((r) => {
      const dc = dcs.get(r.delivery_challan_id);
      return {
        id: r.id,
        code: r.code,
        return_date: r.return_date,
        dc_id: r.delivery_challan_id,
        dc_code: dc?.code ?? null,
        party: (dc?.vendor_id ? vendor.get(dc.vendor_id) : null) ?? dc?.party_name ?? "—",
        party_dc_no: r.party_dc_no,
        status: r.status,
        line_count: agg.get(r.id)?.n ?? 0,
        returned: agg.get(r.id)?.ret ?? 0,
        closed: agg.get(r.id)?.closed ?? 0,
        created_at: r.created_at,
        created_by: r.created_by,
      };
    }),
  );
}
