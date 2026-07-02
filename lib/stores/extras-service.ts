import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  OpeningStock,
  OpeningStockLine,
  MaterialRequisition,
  MaterialRequisitionLine,
  VendorReturn,
  VendorReturnLine,
  CspReceipt,
  CspReceiptLine,
} from "./extras-types";

export type StoreOption = { id: string; code: string; name: string };
export type ItemOption = { id: string; code: string | null; name: string };
export type VendorOption = { id: string; code: string | null; name: string };
export type BuyerOption = { id: string; name: string };

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
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as StoreOption[];
}
export async function getItems(): Promise<ItemOption[]> {
  const s = await createClient();
  const { data } = await s.from("items").select("id, code, name").order("name");
  return (data ?? []) as ItemOption[];
}
export async function getVendors(): Promise<VendorOption[]> {
  const s = await createClient();
  const { data } = await s.from("vendors").select("id, code, name").order("name");
  return (data ?? []) as VendorOption[];
}
export async function getBuyers(): Promise<BuyerOption[]> {
  const s = await createClient();
  const { data } = await s.from("buyers").select("id, name").order("name");
  return (data ?? []) as BuyerOption[];
}

// ============================================================================
// Opening Stock
// ============================================================================
export interface OpeningStockWithRefs extends OpeningStock {
  store_code: string | null;
}
export async function listOpeningStocks(): Promise<OpeningStockWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("opening_stocks")
    .select("*, stores(code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OpeningStock),
    store_code: joined(r, "stores", "code"),
  }));
}
export async function getOpeningStock(id: string): Promise<OpeningStock | null> {
  const s = await createClient();
  const { data } = await s.from("opening_stocks").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as OpeningStock | null;
}
export async function getOpeningStockLines(docId: string): Promise<OpeningStockLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("opening_stock_lines")
    .select("*")
    .eq("opening_stock_id", docId)
    .order("sort_order");
  return (data ?? []) as OpeningStockLine[];
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
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as MaterialRequisition),
    store_code: joined(r, "stores", "code"),
  }));
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
    .select("*, stores(code), vendors(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as VendorReturn),
    store_code: joined(r, "stores", "code"),
    vendor_name: joined(r, "vendors", "name"),
  }));
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
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CspReceipt),
    store_code: joined(r, "stores", "code"),
    buyer_name: joined(r, "buyers", "name"),
  }));
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
