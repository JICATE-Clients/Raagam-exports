"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { capDailyOt } from "@/lib/hr/calc";
import {
  attendanceInput,
  pieceRecordInput,
  type AttendanceInput,
  type PieceRecordInput,
} from "@/lib/hr/types";
import { getSettings } from "@/lib/hr/masters-service";

type Result = { ok: true } | { ok: false; error: string };

/* ---- Attendance ---- */

/**
 * Upsert a single attendance entry (unique on worker_id + work_date).
 * OT hours are capped at max_ot_hours_per_day before saving.
 */
export async function saveAttendance(data: AttendanceInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };

  const parsed = attendanceInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }

  // Cap OT against settings
  const settings = await getSettings();
  const cappedOt = settings
    ? capDailyOt(parsed.data.ot_hours, settings)
    : parsed.data.ot_hours;

  const row = { ...parsed.data, ot_hours: cappedOt };

  const supabase = await createClient();
  const { error } = await supabase
    .from("worker_attendance")
    .upsert(row, { onConflict: "worker_id,work_date" });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/attendance");
  return { ok: true };
}

/**
 * Batch upsert: accept an array of attendance rows (all for the same date).
 * OT cap is applied to each row individually.
 */
export async function saveAttendanceBatch(rows: AttendanceInput[]): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };

  if (rows.length === 0) return { ok: true };

  const settings = await getSettings();

  const parsed: typeof rows = [];
  for (const row of rows) {
    const p = attendanceInput.safeParse(row);
    if (!p.success) {
      return { ok: false, error: p.error.issues[0]?.message ?? "Validation failed" };
    }
    const cappedOt = settings ? capDailyOt(p.data.ot_hours, settings) : p.data.ot_hours;
    parsed.push({ ...p.data, ot_hours: cappedOt });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("worker_attendance")
    .upsert(parsed, { onConflict: "worker_id,work_date" });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/attendance");
  return { ok: true };
}

/* ---- Piece records ---- */

export async function recordPieces(data: PieceRecordInput): Promise<Result> {
  if (!(await can("hr_payroll", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = pieceRecordInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("worker_piece_records").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/piece-records");
  return { ok: true };
}

export async function updatePieces(id: string, data: PieceRecordInput): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };

  // Block edit on locked records
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("worker_piece_records")
    .select("is_locked")
    .eq("id", id)
    .maybeSingle();

  if (existing?.is_locked) {
    return { ok: false, error: "This record is locked and cannot be edited." };
  }

  const parsed = pieceRecordInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }

  const { error } = await supabase
    .from("worker_piece_records")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/piece-records");
  return { ok: true };
}

export async function deletePieceRecord(id: string): Promise<Result> {
  if (!(await can("hr_payroll", "delete"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("worker_piece_records")
    .select("is_locked")
    .eq("id", id)
    .maybeSingle();

  if (existing?.is_locked) {
    return { ok: false, error: "This record is locked and cannot be deleted." };
  }

  const { error } = await supabase.from("worker_piece_records").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/piece-records");
  return { ok: true };
}
