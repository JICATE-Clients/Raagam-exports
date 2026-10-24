import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClassVendor, RequirementLine } from "./types";

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

/** The vendors of every class in `classIds`, keyed by class — one round, not one per class. */
export async function getVendorsByClass(classIds: readonly string[]): Promise<Record<string, ClassVendor[]>> {
  const unique = [...new Set(classIds)];
  const lists = await Promise.all(unique.map((id) => getVendorsForClass(id)));
  return Object.fromEntries(unique.map((id, i) => [id, lists[i]]));
}
