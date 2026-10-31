import "server-only";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";

/**
 * JOB WORK & TRANSIT REPORTS (doc/stores/dc-plan.md Phase 4, user 2026-10-31).
 *
 *   Stock at Vendor   — every Process DC line still out: sent − returned, its age, overdue.
 *   Material In Transit — every Production DC dispatched and not yet received.
 *   Process Loss      — per processor × process: input used, received, loss %, against
 *                       the orders' allowed %, and the excess the bills were flagged for.
 *
 * Read off the documents themselves (0784–0788), never a second store of figures: what
 * is at a vendor IS the DC lines' sent − returned, so the report cannot disagree with the
 * screen. RLS scopes each to the working unit (a Production DC to both of its units).
 * Separate reads, never embeds — delivery_challans carries two FKs to locations / profiles.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

const DAY = 86_400_000;
function daysBetween(from: string | null, to: string): number | null {
  if (!from) return null;
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY);
}

async function names(s: Sb, table: "master_vendors" | "items" | "locations" | "process_orders", ids: string[], col = "name") {
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await s.from(table).select(`id, ${col}`).in("id", ids);
  return new Map(((data ?? []) as unknown as Record<string, string>[]).map((r) => [r.id, r[col]]));
}
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export type AtVendorRow = {
  key: string;
  dc_id: string;
  dc_code: string | null;
  dc_date: string | null;
  vendor: string;
  process: string;
  process_order: string | null;
  item: string;
  sent: number;
  returned: number;
  at_vendor: number;
  expected: string | null;
  age_days: number | null;
  overdue_days: number | null;
};

export async function stockAtVendor(): Promise<AtVendorRow[]> {
  const s = await createClient();
  const { data: dcs, error } = await s
    .from("delivery_challans")
    .select("id, code, dc_date, vendor_id, process_type, purpose, process_order_id, expected_return_date")
    .eq("dc_kind", "process")
    .in("status", ["issued", "partially_returned"])
    .order("dc_date", { ascending: true });
  if (error) throw new Error(`Stock at vendor: ${error.message}`);
  const docs = (dcs ?? []) as {
    id: string;
    code: string | null;
    dc_date: string | null;
    vendor_id: string | null;
    process_type: string | null;
    purpose: string | null;
    process_order_id: string | null;
    expected_return_date: string | null;
  }[];
  if (docs.length === 0) return [];
  const { data: lines, error: lErr } = await s
    .from("dc_line_items")
    .select("id, delivery_challan_id, item_id, description, sent_qty, returned_qty, sort_order")
    .in("delivery_challan_id", docs.map((d) => d.id))
    .order("sort_order");
  if (lErr) throw new Error(`Stock at vendor lines: ${lErr.message}`);
  const ls = (lines ?? []) as {
    id: string;
    delivery_challan_id: string;
    item_id: string | null;
    description: string | null;
    sent_qty: number;
    returned_qty: number;
  }[];
  const [vendors, items, orders] = await Promise.all([
    names(s, "master_vendors", uniq(docs.map((d) => d.vendor_id))),
    names(s, "items", uniq(ls.map((l) => l.item_id))),
    names(s, "process_orders", uniq(docs.map((d) => d.process_order_id)), "code"),
  ]);
  const now = today();
  const byId = new Map(docs.map((d) => [d.id, d]));
  return ls
    .map((l) => {
      const d = byId.get(l.delivery_challan_id)!;
      const sent = Number(l.sent_qty) || 0;
      const returned = Number(l.returned_qty) || 0;
      const overdue = d.expected_return_date ? daysBetween(d.expected_return_date, now) : null;
      return {
        key: l.id,
        dc_id: d.id,
        dc_code: d.code,
        dc_date: d.dc_date,
        vendor: d.vendor_id ? (vendors.get(d.vendor_id) ?? "—") : "—",
        process: (d.process_type ?? d.purpose ?? "").toUpperCase(),
        process_order: d.process_order_id ? (orders.get(d.process_order_id) ?? null) : null,
        item: (l.item_id ? items.get(l.item_id) : null) ?? l.description ?? "—",
        sent,
        returned,
        at_vendor: Math.round((sent - returned) * 1000) / 1000,
        expected: d.expected_return_date,
        age_days: daysBetween(d.dc_date, now),
        overdue_days: overdue != null && overdue > 0 ? overdue : null,
      };
    })
    .filter((r) => r.at_vendor > 0)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || (a.dc_date ?? "").localeCompare(b.dc_date ?? ""));
}

export type InTransitRow = {
  key: string;
  dc_id: string;
  dc_code: string | null;
  dc_date: string | null;
  from_unit: string;
  to_unit: string;
  item: string;
  qty: number;
  vehicle: string | null;
  eway: string | null;
  days: number | null;
};

export async function materialInTransit(): Promise<InTransitRow[]> {
  const s = await createClient();
  const { data: dcs, error } = await s
    .from("delivery_challans")
    .select("id, code, dc_date, location_id, to_location_id, vehicle_no, eway_bill_no")
    .eq("dc_kind", "production")
    .eq("status", "dispatched")
    .order("dc_date", { ascending: true });
  if (error) throw new Error(`In transit: ${error.message}`);
  const docs = (dcs ?? []) as {
    id: string;
    code: string | null;
    dc_date: string | null;
    location_id: string;
    to_location_id: string;
    vehicle_no: string | null;
    eway_bill_no: string | null;
  }[];
  if (docs.length === 0) return [];
  const { data: lines } = await s
    .from("dc_line_items")
    .select("id, delivery_challan_id, item_id, description, sent_qty, sort_order")
    .in("delivery_challan_id", docs.map((d) => d.id))
    .order("sort_order");
  const ls = (lines ?? []) as { id: string; delivery_challan_id: string; item_id: string | null; description: string | null; sent_qty: number }[];
  const [units, items] = await Promise.all([
    names(s, "locations", uniq(docs.flatMap((d) => [d.location_id, d.to_location_id]))),
    names(s, "items", uniq(ls.map((l) => l.item_id))),
  ]);
  const now = today();
  const byId = new Map(docs.map((d) => [d.id, d]));
  return ls.map((l) => {
    const d = byId.get(l.delivery_challan_id)!;
    return {
      key: l.id,
      dc_id: d.id,
      dc_code: d.code,
      dc_date: d.dc_date,
      from_unit: units.get(d.location_id) ?? "—",
      to_unit: units.get(d.to_location_id) ?? "—",
      item: (l.item_id ? items.get(l.item_id) : null) ?? l.description ?? "—",
      qty: Number(l.sent_qty) || 0,
      vehicle: d.vehicle_no,
      eway: d.eway_bill_no,
      days: daysBetween(d.dc_date, now),
    };
  });
}

export type LossRow = {
  key: string;
  vendor: string;
  process: string;
  receipts: number;
  used: number;
  received: number;
  loss: number;
  loss_pct: number | null;
  /** The orders' limit — the highest when they differ, null when none was set. */
  allowed_pct: number | null;
  excess: number;
};

