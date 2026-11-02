import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, isoDateInTZ } from "@/lib/calendar";
import { readPunches } from "@/lib/hr/punch-read";

/**
 * DAILY MOVEMENT REGISTER — every punch a person made on a day, in order, as
 * Time 1, Time 2, … (client 2026-11-02, from the legacy software's register of
 * the same name: "every punches needs to properly fill these like time 1 etc,
 * this is record reason").
 *
 * A RECORD, NOT A CALCULATION. Nothing here decides In or Out, late or early:
 * the register exists so HR can see exactly what the reader recorded, which is
 * what everything else (the dashboard, attendance) is derived from. So every
 * punch is listed, including two a minute apart — the legacy register shows
 * those too (9:11AM 9:11AM), and dropping them would make this a second
 * interpretation instead of the record. Only an exact repeat of the same
 * second from the same id (a device re-sending its log) is folded into one.
 *
 * The day is the factory's calendar day (IST), the legacy "IODate". A punch
 * whose id no staff or worker carries is still listed, as not linked, rather
 * than dropped: a missing row reads as "never punched".
 */

export interface MovementRow {
  /** `${date}|${bio}` — one row per id per day. */
  key: string;
  date: string;
  /** The id enrolled on the reader (the legacy Card No). */
  cardNo: string;
  code: string | null;
  name: string | null;
  kind: "staff" | "worker" | null;
  departmentId: string | null;
  departmentName: string | null;
  /** Punch timestamps for the day, earliest first. */
  times: string[];
}

export interface MovementDepartment {
  id: string;
  name: string;
}

export interface MovementRegister {
  rows: MovementRow[];
  departments: MovementDepartment[];
  /** True when the range held more punches than one read is allowed to carry. */
  capped: boolean;
}

/** The widest range one request reads; a month of a full factory is ~200k punches. */
export const MAX_RANGE_DAYS = 31;

type PersonRow = {
  id: string;
  name: string;
  code: string | null;
  biometric_id: string | null;
  department_id: string | null;
  department: { name: string | null; short_name: string } | null;
};

export async function getMovementRegister(from: string, to: string): Promise<MovementRegister> {
  const s = await createClient();
  const fromIso = `${from}T00:00:00+05:30`;
  const toIso = `${addDays(to, 1)}T00:00:00+05:30`;

  // `departments!department_id`: workers also carry `prod_dept_id` (0553), so a
  // bare embed is PGRST201-ambiguous (AGENTS.md).
  const sel =
    "id, name, code, biometric_id, department_id, department:departments!department_id(name, short_name)";
  // People and punches side by side: neither needs the other to be asked.
  const [staff, workers, read] = await Promise.all([
    s.from("staff").select(sel).not("biometric_id", "is", null),
    s.from("workers").select(sel).not("biometric_id", "is", null),
    readPunches<{ id: number; user_id: string; punch_time: string }>(
      s,
      "id, user_id, punch_time",
      fromIso,
      toIso,
    ).catch((e) => {
      // A failed read is an error, not an empty register (AGENTS.md).
      console.error("[movement-register] punches failed", e);
      throw new Error("Could not read the punches. Try again.");
    }),
  ]);
  if (staff.error) console.error("[movement-register] staff failed", staff.error);
  if (workers.error) console.error("[movement-register] workers failed", workers.error);

  // Inactive people are included on purpose: a register of a past day must
  // still name someone who has since left.
  const byBio = new Map<string, { p: PersonRow; kind: "staff" | "worker" }>();
  for (const [rows, kind] of [
    [staff.data, "staff"],
    [workers.data, "worker"],
  ] as const) {
    for (const p of (rows ?? []) as unknown as PersonRow[]) {
      const bio = String(p.biometric_id ?? "").trim();
      if (bio && !byBio.has(bio)) byBio.set(bio, { p, kind });
    }
  }

  const punches = read.rows;
  const capped = read.capped;

  const rows = new Map<string, MovementRow>();
  for (const pu of punches) {
    const bio = String(pu.user_id ?? "").trim();
    const date = isoDateInTZ(pu.punch_time);
    if (!bio || !date) continue;
    const key = `${date}|${bio}`;
    let row = rows.get(key);
    if (!row) {
      const who = byBio.get(bio);
      row = {
        key,
        date,
        cardNo: bio,
        code: who?.p.code ?? null,
        name: who?.p.name ?? null,
        kind: who?.kind ?? null,
        departmentId: who?.p.department_id ?? null,
        departmentName: who?.p.department
          ? who.p.department.name || who.p.department.short_name
          : null,
        times: [],
      };
      rows.set(key, row);
    }
    const t = new Date(pu.punch_time).getTime();
    if (row.times.length && new Date(row.times[row.times.length - 1]).getTime() === t) continue;
    row.times.push(pu.punch_time);
  }

  const list = [...rows.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.departmentName ?? "￿").localeCompare(b.departmentName ?? "￿") ||
      (a.code ?? a.cardNo).localeCompare(b.code ?? b.cardNo, undefined, { numeric: true }),
  );

  const depts = new Map<string, string>();
  for (const r of list) if (r.departmentId) depts.set(r.departmentId, r.departmentName ?? "—");
  const departments = [...depts]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows: list, departments, capped };
}
