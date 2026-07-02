import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  SqNote,
  SqAllocation,
  IwoBom,
  IwoBomItem,
  ProcessAllocation,
  MaterialExcess,
  PpmIssue,
  PpmIssueLine,
  StockCompletion,
  PdRequest,
  PdProduct,
} from "./types";

// shared order picker (reuse budget-service)
export type { OrderForPicker } from "./budget-service";
export { getOrdersForPicker } from "./budget-service";

// ---------- shared picker option types + fetchers ----------
export type ItemOption = { id: string; code: string | null; name: string };
export type UomOption = { id: string; code: string; name: string };
export type BuyerOption = { id: string; name: string };
export type VendorOption = { id: string; code: string | null; name: string };
export type OpportunityOption = { id: string; code: string | null; title: string | null };
export type StyleOption = { id: string; style_code: string | null };
export type IwoOption = { id: string; code: string | null; title: string };

export async function getItems(): Promise<ItemOption[]> {
  const s = await createClient();
  const { data } = await s.from("items").select("id, code, name").order("name");
  return (data ?? []) as ItemOption[];
}
export async function getUoms(): Promise<UomOption[]> {
  const s = await createClient();
  const { data } = await s.from("uoms").select("id, code, name").order("code");
  return (data ?? []) as UomOption[];
}
export async function getBuyers(): Promise<BuyerOption[]> {
  const s = await createClient();
  const { data } = await s.from("buyers").select("id, name").order("name");
  return (data ?? []) as BuyerOption[];
}
export async function getVendors(): Promise<VendorOption[]> {
  const s = await createClient();
  const { data } = await s.from("vendors").select("id, code, name").order("name");
  return (data ?? []) as VendorOption[];
}
export async function getOpportunities(): Promise<OpportunityOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("opportunities")
    .select("id, code, title")
    .order("created_at", { ascending: false });
  return (data ?? []) as OpportunityOption[];
}
export async function getStyles(): Promise<StyleOption[]> {
  const s = await createClient();
  const { data } = await s.from("styles").select("id, style_code").order("style_code");
  return (data ?? []) as StyleOption[];
}
export async function getInternalWorkOrders(): Promise<IwoOption[]> {
  const s = await createClient();
  const { data } = await s
    .from("internal_work_orders")
    .select("id, code, title")
    .order("created_at", { ascending: false });
  return (data ?? []) as IwoOption[];
}

// helper: pull a nested joined scalar
function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

// ============================================================================
// SQ Notes & Allocation
// ============================================================================
export interface SqNoteWithRefs extends SqNote {
  order_number: string | null;
  buyer_name: string | null;
}
export async function listSqNotes(): Promise<SqNoteWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("sq_notes")
    .select("*, sales_orders(order_number), buyers(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as SqNote),
    order_number: joined(row, "sales_orders", "order_number"),
    buyer_name: joined(row, "buyers", "name"),
  }));
}
export async function getSqNote(id: string): Promise<SqNote | null> {
  const s = await createClient();
  const { data } = await s.from("sq_notes").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as SqNote | null;
}
export async function getSqAllocations(sqNoteId: string): Promise<SqAllocation[]> {
  const s = await createClient();
  const { data } = await s
    .from("sq_allocations")
    .select("*")
    .eq("sq_note_id", sqNoteId)
    .order("sort_order");
  return (data ?? []) as SqAllocation[];
}

// ============================================================================
// BOM for Internal Work Orders
// ============================================================================
export interface IwoRow {
  id: string;
  code: string | null;
  title: string;
  has_bom: boolean;
}
export async function listIwosWithBomFlag(): Promise<IwoRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("internal_work_orders")
    .select("id, code, title, iwo_boms(id)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    code: (row.code as string | null) ?? null,
    title: row.title as string,
    has_bom: ((row.iwo_boms ?? []) as unknown[]).length > 0,
  }));
}
export async function getIwo(iwoId: string): Promise<IwoOption | null> {
  const s = await createClient();
  const { data } = await s
    .from("internal_work_orders")
    .select("id, code, title")
    .eq("id", iwoId)
    .maybeSingle();
  return (data ?? null) as IwoOption | null;
}
export async function getIwoBom(iwoId: string): Promise<IwoBom | null> {
  const s = await createClient();
  const { data } = await s.from("iwo_boms").select("*").eq("iwo_id", iwoId).maybeSingle();
  return (data ?? null) as IwoBom | null;
}
export async function getIwoBomItems(bomId: string): Promise<IwoBomItem[]> {
  const s = await createClient();
  const { data } = await s
    .from("iwo_bom_items")
    .select("*")
    .eq("iwo_bom_id", bomId)
    .order("sort_order");
  return (data ?? []) as IwoBomItem[];
}

// ============================================================================
// Purchase Process Allocation
// ============================================================================
export interface ProcessAllocationWithRefs extends ProcessAllocation {
  order_number: string | null;
  vendor_name: string | null;
}
export async function listProcessAllocations(): Promise<ProcessAllocationWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("process_allocations")
    .select("*, sales_orders(order_number), vendors(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as ProcessAllocation),
    order_number: joined(row, "sales_orders", "order_number"),
    vendor_name: joined(row, "vendors", "name"),
  }));
}

// ============================================================================
// Material Excess Order & Receipt
// ============================================================================
export interface MaterialExcessWithRefs extends MaterialExcess {
  order_number: string | null;
  item_name: string | null;
}
export async function listMaterialExcess(): Promise<MaterialExcessWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_excess")
    .select("*, sales_orders(order_number), items(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as MaterialExcess),
    order_number: joined(row, "sales_orders", "order_number"),
    item_name: joined(row, "items", "name"),
  }));
}

// ============================================================================
// Issue PPM
// ============================================================================
export interface PpmIssueWithRefs extends PpmIssue {
  order_number: string | null;
}
export async function listPpmIssues(): Promise<PpmIssueWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("ppm_issues")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as PpmIssue),
    order_number: joined(row, "sales_orders", "order_number"),
  }));
}
export async function getPpmIssue(id: string): Promise<PpmIssue | null> {
  const s = await createClient();
  const { data } = await s.from("ppm_issues").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as PpmIssue | null;
}
export async function getPpmLines(issueId: string): Promise<PpmIssueLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("ppm_issue_lines")
    .select("*")
    .eq("ppm_issue_id", issueId)
    .order("sort_order");
  return (data ?? []) as PpmIssueLine[];
}

// ============================================================================
// Stock Completion
// ============================================================================
export interface StockCompletionWithRefs extends StockCompletion {
  order_number: string | null;
}
export async function listStockCompletions(): Promise<StockCompletionWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("stock_completions")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as StockCompletion),
    order_number: joined(row, "sales_orders", "order_number"),
  }));
}

// ============================================================================
// Product Development Pipeline
// ============================================================================
export interface PdRequestWithRefs extends PdRequest {
  buyer_name: string | null;
}
export async function listPdRequests(): Promise<PdRequestWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("pd_requests")
    .select("*, buyers(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as PdRequest),
    buyer_name: joined(row, "buyers", "name"),
  }));
}
export async function getPdRequest(id: string): Promise<PdRequest | null> {
  const s = await createClient();
  const { data } = await s.from("pd_requests").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as PdRequest | null;
}
export async function getPdProducts(requestId: string): Promise<PdProduct[]> {
  const s = await createClient();
  const { data } = await s
    .from("pd_products")
    .select("*")
    .eq("pd_request_id", requestId)
    .order("sort_order");
  return (data ?? []) as PdProduct[];
}