export async function processLossByVendor(): Promise<LossRow[]> {
  const s = await createClient();
  const { data: recs, error } = await s.from("dc_receipts").select("id, process_order_id");
  if (error) throw new Error(`Process loss: ${error.message}`);
  const receipts = (recs ?? []) as { id: string; process_order_id: string | null }[];
  if (receipts.length === 0) return [];
  const [linesRes, ordersRes] = await Promise.all([
    s
      .from("dc_receipt_lines")
      .select("receipt_id, received_qty, input_used_qty, loss_qty, allowed_loss_pct, excess_loss_qty")
      .in("receipt_id", receipts.map((r) => r.id)),
    s
      .from("process_orders")
      .select("id, vendor_id, process_type")
      .in("id", uniq(receipts.map((r) => r.process_order_id))),
  ]);
  const orders = new Map(((ordersRes.data ?? []) as { id: string; vendor_id: string; process_type: string }[]).map((o) => [o.id, o]));
  const vendors = await names(s, "master_vendors", uniq([...orders.values()].map((o) => o.vendor_id)));
  const recOrder = new Map(receipts.map((r) => [r.id, r.process_order_id]));
  const agg = new Map<string, LossRow & { recSet: Set<string> }>();
  for (const l of (linesRes.data ?? []) as {
    receipt_id: string;
    received_qty: number;
    input_used_qty: number;
    loss_qty: number;
    allowed_loss_pct: number | null;
    excess_loss_qty: number;
  }[]) {
    const o = orders.get(recOrder.get(l.receipt_id) ?? "");
    if (!o) continue;
    const key = `${o.vendor_id}|${o.process_type}`;
    const a =
      agg.get(key) ??
      ({
        key,
        vendor: vendors.get(o.vendor_id) ?? "—",
        process: o.process_type.toUpperCase(),
        receipts: 0,
        used: 0,
        received: 0,
        loss: 0,
        loss_pct: null,
        allowed_pct: null,
        excess: 0,
        recSet: new Set<string>(),
      } as LossRow & { recSet: Set<string> });
    a.recSet.add(l.receipt_id);
    a.used += Number(l.input_used_qty) || 0;
    a.received += Number(l.received_qty) || 0;
    a.loss += Number(l.loss_qty) || 0;
    a.excess += Number(l.excess_loss_qty) || 0;
    if (l.allowed_loss_pct != null) a.allowed_pct = Math.max(a.allowed_pct ?? 0, Number(l.allowed_loss_pct));
    agg.set(key, a);
  }
  return [...agg.values()]
    .map(({ recSet, ...a }) => ({
      ...a,
      receipts: recSet.size,
      loss_pct: a.used > 0 ? Math.round((a.loss / a.used) * 10000) / 100 : null,
    }))
    .sort((x, y) => (y.loss_pct ?? 0) - (x.loss_pct ?? 0));
}
