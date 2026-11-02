"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { MovementDownload } from "./movement-download";

export type Who = "all" | "staff" | "worker";

/** One register row, with its date and times already printed on the server (IST). */
export interface RegisterLine {
  key: string;
  cardNo: string;
  code: string | null;
  name: string | null;
  kind: "staff" | "worker" | null;
  departmentId: string | null;
  departmentName: string | null;
  date: string;
  times: string[];
}

/**
 * Time 1 … Time 10 always show, even on a quiet day (user 2026-11-02: "i need
 * minimum upto time 10"); a day with more punches adds columns past it.
 */
const MIN_TIME_COLUMNS = 10;

/**
 * THE FILTERS RUN IN THE BROWSER (client 2026-11-02: "when select the
 * departments or searching anything loading everything slow"). Department,
 * Staff / Worker and search are a narrowing of rows already on the page, so
 * they answer in the same frame. Every one of them used to be a server round
 * trip that re-read every person and every punch. Only the DATES go back to
 * the server, because only they change what has to be read.
 *
 * The narrowing is mirrored into the URL with `history.replaceState`, which
 * Next keeps in step with its router without re-rendering the page, so a
 * filtered register can still be bookmarked or sent to someone.
 */
export function MovementRegisterClient({
  from,
  to,
  lines,
  departments,
  initial,
  notice,
}: {
  from: string;
  to: string;
  lines: RegisterLine[];
  departments: { id: string; name: string }[];
  initial: { who: Who; dept: string; q: string };
  notice: string | null;
}) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [range, setRange] = useState({ from, to });
  const [who, setWho] = useState<Who>(initial.who);
  const [dept, setDept] = useState(initial.dept);
  const [q, setQ] = useState(initial.q);
  // The table re-filters at a lower priority than the keystroke, so typing
  // never waits on a long register.
  const search = useDeferredValue(q.trim().toLowerCase());

  const syncUrl = (next: { from: string; to: string; who: Who; dept: string; q: string }) => {
    const p = new URLSearchParams();
    p.set("from", next.from);
    p.set("to", next.to);
    if (next.who !== "all") p.set("who", next.who);
    if (next.dept) p.set("dept", next.dept);
    if (next.q.trim()) p.set("q", next.q.trim());
    return `/hr/movement-register?${p}`;
  };
  const mirror = (patch: Partial<{ who: Who; dept: string; q: string }>) =>
    window.history.replaceState(null, "", syncUrl({ ...range, who, dept, q, ...patch }));

  // Typing a year into a date box passes through 0002, 0020, 0202 — each a
  // valid date. Only a whole year is worth a trip to the server.
  const whole = (d: string) => d >= "2000-01-01";
  const changeRange = (patch: Partial<{ from: string; to: string }>) => {
    const next = { ...range, ...patch };
    // A From past To drags To along, so the range never reads backwards.
    if (next.to < next.from) next.to = next.from;
    setRange(next);
    startTransition(() => router.replace(syncUrl({ ...next, who, dept, q }), { scroll: false }));
  };

  // The department list follows the Staff / Worker switch beside it (AGENTS.md
  // "Cascading filters"); a held department that falls out of it stops
  // filtering instead of leaving an empty register that reads as "nobody
  // punched".
  const sideLines = who === "all" ? lines : lines.filter((l) => l.kind === who);
  const sideDepts = new Set(sideLines.map((l) => l.departmentId));
  const deptOptions = departments.filter((d) => sideDepts.has(d.id));
  const activeDept = sideDepts.has(dept) ? dept : "";

  const rows = sideLines.filter(
    (l) =>
      (!activeDept || l.departmentId === activeDept) &&
      (!search || [l.name, l.code, l.cardNo].some((v) => v?.toLowerCase().includes(search))),
  );

  const width = Math.max(MIN_TIME_COLUMNS, ...rows.map((r) => r.times.length));
  const columns: Column<RegisterLine>[] = [
    { header: "Card No", cell: (r) => <span className="tabular-nums">{r.cardNo}</span> },
    {
      header: "Name",
      cell: (r) => r.name ?? <span className="text-muted-foreground">Not linked to anyone</span>,
    },
    { header: "Department", cell: (r) => r.departmentName ?? "—" },
    { header: "IO Date", cell: (r) => r.date },
    ...Array.from({ length: width }, (_, i) => ({
      header: `Time ${i + 1}`,
      align: "center" as const,
      cell: (r: RegisterLine) =>
        r.times[i] ? <span className="whitespace-nowrap tabular-nums">{r.times[i]}</span> : "",
    })),
  ];

  const sheetRows = rows.map((r) => [
    r.cardNo,
    r.name ?? "Not linked to anyone",
    r.departmentName ?? "",
    r.date,
    ...Array.from({ length: width }, (_, i) => r.times[i] ?? ""),
  ]);
  const day = (d: string) => d.split("-").reverse().join("-");
  const sheetTitle =
    from === to
      ? `Daily Movement Register ${day(from)}`
      : `Daily Movement Register ${day(from)} to ${day(to)}`;

  const people = new Set(rows.map((r) => r.cardNo)).size;
  const punches = rows.reduce((n, r) => n + r.times.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Movement Register"
        description="Every punch on the readers, in order, one row per person per day."
        actions={
          <MovementDownload
            title={sheetTitle}
            headers={columns.map((c) => c.header)}
            rows={sheetRows}
          />
        }
      />
      <FieldRow>
        <Field label="From" w="range">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => whole(e.target.value) && changeRange({ from: e.target.value })}
          />
        </Field>
        <Field label="To" w="range">
          <Input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => whole(e.target.value) && changeRange({ to: e.target.value })}
          />
        </Field>
        <Field label="Department" w="term">
          <Select
            value={activeDept}
            onChange={(e) => {
              setDept(e.target.value);
              mirror({ dept: e.target.value });
            }}
          >
            <option value="">All departments</option>
            {deptOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search" w="term">
          <Input
            type="search"
            placeholder="Name, code or card no"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              mirror({ q: e.target.value });
            }}
          />
        </Field>
        <ToggleGroup<Who>
          label="Group"
          value={who}
          onChange={(w) => {
            setWho(w);
            mirror({ who: w });
          }}
          options={[
            { value: "all", label: "All" },
            { value: "staff", label: "Staff" },
            { value: "worker", label: "Worker" },
          ]}
        />
      </FieldRow>
      {notice && <p className="text-sm text-amber-700 dark:text-amber-400">{notice}</p>}
      <p className="text-sm text-muted-foreground">
        {loading
          ? "Loading the punches for these dates…"
          : `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${people} ${people === 1 ? "person" : "people"} · ${punches} punches`}
      </p>
      <div className={loading ? "opacity-60 transition-opacity" : undefined}>
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
    </div>
  );
}
