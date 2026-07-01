import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Worker, WorkerAttendance, WorkerPieceRecord } from "./types";

// ---------- shaped rows ----------

export interface AttendanceRow extends WorkerAttendance {
  worker_name: string;
  worker_type: string;
}

export interface PieceRecordRow extends WorkerPieceRecord {
  worker_name: string;
  order_number: string | null;
}

// ---------- attendance ----------

/** Active workers, optionally filtered by location, ordered by name. */
export async function listActiveWorkers(locationId?: string | null): Promise<Worker[]> {
  const supabase = await createClient();
  let q = supabase.from("workers").select("*").eq("is_active", true);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Worker[];
}

/**
 * Attendance entries for a specific date, optionally filtered by location.
 * Returns one row per (worker_id, work_date) that exists.
 */
export async function getAttendanceForDate(
  date: string,
  locationId?: string | null,
): Promise<AttendanceRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from("worker_attendance")
    .select(
      `id, worker_id, work_date, present, normal_hours, ot_hours, extra_hours,
       source, note, created_by, created_at, updated_at,
       workers!inner(name, worker_type, location_id)`,
    )
    .eq("work_date", date);

  if (locationId) {
    q = q.eq("workers.location_id", locationId);
  }

  const { data, error } = await q.order("workers(name)");
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const w = r.workers as { name: string; worker_type: string } | null;
    return {
      ...(r as unknown as WorkerAttendance),
      worker_name: w?.name ?? "",
      worker_type: w?.worker_type ?? "",
    };
  });
}

// ---------- piece records ----------

export interface PieceRecordFilters {
  date?: string;
  workerId?: string;
  locationId?: string | null;
}

export async function getPieceRecords(
  filters: PieceRecordFilters = {},
): Promise<PieceRecordRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from("worker_piece_records")
    .select(
      `id, worker_id, work_date, pieces, sales_order_id, is_locked,
       created_by, created_at, updated_at,
       workers!inner(name, location_id),
       sales_orders(order_number)`,
    );

  if (filters.date) q = q.eq("work_date", filters.date);
  if (filters.workerId) q = q.eq("worker_id", filters.workerId);
  if (filters.locationId) q = q.eq("workers.location_id", filters.locationId);

  const { data, error } = await q
    .order("work_date", { ascending: false })
    .order("workers(name)");
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const w = r.workers as { name: string } | null;
    const so = r.sales_orders as { order_number: string } | null;
    return {
      ...(r as unknown as WorkerPieceRecord),
      worker_name: w?.name ?? "",
      order_number: so?.order_number ?? null,
    };
  });
}
