import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { FineEvent, HrFine, StaffOption } from "./fines-types";

/**
 * Reads for Pay ▸ Fines & Deductions (0629).
 *
 * NAMES COME FROM `creator_names()`, never an embed of `profiles`:
 * `profiles_read_own` lets a user read only their OWN profile row, so an embed
 * resolves every other approver to null (the rule under "Created Date /
 * Created User" in AGENTS.md).
 */

const FINE_SELECT =
  "id, code, staff_id, incident_ref, incident_date, deduction_month, deduction_mode, " +
  "days_of_pay, pct_of_gross, basis_salary, fine_amount, status, is_submitted, remarks, " +
  "decision_remark, submitted_at, approved_by, approved_at, decided_at, created_by, " +
  "created_at, updated_at, staff:staff!staff_id(name, code)";

async function profileNames(ids: (string | null)[]): Promise<Record<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (list.length === 0) return {};
  const s = await createClient();
  const { data } = await s.rpc("creator_names", { ids: list });
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) out[p.id] = p.full_name;
  }
  return out;
}

type FineRow = Omit<HrFine, "staff_name" | "staff_code" | "approver_name"> & {
  staff: { name: string | null; code: string | null } | null;
};

async function shape(rows: FineRow[]): Promise<HrFine[]> {
  const names = await profileNames(rows.map((r) => r.approved_by));
  return rows.map(({ staff, ...r }) => ({
    ...r,
    fine_amount: Number(r.fine_amount),
    days_of_pay: r.days_of_pay == null ? null : Number(r.days_of_pay),
    pct_of_gross: r.pct_of_gross == null ? null : Number(r.pct_of_gross),
    basis_salary: r.basis_salary == null ? null : Number(r.basis_salary),
    staff_name: staff?.name ?? null,
    staff_code: staff?.code ?? null,
    approver_name: r.approved_by ? (names[r.approved_by] ?? null) : null,
  }));
}

/** Every fine, in entry order (the app-wide listing rule). */
export async function listFines(): Promise<HrFine[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_staff_fine_deductions")
    .select(FINE_SELECT)
    .order("created_at", { ascending: true });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (error) throw new Error(error.message);
  return withCreators(await shape((data ?? []) as unknown as FineRow[]));
}

/**
 * The Fine Summary Report (spec §7) — APPROVED fines only, for one deduction
 * month (`YYYY-MM`) or all months. Rejected and abandoned rows are audit
 * records, not deductions, so they have no place on a register of deductions.
 */
export async function listApprovedFines(month: string | null): Promise<HrFine[]> {
  const s = await createClient();
  let q = s.from("hr_staff_fine_deductions").select(FINE_SELECT).eq("status", "approved");
  if (month) q = q.eq("deduction_month", `${month}-01`);
  const { data, error } = await q.order("deduction_month").order("created_at");
  if (error) throw new Error(error.message);
  return shape((data ?? []) as unknown as FineRow[]);
}

/** The immutable audit trail of one fine, oldest first. */
export async function getFineEvents(fineId: string): Promise<FineEvent[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_staff_fine_events")
    .select("id, change_type, from_status, to_status, fine_amount, actor_id, remark, created_at")
    .eq("fine_id", fineId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Omit<FineEvent, "actor_name">[];
  const names = await profileNames(rows.map((r) => r.actor_id));
  return rows.map((r) => ({
    ...r,
    fine_amount: r.fine_amount == null ? null : Number(r.fine_amount),
    actor_name: r.actor_id ? (names[r.actor_id] ?? null) : null,
  }));
}

/**
 * The staff a fine may be raised against. Inactive and blocked staff are not
 * offered (the "Disabled rows" rule) — and the database refuses them anyway.
 * The salary rides along so the calculated modes can preview their figure.
 */
export async function getFineStaffOptions(): Promise<StaffOption[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("staff")
    .select("id, code, name, monthly_salary, blocked")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; code: string | null; name: string; monthly_salary: number | null; blocked: boolean | null }[])
    .filter((r) => !r.blocked)
    .map((r) => ({ id: r.id, code: r.code, name: r.name, monthly_salary: Number(r.monthly_salary ?? 0) }));
}

/**
 * Fines still awaiting a decision whose deduction month falls in a payroll
 * period. The run page names them: approving the run first would leave them to
 * land on a closed month, where `hr_fine_apply_decision` then refuses them.
 */
export async function countPendingFinesInPeriod(periodStart: string, periodEnd: string): Promise<number> {
  const s = await createClient();
  const { count, error } = await s
    .from("hr_staff_fine_deductions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .gte("deduction_month", `${periodStart.slice(0, 7)}-01`)
    .lte("deduction_month", periodEnd);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
