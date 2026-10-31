import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";

/**
 * EVERY DELIVERY CHALLAN IN ONE REGISTER (user 2026-10-31, screenshot 3949: "DC should list
 * rejection, production etc."). Four kinds live in two tables:
 *
 *   delivery_challans  dc_kind 'process'    — job work out to a processor (0786)
 *                      dc_kind 'production' — unit → unit transfer (0784)
 *   vendor_returns     dc_kind 'rejection'  — QC-failed goods back, with the debit note (0781)
 *                      dc_kind 'replacement'— goods back for the vendor to resend (0781)
 *
 * Purchase ▸ Delivery Challans used to read only the first, so a Rejection or Replacement
 * DC raised by a GRN — and every Production DC — was invisible there. Each row here opens
 * the screen that owns that kind; nothing is edited from the register itself.
 * RLS decides what a reader sees (a Production DC is visible to both of its units).
 */

export type DcKind = "process" | "production" | "rejection" | "replacement";

export type DcRegisterRow = {
  key: string;
  id: string;
  kind: DcKind;
  code: string | null;
  date: string | null;
  /** The vendor, or "From → To" for a Production DC. */
  party: string;
  /** What it is against: Process Order, GRN, purpose. */
  against: string | null;
  status: string;
  qty: number;
  /** Still out: at the vendor, on the road, or owed back as a replacement. */
  outstanding: number;
  href: string;
  print: string | null;
  created_at: string;
  created_by: string | null;
};

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export async function listDcRegister(): Promise<DcRegisterRow[]> {
  const s = await createClient();
  const [dcRes, vrRes] = await Promise.all([
    s
      .from("delivery_challans")
      .select("id, code, dc_kind, dc_date, status, vendor_id, location_id, to_location_id, purpose, process_order_id, created_at, created_by"),
    s
      .from("vendor_returns")
      .select("id, code, dc_kind, return_date, status, master_vendor_id, vendor_id, grn_id, reason, created_at, created_by"),
  ]);
  if (dcRes.error) throw new Error(`Delivery challans: ${dcRes.error.message}`);
  if (vrRes.error) throw new Error(`Rejection / replacement DCs: ${vrRes.error.message}`);
  const dcs = (dcRes.data ?? []) as {
    id: string;
    code: string | null;
    dc_kind: "process" | "production";
    dc_date: string | null;
    status: string;
    vendor_id: string | null;
    location_id: string;
    to_location_id: string | null;
    purpose: string | null;
    process_order_id: string | null;
    created_at: string;
    created_by: string | null;
  }[];
  const vrs = (vrRes.data ?? []) as {
    id: string;
    code: string | null;
    dc_kind: string | null;
    return_date: string | null;
    status: string;
    master_vendor_id: string | null;
    vendor_id: string | null;
    grn_id: string | null;
    reason: string | null;
    created_at: string;
    created_by: string | null;
  }[];

  const [dcLines, vrLines, vendors, legacyVendors, units, orders, grns] = await Promise.all([
    dcs.length
      ? s.from("dc_line_items").select("delivery_challan_id, sent_qty, returned_qty, received_qty, shortage_qty").in("delivery_challan_id", dcs.map((d) => d.id))
      : Promise.resolve({ data: [] }),
    vrs.length
      ? s.from("vendor_return_lines").select("vendor_return_id, return_qty, replacement_qty, rejection_action").in("vendor_return_id", vrs.map((v) => v.id))
      : Promise.resolve({ data: [] }),
    s.from("master_vendors").select("id, name").in("id", uniq([...dcs.map((d) => d.vendor_id), ...vrs.map((v) => v.master_vendor_id)])),
    s.from("vendors").select("id, name").in("id", uniq(vrs.map((v) => v.vendor_id))),
    s.from("locations").select("id, name").in("id", uniq(dcs.flatMap((d) => [d.location_id, d.to_location_id]))),
    s.from("process_orders").select("id, code").in("id", uniq(dcs.map((d) => d.process_order_id))),
    s.from("grns").select("id, code").in("id", uniq(vrs.map((v) => v.grn_id))),
  ]);
  const nameOf = (r: { data: unknown }) =>
    new Map(((r.data ?? []) as { id: string; name?: string; code?: string }[]).map((x) => [x.id, x.name ?? x.code ?? ""]));
  const vendor = nameOf(vendors);
  const legacy = nameOf(legacyVendors);
  const unit = nameOf(units);
  const order = nameOf(orders);
  const grn = nameOf(grns);

  const dcAgg = new Map<string, { qty: number; out: number }>();
  for (const l of (dcLines.data ?? []) as { delivery_challan_id: string; sent_qty: number; returned_qty: number; received_qty: number; shortage_qty: number }[]) {
    const a = dcAgg.get(l.delivery_challan_id) ?? { qty: 0, out: 0 };
    a.qty += Number(l.sent_qty) || 0;
    a.out += Math.max((Number(l.sent_qty) || 0) - (Number(l.returned_qty) || 0) - (Number(l.received_qty) || 0) - (Number(l.shortage_qty) || 0), 0);
    dcAgg.set(l.delivery_challan_id, a);
  }
  const vrAgg = new Map<string, { qty: number; out: number }>();
  for (const l of (vrLines.data ?? []) as { vendor_return_id: string; return_qty: number; replacement_qty: number; rejection_action: string | null }[]) {
    const a = vrAgg.get(l.vendor_return_id) ?? { qty: 0, out: 0 };
    a.qty += Number(l.return_qty) || 0;
    if ((l.rejection_action ?? "replace") === "replace") a.out += Math.max((Number(l.return_qty) || 0) - (Number(l.replacement_qty) || 0), 0);
    vrAgg.set(l.vendor_return_id, a);
  }

  const rows: DcRegisterRow[] = [
    ...dcs.map((d): DcRegisterRow => {
      const a = dcAgg.get(d.id) ?? { qty: 0, out: 0 };
      if (d.dc_kind === "production") {
        return {
          key: `dc-${d.id}`,
          id: d.id,
          kind: "production",
          code: d.code,
          date: d.dc_date,
          party: `${unit.get(d.location_id) ?? "—"} → ${d.to_location_id ? (unit.get(d.to_location_id) ?? "—") : "—"}`,
          against: "Stock transfer",
          status: d.status,
          qty: a.qty,
          outstanding: d.status === "dispatched" ? a.qty : 0,
          href: d.status === "draft" ? `/stores/production-dc?send=${d.id}` : `/stores/production-dc/${d.id}/print`,
          print: d.status === "draft" ? null : `/stores/production-dc/${d.id}/print`,
          created_at: d.created_at,
          created_by: d.created_by,
        };
      }
      const viaOrder = !!d.process_order_id;
      return {
        key: `dc-${d.id}`,
        id: d.id,
        kind: "process",
        code: d.code,
        date: d.dc_date,
        party: d.vendor_id ? (vendor.get(d.vendor_id) ?? "—") : "—",
        against: viaOrder ? `Process Order ${order.get(d.process_order_id!) ?? ""}`.trim() : (d.purpose ?? null),
        status: d.status,
        qty: a.qty,
        outstanding: d.status === "draft" ? 0 : a.out,
        // A DC against a Process Order is worked on Stores ▸ Process DC; an older one here.
        href: viaOrder
          ? d.status === "draft"
            ? `/stores/process-dc?send=${d.id}`
            : d.status === "closed"
              ? `/stores/process-dc/${d.id}/print`
              : `/stores/process-dc?receive=${d.id}`
          : `/purchase/dc/${d.id}`,
        print: viaOrder && d.status !== "draft" ? `/stores/process-dc/${d.id}/print` : null,
        created_at: d.created_at,
        created_by: d.created_by,
      };
    }),
    ...vrs.map((v): DcRegisterRow => {
      const a = vrAgg.get(v.id) ?? { qty: 0, out: 0 };
      // Before 0781 a GRN's DC had no kind; a Stores vendor return raised by hand is a
      // rejection going back too.
      const kind: DcKind = v.dc_kind === "replacement" ? "replacement" : "rejection";
      return {
        key: `vr-${v.id}`,
        id: v.id,
        kind,
        code: v.code,
        date: v.return_date,
        party: v.master_vendor_id ? (vendor.get(v.master_vendor_id) ?? "—") : v.vendor_id ? (legacy.get(v.vendor_id) ?? "—") : "—",
        against: v.grn_id ? `GRN ${grn.get(v.grn_id) ?? ""}`.trim() : (v.reason ?? null),
        status: v.status,
        qty: a.qty,
        outstanding: kind === "replacement" && v.status !== "cancelled" ? a.out : 0,
        href: `/stores/vendor-returns/${v.id}`,
        print: v.status === "cancelled" ? null : `/stores/vendor-returns/${v.id}/print`,
        created_at: v.created_at,
        created_by: v.created_by,
      };
    }),
  ];
  // LISTED IN ENTRY ORDER (user 2026-09-22).
  rows.sort((x, y) => x.created_at.localeCompare(y.created_at));
  return withCreators(rows);
}
