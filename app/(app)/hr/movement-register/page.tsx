import { requirePermission } from "@/lib/auth/server";
import { addDays, daysBetween, isCalendarDate, nowTime, today } from "@/lib/calendar";
import { fmtDate, fmtTime } from "@/lib/format";
import {
  getMovementRegister,
  MAX_RANGE_DAYS,
  type MovementRow,
} from "@/lib/hr/movement-register-service";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { MovementFilters, type Who } from "./movement-filters";
import { MovementDownload } from "./movement-download";

interface Props {
  searchParams: Promise<{ from?: string; to?: string; who?: string; dept?: string; q?: string }>;
}

/** A punch as the register prints it: the factory's clock, 12-hour. */
const punchTime = (iso: string) => fmtTime(nowTime(new Date(iso)));

/**
 * Time 1 … Time 10 always show, even on a quiet day (user 2026-11-02: "i need
 * minimum upto time 10"); a day with more punches adds columns past it.
 */
const MIN_TIME_COLUMNS = 10;

/**
 * Daily Movement Register (Time & Attendance) — one row per person per day,
 * every punch in order as Time 1, Time 2, … Read-only: the record of what the
 * readers sent. See `lib/hr/movement-register-service.ts`.
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
  const q = (sp.q ?? "").trim().toLowerCase();

  const register = await getMovementRegister(from, to);
  const sideRows = register.rows.filter((r) => who === "all" || r.kind === who);

  // The department list follows the Staff / Worker switch beside it (AGENTS.md
  // "Cascading filters"), and a held department that is not in it — another
  // side, or no punches in these dates — stops filtering instead of leaving
  // an empty register that reads as "nobody punched".
  const deptIds = new Set(sideRows.map((r) => r.departmentId));
  const departments = register.departments.filter((d) => deptIds.has(d.id));
  const dept = sp.dept && deptIds.has(sp.dept) ? sp.dept : "";

  const rows = sideRows.filter(
    (r) =>
      (!dept || r.departmentId === dept) &&
      (!q ||
        [r.name, r.code, r.cardNo].some((v) => v?.toLowerCase().includes(q))),
  );

  const width = Math.max(MIN_TIME_COLUMNS, ...rows.map((r) => r.times.length));
  const columns: Column<MovementRow>[] = [
    { header: "Card No", cell: (r) => <span className="tabular-nums">{r.cardNo}</span> },
    {
      header: "Name",
      cell: (r) =>
        r.name ?? <span className="text-muted-foreground">Not linked to anyone</span>,
    },
    { header: "Department", cell: (r) => r.departmentName ?? "—" },
    { header: "IO Date", cell: (r) => fmtDate(r.date) },
    ...Array.from({ length: width }, (_, i) => ({
      header: `Time ${i + 1}`,
      align: "center" as const,
      cell: (r: MovementRow) =>
        r.times[i] ? (
          <span className="whitespace-nowrap tabular-nums">
            {punchTime(r.times[i])}
          </span>
        ) : (
          ""
        ),
    })),
  ];

  const sheetHeaders = columns.map((c) => c.header);
  const sheetRows = rows.map((r) => [
    r.cardNo,
    r.name ?? "Not linked to anyone",
    r.departmentName ?? "",
    fmtDate(r.date),
    ...Array.from({ length: width }, (_, i) => (r.times[i] ? punchTime(r.times[i]) : "")),
  ]);
  const sheetTitle =
    from === to
      ? `Daily Movement Register ${fmtDate(from).replaceAll("/", "-")}`
      : `Daily Movement Register ${fmtDate(from).replaceAll("/", "-")} to ${fmtDate(to).replaceAll("/", "-")}`;

  const people = new Set(rows.map((r) => r.cardNo)).size;
  const punches = rows.reduce((n, r) => n + r.times.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Movement Register"
        description="Every punch on the readers, in order, one row per person per day."
        actions={<MovementDownload title={sheetTitle} headers={sheetHeaders} rows={sheetRows} />}
      />
      <MovementFilters
        from={from}
        to={to}
        who={who}
        dept={dept}
        q={sp.q ?? ""}
        key={`${who}|${dept}`}
        departments={departments}
      />
      {(clipped || register.capped) && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {clipped
            ? `Showing ${MAX_RANGE_DAYS} days from ${fmtDate(from)} — pick a shorter range to see the rest.`
            : "This range holds more punches than one read can carry — pick a shorter range."}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {rows.length} {rows.length === 1 ? "row" : "rows"} · {people}{" "}
        {people === 1 ? "person" : "people"} · {punches} punches
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r) => r.key}
        gridLines
        dense="spacing"
        // The table drops the LAST row's rule (`last:border-0`), expecting the
        // frame to close it — but a listing's frame stretches below the rows,
        // so the register's last line read as unfinished. Keep it, like the
        // legacy register.
        rowClassName={() => "border-b! border-border"}
        empty="No punches for this selection."
      />
    </div>
  );
}

// created-by: exempt -- every row is derived from device punches, which have no creator
