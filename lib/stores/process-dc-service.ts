import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";

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
};

export type ProcessDc = ProcessDcRow & {
  vendor_id: string | null;
  location_id: string;
  transporter: string | null;
  eway_bill_no: string | null;
  order_no: string | null;
  /** The order's soft loss limit (0786); a receipt past it is flagged, never blocked. */
  allowed_loss_pct: number | null;
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
  const [linesRes, sentRes, vendors, soRes] = await Promise.all([
    s.from("process_order_lines").select("id, process_order_id, item_id, description, sent_qty, rate, sort_order").in("process_order_id", ids).order("sort_order"),
    s
      .from("delivery_challans")
      .select("id")
      .in("process_order_id", ids)
      .not("status", "in", "(draft,cancelled)"),
    vendorNames(s, [...new Set(rows.map((r) => r.vendor_id))]),
    s.from("sales_orders").select("id, order_number").in("id", rows.map((r) => r.sales_order_id).filter((x): x is string => !!x)),
  ]);
  const dcIds = ((sentRes.data ?? []) as { id: string }[]).map((d) => d.id);
  const sentLines = dcIds.length
    ? ((await s.from("dc_line_items").select("process_order_line_id, sent_qty").in("delivery_challan_id", dcIds)).data ?? [])
    : [];
  const sent = new Map<string, number>();
  for (const l of sentLines as { process_order_line_id: string | null; sent_qty: number }[]) {
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
  const items = await itemInfo(s, [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))]);
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
          };
        }),
    }))
    .filter((o) => o.lines.some((l) => l.balance > 0 && l.item_id));
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
      .select("id, item_id, description, sent_qty, returned_qty, from_store_id, bin_id, lot_no, process_order_line_id, rate")
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
  const outRes = polIds.length ? await s.from("process_order_lines").select("id, output_item_id").in("id", polIds) : { data: [] };
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

