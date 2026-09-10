import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { listStaffTaKpi, canSeeTeamKpi } from "@/lib/ta/kpi";
import { addMonths, endOfMonth, startOfMonth, today } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { buttonClasses } from "@/components/ui/button";
import { TaPerformanceReport } from "./ta-performance-report";

/**
 * Reports ▸ T&A Staff Performance — the Monthly Review Meeting view.
 *
 * ONE MONTH AT A TIME, DELIBERATELY (`?month=YYYY-MM`). This report exists
 * for an MRM, which reviews a specific month's schedule, not a rolling
 * window — `lib/date-filter.ts`'s preset/custom-range machinery is built for
 * a list screen's FilterBar and would offer ranges this report has no honest
 * answer for (an on-time score spanning two months answers "on time for
 * WHICH month's targets?" ambiguously). `startOfMonth`/`endOfMonth`
 * (`lib/calendar.ts`) own the arithmetic, never a local `new Date()`.
 *
 * THE PAGE ASKS `orders:export` FOR ITS OWN COPY, not to gate access —
 * `listStaffTaKpi` already enforces that inside `staff_ta_kpi()`
 * (SECURITY DEFINER). This second call only decides which SENTENCE to print
 * above the table ("your own figure" vs "every staff member's"), so the copy
 * can never claim a scope the data does not actually have.
 */
export default async function TaPerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePermission("reports", "view");

  const { month } = await searchParams;
  // `?month=2026-09` → the 1st of that month; a malformed/missing param falls
  // back to today's own month rather than refusing the page.
  const anchor = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : today();
  const from = startOfMonth(anchor);
  const to = endOfMonth(anchor);

  const [rows, teamView] = await Promise.all([listStaffTaKpi(from, to), canSeeTeamKpi()]);

  const evaluated = rows.reduce((s, r) => s + r.completedOnTime + r.completedLate, 0);
  const onTime = rows.reduce((s, r) => s + r.completedOnTime, 0);
  const buyerDelays = rows.reduce((s, r) => s + r.buyerAttributedDelays, 0);
  // Company-wide average excludes buyer-attributed the same way each row's
  // own score does — see the migration's header for why that exclusion
  // exists at all: a buyer sitting on an approval must not read as staff
  // under-performance, at the person's row or rolled up.
  const denom = evaluated - buyerDelays;
  const overallScore = denom > 0 ? Math.round((onTime / denom) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="T&A Staff Performance"
        description={
          teamView
            ? "On-time completion by staff, for the Monthly Review Meeting."
            : "Your own on-time completion. Company-wide visibility needs Export access."
        }
        actions={<MonthNav anchor={from} />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Overall on-time"
          value={overallScore != null ? `${overallScore}%` : "—"}
          tone={
            overallScore == null
              ? "neutral"
              : overallScore >= 90
                ? "success"
                : overallScore >= 75
                  ? "warning"
                  : "danger"
          }
        />
        <Stat label="Completed" value={evaluated} tone="neutral" />
        <Stat label="On time" value={onTime} tone="neutral" />
        <Stat
          label="Buyer-attributed delays"
          value={buyerDelays}
          hint="Excluded from the score above"
          tone="neutral"
        />
      </div>

      <TaPerformanceReport rows={rows} from={from} to={to} />
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "September 2026" straight from the trusted `YYYY-MM-DD` `anchor` this
 * module already built (`startOfMonth`/`addMonths`) — never `fmtDate` (that
 * owns DD/MM/YYYY, a different question) and never `new Date(anchor)`
 * (`lib/calendar.ts`'s own warning: UTC-parsed and a day behind on this
 * UTC+5:30 business for anything time-sensitive). Splitting the string is
 * safe here specifically because `anchor` is this file's own output, not
 * external input.
 */
function monthLabel(anchor: string): string {
  const [y, m] = anchor.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function MonthNav({ anchor }: { anchor: string }) {
  const prev = addMonths(anchor, -1).slice(0, 7);
  const next = addMonths(anchor, 1).slice(0, 7);
  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/reports/ta-performance?month=${prev}`}
        className={buttonClasses({ variant: "outline", className: "px-2" })}
        aria-label="Previous month"
      >
        <ChevronLeft aria-hidden />
      </Link>
      <span className="min-w-[8rem] text-center text-sm font-medium">
        {monthLabel(anchor)}
      </span>
      <Link
        href={`/reports/ta-performance?month=${next}`}
        className={buttonClasses({ variant: "outline", className: "px-2" })}
        aria-label="Next month"
      >
        <ChevronRight aria-hidden />
      </Link>
    </div>
  );
}
