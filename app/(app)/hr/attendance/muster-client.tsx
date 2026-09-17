"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Worker } from "@/lib/hr/types";
import type {
  MusterAttendance,
  MusterHoliday,
} from "@/lib/hr/attendance-service";
import type { LocationOption } from "@/lib/hr/masters-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Stat } from "@/components/ui/stat";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * THE MUSTER ROLL — a month at a time, one row per worker, one cell per day.
 *
 * The day sheet beside it answers "who is in today"; this answers "what did
 * this month look like", which is the question asked before a payroll run is
 * approved and the one an inspector asks of the register. Payroll already
 * aggregates exactly these numbers (`days_present`, `ot_hours` in
 * payroll-service) — until now nobody could SEE the month those totals came
 * from, only the one day the sheet happened to be showing.
 *
 * READ-ONLY, DELIBERATELY. A day number here is a link to the day it stands
 * for, so a correction is made on the sheet that owns the record, with its OT
 * cap, its source and its note. A grid that edited 31 days by 200 workers in
 * place would be a second way to write attendance with none of those rules
 * attached.
 *
 * THE WHOLE MONTH FITS WITHOUT SCROLLING, and that is the design. At 24px a
 * day, 31 days plus the name and the totals sit inside a laptop's content
 * pane — so a run of absences is found by its shape rather than by reading.
 * It still scrolls sideways on a phone, with the name column pinned.
 */

/** What one cell says. `null` is "nothing was recorded", not "absent". */
type Mark = "P" | "L" | "H" | "A";

const MARK_CLASS: Record<Mark, string> = {
  P: "bg-success-soft text-success",
  L: "bg-info-soft text-info",
  H: "bg-surface-muted text-muted-foreground",
  A: "bg-danger-soft text-danger",
};

const MARK_LABEL: Record<Mark, string> = {
  P: "Present",
  L: "On leave",
  H: "Holiday",
  A: "Absent",
};

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

