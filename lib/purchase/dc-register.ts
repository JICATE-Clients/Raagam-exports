import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";

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
 *
 * DEPARTMENT DELIVERY joined 2026-11-04 (user: "Department Delivery move it to the delivery
 * challans") — `interdept_deliveries` (0365), store → store between departments, no stock
 * moved. Its RLS is `stores:view`, so a Purchase-only reader simply sees none of them.
 */

export type DcKind = "process" | "production" | "general" | "department" | "rejection" | "replacement";

export type DcRegisterRow = {
  key: string;
  id: string;
  kind: DcKind;
  code: string | null;
  date: string | null;
  /** The vendor, or "From → To" for a Production DC / Department Delivery. */
  party: string;
  /** What it is against: Process Order, GRN, purpose. */
  against: string | null;
  status: string;
  qty: number;
  /** Still out: at the vendor, on the road, or owed back as a replacement. */
  outstanding: number;
  /** Where the row opens; null when its kind has no screen to open (Department Delivery). */
  href: string | null;
  print: string | null;
  /** The action this unit can take on the row now, from the hub (user 2026-10-31). */
  action: "receive-back" | "receive-stock" | "dispatch" | null;
  created_at: string;
  created_by: string | null;
};

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export async function listDcRegister(): Promise<DcRegisterRow[]> {
  const s = await createClient();
  const { location } = await getCurrentLocation();
  const here = location?.id ?? null;
  const [dcRes, vrRes, iddRes] = await Promise.all([
    s
      .from("delivery_challans")
      .select("id, code, dc_kind, dc_date, status, vendor_id, location_id, to_location_id, purpose, process_order_id, is_returnable, party_name, created_at, created_by"),
    s
      .from("vendor_returns")
      .select("id, code, dc_kind, return_date, status, master_vendor_id, vendor_id, grn_id, reason, created_at, created_by"),
    s
      .from("interdept_deliveries")
      .select("id, code, from_department, to_department, from_store_id, to_store_id, delivery_date, status, created_at, created_by"),
  ]);
  if (dcRes.error) throw new Error(`Delivery challans: ${dcRes.error.message}`);
  if (vrRes.error) throw new Error(`Rejection / replacement DCs: ${vrRes.error.message}`);
  if (iddRes.error) throw new Error(`Department deliveries: ${iddRes.error.message}`);
  const idds = (iddRes.data ?? []) as {
    id: string;
    code: string | null;
    from_department: string;
    to_department: string;
    from_store_id: string;
    to_store_id: string;
    delivery_date: string | null;
    status: string;
    created_at: string;
    created_by: string | null;
  }[];
  const dcs = (dcRes.data ?? []) as {
    id: string;
    code: string | null;
    dc_kind: "process" | "production" | "general";
    is_returnable: boolean | null;
    party_name: string | null;
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

  const [dcLines, vrLines, vendors, legacyVendors, units, orders, grns, iddLines, iddStores] = await Promise.all([
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
    idds.length
      ? s.from("interdept_delivery_lines").select("delivery_id, quantity").in("delivery_id", idds.map((d) => d.id))
      : Promise.resolve({ data: [] }),
    s.from("stores").select("id, name").in("id", uniq(idds.flatMap((d) => [d.from_store_id, d.to_store_id]))),
  ]);
  const nameOf = (r: { data: unknown }) =>
    new Map(((r.data ?? []) as { id: string; name?: string; code?: string }[]).map((x) => [x.id, x.name ?? x.code ?? ""]));
  const vendor = nameOf(vendors);
  const legacy = nameOf(legacyVendors);
  const unit = nameOf(units);
  const order = nameOf(orders);
  const grn = nameOf(grns);
  const store = nameOf(iddStores);
  const iddQty = new Map<string, number>();
  for (const l of (iddLines.data ?? []) as { delivery_id: string; quantity: number }[]) {
    iddQty.set(l.delivery_id, (iddQty.get(l.delivery_id) ?? 0) + (Number(l.quantity) || 0));
  }

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
      // GENERAL DC (0796): out to a party for repair / sample / loan / gift. A draft reopens
      // its form; a returnable one still out is received back on Delivery Return (0797); a
      // non-returnable one reads "Sent" once dispatched (it is closed, not returned).
      if (d.dc_kind === "general") {
        const out = d.status === "issued" || d.status === "partially_returned";
        return {
          key: `dc-${d.id}`,
          id: d.id,
          kind: "general",
          code: d.code,
          date: d.dc_date,
          party: d.vendor_id ? (vendor.get(d.vendor_id) ?? "—") : (d.party_name ?? "—"),
          against: `${d.is_returnable === false ? "Non-returnable" : "Returnable"}${d.purpose ? ` · ${d.purpose}` : ""}`,
          status: d.is_returnable === false && d.status === "closed" ? "sent" : d.status,
          qty: a.qty,
          outstanding: d.is_returnable === false || d.status === "draft" ? 0 : a.out,
          href:
            d.status === "draft"
              ? `/purchase/dc?edit=${d.id}&type=general`
              : out
                ? `/purchase/delivery-returns?dc=${d.id}`
                : `/purchase/general-delivery/${d.id}/print`,
          print: d.status === "draft" ? null : `/purchase/general-delivery/${d.id}/print`,
          action: out && d.is_returnable !== false ? "receive-back" : null,
          created_at: d.created_at,
          created_by: d.created_by,
        };
      }
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
          // Worked from the hub (user 2026-10-31): a draft reopens its form in the drawer; an
          // incoming one is received there; anything else opens its print.
          href:
            d.status === "draft"
              ? `/purchase/dc?edit=${d.id}&type=production`
              : d.status === "dispatched" && d.to_location_id === here
                ? `/purchase/dc?receive=${d.id}&type=production`
                : `/stores/production-dc/${d.id}/print`,
          print: d.status === "draft" ? null : `/stores/production-dc/${d.id}/print`,
          action: d.status === "dispatched" && d.to_location_id === here ? "receive-stock" : null,
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
        // A DC against a Process Order is worked from the hub's drawer; an older one on its page.
        href: viaOrder
          ? d.status === "draft"
            ? `/purchase/dc?edit=${d.id}&type=process`
            : d.status === "closed"
              ? `/stores/process-dc/${d.id}/print`
              : `/purchase/dc?receive=${d.id}&type=process`
          : `/purchase/dc/${d.id}`,
        print: viaOrder && d.status !== "draft" ? `/stores/process-dc/${d.id}/print` : null,
        action: viaOrder && (d.status === "issued" || d.status === "partially_returned") ? "receive-back" : null,
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
        against: v.grn_id ? (grn.get(v.grn_id) ?? "GRN") : (v.reason ?? null), // the GRN code already reads "GRN-0010"
        status: v.status,
        qty: a.qty,
        outstanding: kind === "replacement" && v.status !== "cancelled" ? a.out : 0,
        // TWO SCREENS, NOT THREE (user 2026-11-02): a Rejection / Replacement DC is opened,
        // dispatched and printed in this hub — never on a separate Vendor Returns page.
        href: `/purchase/dc?view=${v.id}&type=${kind}`,
        // The return slip prints once the DC has gone out, not while it is a draft.
        print: v.status === "draft" || v.status === "cancelled" ? null : `/purchase/vendor-returns/${v.id}/print`,
        action: v.status === "draft" ? "dispatch" : null,
        created_at: v.created_at,
        created_by: v.created_by,
      };
    }),
    ...idds.map(
      (d): DcRegisterRow => ({
        key: `idd-${d.id}`,
        id: d.id,
        kind: "department",
        code: d.code,
        date: d.delivery_date,
        party: `${d.from_department} → ${d.to_department}`,
        against: `${store.get(d.from_store_id) ?? "—"} → ${store.get(d.to_store_id) ?? "—"}`,
        status: d.status,
        qty: iddQty.get(d.id) ?? 0,
        outstanding: 0,
        // It never had a screen of its own to open — the old page was a list and a pop-up.
        href: null,
        print: null,
        action: null,
        created_at: d.created_at,
        created_by: d.created_by,
      }),
    ),
  ];
  // LISTED IN ENTRY ORDER (user 2026-09-22).
  rows.sort((x, y) => x.created_at.localeCompare(y.created_at));
  return withCreators(rows);
}
