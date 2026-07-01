import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProcessJob, ProcessJobReceipt, ProcessJobStatus } from "./types";

// ---------- enriched types ----------

export type ProcessJobWithProcessor = ProcessJob & {
  vendors: { id: string; name: string; code: string | null } | null;
};

export type ProcessorOption = { id: string; code: string | null; name: string };
export type ItemOption = { id: string; code: string | null; name: string };
export type UomOption = { id: string; code: string; name: string };
export type OrderPickerItem = { id: string; order_number: string | null };
export type FabricBomPickerItem = { id: string; sales_order_id: string | null };
export type DcPickerItem = { id: string; code: string | null };

// ---------- jobs ----------

/** List all process jobs with processor name. Most recent first. */
export async function listJobs(
  filter?: { statuses?: ProcessJobStatus[] },
): Promise<ProcessJobWithProcessor[]> {
  const supabase = await createClient();
  let query = supabase
    .from("process_jobs")
    .select("*, vendors(id, code, name)")
    .order("created_at", { ascending: false });

  if (filter?.statuses && filter.statuses.length > 0) {
    query = query.in("status", filter.statuses);
  }

  const { data } = await query;
  return (data ?? []) as unknown as ProcessJobWithProcessor[];
}

/** Fetch a single job with processor. Returns null if not found. */
export async function getJob(id: string): Promise<ProcessJobWithProcessor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_jobs")
    .select("*, vendors(id, code, name)")
    .eq("id", id)
    .single();
  return (data as unknown as ProcessJobWithProcessor) ?? null;
}

/** Fetch all receipts for a job, ordered by received_date asc. */
export async function getJobReceipts(jobId: string): Promise<ProcessJobReceipt[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_job_receipts")
    .select("*")
    .eq("process_job_id", jobId)
    .order("received_date", { ascending: true });
  return (data ?? []) as ProcessJobReceipt[];
}

// ---------- reference pickers ----------

/** Vendors act as processors. */
export async function getProcessors(): Promise<ProcessorOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as ProcessorOption[];
}

export async function getItems(): Promise<ItemOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as ItemOption[];
}

export async function getUoms(): Promise<UomOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as UomOption[];
}

export async function getOrdersForPicker(): Promise<OrderPickerItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderPickerItem[];
}

export async function getFabricBomsForPicker(): Promise<FabricBomPickerItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fabric_boms")
    .select("id, sales_order_id")
    .order("created_at", { ascending: false });
  return (data ?? []) as FabricBomPickerItem[];
}

export async function getDcsForPicker(): Promise<DcPickerItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("id, code")
    .order("created_at", { ascending: false });
  return (data ?? []) as DcPickerItem[];
}
