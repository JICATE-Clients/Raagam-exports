import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";

/**
 * PROCESS DC — job work sent out against a Process Order (doc/stores/dc-plan.md Phase 2,
 * 0786). A `delivery_challans` row with `dc_kind = 'process'` and `process_order_id` set.
 * What has gone out on an order line is the sum of its DISPATCHED DC lines — never typed.
 *
 * Separate reads, never embeds: delivery_challans carries two FKs to locations and three to
 * profiles (0784), and dc_line_items two to stores and two to bins.
 */

export type OpenOrderLine = {
  id: string;
  item_id: string | null;
  item_name: string;
  uom: string | null;
  ordered: number;
  sent: number;
  /** ordered − sent on dispatched DCs: the most a new DC may carry. */
  balance: number;
  rate: number;
  /** Knitting orders (0825): kg in one sealed bag of this yarn, so the DC can count bags.
   *  Null on every other process order. */
  bag_weight_kg: number | null;
  /** Knitting orders (0825): the program behind this yarn line — what the knitter knits it into. */
  knit: KnitLineMeta | null;
};

/**
 * THE KNITTING PROGRAM BEHIND ONE ORDER LINE (spec "Program Technical Specs (Linked Metadata)",
 * user 2026-11-11). Read off the order, never typed on the DC, so the challan and the knitting
 * order cannot disagree.
 */
export type KnitLineMeta = {
  /** The Knitting Order the yarn is for, and its RE — one DC may carry several (0832). */
  order_id: string;
  order_code: string | null;
  re_no: string | null;
  blend_pct: number;
  bag_weight_kg: number | null;
  fabric: string;
  knit_dia: string | null;
  finished_dia: string | null;
  width_form: string | null;
  gauge: string | null;
  loop_length: number | null;
  loop_length_ref: number | null;
  gsm: number | null;
  ply: string | null;
};

/** What a bin of this unit holds (`stock_bin_balances`) — the DC's per-bin stock and bin list. */
export type BinStockOption = {
  store_id: string;
  bin_id: string | null;
  item_id: string;
  qty: number;
  /** The oldest lot still in this bin (stock_lot_balances.first_in_date) — only with `withAge`. */
  first_in?: string | null;
};

/** Knitting facts for these order lines (empty map for any other process). */
export async function knitMetaByLine(lineIds: readonly string[]): Promise<Map<string, KnitLineMeta>> {
  const out = new Map<string, KnitLineMeta>();
  const ids = [...new Set(lineIds.filter(Boolean))];
  if (!ids.length) return out;
  const s = await createClient();
  const { data, error } = await s
    .from("process_order_knit_yarns")
    .select(
      "process_order_line_id, blend_pct, bag_weight_kg, " +
        "fabric:process_order_knit_fabrics!inner(process_order_id, knit_dia, finished_dia, width_form, loop_length, loop_length_ref, gsm, ply, fso:sales_orders!sales_order_id(order_number), " +
        "item:items!fabric_item_id(name), gauge:config_lookups!gauge_id(name), " +
        "ko:process_orders!process_order_id(code, so:sales_orders!sales_order_id(order_number)))",
    )
    .in("process_order_line_id", ids);
  if (error) throw new Error(`Knitting program for the DC: ${error.message}`);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const nn = (v: unknown) => (v == null ? null : Number(v));
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const f = one(r.fabric as Record<string, unknown> | Record<string, unknown>[] | null) as Record<string, unknown> | null;
    if (!r.process_order_line_id || !f) continue;
    const ko = one(f.ko as { code: string | null; so: unknown } | null) as { code: string | null; so: { order_number: string | null } | { order_number: string | null }[] | null } | null;
    out.set(r.process_order_line_id as string, {
      order_id: f.process_order_id as string,
      order_code: ko?.code ?? null,
      // The FABRIC's RE (0836: one Knitting Order may carry several), else the order's.
      re_no: one(f.fso as { order_number: string | null } | null)?.order_number ?? one(ko?.so ?? null)?.order_number ?? null,
      blend_pct: Number(r.blend_pct) || 0,
      bag_weight_kg: nn(r.bag_weight_kg),
      fabric: one(f.item as { name: string } | null)?.name ?? "",
      knit_dia: (f.knit_dia as string | null) ?? null,
      finished_dia: (f.finished_dia as string | null) ?? null,
      width_form: (f.width_form as string | null) ?? null,
      gauge: one(f.gauge as { name: string } | null)?.name ?? null,
      loop_length: nn(f.loop_length),
      loop_length_ref: nn(f.loop_length_ref),
      gsm: nn(f.gsm),
      ply: (f.ply as string | null) ?? null,
    });
  }
  return out;
}

