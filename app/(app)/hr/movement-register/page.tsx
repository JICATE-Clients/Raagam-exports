import { requirePermission } from "@/lib/auth/server";
import { addDays, daysBetween, isCalendarDate, nowTime, today } from "@/lib/calendar";
import { fmtDate, fmtTime } from "@/lib/format";
import { getMovementRegister, MAX_RANGE_DAYS } from "@/lib/hr/movement-register-service";
import { MovementRegisterClient, type RegisterLine, type Who } from "./movement-register-client";

interface Props {
  searchParams: Promise<{ from?: string; to?: string; who?: string; dept?: string; q?: string }>;
}

/** A punch as the register prints it: the factory's clock, 12-hour. */
const punchTime = (iso: string) => fmtTime(nowTime(new Date(iso)));

/**
 * Daily Movement Register (Time & Attendance) — one row per person per day,
 * every punch in order as Time 1, Time 2, … Read-only: the record of what the
 * readers sent. See `lib/hr/movement-register-service.ts`.
 *
 * The server reads the DATE RANGE and nothing else; Staff / Worker, department
 * and search narrow those rows in the browser (`movement-register-client.tsx`).
 * Dates and times are printed here, in IST, so a browser in another zone
 * cannot move a punch to a different time or day.
 */
export default async function MovementRegisterPage({ searchParams }: Props) {
  await requirePermission("hr_payroll", "view");
  const sp = await searchParams;

  const todayIst = today();
  const from = sp.from && isCalendarDate(sp.from) ? sp.from : todayIst;
  let to = sp.to && isCalendarDate(sp.to) && sp.to >= from ? sp.to : from;
  const clipped = daysBetween(from, to) >= MAX_RANGE_DAYS;
  if (clipped) to = addDays(from, MAX_RANGE_DAYS - 1);
  const who: Who = sp.who === "staff" || sp.who === "worker" ? sp.who : "all";

  const register = await getMovementRegister(from, to);
  const lines: RegisterLine[] = register.rows.map((r) => ({
    key: r.key,
    cardNo: r.cardNo,
    code: r.code,
    name: r.name,
    kind: r.kind,
    person: r.person,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    date: fmtDate(r.date),
    times: r.times.map(punchTime),
  }));

  const notice = clipped
    ? `Showing ${MAX_RANGE_DAYS} days from ${fmtDate(from)} — pick a shorter range to see the rest.`
    : register.capped
      ? "This range holds more punches than one read can carry — pick a shorter range."
      : null;

  return (
    <MovementRegisterClient
      from={from}
      to={to}
      lines={lines}
      departments={register.departments}
      initial={{ who, dept: sp.dept ?? "", q: sp.q ?? "" }}
      notice={notice}
    />
  );
}

// created-by: exempt -- every row is derived from device punches, which have no creator
