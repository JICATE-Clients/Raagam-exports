import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Contractor, Worker, Staff, PayrollSettings } from "./types";

// ---------- shaped rows ----------

export interface WorkerRow extends Worker {
  contractor_name: string | null;
  location_name: string | null;
}

export interface ContractorRow extends Contractor {
  location_name: string | null;
}

export interface StaffRow extends Staff {
  location_name: string | null;
}

export interface LocationOption {
  id: string;
  code: string | null;
  name: string;
}

export interface OrderOption {
  id: string;
  order_number: string;
}

// ---------- workers ----------

export async function listWorkers(): Promise<WorkerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workers")
    .select(
      `id, code, name, worker_type, contractor_id, location_id, biometric_id,
       shift_wage_per_day, hourly_wage, piece_rate, esi_applicable, pf_applicable,
       joined_date, is_active, created_at, updated_at,
       contractors(name),
       locations(name)`,
    )
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const con = r.contractors as { name: string } | null;
    const loc = r.locations as { name: string } | null;
    return {
      ...(r as unknown as Worker),
      contractor_name: con?.name ?? null,
      location_name: loc?.name ?? null,
    };
  });
}

export async function getWorker(id: string): Promise<Worker | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Worker | null) ?? null;
}

// ---------- contractors ----------

export async function listContractors(): Promise<ContractorRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractors")
    .select(
      `id, code, name, contact_person, phone, location_id, is_active,
       created_at, updated_at,
       locations(name)`,
    )
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const loc = r.locations as { name: string } | null;
    return {
      ...(r as unknown as Contractor),
      location_name: loc?.name ?? null,
    };
  });
}

// ---------- staff ----------

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select(
      `id, code, name, designation, location_id, monthly_salary,
       esi_applicable, pf_applicable, joined_date, is_active,
       created_at, updated_at,
       locations(name)`,
    )
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const loc = r.locations as { name: string } | null;
    return {
      ...(r as unknown as Staff),
      location_name: loc?.name ?? null,
    };
  });
}

// ---------- settings ----------

export async function getSettings(): Promise<PayrollSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_settings")
    .select("*")
    .maybeSingle();
  return (data as PayrollSettings | null) ?? null;
}

// ---------- pickers ----------

export async function getLocations(): Promise<LocationOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationOption[];
}

export async function getOrdersForPicker(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .order("order_number", { ascending: false });
  return (data ?? []) as OrderOption[];
}
