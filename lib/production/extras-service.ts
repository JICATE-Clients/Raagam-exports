import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  WorkType,
  SewingOperation,
  ProductionJobOrder,
  JobOrderComponent,
  ContractorPieceRate,
  PackingList,
  PackingListLine,
  Inspection,
  Despatch,
} from "./extras-types";

export type OrderOption = { id: string; order_number: string | null };
export type ContractorOption = { id: string; code: string | null; name: string };
export type WorkTypeOption = { id: string; code: string | null; name: string };

function joined(row: Record<string, unknown>, rel: string, field: string): string | null {
  const r = row[rel] as Record<string, unknown> | null;
  return (r?.[field] as string | null) ?? null;
}

// ---------- pickers ----------
export async function getOrders(): Promise<OrderOption[]> {
  const s = await createClient();
  const { data } = await s.from("sales_orders").select("id, order_number").order("created_at", { ascending: false });
  return (data ?? []) as OrderOption[];
}
export async function getContractors(): Promise<ContractorOption[]> {
  const s = await createClient();
  const { data } = await s.from("contractors").select("id, code, name").order("name");
  return (data ?? []) as ContractorOption[];
}
export async function getWorkTypeOptions(): Promise<WorkTypeOption[]> {
  const s = await createClient();
  const { data } = await s.from("work_types").select("id, code, name").order("name");
  return (data ?? []) as WorkTypeOption[];
}

// ---------- masters ----------
export async function listWorkTypes(): Promise<WorkType[]> {
  const s = await createClient();
  const { data } = await s.from("work_types").select("*").order("created_at", { ascending: false });
  return (data ?? []) as WorkType[];
}
export async function listSewingOperations(): Promise<SewingOperation[]> {
  const s = await createClient();
  const { data } = await s.from("sewing_operations").select("*").order("created_at", { ascending: false });
  return (data ?? []) as SewingOperation[];
}

// ---------- job orders ----------
export interface JobOrderWithRefs extends ProductionJobOrder {
  order_number: string | null;
}
export async function listJobOrders(): Promise<JobOrderWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("production_job_orders")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ProductionJobOrder),
    order_number: joined(r, "sales_orders", "order_number"),
  }));
}
export async function getJobOrder(id: string): Promise<ProductionJobOrder | null> {
  const s = await createClient();
  const { data } = await s.from("production_job_orders").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as ProductionJobOrder | null;
}
export async function getJobOrderComponents(jobId: string): Promise<JobOrderComponent[]> {
  const s = await createClient();
  const { data } = await s
    .from("job_order_components")
    .select("*")
    .eq("job_order_id", jobId)
    .order("sort_order");
  return (data ?? []) as JobOrderComponent[];
}

// ---------- piece rates ----------
export interface PieceRateWithRefs extends ContractorPieceRate {
  contractor_name: string | null;
  work_type_name: string | null;
}
export async function listPieceRates(): Promise<PieceRateWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("contractor_piece_rates")
    .select("*, contractors(name), work_types(name)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ContractorPieceRate),
    contractor_name: joined(r, "contractors", "name"),
    work_type_name: joined(r, "work_types", "name"),
  }));
}

// ---------- packing lists ----------
export interface PackingListWithRefs extends PackingList {
  order_number: string | null;
}
export async function listPackingLists(): Promise<PackingListWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_lists")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PackingList),
    order_number: joined(r, "sales_orders", "order_number"),
  }));
}
export async function getPackingList(id: string): Promise<PackingList | null> {
  const s = await createClient();
  const { data } = await s.from("packing_lists").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as PackingList | null;
}
export async function getPackingLines(docId: string): Promise<PackingListLine[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_list_lines")
    .select("*")
    .eq("packing_list_id", docId)
    .order("sort_order");
  return (data ?? []) as PackingListLine[];
}

// ---------- inspections ----------
export interface InspectionWithRefs extends Inspection {
  order_number: string | null;
}
export async function listInspections(): Promise<InspectionWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("inspections")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as Inspection),
    order_number: joined(r, "sales_orders", "order_number"),
  }));
}

// ---------- despatches ----------
export interface DespatchWithRefs extends Despatch {
  order_number: string | null;
}
export async function listDespatches(): Promise<DespatchWithRefs[]> {
  const s = await createClient();
  const { data } = await s
    .from("despatches")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as Despatch),
    order_number: joined(r, "sales_orders", "order_number"),
  }));
}
