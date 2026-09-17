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

/** Active workers, optionally filtered by location, ordered by name.
 *
 *  created-by: exempt -- an OPTIONS list, not a record listing. These rows are
 *  the left-hand column of the attendance entry grid and the worker picker on
 *  Piece Records; neither renders the Created pair, so resolving the creator of
 *  each worker row would be a round trip nothing displays. The Worker MASTER
 *  listing is a different screen with a different service. */
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

// ---------- the muster roll (a MONTH, one row per worker) ----------
//
// THE DAY SHEET AND THE MONTH GRID READ THE SAME TABLE, and neither is a copy
// of the other: `getAttendanceForDate` above hands back whole rows because that
// screen EDITS them, while these three hand back the smallest thing a read-only
// grid can draw a cell from. A month of 200 workers is ~6,000 rows; shaping
// them on the server is what keeps the payload to one small object per worker.
//
// EVERY DATE HERE IS A STRING AND STAYS ONE. `work_date` is a Postgres `date`,
// so it arrives as "YYYY-MM-DD" with no time and no zone, and the day of the
// month is characters 9-10 of it. Parsing it into a `Date` to ask for
// `getDate()` is what puts a shift-worker's 1st of the month on the 31st of the
// last one for anybody east of UTC — and ISO dates compare correctly as plain
// strings, so the range tests below need no Date either.

export interface MusterCell {
  present: boolean;
  /** Normal + extra. OT is kept apart because it is paid at its own rate. */
  hours: number;
  ot: number;
}

/** worker_id -> day of month (1-31) -> what was recorded that day. */
export type MusterAttendance = Record<string, Record<number, MusterCell>>;

/** Day of month -> the day's meaning, for the whole grid rather than one worker. */
export interface MusterHoliday {
  name: string;
  /** A paid holiday counts towards pay; LOP does not. */
  paid: boolean;
}

function dayOf(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
}

/**
 * Attendance for every day between `from` and `to`, keyed for direct lookup.
 *
 * created-by: exempt -- a GRID of cells, not a record listing. No row here is
 * shown on its own, so there is no Created pair to resolve; the day sheet is
 * where an attendance row is opened and edited.
 */
export async function getAttendanceForMonth(
  from: string,
  to: string,
  locationId?: string | null,
): Promise<MusterAttendance> {
  const supabase = await createClient();

  let q = supabase
    .from("worker_attendance")
    .select(
      "worker_id, work_date, present, normal_hours, ot_hours, extra_hours, workers!inner(location_id)",
    )
    .gte("work_date", from)
    .lte("work_date", to);

  if (locationId) q = q.eq("workers.location_id", locationId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const out: MusterAttendance = {};
  for (const r of (data ?? []) as unknown as {
    worker_id: string;
    work_date: string;
    present: boolean;
    normal_hours: number | null;
    ot_hours: number | null;
    extra_hours: number | null;
  }[]) {
    (out[r.worker_id] ??= {})[dayOf(r.work_date)] = {
      present: r.present,
      hours: (r.normal_hours ?? 0) + (r.extra_hours ?? 0),
      ot: r.ot_hours ?? 0,
    };
  }
  return out;
}

/**
 * The declared holidays falling inside the month, by day.
 *
 * READ WHOLE AND FILTERED HERE, deliberately. A holiday row can be a RANGE
 * (`is_date_range` with an `end_date`), so "does it touch this month?" is
 * `coalesce(end_date, holiday_date) >= from` — a comparison PostgREST cannot
 * express against a nullable column without a view. The table holds a handful
 * of rows a year, so reading it and answering in TypeScript costs nothing and
 * keeps the rule where it can be read.
 *
 * created-by: exempt -- calendar data shared by every row of the grid.
 */
export async function getHolidaysForMonth(
  from: string,
  to: string,
): Promise<Record<number, MusterHoliday>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("name, pay_type, holiday_date, end_date")
    .lte("holiday_date", to);
  if (error) throw new Error(error.message);

  const out: Record<number, MusterHoliday> = {};
  for (const h of (data ?? []) as {
    name: string;
    pay_type: string | null;
    holiday_date: string;
    end_date: string | null;
  }[]) {
    const last = h.end_date ?? h.holiday_date;
    if (last < from) continue;
    const start = h.holiday_date < from ? from : h.holiday_date;
    const end = last > to ? to : last;
    for (let d = dayOf(start); d <= dayOf(end); d++) {
      out[d] = { name: h.name, paid: h.pay_type !== "LOP" };
    }
  }
  return out;
}

/**
 * APPROVED leave for workers, by worker and day.
 *
 * Approved only: a pending application is a request, and showing it on the
 * muster roll as leave would mean the register says a day is settled while
 * somebody still has to decide it.
 *
 * created-by: exempt -- cells on a grid; Leave & Encashment lists the records.
 */
export async function getLeaveForMonth(
  from: string,
  to: string,
): Promise<Record<string, Record<number, string>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hr_leaves")
    .select("employee_id, leave_type, from_date, to_date")
    .eq("employee_type", "worker")
    .eq("status", "approved")
    .lte("from_date", to)
    .gte("to_date", from);
  if (error) throw new Error(error.message);

  const out: Record<string, Record<number, string>> = {};
  for (const l of (data ?? []) as {
    employee_id: string;
    leave_type: string;
    from_date: string | null;
    to_date: string | null;
  }[]) {
    // An application with no dates has no days to mark — it is an encashment
    // row, which belongs to a balance rather than to a calendar.
    if (!l.from_date || !l.to_date) continue;
    const start = l.from_date < from ? from : l.from_date;
    const end = l.to_date > to ? to : l.to_date;
    const byDay = (out[l.employee_id] ??= {});
    for (let d = dayOf(start); d <= dayOf(end); d++) byDay[d] = l.leave_type;
  }
  return out;
}
