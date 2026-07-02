import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  PurchaseIndent,
  PurchaseIndentLine,
  OverBudgetConfirmation,
  PoRateAmendment,
  PoCancellation,
  LabTestStandard,
  LabTest,
} from "./extras-types";

// reuse existing purchase pickers
export { getVendorsForPicker, getItems, getUoms, listPurchaseOrders } from "./po-service";
export type { VendorForPicker, PoWithVendor } from "./po-service";

export type OrderOption = { id: string; order_number: string | null };
export type BuyerOption = { id: string; name: string };
export type PoOption = { id: string; code: string | null; vendor_name: string | null };
export type PoLineOption = { id: string; description: string; unit_price: number };
export type PoWithLines = PoOption & { lines: PoLineOption[] };

function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

export async function getOrders(): Promise<OrderOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number")
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderOption[];
}
export async function getBuyers(): Promise<BuyerOption[]> {
  const s = await createClient();
  const { data } = await s.from("buyers").select("id, name").order("name");
  return (data ?? []) as BuyerOption[];
}

/** Light PO picker (code + vendor). */
export async function getPoOptions(): Promise<PoOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, vendors(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    vendor_name: joined(r, "vendors", "name"),
  }));
}

/** POs with their line items, for the rate-amendment picker. */
export async function getPosWithLines(): Promise<PoWithLines[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, vendors(name), po_line_items(id, description, unit_price, sort_order)")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const lines = ((r.po_line_items ?? []) as Record<string, unknown>[])
      .map((l) => ({
        id: l.id as string,
        description: l.description as string,
        unit_price: (l.unit_price as number) ?? 0,
        sort_order: (l.sort_order as number) ?? 0,
      }))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, description, unit_price }) => ({ id, description, unit_price }));
    return {
      id: r.id as string,
      code: (r.code as string | null) ?? null,
      vendor_name: joined(r, "vendors", "name"),
      lines,
    };
  });
}

/** POs that can still be cancelled. */
export async function getCancellablePos(): Promise<PoOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_orders")
    .select("id, code, vendors(name)")
    .in("status", ["draft", "pending_approval", "approved", "partially_received"])
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    vendor_name: joined(r, "vendors", "name"),
  }));
}

// ============================================================================
// Purchase Indents
// ============================================================================
export interface PurchaseIndentWithRefs extends PurchaseIndent {
  order_number: string | null;
}
export async function listPurchaseIndents(): Promise<PurchaseIndentWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_indents")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PurchaseIndent),
    order_number: joined(r, "sales_orders", "order_number"),
  }));
}
export async function getPurchaseIndent(id: string): Promise<PurchaseIndent | null> {
  const s = await createClient();
  const { data } = await s.from("purchase_indents").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as PurchaseIndent | null;
}
export async function getIndentLines(indentId: string): Promise<PurchaseIndentLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("purchase_indent_lines")
    .select("*")
    .eq("purchase_indent_id", indentId)
    .order("sort_order");
  return (data ?? []) as PurchaseIndentLine[];
}

// ============================================================================
// Over-budget confirmations
// ============================================================================
export interface OverBudgetWithRefs extends OverBudgetConfirmation {
  po_code: string | null;
}
export async function listOverBudget(): Promise<OverBudgetWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("over_budget_confirmations")
    .select("*, purchase_orders(code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as OverBudgetConfirmation),
    po_code: joined(r, "purchase_orders", "code"),
  }));
}

// ============================================================================
// PO rate amendments
// ============================================================================
export interface RateAmendmentWithRefs extends PoRateAmendment {
  po_code: string | null;
}
export async function listRateAmendments(): Promise<RateAmendmentWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("po_rate_amendments")
    .select("*, purchase_orders(code)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PoRateAmendment),
    po_code: joined(r, "purchase_orders", "code"),
  }));
}

// ============================================================================
// PO cancellations
// ============================================================================
export interface PoCancellationWithRefs extends PoCancellation {
  po_code: string | null;
  vendor_name: string | null;
}
export async function listPoCancellations(): Promise<PoCancellationWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("po_cancellations")
    .select("*, purchase_orders(code, vendors(name))")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const po = r.purchase_orders as Record<string, unknown> | null;
    const vendor = po?.vendors as Record<string, unknown> | null;
    return {
      ...(r as unknown as PoCancellation),
      po_code: (po?.code as string | null) ?? null,
      vendor_name: (vendor?.name as string | null) ?? null,
    };
  });
}

// ============================================================================
// Lab
// ============================================================================
export async function listLabStandards(): Promise<LabTestStandard[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_test_standards")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as LabTestStandard[];
}
export interface LabTestWithRefs extends LabTest {
  standard_name: string | null;
}
export async function listLabTests(): Promise<LabTestWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_tests")
    .select("*, lab_test_standards(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as LabTest),
    standard_name: joined(r, "lab_test_standards", "name"),
  }));
}
export async function getLabStandardOptions(): Promise<{ id: string; code: string | null; name: string }[]> {
  const s = await createClient();
  const { data } = await s
    .from("lab_test_standards")
    .select("id, code, name")
    .order("name");
  return (data ?? []) as { id: string; code: string | null; name: string }[];
}
