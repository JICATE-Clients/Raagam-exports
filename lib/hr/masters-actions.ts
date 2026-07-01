"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  contractorInput,
  workerInput,
  staffInput,
  payrollSettingsInput,
  type ContractorInput,
  type WorkerInput,
  type StaffInput,
  type PayrollSettingsInput,
} from "@/lib/hr/types";

type Result = { ok: true } | { ok: false; error: string };

/* ---- Contractors ---- */

export async function createContractor(data: ContractorInput): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = contractorInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("contractors").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/contractors");
  return { ok: true };
}

export async function updateContractor(id: string, data: ContractorInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = contractorInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("contractors").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/contractors");
  return { ok: true };
}

/* ---- Workers ---- */

export async function createWorker(data: WorkerInput): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = workerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("workers").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/workers");
  return { ok: true };
}

export async function updateWorker(id: string, data: WorkerInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = workerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("workers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/workers");
  return { ok: true };
}

/* ---- Staff ---- */

export async function createStaff(data: StaffInput): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("staff").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/staff");
  return { ok: true };
}

export async function updateStaff(id: string, data: StaffInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/staff");
  return { ok: true };
}

/* ---- Settings ---- */

export async function updateSettings(id: string, data: PayrollSettingsInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = payrollSettingsInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("payroll_settings")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/settings");
  return { ok: true };
}
