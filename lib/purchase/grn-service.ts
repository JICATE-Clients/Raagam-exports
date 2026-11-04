import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Grn, GrnLineItem, DeliveryChallan, DcLineItem, Vendor } from "./types";
import { poLineOpenBalance } from "./types";
import type { Item, Uom } from "@/lib/masters/types";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";
import { isInactive } from "@/lib/masters/inactive";

// ---------- enriched types ----------

export type GrnWithVendor = Grn & {
  /** The supplier (master vendor, 0777). Named `vendors` so every reader stays as it was. */
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
  /** The PO's MASTER vendor (0777) — what every PO names since 0737. */
  vendor_id: string;
  vendor_name: string;
  /** The item the PO line buys — copied onto the GRN line (0777). */
  item_id: string | null;
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
  /** The rest is what the Receiving screen's filter cascade reads (0778). */
  po_date: string | null;
  delivery_date: string | null;
  group_kind: GrnGroupKind;
  /** The RE (garment order) or the IWO behind the line; null for a General PO. */
  order_id: string | null;
  order_no: string | null;
  buyer: string | null;
  item_class_id: string | null;
  item_class: string | null;
  category: string | null;
  /** Yarn: the kg in one bag as the PO was raised (0758) — the GRN's bag widget opens on it. */
  bag_weight: number | null;
};

/** Where a PO line's need came from (grn.md §1 "Group Type"). */
export type GrnGroupKind = "re" | "swo" | "iwo" | "general";

