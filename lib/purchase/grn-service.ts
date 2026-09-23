import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Grn, GrnLineItem, DeliveryChallan, DcLineItem, Vendor } from "./types";
import { poLineOpenBalance } from "./types";
import type { Item, Uom } from "@/lib/masters/types";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";

// ---------- enriched types ----------

export type GrnWithVendor = Grn & {
  vendors: Pick<Vendor, "id" | "name"> | null;
  line_count: number;
  /** Display name of `over_receipt_authorized_by` — set by `getGrn` only. */
  over_receipt_authorized_by_name?: string | null;
};

/** A PO line that still has open quantity available to receive. */
export type OpenPoLine = {
  id: string;
  purchase_order_id: string;
  po_code: string | null;
  vendor_id: string;
  vendor_name: string;
  description: string;
  quantity: number;
  received_qty: number;
  open_balance: number;
  uom_id: string | null;
  /** The UOM's code, resolved here so the store keeper never types one. */
  uom_code: string | null;
  /** The PO's approved over-receipt tolerance, percent (0620). */
  tolerance_pct: number;
  sort_order: number;
};

export type GrnLineWithPo = GrnLineItem & {
  po_code: string | null;
};

/* THE EMBED IS NAMED AFTER THE RELATIONSHIP, so both of these say
   `master_vendors` since 0445 repointed `delivery_challans.vendor_id` there.
   A DC's processor is a MASTER vendor; a GRN's supplier is still a legacy
   `public.vendors` row, and the two types must not be merged for that reason. */
export type DcVendor = { id: string; name: string };

export type DcWithVendor = DeliveryChallan & {
  master_vendors: DcVendor | null;
  outstanding_qty: number;
};

export type DcDetail = DeliveryChallan & {
  master_vendors: DcVendor | null;
};

// ---------- GRN ----------

export async function listGrns(): Promise<GrnWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grns")
    .select("*, vendors(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as (Grn & {
    vendors: Pick<Vendor, "id" | "name"> | null;
  })[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: lineCounts } = await supabase
    .from("grn_line_items")
    .select("grn_id")
    .in("grn_id", ids);

  const countMap: Record<string, number> = {};
  for (const lc of (lineCounts ?? []) as { grn_id: string }[]) {
    countMap[lc.grn_id] = (countMap[lc.grn_id] ?? 0) + 1;
  }

  return withCreators(rows.map((r) => ({ ...r, line_count: countMap[r.id] ?? 0 })));
}

export async function getGrn(id: string): Promise<GrnWithVendor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grns")
    .select("*, vendors(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Grn & {
    vendors: Pick<Vendor, "id" | "name"> | null;
  };
  // The override's author, by the same SECURITY DEFINER name lookup
  // `withCreators` uses — a `profiles` embed would resolve to null for anyone
  // but the reader themself (profiles_read_own).
  let authorName: string | null = null;
  if (row.over_receipt_authorized_by) {
    const { data: names } = await supabase.rpc("creator_names", {
      ids: [row.over_receipt_authorized_by],
    });
    authorName =
      ((names ?? []) as { id: string; full_name: string | null }[])[0]?.full_name ?? null;
  }
  return { ...row, line_count: 0, over_receipt_authorized_by_name: authorName };
}

export async function getGrnLines(grnId: string): Promise<GrnLineWithPo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grn_line_items")
    .select("*, purchase_orders(code)")
    .eq("grn_id", grnId)
    .order("sort_order");

  return (
    (data ?? []) as unknown as (GrnLineItem & {
      purchase_orders: { code: string | null } | null;
    })[]
  ).map((row) => ({
    ...row,
    po_code: row.purchase_orders?.code ?? null,
  }));
}

/**
 * Every line of every PO still open for receipt (approved / partially
 * received), optionally for one vendor.
 *
 * ALL LINES, NOT ONLY THOSE WITH AN OPEN BALANCE (0620). Picking a PO on the
 * GRN screen loads its whole expected list, so the store keeper never types a
 * description or a UOM — and a line already received in full is still a line
 * the vendor can over-deliver on, which is exactly what the tolerance banner
 * exists to show. The screen skips a line whose Today Recd is left blank.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST: an empty list here reads as
 * "this vendor has nothing open", which is believed rather than reported.
 */
