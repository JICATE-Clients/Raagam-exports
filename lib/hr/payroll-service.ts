import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PayrollRun, PayrollLine, ContractorPayrollRow, Worker, Staff, PayrollSettings } from "./types";

// ---------- shaped rows returned to the UI ----------

export interface RunRow extends PayrollRun {
  location_name: string | null;
  total_actual_gross: number;
  total_actual_net: number;
  total_extra_wage: number;
  total_net: number;
}

export interface LineWithName extends PayrollLine {
  worker_name: string | null;
  staff_name: string | null;
}

export interface ContractorPayrollWithName extends ContractorPayrollRow {
  contractor_name: string | null;
}

export interface LocationOption {
  id: string;
  code: string | null;
  name: string;
}

// ---------- payroll runs ----------

export async function listRuns(): Promise<RunRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payroll_runs")
    .select(
      `id, code, run_kind, period_type, period_start, period_end, location_id,
       status, notes, created_by, approved_by, approved_at, created_at, updated_at,
       locations(name)`,
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const loc = r.locations as { name: string } | null;
    return {
      ...(r as unknown as PayrollRun),
      location_name: loc?.name ?? null,
      // These totals are filled after the run is calculated; we aggregate on the server
      // to avoid an extra round trip — they appear on the list page only.
      total_actual_gross: 0,
      total_actual_net: 0,
      total_extra_wage: 0,
      total_net: 0,
    };
  });
}

export async function getRun(runId: string): Promise<(PayrollRun & { location_name: string | null }) | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payroll_runs")
    .select(
      `id, code, run_kind, period_type, period_start, period_end, location_id,
       status, notes, created_by, approved_by, approved_at, created_at, updated_at,
       locations(name)`,
    )
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const d = data as Record<string, unknown>;
  const loc = d.locations as { name: string } | null;
  return { ...(d as unknown as PayrollRun), location_name: loc?.name ?? null };
}

// ---------- payroll lines ----------

export async function getRunLines(runId: string): Promise<LineWithName[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payroll_lines")
    .select(
      `id, payroll_run_id, worker_id, staff_id, worker_type,
       days_worked, ot_hours, ot_wage, actual_gross, esi, pf, actual_net,
       pieces, extra_wage, total_net, details, created_at,
       workers(name), staff(name)`,
    )
    .eq("payroll_run_id", runId)
    .order("created_at");

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const w = r.workers as { name: string } | null;
    const s = r.staff as { name: string } | null;
    return {
      ...(r as unknown as PayrollLine),
      worker_name: w?.name ?? null,
      staff_name: s?.name ?? null,
    };
  });
}

// ---------- contractor payroll ----------

export async function getContractorPayroll(runId: string): Promise<ContractorPayrollWithName[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contractor_payroll")
    .select(
      `id, payroll_run_id, contractor_id, total_pieces, piece_amount,
       sum_actual_wages, extra_wage, created_at,
       contractors(name)`,
    )
    .eq("payroll_run_id", runId)
    .order("created_at");

  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const c = r.contractors as { name: string } | null;
    return {
      ...(r as unknown as ContractorPayrollRow),
      contractor_name: c?.name ?? null,
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

// ---------- locations ----------

export async function getLocations(): Promise<LocationOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationOption[];
}

// ---------- calculation helpers ----------

/** Active workers, optionally filtered by location. */
export async function getActiveWorkers(locationId?: string | null): Promise<Worker[]> {
  const supabase = await createClient();
  let q = supabase.from("workers").select("*").eq("is_active", true);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Worker[];
}

/** Attendance aggregate per worker in [start, end]. */
export interface AttendanceAggregate {
  worker_id: string;
  days_present: number;
  ot_hours: number;
  extra_hours: number;
}

export async function getAttendanceAggregates(
  start: string,
  end: string,
  workerIds: string[],
): Promise<AttendanceAggregate[]> {
  if (workerIds.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("worker_attendance")
    .select("worker_id, present, ot_hours, extra_hours")
    .in("worker_id", workerIds)
    .gte("work_date", start)
    .lte("work_date", end);

  if (error) throw new Error(error.message);

  const map = new Map<string, AttendanceAggregate>();
  for (const r of (data ?? []) as {
    worker_id: string;
    present: boolean;
    ot_hours: number;
    extra_hours: number;
  }[]) {
    const existing = map.get(r.worker_id) ?? {
      worker_id: r.worker_id,
      days_present: 0,
      ot_hours: 0,
      extra_hours: 0,
    };
    if (r.present) existing.days_present += 1;
    existing.ot_hours += r.ot_hours ?? 0;
    existing.extra_hours += r.extra_hours ?? 0;
    map.set(r.worker_id, existing);
  }

  return Array.from(map.values());
}

/** Piece aggregate per worker in [start, end] (unlocked only). */
export interface PieceAggregate {
  worker_id: string;
  total_pieces: number;
}

export async function getPieceAggregates(
  start: string,
  end: string,
  workerIds: string[],
): Promise<PieceAggregate[]> {
  if (workerIds.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("worker_piece_records")
    .select("worker_id, pieces")
    .in("worker_id", workerIds)
    .gte("work_date", start)
    .lte("work_date", end)
    .eq("is_locked", false);

  if (error) throw new Error(error.message);

  const map = new Map<string, PieceAggregate>();
  for (const r of (data ?? []) as { worker_id: string; pieces: number }[]) {
    const existing = map.get(r.worker_id) ?? {
      worker_id: r.worker_id,
      total_pieces: 0,
    };
    existing.total_pieces += r.pieces ?? 0;
    map.set(r.worker_id, existing);
  }

  return Array.from(map.values());
}

/** Active staff, optionally filtered by location. */
export async function getActiveStaff(locationId?: string | null): Promise<Staff[]> {
  const supabase = await createClient();
  let q = supabase.from("staff").select("*").eq("is_active", true);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Staff[];
}

// ---------- payslip helpers ----------

export interface WorkerOption {
  id: string;
  name: string;
  code: string | null;
}

export async function getWorkersForPayslip(): Promise<WorkerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workers")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as WorkerOption[];
}

export interface RunOption {
  id: string;
  code: string | null;
  period_start: string;
  period_end: string;
  status: string;
}

export async function getRunsForPayslip(): Promise<RunOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_runs")
    .select("id, code, period_start, period_end, status")
    .eq("run_kind", "worker")
    .in("status", ["approved", "locked", "paid"])
    .order("period_start", { ascending: false });
  return (data ?? []) as RunOption[];
}

export async function getLineForPayslip(
  runId: string,
  workerId: string,
): Promise<LineWithName | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_lines")
    .select(
      `id, payroll_run_id, worker_id, staff_id, worker_type,
       days_worked, ot_hours, ot_wage, actual_gross, esi, pf, actual_net,
       pieces, extra_wage, total_net, details, created_at,
       workers(name), staff(name)`,
    )
    .eq("payroll_run_id", runId)
    .eq("worker_id", workerId)
    .maybeSingle();

  if (!data) return null;
  const d = data as Record<string, unknown>;
  const w = d.workers as { name: string } | null;
  const s = d.staff as { name: string } | null;
  return {
    ...(d as unknown as PayrollLine),
    worker_name: w?.name ?? null,
    staff_name: s?.name ?? null,
  };
}