export type GrnLineWithPo = GrnLineItem & {
  po_code: string | null;
  /** Where the accepted goods were put (0777) — names, for the detail page. */
  store_name: string | null;
  bin_code: string | null;
  /** The accepted qty bin by bin when the line was split (0782); [] = one bin or none. */
  bin_split: { code: string; qty: number; bin_id: string }[];
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
    // THE MASTER VENDOR, under the old key (0777) — the list and detail read `vendors.name`.
    .select("*, vendors:master_vendors!master_vendor_id(id, name)")
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
    .select("*, vendors:master_vendors!master_vendor_id(id, name)")
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
    // `bins!bin_id`, never bare: grn_line_bins (0782) is a second path to bins, so a bare
    // embed is PGRST201-ambiguous. The split rides along for the Bin cell.
    .select("*, purchase_orders(code), stores(name), bins!bin_id(bin_code), grn_line_bins(qty, sort_order, bin_id, bins!bin_id(bin_code))")
    .eq("grn_id", grnId)
    .order("sort_order");

  return (
    (data ?? []) as unknown as (GrnLineItem & {
      purchase_orders: { code: string | null } | null;
      stores: { name: string } | null;
      bins: { bin_code: string } | null;
      grn_line_bins: { qty: number; sort_order: number; bin_id: string; bins: { bin_code: string } | null }[] | null;
    })[]
  ).map(({ grn_line_bins: split, ...row }) => ({
    ...row,
    po_code: row.purchase_orders?.code ?? null,
    store_name: row.stores?.name ?? null,
    // A split line reads "B1 30 · B2 20" (0782); otherwise its one bin.
    bin_split: [...(split ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b) => ({ code: b.bins?.bin_code ?? "?", qty: Number(b.qty) || 0, bin_id: b.bin_id })),
    bin_code: split && split.length > 0
      ? [...split].sort((a, b) => a.sort_order - b.sort_order).map((b) => `${b.bins?.bin_code ?? "?"} ${b.qty}`).join(" · ")
      : (row.bins?.bin_code ?? null),
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
  /* ONE READ (0778): the PO, its line, the UOM, the order, the buyer and the item class
     come back together — what the Receiving screen's filter cascade reads. */
  /* The bag weight rides beside the RPC rather than in it (no migration): read in
     PARALLEL, so it costs no extra round trip — only open POs' yarn lines carry one. */
  const [{ data, error }, bagRes] = await Promise.all([
    supabase.rpc("grn_open_po_lines"),
    supabase
      .from("po_line_items")
      .select("id, bag_weight, purchase_orders!purchase_order_id!inner(status)")
      .in("purchase_orders.status", ["approved", "partially_received"])
      .not("bag_weight", "is", null),
  ]);
  if (error) throw new Error(`Open POs: ${error.message}`);
  if (bagRes.error) throw new Error(`Open POs (bag weights): ${bagRes.error.message}`);
  const bagWeight = new Map(
    ((bagRes.data ?? []) as { id: string; bag_weight: number | null }[]).map((r) => [r.id, Number(r.bag_weight) || null]),
  );
  const rows = (data ?? []) as Record<string, unknown>[];
  const n = (v: unknown) => Number(v) || 0;
  const str = (v: unknown) => (v == null ? null : String(v));
  return rows
    .filter((r) => !vendorId || r.master_vendor_id === vendorId)
    .map((r) => {
      const quantity = n(r.quantity);
      const received = n(r.received_qty);
      return {
        id: String(r.id),
        purchase_order_id: String(r.purchase_order_id),
        po_code: str(r.po_code),
        po_date: str(r.po_date),
        vendor_id: str(r.master_vendor_id) ?? "",
        vendor_name: str(r.vendor_name) ?? "",
        item_id: str(r.item_id),
        description: String(r.description ?? ""),
        quantity,
        received_qty: received,
        open_balance: poLineOpenBalance({ quantity, received_qty: received }),
        uom_id: str(r.uom_id),
        uom_code: str(r.uom_code),
        tolerance_pct: n(r.tolerance_pct ?? 3),
        sort_order: n(r.sort_order),
        delivery_date: str(r.delivery_date),
        group_kind: (str(r.group_kind) ?? "general") as GrnGroupKind,
        order_id: str(r.order_id),
        order_no: str(r.order_no),
        buyer: str(r.buyer),
        item_class_id: str(r.item_class_id),
        item_class: str(r.item_class),
        category: str(r.category),
        bag_weight: bagWeight.get(String(r.id)) ?? null,
      };
    });
}

/** Where a received line can be put: the working unit's stores and bins (grn.md §2A). */
export type GrnStoreOption = { id: string; code: string; name: string; store_type: string };
/** `inactive`: a switched-off bin — hidden by the picker unless a record already holds it. */
/** `store_id` (0800): the Bin list follows the chosen Store. */
export type GrnBinOption = { id: string; code: string; description: string | null; inactive?: boolean; store_id: string | null };
/** A vendor Master Data marks Is Processor — Received Store ▸ Vendor lists these (user 2026-11-03). */
export type GrnProcessorOption = { id: string; name: string };
/** An open Process Order a supplier may deliver straight to (Place of Delivery = direct, 0792). */
export type GrnProcessOrderOption = {
  id: string;
  code: string | null;
  vendor_id: string;
  vendor_name: string;
  process_type: string | null;
  /** The input items on the order — a direct line must be one of them. */
  item_ids: string[];
};

/**
 * THE WORKING UNIT'S STORES AND BINS — the Store and Bin pickers on a GRN line.
 *
 * Stores: the unit's active stores a delivery can be put into — material and purchase.
 * Rejection, surplus and processing stores are not a receiving destination (rejected
 * stock is moved to the rejection store by the post itself). Bins: the unit's own plus
 * the shared ones (no unit), active only. Until Phase 5 ties a bin to a store, any bin
 * of the unit may be picked under any store.
 */
export async function getGrnStoresAndBins(): Promise<{
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
  processOrders: GrnProcessOrderOption[];
  processors: GrnProcessorOption[];
}> {
  const supabase = await createClient();
  const { location } = await getCurrentLocation();
  if (!location) return { stores: [], bins: [], defaultStoreId: null, processOrders: [], processors: [] };
  const [storesRes, binsRes, poRes, procRes] = await Promise.all([
    supabase
      .from("stores")
      .select("id, code, name, store_type")
      .eq("location_id", location.id)
      .eq("is_active", true)
      .in("store_type", ["material", "purchase"])
      .order("code"),
    supabase
      .from("bins")
      .select("id, bin_code, description, location_id, inactive, store_id")
      .or(`location_id.eq.${location.id},location_id.is.null`)
      .order("bin_code"),
    // DIRECT TO PROCESSOR (0792): the unit's open Process Orders and their input items.
    supabase
      .from("process_orders")
      .select("id, code, vendor_id, process_type, master_vendors!vendor_id(name), process_order_lines(item_id)")
      .in("status", ["issued", "in_process", "partially_received"])
      .or(`location_id.eq.${location.id},location_id.is.null`)
      .order("created_at"),
    // RECEIVED STORE ▸ VENDOR (user 2026-11-03): the vendors Master Data marks Is Processor —
    // a delivery place outside our stores. Switched-off vendors are not offered.
    supabase.from("master_vendors").select("id, name, inactive").eq("is_processor", true).order("name"),
  ]);
  if (poRes.error) throw new Error(`Process orders: ${poRes.error.message}`);
  if (procRes.error) throw new Error(`Processors: ${procRes.error.message}`);
  const processors = ((procRes.data ?? []) as { id: string; name: string | null; inactive: boolean | null }[])
    .filter((v) => !isInactive(v))
    .map((v) => ({ id: v.id, name: v.name ?? "—" }));
  const processOrders = (
    (poRes.data ?? []) as unknown as {
      id: string;
      code: string | null;
      vendor_id: string;
      process_type: string | null;
      master_vendors: { name: string | null } | null;
      process_order_lines: { item_id: string | null }[] | null;
    }[]
  ).map((o) => ({
    id: o.id,
    code: o.code,
    vendor_id: o.vendor_id,
    vendor_name: o.master_vendors?.name ?? "—",
    process_type: o.process_type,
    item_ids: (o.process_order_lines ?? []).map((x) => x.item_id).filter((x): x is string => !!x),
  }));
  if (storesRes.error) throw new Error(`Stores: ${storesRes.error.message}`);
  if (binsRes.error) throw new Error(`Bins: ${binsRes.error.message}`);
  const stores = (storesRes.data ?? []) as GrnStoreOption[];
  const bins = ((binsRes.data ?? []) as { id: string; bin_code: string; description: string | null; inactive: boolean | null; store_id: string | null }[])
    // Kept, flagged: the picker hides a switched-off bin but still shows the one a GRN holds.
    .map((b) => ({ id: b.id, code: b.bin_code, description: b.description, inactive: !!b.inactive, store_id: b.store_id }));
  // Accepted goods land in the MATERIAL store when nothing else is picked — what postGrn
  // has always done — so that is the default the line opens with.
  const defaultStoreId = stores.find((st) => st.store_type === "material")?.id ?? stores[0]?.id ?? null;
  return { stores, bins, defaultStoreId, processOrders, processors };
}

// ---------- DC ----------

export async function listDcs(): Promise<DcWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("*, master_vendors(id, name)")
    // Job-work DCs only — a Production DC (0784) lives on Stores ▸ Production DC.
    .eq("dc_kind", "process")
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
  const { location, allowed } = await getCurrentLocation();
  // THE UNIT THE TOP BAR SHOWS IS THE UNIT THAT POSTS (fixed 2026-10-31, screenshot
  // 3934). This used to accept only a STORED choice, on the reasoning that the policy
  // read `profiles.current_location_id` alone — so an operator on their DEFAULT unit
  // (Raagam HO, never switched) was told "Pick your working unit in the top bar first"
  // while the top bar named one. That reasoning is out of date: `is_current_location()`
  // compares with `current_location()`, which walks the same chain as
  // `resolveCurrentLocation` — stored, then default, then the house unit, then a single
  // allocated unit (0489 · 0681). Whatever this resolves, the policy accepts.
  const postableId = location?.id ?? null;
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

// ---------- rejection paper + replacements (0780) ----------

/** A Rejection DC still owed a replacement — a Pending row on the Receiving screen. */
export type ReplacementDue = {
  /** The Rejection DC (vendor_returns). */
  id: string;
  code: string | null;
  vendor_id: string;
  vendor_name: string;
  /** The GRN that rejected the goods. */
  grn_code: string | null;
  /** What is still owed, per PO line. */
  lines: { po_line_item_id: string; due: number }[];
};

/**
 * REJECTION DCs STILL OWED A REPLACEMENT (grn.md §2C). Only DCs a GRN raised (`grn_id`
 * set), only their "replace" lines, only what is not yet replaced — a "return" line is
 * re-bought on a new PO instead. A cancelled or closed DC owes nothing. Two reads, no
 * embed: grns ↔ vendor_returns point at each other (0780), and the vendor is named off
 * the master by id.
 */
export async function getReplacementsDue(): Promise<ReplacementDue[]> {
  const supabase = await createClient();
  const { data: docs, error } = await supabase
    .from("vendor_returns")
    .select("id, code, grn_id, master_vendor_id, status")
    .not("grn_id", "is", null)
    .in("status", ["draft", "returned"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Rejection DCs: ${error.message}`);
  const rows = (docs ?? []) as { id: string; code: string | null; grn_id: string; master_vendor_id: string | null }[];
  if (rows.length === 0) return [];
  const [linesRes, grnsRes, vendorsRes] = await Promise.all([
    supabase
      .from("vendor_return_lines")
      .select("vendor_return_id, po_line_item_id, return_qty, replacement_qty, rejection_action")
      .in("vendor_return_id", rows.map((r) => r.id)),
    supabase.from("grns").select("id, code").in("id", rows.map((r) => r.grn_id)),
    supabase
      .from("master_vendors")
      .select("id, name")
      .in("id", rows.map((r) => r.master_vendor_id).filter((v): v is string => !!v)),
  ]);
  if (linesRes.error) throw new Error(`Rejection DC lines: ${linesRes.error.message}`);
  const grnCode = new Map(((grnsRes.data ?? []) as { id: string; code: string | null }[]).map((g) => [g.id, g.code]));
  const vendorName = new Map(((vendorsRes.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const byDoc = new Map<string, { po_line_item_id: string; due: number }[]>();
  for (const l of (linesRes.data ?? []) as {
    vendor_return_id: string;
    po_line_item_id: string | null;
    return_qty: number;
    replacement_qty: number;
    rejection_action: string | null;
  }[]) {
    const due = (Number(l.return_qty) || 0) - (Number(l.replacement_qty) || 0);
    if (!l.po_line_item_id || (l.rejection_action ?? "replace") !== "replace" || due <= 0) continue;
    const arr = byDoc.get(l.vendor_return_id) ?? [];
    arr.push({ po_line_item_id: l.po_line_item_id, due });
    byDoc.set(l.vendor_return_id, arr);
  }
  return rows
    .filter((r) => byDoc.has(r.id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      vendor_id: r.master_vendor_id ?? "",
      vendor_name: (r.master_vendor_id && vendorName.get(r.master_vendor_id)) || "",
      grn_code: grnCode.get(r.grn_id) ?? null,
      lines: byDoc.get(r.id) ?? [],
    }));
}

/** The Debit Note and Rejection DC a posted GRN raised, and the DC a replacement fills. */
export type GrnPaper = {
  debitNote: { id: string; code: string | null; amount: number; status: string } | null;
  /** The Rejection DC ('return' lines, with the debit note) — 0781 split it from the next. */
  rejectionDc: { id: string; code: string | null; status: string } | null;
  /** The Replacement DC ('replace' lines, no debit note) — the vendor resends these. */
  replacementDc: { id: string; code: string | null; status: string } | null;
  replaces: { id: string; code: string | null } | null;
};

export async function getGrnPaper(grn: Pick<Grn, "id" | "vendor_return_id">): Promise<GrnPaper> {
  const supabase = await createClient();
  // Separate reads, never an embed: grns ↔ vendor_returns is ambiguous both ways (0780).
  // A reader without Finance / Stores access gets nothing back for that half — said as "—".
  const [dn, dc, rep] = await Promise.all([
    supabase.from("finance_notes").select("id, code, amount, status").eq("grn_id", grn.id).maybeSingle(),
    supabase.from("vendor_returns").select("id, code, status, dc_kind").eq("grn_id", grn.id),
    grn.vendor_return_id
      ? supabase.from("vendor_returns").select("id, code").eq("id", grn.vendor_return_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    debitNote: dn.data
      ? { ...(dn.data as { id: string; code: string | null; status: string }), amount: Number((dn.data as { amount: number }).amount) || 0 }
      : null,
    // Before 0781 a GRN raised one DC with no kind — read as a Rejection DC, as it was printed.
    rejectionDc:
      ((dc.data ?? []) as { id: string; code: string | null; status: string; dc_kind: string | null }[]).find(
        (d) => d.dc_kind !== "replacement",
      ) ?? null,
    replacementDc:
      ((dc.data ?? []) as { id: string; code: string | null; status: string; dc_kind: string | null }[]).find(
        (d) => d.dc_kind === "replacement",
      ) ?? null,
    replaces: (rep.data as GrnPaper["replaces"]) ?? null,
  };
}

/** One GRN line held at Pending QC (0791) — a row on Stores ▸ Pending QC. */
export type PendingQcLine = {
  id: string;
  grn_id: string;
  grn_code: string | null;
  grn_date: string | null;
  grn_kind: string;
  vendor_name: string | null;
  po_code: string | null;
  description: string;
  received_qty: number;
  uom_code: string | null;
  lot_no: string | null;
  store_id: string | null;
  close_balance: boolean;
  created_at: string | null;
};

/**
 * EVERY LINE WAITING FOR AN INSPECTOR in the working unit (0791): posted GRNs whose line
 * still reads QC = Pending. Unit-scoped by RLS (a GRN line follows its GRN), oldest first —
 * the goods that have waited longest at the gate are the first to inspect.
 */
// created-by: exempt -- a work queue of lines; the GRN above each carries its creator
export async function listPendingQcLines(): Promise<PendingQcLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grn_line_items")
    .select(
      "id, grn_id, description, received_qty, roll_batch_no, store_id, close_balance, created_at, purchase_orders(code), po_line_items(uom_id, uoms(code)), grns!inner(code, grn_date, kind, status, vendors:master_vendors!master_vendor_id(name))",
    )
    .eq("qc_status", "pending")
    .eq("grns.status", "posted")
    .order("created_at");
  if (error) throw new Error(`Pending QC: ${error.message}`);
  return (
    (data ?? []) as unknown as {
      id: string;
      grn_id: string;
      description: string | null;
      received_qty: number | null;
      roll_batch_no: string | null;
      store_id: string | null;
      close_balance: boolean | null;
      created_at: string | null;
      purchase_orders: { code: string | null } | null;
      po_line_items: { uoms: { code: string | null } | null } | null;
      grns: { code: string | null; grn_date: string | null; kind: string; vendors: { name: string | null } | null } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    grn_id: r.grn_id,
    grn_code: r.grns?.code ?? null,
    grn_date: r.grns?.grn_date ?? null,
    grn_kind: r.grns?.kind ?? "regular",
    vendor_name: r.grns?.vendors?.name ?? null,
    po_code: r.purchase_orders?.code ?? null,
    description: r.description ?? "",
    received_qty: Number(r.received_qty) || 0,
    uom_code: r.po_line_items?.uoms?.code ?? null,
    lot_no: r.roll_batch_no,
    store_id: r.store_id,
    close_balance: !!r.close_balance,
    created_at: r.created_at,
  }));
}

/**
 * WHY A POSTED GRN'S QUANTITIES CANNOT BE EDITED — null when they can (0792). The same
 * refusals `grn_edit_posted` makes, asked up front so the edit screen can say so before
 * the operator types; the function stays the guard. The paper is always editable.
 */
export async function grnQtyLockReason(grnId: string): Promise<string | null> {
  const supabase = await createClient();
  const [grnRes, linesRes, billsRes, notesRes, dcsRes] = await Promise.all([
    supabase.from("grns").select("status, kind, delivery_kind").eq("id", grnId).maybeSingle(),
    supabase.from("grn_line_items").select("close_balance").eq("grn_id", grnId),
    supabase.from("payables").select("status").eq("grn_id", grnId),
    supabase.from("finance_notes").select("status").eq("grn_id", grnId),
    supabase.from("vendor_returns").select("id, status").eq("grn_id", grnId),
  ]);
  for (const r of [grnRes, linesRes, billsRes, notesRes, dcsRes]) if (r.error) throw new Error(`GRN edit check: ${r.error.message}`);
  const g = grnRes.data as { status: string; kind: string; delivery_kind: string | null } | null;
  if (!g) return "GRN not found";
  if (g.status !== "posted") return "Only a posted GRN is edited here";
  if (g.kind !== "regular") return "A Replacement GRN's quantities cannot be edited — it has already filled its Replacement DC";
  if (g.delivery_kind === "direct") return "Delivered direct to a processor — its Job Work DC is already with the processor";
  if (((linesRes.data ?? []) as { close_balance: boolean | null }[]).some((l) => l.close_balance)) {
    return "A line on this GRN closed its PO balance — that cannot be undone by an edit";
  }
  if (((billsRes.data ?? []) as { status: string }[]).some((b) => b.status !== "draft")) return "Its bill is no longer a draft in Payables";
  if (((notesRes.data ?? []) as { status: string }[]).some((n) => n.status !== "draft")) return "Its debit note is no longer a draft";
  const dcs = (dcsRes.data ?? []) as { id: string; status: string }[];
  if (dcs.some((d) => d.status !== "draft")) return "Its Rejection / Replacement DC has already gone back to the vendor";
  if (dcs.length > 0) {
    const { data: repl, error } = await supabase.from("grns").select("id").in("vendor_return_id", dcs.map((d) => d.id)).limit(1);
    if (error) throw new Error(`GRN edit check: ${error.message}`);
    if ((repl ?? []).length > 0) return "A replacement has already been received against this GRN";
  }
  return null;
}