export default function MusterClient({
  workers,
  attendance,
  holidays,
  leave,
  locations,
  month,
  daysInMonth,
  selectedLocationId,
}: {
  workers: Worker[];
  attendance: MusterAttendance;
  holidays: Record<number, MusterHoliday>;
  leave: Record<string, Record<number, string>>;
  locations: LocationOption[];
  /** "YYYY-MM" — a month is a string here for the same reason a date is. */
  month: string;
  daysInMonth: number;
  selectedLocationId: string | null;
}) {
  const router = useRouter();
  const [monthVal, setMonthVal] = useState(month);
  const [locationVal, setLocationVal] = useState(selectedLocationId ?? "");

  function navigate() {
    const params = new URLSearchParams({ view: "month", month: monthVal });
    if (locationVal) params.set("location", locationVal);
    router.push(`/hr/attendance?${params.toString()}`);
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));

  /** The day sheet for one day of this month, filters carried across. */
  function dayHref(d: number) {
    const params = new URLSearchParams({
      date: `${month}-${String(d).padStart(2, "0")}`,
    });
    if (locationVal) params.set("location", locationVal);
    return `/hr/attendance?${params.toString()}`;
  }

  /**
   * ONE DAY, ONE ANSWER. Present wins over everything — a worker who came in
   * on a holiday was present, and the register must say so. Then leave, which
   * is a decision somebody made, ahead of absence, which is merely the lack of
   * one. A day with NO ROW AT ALL stays blank rather than reading "A": nothing
   * was recorded, and a grid that prints absent for "not entered yet" turns
   * the rest of the month into a wall of red every time it is opened.
   */
  function markFor(workerId: string, d: number): Mark | null {
    const att = attendance[workerId]?.[d];
    if (att?.present) return "P";
    if (leave[workerId]?.[d]) return "L";
    if (holidays[d]) return "H";
    if (att) return "A";
    return null;
  }

  const totals = workers.map((w) => {
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let hours = 0;
    let ot = 0;
    for (const d of days) {
      const mark = markFor(w.id, d);
      if (mark === "P") present++;
      else if (mark === "A") absent++;
      else if (mark === "L") onLeave++;
      const att = attendance[w.id]?.[d];
      hours += att?.hours ?? 0;
      ot += att?.ot ?? 0;
    }
    return { present, absent, onLeave, hours, ot };
  });

  const manDays = totals.reduce((n, t) => n + t.present, 0);
  const otHours = totals.reduce((n, t) => n + t.ot, 0);
  const absentDays = totals.reduce((n, t) => n + t.absent, 0);

  /** Hours are numeric(5,2) but land on whole numbers most days. */
  const num = (n: number) => (Number.isInteger(n) ? n : n.toFixed(1));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="mus-month">Month</Label>
          <Input
            id="mus-month"
            type="month"
            value={monthVal}
            onChange={(e) => setMonthVal(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <Label htmlFor="mus-loc">Location</Label>
          <Select
            id="mus-loc"
            value={locationVal}
            onChange={(e) => setLocationVal(e.target.value)}
            className="w-48"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" onClick={navigate}>
          Load
        </Button>
      </div>

      {workers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No active workers for the selected filters.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Workers" value={workers.length} />
            <Stat
              label="Man-days present"
              value={manDays}
              tone="success"
              hint={`over ${daysInMonth} days`}
            />
            <Stat label="OT hours" value={num(otHours)} tone="info" />
            <Stat
              label="Absent days"
              value={absentDays}
              tone={absentDays > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="sticky left-0 z-10 min-w-40 bg-surface-muted px-3 py-1.5 text-left text-xs font-bold text-muted-foreground">
                    Worker
                  </th>
                  {days.map((d) => {
                    const dow = new Date(year, mon - 1, d).getDay();
                    const holiday = holidays[d];
                    return (
                      <th
                        key={d}
                        scope="col"
                        className={cn(
                          "w-6 border-l border-border px-0 py-1 text-center font-semibold",
                          dow === 0 || holiday
                            ? "bg-surface-muted text-muted-foreground"
                            : "text-foreground",
                        )}
                      >
                        {/* The day number opens that day's entry sheet — this
                            grid is read-only, so it is the way in to fixing
                            what the grid shows. */}
                        <Link
                          href={dayHref(d)}
                          title={
                            holiday
                              ? `${holiday.name}${holiday.paid ? "" : " (LOP)"}`
                              : `Open ${d}`
                          }
                          className="block hover:underline"
                        >
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {WEEKDAY[dow]}
                          </span>
                          {d}
                        </Link>
                      </th>
                    );
                  })}
                  {["P", "A", "L", "OT", "Hrs"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="w-10 border-l border-border px-1 py-1 text-right text-xs font-bold text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map((w, i) => {
                  const t = totals[i]!;
                  return (
                    <tr
                      key={w.id}
                      className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-surface px-3 py-1 text-left font-normal"
                      >
                        <Truncated
                          text={w.name}
                          className="block font-medium text-foreground"
                        />
                        {w.code && (
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            {w.code}
                          </span>
                        )}
                      </th>
                      {days.map((d) => {
                        const mark = markFor(w.id, d);
                        const holiday = holidays[d];
                        return (
                          <td
                            key={d}
                            title={
                              mark
                                ? `${MARK_LABEL[mark]} — ${d}${
                                    holiday ? ` (${holiday.name})` : ""
                                  }`
                                : `Not recorded — ${d}`
                            }
                            className={cn(
                              "border-l border-border px-0 py-1 text-center font-semibold",
                              mark ? MARK_CLASS[mark] : "text-muted-foreground",
                            )}
                          >
                            {mark ?? "·"}
                          </td>
                        );
                      })}
                      <td className="border-l border-border px-1 py-1 text-right tabular-nums">
                        {t.present}
                      </td>
                      <td className="border-l border-border px-1 py-1 text-right tabular-nums">
                        {t.absent}
                      </td>
                      <td className="border-l border-border px-1 py-1 text-right tabular-nums">
                        {t.onLeave}
                      </td>
                      <td className="border-l border-border px-1 py-1 text-right tabular-nums">
                        {num(t.ot)}
                      </td>
                      <td className="border-l border-border px-1 py-1 text-right tabular-nums">
                        {num(t.hours)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {(["P", "A", "L", "H"] as const).map((m) => (
              <span key={m} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded font-semibold",
                    MARK_CLASS[m],
                  )}
                >
                  {m}
                </span>
                {MARK_LABEL[m]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded border border-border">
                ·
              </span>
              Not recorded
            </span>
            <span>Click a day to open its entry sheet.</span>
          </div>
        </>
      )}
    </div>
  );
}