/**
 * Stock by bin in this unit's holding stores (positive balances only). `withAge` also reads the
 * oldest lot date per bin, in parallel, so a caller can take the OLDEST stock first (Knitting
 * "Delivery Now" picks its bins itself — Session 2, 2026-11-14).
 */
export async function listBinStock(opts: { withAge?: boolean } = {}): Promise<BinStockOption[]> {
  const s = await createClient();
  const { location } = await getCurrentLocation();
  if (!location) return [];
  const [res, lots] = await Promise.all([
    s.from("stock_bin_balances").select("store_id, bin_id, item_id, quantity").eq("location_id", location.id).gt("quantity", 0),
    opts.withAge
      ? s.from("stock_lot_balances").select("store_id, bin_id, item_id, first_in_date").eq("location_id", location.id).gt("quantity", 0)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (res.error) throw new Error(`Bin stock: ${res.error.message}`);
  if (lots.error) throw new Error(`Bin stock age: ${lots.error.message}`);
  const key = (x: { store_id: string; bin_id: string | null; item_id: string }) => `${x.store_id}|${x.bin_id ?? ""}|${x.item_id}`;
  const oldest = new Map<string, string>();
  for (const l of (lots.data ?? []) as { store_id: string; bin_id: string | null; item_id: string; first_in_date: string | null }[]) {
    if (!l.first_in_date) continue;
    const k = key(l);
    const was = oldest.get(k);
    if (!was || l.first_in_date < was) oldest.set(k, l.first_in_date);
  }
  return ((res.data ?? []) as { store_id: string; bin_id: string | null; item_id: string; quantity: number }[]).map((b) => ({
    store_id: b.store_id,
    bin_id: b.bin_id,
    item_id: b.item_id,
    qty: Number(b.quantity) || 0,
    ...(opts.withAge ? { first_in: oldest.get(key(b)) ?? null } : {}),
  }));
}

/** One lot on hand in a store of this unit (`stock_lot_balances`, 0790) — the DC's lot pick. */
export type LotStockOption = {
  store_id: string;
  bin_id: string | null;
  bin_code: string | null;
  item_id: string;
  lot_no: string;
  qty: number;
  first_in_date: string | null;
};

export type OpenProcessOrder = {
  id: string;
  code: string | null;
  process_type: string;
  vendor_id: string;
  vendor_name: string;
  order_no: string | null;
  expected_date: string | null;
  status: string;
  lines: OpenOrderLine[];
};

export type ProcessDcRow = {
  id: string;
  code: string | null;
  dc_date: string | null;
  status: string;
  vendor_name: string;
  process_type: string | null;
  process_order_id: string | null;
  process_order_code: string | null;
  expected_return_date: string | null;
  vehicle_no: string | null;
  line_count: number;
  sent_total: number;
  created_at: string;
  created_by: string | null;
};

export type ProcessDcLine = {
  id: string;
  item_id: string;
  item_name: string;
  uom: string | null;
  sent_qty: number;
  returned_qty: number;
  from_store_id: string | null;
  from_store: string | null;
  bin_id: string | null;
  lot_no: string | null;
  process_order_line_id: string | null;
  rate: number | null;
  hsn: string | null;
  /** What the order expects back for this line (0786) — the receipt's default output item. */
  output_item_id: string | null;
  /** Sealed bags on the line (0825, a knitter's yarn); null when not counted. */
  bags: number | null;
  /** Knitting orders: the program behind the yarn — printed on the challan for the knitter. */
  knit: KnitLineMeta | null;
};

export type ProcessDc = ProcessDcRow & {
  vendor_id: string | null;
  location_id: string;
  transporter: string | null;
  eway_bill_no: string | null;
  order_no: string | null;
  /** The order's soft loss limit (0786); a receipt past it is flagged, never blocked. */
  allowed_loss_pct: number | null;
  /** 0833: a PAPER DC — yarn already at the knitter, moved from this Knitting Order. No goods travelled. */
  knit_transfer_from: string | null;
  lines: ProcessDcLine[];
};

type Sb = Awaited<ReturnType<typeof createClient>>;

async function vendorNames(s: Sb, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await s.from("master_vendors").select("id, name").in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
}

async function itemInfo(s: Sb, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; uom: string | null; hsn: string | null }>();
  const { data } = await s.from("items").select("id, name, hsn_code, uoms!uom_id(code)").in("id", ids);
  return new Map(
    ((data ?? []) as unknown as { id: string; name: string; hsn_code: string | null; uoms: { code: string } | null }[]).map((i) => [
      i.id,
      { name: i.name, uom: i.uoms?.code ?? null, hsn: i.hsn_code ?? null },
    ]),
  );
}

/** Issued process orders of this unit with something still to send. */
export async function listOpenProcessOrders(): Promise<OpenProcessOrder[]> {
  const s = await createClient();
  const { data: orders, error } = await s
    .from("process_orders")
    .select("id, code, process_type, vendor_id, sales_order_id, expected_date, status")
    .in("status", ["issued", "in_process", "partially_received"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Process orders: ${error.message}`);
  const rows = (orders ?? []) as {
    id: string;
    code: string | null;
    process_type: string;
    vendor_id: string;
    sales_order_id: string | null;
    expected_date: string | null;
    status: string;
  }[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [linesRes, vendors, soRes] = await Promise.all([
    s.from("process_order_lines").select("id, process_order_id, item_id, description, sent_qty, rate, sort_order").in("process_order_id", ids).order("sort_order"),
    vendorNames(s, [...new Set(rows.map((r) => r.vendor_id))]),
    s.from("sales_orders").select("id, order_number").in("id", rows.map((r) => r.sales_order_id).filter((x): x is string => !!x)),
  ]);
  // What has left, per ORDER LINE — whichever DC carried it (0832: one knitting DC may carry
  // several orders, and its own process_order_id names only the first).
  const allLineIds = ((linesRes.data ?? []) as { id: string }[]).map((l) => l.id);
  const sentRes = allLineIds.length
    ? await s
        .from("dc_line_items")
        .select("process_order_line_id, sent_qty, dc:delivery_challans!inner(status)")
        .in("process_order_line_id", allLineIds)
        .not("dc.status", "in", "(draft,cancelled)")
    : { data: [], error: null };
  if (sentRes.error) throw new Error(`Sent so far: ${sentRes.error.message}`);
  const sentLines = sentRes.data ?? [];
  const sent = new Map<string, number>();
  for (const l of sentLines as unknown as { process_order_line_id: string | null; sent_qty: number }[]) {
    if (l.process_order_line_id) sent.set(l.process_order_line_id, (sent.get(l.process_order_line_id) ?? 0) + (Number(l.sent_qty) || 0));
  }
  const lines = (linesRes.data ?? []) as {
    id: string;
    process_order_id: string;
    item_id: string | null;
    description: string;
    sent_qty: number;
    rate: number;
  }[];
  const [items, knitByLine] = await Promise.all([
    itemInfo(s, [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))]),
    // Knitting orders (0825): the program behind each yarn line, and its bag weight.
    knitMetaByLine(lines.map((l) => l.id)),
  ]);
  const so = new Map(((soRes.data ?? []) as { id: string; order_number: string | null }[]).map((o) => [o.id, o.order_number]));
  return rows
    .map((r) => ({
      id: r.id,
      code: r.code,
      process_type: r.process_type,
      vendor_id: r.vendor_id,
      vendor_name: vendors.get(r.vendor_id) ?? "—",
      order_no: r.sales_order_id ? (so.get(r.sales_order_id) ?? null) : null,
      expected_date: r.expected_date,
      status: r.status,
      lines: lines
        .filter((l) => l.process_order_id === r.id)
        .map((l) => {
          const ordered = Number(l.sent_qty) || 0;
          const done = sent.get(l.id) ?? 0;
          const info = l.item_id ? items.get(l.item_id) : undefined;
          return {
            id: l.id,
            item_id: l.item_id,
            item_name: info?.name ?? l.description,
            uom: info?.uom ?? null,
            ordered,
            sent: done,
            balance: Math.max(0, Math.round((ordered - done) * 1000) / 1000),
            rate: Number(l.rate) || 0,
            bag_weight_kg: knitByLine.get(l.id)?.bag_weight_kg ?? null,
            knit: knitByLine.get(l.id) ?? null,
          };
        }),
    }))
    .filter((o) => o.lines.some((l) => l.balance > 0 && l.item_id));
}

/**
 * Every lot on hand in a holding store of this unit, oldest first (FIFO) — so a DC line can
 * be sent from a lot that is really there, and its bin follows the lot (Knitting Hub Phase 2:
 * "only bins with stock"). 0826 refuses a line larger than its lot.
 */
export async function listLotStock(): Promise<LotStockOption[]> {
  const s = await createClient();
  const { location } = await getCurrentLocation();
  if (!location) return [];
  const { data, error } = await s
    .from("stock_lot_balances")
    .select("store_id, bin_id, item_id, lot_no, quantity, first_in_date")
    .eq("location_id", location.id)
    .not("lot_no", "is", null)
    .gt("quantity", 0)
    .order("first_in_date", { ascending: true });
  if (error) throw new Error(`Lot stock: ${error.message}`);
  const rows = (data ?? []) as { store_id: string; bin_id: string | null; item_id: string; lot_no: string; quantity: number; first_in_date: string | null }[];
  const binIds = [...new Set(rows.map((r) => r.bin_id).filter((x): x is string => !!x))];
  const bins = binIds.length ? ((await s.from("bins").select("id, bin_code").in("id", binIds)).data ?? []) : [];
  const binCode = new Map((bins as { id: string; bin_code: string }[]).map((b) => [b.id, b.bin_code]));
  return rows.map((r) => ({
    store_id: r.store_id,
    bin_id: r.bin_id,
    bin_code: r.bin_id ? (binCode.get(r.bin_id) ?? null) : null,
    item_id: r.item_id,
    lot_no: r.lot_no,
    qty: Number(r.quantity) || 0,
    first_in_date: r.first_in_date,
  }));
}

export async function listProcessDcs(): Promise<ProcessDcRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("delivery_challans")
    .select("id, code, dc_date, status, vendor_id, process_type, process_order_id, expected_return_date, vehicle_no, created_at, created_by")
    .eq("dc_kind", "process")
    .not("process_order_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Process DCs: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    code: string | null;
    dc_date: string | null;
    status: string;
    vendor_id: string | null;
    process_type: string | null;
    process_order_id: string | null;
    expected_return_date: string | null;
    vehicle_no: string | null;
    created_at: string;
    created_by: string | null;
  }[];
  const ids = rows.map((r) => r.id);
  const [vendors, poRes, linesRes] = await Promise.all([
    vendorNames(s, [...new Set(rows.map((r) => r.vendor_id).filter((x): x is string => !!x))]),
    s.from("process_orders").select("id, code").in("id", rows.map((r) => r.process_order_id).filter((x): x is string => !!x)),
    ids.length ? s.from("dc_line_items").select("delivery_challan_id, sent_qty").in("delivery_challan_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const po = new Map(((poRes.data ?? []) as { id: string; code: string | null }[]).map((p) => [p.id, p.code]));
  const agg = new Map<string, { n: number; q: number }>();
  for (const l of (linesRes.data ?? []) as { delivery_challan_id: string; sent_qty: number }[]) {
    const a = agg.get(l.delivery_challan_id) ?? { n: 0, q: 0 };
    a.n += 1;
    a.q += Number(l.sent_qty) || 0;
    agg.set(l.delivery_challan_id, a);
  }
  return withCreators(
    rows.map((r) => ({
      ...r,
      vendor_name: r.vendor_id ? (vendors.get(r.vendor_id) ?? "—") : "—",
      process_order_code: r.process_order_id ? (po.get(r.process_order_id) ?? null) : null,
      line_count: agg.get(r.id)?.n ?? 0,
      sent_total: agg.get(r.id)?.q ?? 0,
    })),
  );
}

export async function getProcessDc(id: string): Promise<ProcessDc | null> {
  const s = await createClient();
  const [dcRes, linesRes] = await Promise.all([
    s.from("delivery_challans").select("*").eq("id", id).eq("dc_kind", "process").maybeSingle(),
    s
      .from("dc_line_items")
      .select("id, item_id, description, sent_qty, returned_qty, from_store_id, bin_id, lot_no, process_order_line_id, rate, bags")
      .eq("delivery_challan_id", id)
      .order("sort_order"),
  ]);
  if (dcRes.error) throw new Error(`Process DC: ${dcRes.error.message}`);
  if (!dcRes.data) return null;
  const d = dcRes.data as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  const raw = (linesRes.data ?? []) as {
    id: string;
    item_id: string;
    description: string | null;
    sent_qty: number;
    returned_qty: number;
    from_store_id: string | null;
    bin_id: string | null;
    lot_no: string | null;
    process_order_line_id: string | null;
    rate: number | null;
    bags: number | null;
  }[];
  const poId = str("process_order_id");
  const [items, vendors, storeRes, poRes] = await Promise.all([
    itemInfo(s, [...new Set(raw.map((l) => l.item_id))]),
    vendorNames(s, str("vendor_id") ? [str("vendor_id")!] : []),
    s.from("stores").select("id, name").in("id", raw.map((l) => l.from_store_id).filter((x): x is string => !!x)),
    poId ? s.from("process_orders").select("code, sales_order_id, allowed_loss_pct").eq("id", poId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = (poRes.data ?? null) as { code: string | null; sales_order_id: string | null; allowed_loss_pct: number | null } | null;
  const polIds = raw.map((l) => l.process_order_line_id).filter((x): x is string => !!x);
  const [outRes, knitByLine] = await Promise.all([
    polIds.length ? s.from("process_order_lines").select("id, output_item_id").in("id", polIds) : Promise.resolve({ data: [] }),
    knitMetaByLine(polIds),
  ]);
  const outOf = new Map(((outRes.data ?? []) as { id: string; output_item_id: string | null }[]).map((x) => [x.id, x.output_item_id]));
  const so = p?.sales_order_id ? (await s.from("sales_orders").select("order_number").eq("id", p.sales_order_id).maybeSingle()).data : null;
  const stores = new Map(((storeRes.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const lines: ProcessDcLine[] = raw.map((l) => ({
    ...l,
    item_name: items.get(l.item_id)?.name ?? l.description ?? "—",
    uom: items.get(l.item_id)?.uom ?? null,
    hsn: items.get(l.item_id)?.hsn ?? null,
    sent_qty: Number(l.sent_qty) || 0,
    returned_qty: Number(l.returned_qty) || 0,
    from_store: l.from_store_id ? (stores.get(l.from_store_id) ?? null) : null,
    rate: l.rate == null ? null : Number(l.rate),
    bags: l.bags == null ? null : Number(l.bags),
    knit: l.process_order_line_id ? (knitByLine.get(l.process_order_line_id) ?? null) : null,
    output_item_id: l.process_order_line_id ? (outOf.get(l.process_order_line_id) ?? null) : null,
  }));
  return {
    id,
    code: str("code"),
    dc_date: str("dc_date"),
    status: String(d.status),
    vendor_id: str("vendor_id"),
    vendor_name: str("vendor_id") ? (vendors.get(str("vendor_id")!) ?? "—") : "—",
    location_id: String(d.location_id),
    process_type: str("process_type"),
    process_order_id: poId,
    process_order_code: p?.code ?? null,
    order_no: (so as { order_number: string | null } | null)?.order_number ?? null,
    allowed_loss_pct: p?.allowed_loss_pct == null ? null : Number(p.allowed_loss_pct),
    knit_transfer_from: str("knit_transfer_from"),
    expected_return_date: str("expected_return_date"),
    vehicle_no: str("vehicle_no"),
    transporter: str("transporter"),
    eway_bill_no: str("eway_bill_no"),
    line_count: lines.length,
    sent_total: lines.reduce((a, l) => a + l.sent_qty, 0),
    created_at: String(d.created_at),
    created_by: str("created_by"),
    lines,
  };
}

