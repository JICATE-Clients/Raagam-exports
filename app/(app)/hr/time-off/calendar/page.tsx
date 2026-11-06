import { PersonCell } from "@/components/ui/person-avatar";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { TypeDot, whenOf } from "@/components/hr/timeoff/shared";
import { today } from "@/lib/calendar";
import { listApprovedBetween } from "@/lib/hr/timeoff-service";
import { fmtDays, fmtMinutes, type TimeoffRequest } from "@/lib/hr/timeoff-types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Leave Calendar" };

/**
 * HR ▸ Time Off ▸ Leave Calendar (0770, MyJKKN `/hr/leave/calendar`).
 * Approved leave and permissions for one month in the unit being worked in.
 * Sundays are shaded and Master Data ▸ Holidays are named on their day.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("hr_payroll", "view");
  const sp = await searchParams;
  const t0 = today();
  const ym = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : t0.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = iso(y, m, 1);
  const last = iso(y, m, days);

  const s = await createClient();
  const [rows, hol] = await Promise.all([
    listApprovedBetween(first, last),
    s.from("holidays").select("name, holiday_date, end_date").lte("holiday_date", last),
  ]);
  if (hol.error) throw new Error(hol.error.message);
  const holidays = (hol.data ?? []) as { name: string; holiday_date: string; end_date: string | null }[];

  const cells: { date: string | null }[] = [];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  for (let i = 0; i < lead; i++) cells.push({ date: null });
  for (let d = 1; d <= days; d++) cells.push({ date: iso(y, m, d) });
  while (cells.length % 7) cells.push({ date: null });

  const onDay = (d: string) => rows.filter((r) => r.start_date <= d && r.end_date >= d);
  const holidayOn = (d: string) => holidays.find((h) => h.holiday_date <= d && (h.end_date ?? h.holiday_date) >= d);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const columns: Column<TimeoffRequest>[] = [
    {
      header: "Person",
      cell: (r) => (
        <PersonCell name={r.person_name} person={r.staff_id ? `staff:${r.staff_id}` : r.worker_id ? `worker:${r.worker_id}` : null}>
          <span className="text-sm font-medium">{r.person_name}</span>
        </PersonCell>
      ),
    },
    { header: "Type", cell: (r) => <TypeDot color={r.leave_color}>{r.leave_name}</TypeDot> },
    { header: "When", cell: (r) => <span className="text-sm tabular-nums">{whenOf(r)}</span> },
    {
      header: "Days",
      align: "right",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : fmtDays(r.total_days)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Leave Calendar" description="Approved leave and permissions in this unit, by month." />

      <div className="flex items-center gap-2">
        <Link
          href={`?month=${shiftMonth(ym, -1)}`}
          aria-label="Previous month"
          className={buttonClasses({ variant: "outline", className: "w-9 px-0" })}
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h2 className="min-w-44 text-center text-base font-semibold">{monthName}</h2>
        <Link
          href={`?month=${shiftMonth(ym, 1)}`}
          aria-label="Next month"
          className={buttonClasses({ variant: "outline", className: "w-9 px-0" })}
        >
          <ChevronRight className="size-4" />
        </Link>
        {ym !== t0.slice(0, 7) && (
          <Link href="?" className="ml-2 text-sm text-primary hover:underline">
            This month
          </Link>
        )}
      </div>

      {/*
        THE MONTH FITS A PHONE (user 2026-11-04: "time off … mainly focusing on
        mobile friendly"). It was a 44rem grid in a sideways scroll. Below md a
        day is a small square — its date and one coloured dot per person away
        (½ and ⏱ ride on the dot's title); who it is lives in the list below,
        which DataTable turns into cards there. From md it is the grid it was:
        names in each day, a holiday's name in the corner.
      */}
      {/* responsive: exempt -- a calendar is seven weekdays; a day is ~50px on a 375px phone and holds a date and dots */}
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-b border-border bg-muted/40 px-1 py-1.5 text-center text-[11px] font-semibold text-muted-foreground md:px-2 md:text-left md:text-xs">
              {w}
            </div>
          ))}
          {cells.map((c, i) => {
            if (!c.date) return <div key={i} className="min-h-12 border-b border-r border-border bg-muted/20 md:min-h-24" />;
            const list = onDay(c.date);
            const h = holidayOn(c.date);
            const sunday = i % 7 === 6;
            return (
              <div
                key={c.date}
                className={cn(
                  "min-h-12 min-w-0 border-b border-r border-border p-1 md:min-h-24 md:p-1.5",
                  (sunday || h) && "bg-muted/30",
                  c.date === t0 && "ring-2 ring-inset ring-primary/40",
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn("text-xs font-semibold tabular-nums", c.date === t0 && "text-primary")}>
                    {Number(c.date.slice(8))}
                  </span>
                  {h && <span className="hidden truncate text-[10px] text-muted-foreground md:inline">{h.name}</span>}
                </div>
                {list.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 md:hidden" aria-label={`${list.length} away`}>
                    {list.slice(0, 6).map((r) => (
                      <span
                        key={r.id}
                        className="size-2 rounded-full"
                        style={{ background: r.leave_color }}
                        title={`${r.person_name} — ${r.leave_name}`}
                      />
                    ))}
                    {list.length > 6 && <span className="text-[9px] leading-none text-muted-foreground">+{list.length - 6}</span>}
                  </div>
                )}
                <ul className="mt-1 hidden space-y-0.5 md:block">
                  {list.slice(0, 4).map((r) => (
                    <li
                      key={r.id}
                      className="truncate rounded px-1 text-[11px] leading-5"
                      style={{ background: `${r.leave_color}22`, color: r.leave_color }}
                      title={`${r.person_name} — ${r.leave_name}`}
                    >
                      {r.person_name}
                      {r.day_part === "first_half" ? " ½" : r.day_part === "second_half" ? " ½" : r.day_part === "hourly" ? " ⏱" : ""}
                    </li>
                  ))}
                  {list.length > 4 && <li className="px-1 text-[11px] text-muted-foreground">+{list.length - 4} more</li>}
                </ul>
              </div>
            );
          })}
      </div>

      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No approved leave this month." paginate={false} />
    </div>
  );
}
