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

/**
 * A BLANK LOCATION IS OMITTED, NOT SENT AS NULL.
 *
 * `staff.location_id` is NOT NULL with `default current_location()` (0487) —
 * the unit a row belongs to, defaulting to the one the operator is working in.
 * A column default only fires when the key is ABSENT: send `location_id: null`
 * explicitly and Postgres takes the null and rejects it
 * (`23502 null value in column "location_id" … violates not-null constraint`),
 * which is exactly what a round-trip against the live table did before this
 * existed.
 *
 * So a blank Location means "wherever I am", which is what the column was built
 * to say — not an error to show the operator, and not a field to make mandatory
 * on a screen where the answer is almost always the current unit.
 *
 * The same treatment on UPDATE: the column cannot hold null, so a blank there
 * means "leave it as it is" rather than "clear it".
 */
function withoutBlankLocation(data: StaffInput): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (out.location_id == null) delete out.location_id;
  return out;
}

/** The four child lists, as the editor sends them. */
export type StaffChildren = {
  family: Record<string, unknown>[];
  experience: Record<string, unknown>[];
  internalRefs: Record<string, unknown>[];
  nominations: Record<string, unknown>[];
  bankAccounts: Record<string, unknown>[];
  externalRefs: Record<string, unknown>[];
  emergencyContacts: Record<string, unknown>[];
};

/**
 * REPLACE, NOT MERGE — delete every child row for this staff member and insert
 * what the editor holds.
 *
 * The alternative is diffing three lists by a database id the form does not
 * carry (rows are re-keyed on load, so `key` is React's and nothing else). A
 * replace is one round trip per table, cannot leave an orphan behind, and makes
 * "what is in the form" and "what is in the table" the same statement.
 *
 * The cost is honest and small: these lists are a handful of rows per employee,
 * and nothing else references them — a family member has no id anyone links to.
 * Do NOT copy this to a table whose rows are pointed at from elsewhere.
 *
 * `sno` is the row's ORDER, assigned here from the array index, so the list
 * comes back in the sequence the operator arranged it.
 */
async function replaceStaffChildren(
  supabase: Awaited<ReturnType<typeof createClient>>,
  staffId: string,
  children: StaffChildren,
): Promise<string | null> {
  const tables = [
    ["staff_family_members", children.family],
    ["staff_work_experience", children.experience],
    ["staff_internal_references", children.internalRefs],
    ["staff_nominations", children.nominations],
    ["staff_bank_accounts", children.bankAccounts],
    ["staff_external_references", children.externalRefs],
    ["staff_emergency_contacts", children.emergencyContacts],
  ] as const;

  for (const [table, rows] of tables) {
    const { error: delErr } = await supabase.from(table).delete().eq("staff_id", staffId);
    if (delErr) return delErr.message;
    if (!rows.length) continue;
    const payload = rows.map((r, i) => ({ ...r, staff_id: staffId, sno: i + 1 }));
    const { error: insErr } = await supabase.from(table).insert(payload);
    if (insErr) return insErr.message;
  }
  return null;
}

export async function createStaff(
  data: StaffInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("staff")
    .insert(withoutBlankLocation(parsed.data))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replaceStaffChildren(supabase, row.id, children);
    if (childErr) return { ok: false, error: childErr };
  }
  revalidatePath("/hr/staff");
  return { ok: true };
}

export async function updateStaff(
  id: string,
  data: StaffInput,
  children?: StaffChildren,
): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = staffInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff")
    .update(withoutBlankLocation(parsed.data))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (children) {
    const childErr = await replaceStaffChildren(supabase, id, children);
    if (childErr) return { ok: false, error: childErr };
  }
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
