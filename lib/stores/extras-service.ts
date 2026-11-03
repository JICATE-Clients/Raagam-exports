import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  MaterialRequisition,
  MaterialRequisitionLine,
  VendorReturn,
  VendorReturnLine,
  CspReceipt,
  CspReceiptLine,
} from "./extras-types";
import { withCreators } from "@/lib/created-by";

// `is_active` rides on every option row: the picker hides a disabled store /
// material / vendor / buyer, and keeps the one a document already names so
// reopening it still reads (AGENTS.md, "Disabled rows").
export type StoreOption = { id: string; code: string; name: string; is_active: boolean };
export type ItemOption = { id: string; code: string | null; name: string; is_active: boolean };
export type VendorOption = { id: string; code: string | null; name: string; is_active: boolean };
export type BuyerOption = { id: string; name: string; is_active: boolean };

function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

// ---------- pickers ----------
/** Accessible stores only (RLS on `stores` already filters by can_access_store). */
export async function getStoreOptions(): Promise<StoreOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("stores")
    .select("id, code, name, is_active")
    .order("code");
  return (data ?? []) as StoreOption[];
}
export async function getItems(): Promise<ItemOption[]> {
  const s = await createClient();
  const { data } = await s.from("items").select("id, code, name, is_active").order("name");
  return (data ?? []) as ItemOption[];
}
export async function getVendors(): Promise<VendorOption[]> {
  const s = await createClient();
  const { data } = await s.from("vendors").select("id, code, name, is_active").order("name");
  return (data ?? []) as VendorOption[];
}
export async function getBuyers(): Promise<BuyerOption[]> {
  const s = await createClient();
  const { data } = await s.from("buyers").select("id, name, is_active").order("name");
  return (data ?? []) as BuyerOption[];
}

// ============================================================================
// Material Requisitions
// ============================================================================
export interface MrsWithRefs extends MaterialRequisition {
  store_code: string | null;
}
export async function listRequisitions(): Promise<MrsWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_requisitions")
    .select("*, stores(code)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as MaterialRequisition),
    store_code: joined(r, "stores", "code"),
  })));
}
export async function getRequisition(id: string): Promise<MaterialRequisition | null> {
  const s = await createClient();
  const { data } = await s.from("material_requisitions").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as MaterialRequisition | null;
}
export async function getRequisitionLines(docId: string): Promise<MaterialRequisitionLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_requisition_lines")
    .select("*")
    .eq("material_requisition_id", docId)
    .order("sort_order");
  return (data ?? []) as MaterialRequisitionLine[];
}

// ============================================================================
// General Items Delivery (Purchase ▸ General Items Purchase, 2026-11-02)
// ============================================================================
/**
 * The store's hand-over queue: APPROVED Material Requisition Slips waiting to go
 * to the department, and the ISSUED ones already gone. No table of its own — a
 * delivery IS the MRS issue step (`issueMrs`), whole slip at a time (user
 * 2026-11-02: reuse the issue step, no partial delivery).
 *
 * Each line carries the store's on-hand balance so the screen can say Ready or
 * Short before the operator presses Deliver, and each slip carries the item
 * classes of its lines so the screen can narrow to GENERAL (`GEN`) items.
 */
export interface DeliveryQueueLine {
  id: string;
  item_id: string;
  item_name: string | null;
  item_class_id: string | null;
  requested_qty: number;
  issued_qty: number;
  stock_qty: number;
}
export interface DeliveryQueueRow extends MaterialRequisition {
  store_code: string | null;
  store_name: string | null;
  lines: DeliveryQueueLine[];
  /** Item classes of the slip's lines — a slip matches a class filter when any line does. */
  item_class_ids: string[];
  /** Lines whose requested quantity is more than the store holds (approved slips only). */
  short_lines: DeliveryQueueLine[];
}
export type ItemClassOption = { id: string; code: string; name: string };

/** created-by: exempt -- an OPTIONS list (the Item class filter), not a record listing. */
export async function listItemClassOptions(): Promise<ItemClassOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("config_lookups")
    .select("id, code, name")
    .eq("kind", "item_class")
    .order("name");
  return (data ?? []) as ItemClassOption[];
}

