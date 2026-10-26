import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import { creatorName } from "@/components/ui/created-columns";
import type { DraftHold } from "./filters";
import { lineKeyOf, type ClassVendor, type RaisedPo, type RequirementLine } from "./types";

/*
 * Reads for the PO-from-requirement screen. Both go through the SECURITY DEFINER
 * functions of 0737, which check `materials_purchase` and the caller's order
 * access themselves — a Purchase Manager need not hold `orders:view` to see what
 * an RE still has to buy.
 *
 * A FAILED READ IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md, "A second FK"): an
 * empty requirement list reads as "nothing left to buy", which is exactly the
 * answer nobody would question.
 */

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Every requirement line with a balance, or the lines of the given REs (balance or not). */
export async function getRequirementLines(sourceIds?: readonly string[]): Promise<RequirementLine[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("po_requirement_lines", {
    p_source_ids: sourceIds && sourceIds.length ? [...sourceIds] : null,
  });
  if (error) throw new Error(`Could not read the requirement sheets: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    source_kind: (r.source_kind as RequirementLine["source_kind"]) ?? "re",
    source_id: String(r.source_id),
    source_no: String(r.source_no ?? "—"),
    garment_order_id: (r.garment_order_id as string | null) ?? null,
    iwo_id: (r.iwo_id as string | null) ?? null,
    sales_order_id: (r.sales_order_id as string | null) ?? null,
    re_no: (r.re_no as string | null) ?? null,
    customer: (r.customer as string | null) ?? null,
    delivery_date: (r.delivery_date as string | null) ?? null,
    item_id: String(r.item_id),
    item_name: String(r.item_name ?? ""),
    item_class_id: (r.item_class_id as string | null) ?? null,
    item_class: (r.item_class as string | null) ?? null,
    category_id: (r.category_id as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    slice_label: String(r.slice_label ?? ""),
    colour: (r.colour as string | null) ?? null,
    req_key: String(r.req_key),
    uom_id: (r.uom_id as string | null) ?? null,
    uom_code: (r.uom_code as string | null) ?? null,
    required_qty: num(r.required_qty),
    ordered_qty: num(r.ordered_qty),
    balance_qty: num(r.balance_qty),
    size_id: (r.size_id as string | null) ?? null,
    size_name: (r.size_name as string | null) ?? null,
    size_sort: r.size_sort == null ? null : num(r.size_sort),
    slice_base: String(r.slice_base ?? r.slice_label ?? ""),
  }));
}

/**
 * The number the next PO in the caller's working unit will take — HO/PO/26-27/0001
 * (0745). A PREVIEW for the PO No field: the insert trigger decides, under a lock, so
 * a PO saved by someone else in between takes this one and the screen's goes up by one.
 */
export async function peekPoNumber(): Promise<string | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("po_peek_number");
  if (error) throw new Error(`Could not read the next PO number: ${error.message}`);
  return (data as string | null) ?? null;
}

/** Bought-item vendors mapped to an item class (Master Data ▸ Vendors ▸ item categories). */
export async function getVendorsForClass(itemClassId: string): Promise<ClassVendor[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("po_vendors_for_class", { p_item_class_id: itemClassId });
  if (error) throw new Error(`Could not read the vendors: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((v) => ({
    id: String(v.id),
    code: (v.code as string | null) ?? null,
    name: String(v.name ?? ""),
    lead_days: v.lead_days == null ? null : Number(v.lead_days),
    on_time_pct: v.on_time_pct == null ? null : Number(v.on_time_pct),
    received_lines: num(v.received_lines),
  }));
}

/**
 * WHICH LINES HAVE AN APPROVED BUDGET — the Budget filter (2026-10-26). The same
 * `po_budget_check` the rate check uses, asked with NO rate: it answers
 * has_budget and never the figure, so spec point 7 (the budget rate stays hidden)
 * holds. An IWO / SWO line has no order budget and comes back false, as it does
 * when its PO is submitted.
 */
export async function getBudgetedLineKeys(lines: readonly RequirementLine[]): Promise<string[]> {
  const re = lines.filter((l) => l.garment_order_id);
  if (re.length === 0) return [];
  const s = await createClient();
  const { data, error } = await s.rpc("po_budget_check", {
    p_lines: re.map((l) => ({
      key: lineKeyOf(l),
      garment_order_id: l.garment_order_id,
      item_id: l.item_id,
      uom_id: l.uom_id,
      slice_label: l.slice_label,
      colour: l.colour,
      rate: null,
    })),
  });
  if (error) throw new Error(`Could not read which orders have an approved budget: ${error.message}`);
  return ((data ?? []) as { key: string; has_budget: boolean }[]).filter((r) => r.has_budget).map((r) => r.key);
}

/**
 * DRAFT POs HOLDING A BALANCE (2026-10-26). A draft counts as ordered (0748's
 * `ord`), so an order a colleague drafted and forgot shows less left to buy with
 * nothing on screen saying why — the list names the draft instead. Two plain
 * reads, no embed: `po_line_items` → `purchase_orders` is not on the ambiguous
 * list today, and a select that never embeds cannot become ambiguous later.
 */
export async function getDraftHolds(): Promise<DraftHold[]> {
  const s = await createClient();
  const { data: pos, error } = await s.from("purchase_orders").select("id, code, created_by").eq("status", "draft");
  if (error) throw new Error(`Could not read the draft POs: ${error.message}`);
  const drafts = await withCreators((pos ?? []) as { id: string; code: string | null; created_by: string | null }[]);
  if (drafts.length === 0) return [];
  const { data: ls, error: lErr } = await s
    .from("po_line_items")
    .select("purchase_order_id, garment_order_id, iwo_id, req_key")
    .in("purchase_order_id", drafts.map((d) => d.id))
    .not("req_key", "is", null);
  if (lErr) throw new Error(`Could not read the draft PO lines: ${lErr.message}`);
  const byId = new Map(drafts.map((d) => [d.id, d]));
  return ((ls ?? []) as { purchase_order_id: string; garment_order_id: string | null; iwo_id: string | null; req_key: string }[])
    .filter((l) => l.garment_order_id ?? l.iwo_id)
    .map((l) => {
      const d = byId.get(l.purchase_order_id);
      return {
        source_id: (l.garment_order_id ?? l.iwo_id) as string,
        req_key: l.req_key,
        code: d?.code ?? "Draft PO",
        by: creatorName(d),
      };
    });
}

/**
 * THE POs RAISED ON THIS SCREEN — Raise PO's Updated and Draft lists (user
 * 2026-10-26: "make it like the order module, pending · updated · draft"). A PO
 * belongs here when any of its lines carries a `req_key` (only
 * `savePoFromRequirement` writes one); a PO made on Purchase Orders has none.
 * Plain reads, no embed — the same reason as `getDraftHolds` above, and
 * `purchase_orders` → vendors IS on the ambiguous list.
 */
export async function listRaisedPos(): Promise<RaisedPo[]> {
  const s = await createClient();
  const { data: ls, error: lErr } = await s
    .from("po_line_items")
    .select("purchase_order_id, garment_order_id, iwo_id")
    .not("req_key", "is", null);
  if (lErr) throw new Error(`Could not read the raised PO lines: ${lErr.message}`);
  const sourcesOf = new Map<string, Set<string>>();
  for (const l of (ls ?? []) as { purchase_order_id: string; garment_order_id: string | null; iwo_id: string | null }[]) {
    const set = sourcesOf.get(l.purchase_order_id) ?? new Set<string>();
    const src = l.garment_order_id ?? l.iwo_id;
    if (src) set.add(src);
    sourcesOf.set(l.purchase_order_id, set);
  }
  if (sourcesOf.size === 0) return [];

  const { data: pos, error } = await s
    .from("purchase_orders")
    .select("id, code, status, order_date, total_amount, master_vendor_id, created_at, created_by")
    .in("id", [...sourcesOf.keys()])
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not read the raised POs: ${error.message}`);
  const rows = (pos ?? []) as Omit<RaisedPo, "vendor" | "source_nos" | "customers">[];

  const vendorIds = [...new Set(rows.map((r) => r.master_vendor_id).filter((v): v is string => !!v))];
  const allSources = [...new Set([...sourcesOf.values()].flatMap((x) => [...x]))];
  const [vendors, reqLines] = await Promise.all([
    vendorIds.length
      ? s.from("master_vendors").select("id, name").in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    // Balance or not: a fully ordered RE has left the open list but still names its PO.
    getRequirementLines(allSources),
  ]);
  if (vendors.error) throw new Error(`Could not read the vendors: ${vendors.error.message}`);
  const vendorName = new Map(((vendors.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const sourceInfo = new Map(reqLines.map((l) => [l.source_id, { no: l.source_no, customer: l.customer }]));

  return withCreators(
    rows.map((r) => {
      const src = [...(sourcesOf.get(r.id) ?? [])].map((id) => sourceInfo.get(id)).filter((x) => !!x);
      return {
        ...r,
        total_amount: num(r.total_amount),
        vendor: r.master_vendor_id ? (vendorName.get(r.master_vendor_id) ?? null) : null,
        source_nos: [...new Set(src.map((x) => x.no))].sort(),
        customers: [...new Set(src.map((x) => x.customer).filter((c): c is string => !!c))],
      };
    }),
  );
}

/**
 * EVERY ITEM CLASS, not only the ones with something to buy (user 2026-10-26: "item
 * class should list all"). The screen counts each against the requirement lines and
 * greys a class at 0 — visible, so the operator sees the class exists and that it has
 * nothing pending, but not pickable into an empty PO. A switched-off class is left
 * out, as everywhere (AGENTS.md, Disabled rows).
 */
export async function getItemClasses(): Promise<{ id: string; name: string }[]> {
  const s = await createClient();
  const { data, error } = await s.from("config_lookups").select("*").eq("kind", "item_class").order("name");
  if (error) throw new Error(`Could not read the item classes: ${error.message}`);
  return ((data ?? []) as ({ id: string; name: string | null } & Deactivatable)[])
    .filter((c) => !isInactive(c))
    .map((c) => ({ id: c.id, name: c.name ?? "—" }));
}

/** The vendors of every class in `classIds`, keyed by class — one round, not one per class. */
export async function getVendorsByClass(classIds: readonly string[]): Promise<Record<string, ClassVendor[]>> {
  const unique = [...new Set(classIds)];
  const lists = await Promise.all(unique.map((id) => getVendorsForClass(id)));
  return Object.fromEntries(unique.map((id, i) => [id, lists[i]]));
}