export async function getOpenPoLines(vendorId?: string): Promise<OpenPoLine[]> {
  const supabase = await createClient();

  let poQuery = supabase
    .from("purchase_orders")
    .select("id, code, vendor_id, over_receipt_tolerance_pct, vendors!vendor_id(id, name)")
    .in("status", ["approved", "partially_received"])
    // Entry order, so the PO picker lists them 1, 2, 3.
    .order("created_at", { ascending: true });

  if (vendorId) {
    poQuery = poQuery.eq("vendor_id", vendorId);
  }

  const { data: posData, error: poErr } = await poQuery;
  if (poErr) throw new Error(`Open POs: ${poErr.message}`);
  const pos = (posData ?? []) as unknown as {
    id: string;
    code: string | null;
    vendor_id: string;
    over_receipt_tolerance_pct: number | null;
    vendors: { id: string; name: string } | null;
  }[];

  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.id);
  const poMap = new Map(pos.map((p) => [p.id, p]));

  const { data: linesData, error: lineErr } = await supabase
    .from("po_line_items")
    .select("id, purchase_order_id, description, quantity, received_qty, uom_id, sort_order")
    .in("purchase_order_id", poIds)
    .order("sort_order");
  if (lineErr) throw new Error(`Open PO lines: ${lineErr.message}`);

  const lines = (linesData ?? []) as {
    id: string;
    purchase_order_id: string;
    description: string;
    quantity: number;
    received_qty: number;
    uom_id: string | null;
    sort_order: number;
  }[];

  // UOM codes by a second read rather than an embed: `po_line_items` carries
  // both `uom_id` and `billing_uom_id` to `uoms`, so a bare `uoms(code)` embed
  // is PGRST201-ambiguous (AGENTS.md, "A SECOND FK BREAKS EVERY EXISTING EMBED").
  const uomIds = Array.from(new Set(lines.map((l) => l.uom_id).filter(Boolean))) as string[];
  const uomCode = new Map<string, string>();
  if (uomIds.length > 0) {
    const { data: uomRows } = await supabase.from("uoms").select("id, code").in("id", uomIds);
    for (const u of (uomRows ?? []) as { id: string; code: string }[]) uomCode.set(u.id, u.code);
  }

  return lines.map((line) => {
    const po = poMap.get(line.purchase_order_id);
    return {
      id: line.id,
      purchase_order_id: line.purchase_order_id,
      po_code: po?.code ?? null,
      vendor_id: po?.vendor_id ?? "",
      vendor_name: po?.vendors?.name ?? "",
      description: line.description,
      quantity: Number(line.quantity) || 0,
      received_qty: Number(line.received_qty) || 0,
      open_balance: poLineOpenBalance({
        quantity: Number(line.quantity) || 0,
        received_qty: Number(line.received_qty) || 0,
      }),
      uom_id: line.uom_id,
      uom_code: line.uom_id ? (uomCode.get(line.uom_id) ?? null) : null,
      tolerance_pct: Number(po?.over_receipt_tolerance_pct ?? 3),
      sort_order: line.sort_order ?? 0,
    };
  });
}

// ---------- DC ----------

export async function listDcs(): Promise<DcWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("*, master_vendors(id, name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as (DeliveryChallan & {
    master_vendors: DcVendor | null;
  })[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: linesData } = await supabase
    .from("dc_line_items")
    .select("delivery_challan_id, sent_qty, returned_qty")
    .in("delivery_challan_id", ids);

  const outMap: Record<string, number> = {};
  for (const l of (linesData ?? []) as {
    delivery_challan_id: string;
    sent_qty: number;
    returned_qty: number;
  }[]) {
    const bal = Math.max(0, (l.sent_qty ?? 0) - (l.returned_qty ?? 0));
    outMap[l.delivery_challan_id] = (outMap[l.delivery_challan_id] ?? 0) + bal;
  }

  return withCreators(rows.map((r) => ({ ...r, outstanding_qty: outMap[r.id] ?? 0 })));
}

export async function getDc(id: string): Promise<DcDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("*, master_vendors(id, name)")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as unknown as DcDetail | null;
}

export async function getDcLines(dcId: string): Promise<DcLineItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dc_line_items")
    .select("*")
    .eq("delivery_challan_id", dcId)
    .order("sort_order");
  return (data ?? []) as DcLineItem[];
}

// ---------- master lookups ----------

/**
 * The processors a Delivery Challan may name — `master_vendors`, since 0445.
 *
 * A SEPARATE FUNCTION FROM `getVendors()` BELOW, deliberately. That one is
 * shared with the GRN form, and GRN stays on legacy `public.vendors`; repointing
 * it in place would hand that form master ids which fail `grns_vendor_id_fkey` —
 * the same class of defect 0377 and 0445 both exist to prevent, reintroduced by
 * the fix. 0439's header got this wrong and named `getVendors` as a site to edit.
 *
 * FILTERS ON `status`, NOT `is_active`. `master_vendors` has no such column
 * (0246); copying `getVendors`' filter across returns a PostgREST 400 at runtime
 * that `tsc` cannot see. 0445 asserts the column has not appeared since.
 */
export async function getProcessorVendors(): Promise<
  { id: string; code: string | null; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("master_vendors")
    .select("id, code, name")
    .eq("status", "Approved")
    .order("name");
  return (data ?? []) as { id: string; code: string | null; name: string }[];
}

export async function getVendors(): Promise<
  Pick<Vendor, "id" | "code" | "name">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<Vendor, "id" | "code" | "name">[];
}

export async function getLocations(): Promise<
  { id: string; code: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string }[];
}

/**
 * The units this operator may RECEIVE into, and which one to default to.
 *
 * Every unit `my_locations()` lets them reach is listed, but only the one they
 * are WORKING IN is postable: `grns_insert` is `is_current_location(location_id)`
 * (0487), so a GRN named for any other unit is refused by RLS. The rest come
 * back `postable: false` so the picker can show them greyed with the reason
 * ("switch unit in the top bar") rather than offering a choice that fails on
 * Save — or hiding a unit the keeper knows they belong to.
 */
export async function getGrnReceivingLocations(): Promise<{
  options: { id: string; code: string; name: string; postable: boolean }[];
  defaultId: string | null;
}> {
  const { location, source, allowed } = await getCurrentLocation();
  // Only a STORED current unit satisfies the policy; a unit resolved from the
  // default/fallback is what the top bar shows, but the column the policy reads
  // is still empty until the operator switches once.
  const postableId = source === "stored" ? (location?.id ?? null) : null;
  return {
    options: allowed.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      postable: l.id === postableId,
    })),
    defaultId: postableId,
  };
}

export async function getItems(): Promise<Pick<Item, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<Item, "id" | "code" | "name">[];
}

export async function getUoms(): Promise<Pick<Uom, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as Pick<Uom, "id" | "code" | "name">[];
}