export async function listDeliveryQueue(): Promise<DeliveryQueueRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("material_requisitions")
    .select("*, stores(code, name)")
    .in("status", ["approved", "issued"])
    // Entry order, as every listing (user 2026-09-22).
    .order("created_at", { ascending: true });
  // A failed query is an error, not an empty queue (AGENTS.md, second-FK note).
  if (error) throw new Error(`General Items Delivery: ${error.message}`);
  const docs = (data ?? []) as Record<string, unknown>[];
  if (docs.length === 0) return [];

  const ids = docs.map((d) => d.id as string);
  const { data: lineData, error: lineErr } = await s
    .from("material_requisition_lines")
    .select("id, material_requisition_id, item_id, requested_qty, issued_qty, sort_order")
    .in("material_requisition_id", ids)
    .order("sort_order");
  if (lineErr) throw new Error(`General Items Delivery: ${lineErr.message}`);
  const lines = (lineData ?? []) as (Pick<MaterialRequisitionLine, "id" | "material_requisition_id" | "item_id" | "requested_qty" | "issued_qty">)[];

  const itemIds = [...new Set(lines.map((l) => l.item_id))];
  const storeIds = [...new Set(docs.map((d) => d.store_id as string))];
  const [itemsRes, stockRes] = await Promise.all([
    itemIds.length
      ? s.from("items").select("id, name, item_class_id").in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    itemIds.length
      ? s.from("stock_balances").select("store_id, item_id, quantity").in("store_id", storeIds).in("item_id", itemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsRes.error) throw new Error(`General Items Delivery: ${itemsRes.error.message}`);
  if (stockRes.error) throw new Error(`General Items Delivery: ${stockRes.error.message}`);
  const items = new Map(
    ((itemsRes.data ?? []) as { id: string; name: string; item_class_id: string | null }[]).map((i) => [i.id, i]),
  );
  const stock = new Map<string, number>();
  for (const b of (stockRes.data ?? []) as { store_id: string; item_id: string; quantity: number }[]) {
    const k = `${b.store_id}:${b.item_id}`;
    stock.set(k, (stock.get(k) ?? 0) + Number(b.quantity ?? 0));
  }

  const storeOf = new Map(docs.map((d) => [d.id as string, d.store_id as string]));
  const byDoc = new Map<string, DeliveryQueueLine[]>();
  for (const l of lines) {
    const item = items.get(l.item_id);
    const row: DeliveryQueueLine = {
      id: l.id,
      item_id: l.item_id,
      item_name: item?.name ?? null,
      item_class_id: item?.item_class_id ?? null,
      requested_qty: Number(l.requested_qty ?? 0),
      issued_qty: Number(l.issued_qty ?? 0),
      stock_qty: stock.get(`${storeOf.get(l.material_requisition_id)}:${l.item_id}`) ?? 0,
    };
    const arr = byDoc.get(l.material_requisition_id) ?? [];
    arr.push(row);
    byDoc.set(l.material_requisition_id, arr);
  }

  return withCreators(
    docs.map((r) => {
      const ls = byDoc.get(r.id as string) ?? [];
      const approved = r.status === "approved";
      return {
        ...(r as unknown as MaterialRequisition),
        store_code: joined(r, "stores", "code"),
        store_name: joined(r, "stores", "name"),
        lines: ls,
        item_class_ids: [...new Set(ls.map((l) => l.item_class_id).filter((x): x is string => !!x))],
        short_lines: approved ? ls.filter((l) => l.requested_qty > l.stock_qty + 0.0001) : [],
      };
    }),
  );
}

// ============================================================================
// Vendor Returns
// ============================================================================
export interface VendorReturnWithRefs extends VendorReturn {
  store_code: string | null;
  vendor_name: string | null;
}
export async function listVendorReturns(): Promise<VendorReturnWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("vendor_returns")
    // The master vendor too (0780): a Rejection DC raised by a GRN names only that one.
    .select("*, stores(code), vendors(name), master_vendors(name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as VendorReturn),
    store_code: joined(r, "stores", "code"),
    vendor_name: joined(r, "master_vendors", "name") ?? joined(r, "vendors", "name"),
  })));
}
export async function getVendorReturn(id: string): Promise<VendorReturn | null> {
  const s = await createClient();
  const { data } = await s.from("vendor_returns").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as VendorReturn | null;
}
export async function getVendorReturnLines(docId: string): Promise<VendorReturnLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("vendor_return_lines")
    .select("*")
    .eq("vendor_return_id", docId)
    .order("sort_order");
  return (data ?? []) as VendorReturnLine[];
}

// ============================================================================
// CSP Receipts
// ============================================================================
export interface CspReceiptWithRefs extends CspReceipt {
  store_code: string | null;
  buyer_name: string | null;
}
export async function listCspReceipts(): Promise<CspReceiptWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("csp_receipts")
    .select("*, stores(code), buyers(name)")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return withCreators(((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CspReceipt),
    store_code: joined(r, "stores", "code"),
    buyer_name: joined(r, "buyers", "name"),
  })));
}
export async function getCspReceipt(id: string): Promise<CspReceipt | null> {
  const s = await createClient();
  const { data } = await s.from("csp_receipts").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as CspReceipt | null;
}
export async function getCspReceiptLines(docId: string): Promise<CspReceiptLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("csp_receipt_lines")
    .select("*")
    .eq("csp_receipt_id", docId)
    .order("sort_order");
  return (data ?? []) as CspReceiptLine[];
}
