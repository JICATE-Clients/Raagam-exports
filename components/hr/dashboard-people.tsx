"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlarmClock,
  Briefcase,
  Building2,
  CircleCheck,
  DoorOpen,
  LogOut,
  Palmtree,
  Timer,
  UserCheck,
  Users,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/** One person on today's dashboard, slimmed to what the list shows. */
export interface PeopleRow {
  bio: string;
  name: string;
  code: string | null;
  category: string | null;
  /** "" = no department. */
  deptId: string;
  dept: string;
  /** The keys of every top card this person counts under. */
  in: PeopleKey[];
  firstAt: number | null;
  lastAt: number | null;
  lateMin: number;
  earlyMin: number;
  /** Approved Time Off today: the leave type's name. */
  offType: string | null;
}

/** The top cards, in their order. `out` is the "out right now" half of On premises. */
export const PEOPLE_LISTS = [
  { key: "onroll", label: "On roll" },
  { key: "present", label: "Present" },
  { key: "leave", label: "Leave" },
  { key: "onduty", label: "On duty" },
  { key: "permission", label: "Permission" },
  { key: "absent", label: "Absent" },
  { key: "late", label: "Late" },
  { key: "early", label: "Left early" },
  { key: "ontime", label: "On time" },
  { key: "premises", label: "On premises" },
  { key: "out", label: "Out now" },
] as const;
export type PeopleKey = (typeof PEOPLE_LISTS)[number]["key"];

/*
 * Each list's colour — the same family as its card at the top, so the header
 * says which list is open before a word is read.
 */
const LOOK: Record<PeopleKey, { band: string; art: string; icon: LucideIcon; idle: string; lit: string }> = {
  onroll: { band: "from-indigo-600 via-indigo-500 to-violet-500", art: "/hr/3d/onroll.png", icon: Users, idle: "bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30", lit: "shadow-indigo-500/40" },
  present: { band: "from-emerald-600 via-emerald-500 to-teal-400", art: "/hr/3d/present.png", icon: UserCheck, idle: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30", lit: "shadow-emerald-500/40" },
  leave: { band: "from-sky-600 via-sky-500 to-cyan-400", art: "/hr/3d/leave.png", icon: Palmtree, idle: "bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30", lit: "shadow-sky-500/40" },
  onduty: { band: "from-violet-600 via-violet-500 to-fuchsia-500", art: "/hr/3d/onduty.png", icon: Briefcase, idle: "bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30", lit: "shadow-violet-500/40" },
  permission: { band: "from-amber-500 via-amber-400 to-yellow-400", art: "/hr/3d/permission.png", icon: Timer, idle: "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30", lit: "shadow-amber-500/40" },
  absent: { band: "from-rose-600 via-rose-500 to-pink-500", art: "/hr/3d/absent.png", icon: UserX, idle: "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30", lit: "shadow-rose-500/40" },
  late: { band: "from-orange-600 via-orange-500 to-amber-400", art: "/hr/3d/late.png", icon: AlarmClock, idle: "bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30", lit: "shadow-orange-500/40" },
  early: { band: "from-fuchsia-600 via-pink-500 to-rose-400", art: "/hr/3d/left.png", icon: LogOut, idle: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 hover:bg-fuchsia-100 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:ring-fuchsia-500/30", lit: "shadow-fuchsia-500/40" },
  ontime: { band: "from-teal-600 via-emerald-500 to-lime-400", art: "/hr/3d/ontime.png", icon: CircleCheck, idle: "bg-teal-50 text-teal-700 ring-teal-200 hover:bg-teal-100 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30", lit: "shadow-teal-500/40" },
  premises: { band: "from-blue-600 via-sky-500 to-cyan-400", art: "/hr/3d/premises.png", icon: Building2, idle: "bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30", lit: "shadow-blue-500/40" },
  out: { band: "from-cyan-600 via-sky-500 to-indigo-400", art: "/hr/3d/premises.png", icon: DoorOpen, idle: "bg-cyan-50 text-cyan-700 ring-cyan-200 hover:bg-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/30", lit: "shadow-cyan-500/40" },
};

function clock(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}
function mins(m: number): string {
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/**
 * THE NAMES BEHIND THE TOP CARDS (user 2026-10-31): one panel instead of the
 * three fixed Late / Out / Early cards. Pick a card — up here, or by clicking
 * it at the top, which lands here with `?show=`. Departments are narrowed by
 * the dashboard's own filter at the top, not again here (user 2026-10-31).
 */
export function DashboardPeople({ rows, now }: { rows: PeopleRow[]; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const shown = params.get("show");
  const list: PeopleKey = PEOPLE_LISTS.some((l) => l.key === shown) ? (shown as PeopleKey) : "late";

  function pick(key: PeopleKey) {
    const q = new URLSearchParams(params.toString());
    q.set("show", key);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  const visible = rows.filter((r) => r.in.includes(list)).sort((a, b) =>
    list === "late"
      ? b.lateMin - a.lateMin
      : list === "early"
        ? b.earlyMin - a.earlyMin
        : list === "out"
          ? (a.lastAt ?? 0) - (b.lastAt ?? 0)
          : a.name.localeCompare(b.name),
  );

  // Paged HERE, not by the table: a paged DataTable pins its pager to the
  // bottom of the screen and scrolls its rows in a box — right for a page's
  // main list, wrong inside a dashboard card (user 2026-10-31). Same app-wide
  // "Rows per page" either way.
  const pg = usePagination(visible);

  // The last column says what this list is about.
  const detail: Column<PeopleRow> | null =
    list === "late"
      ? { header: "Late by", align: "right", cell: (r) => <span className="font-semibold text-amber-600 dark:text-amber-400">+{mins(r.lateMin)}</span> }
      : list === "early"
        ? { header: "Early by", align: "right", cell: (r) => <span className="font-semibold text-rose-600 dark:text-rose-400">−{mins(r.earlyMin)}</span> }
        : list === "out"
          ? { header: "Away", align: "right", cell: (r) => <span className="font-semibold text-sky-600 dark:text-sky-400">{r.lastAt ? mins(Math.round((now - r.lastAt) / 60_000)) : "—"}</span> }
          : list === "leave" || list === "onduty" || list === "permission"
            ? { header: "Type", cell: (r) => r.offType ?? "—" }
            : null;

  const columns: Column<PeopleRow>[] = [
    {
      // The count sits beside the column it counts (user 2026-10-31).
      header: `Employee (${visible.length})`,
      cell: (r) => (
        <div className="min-w-0 max-w-[18rem]">
          <Truncated text={r.name} className="block font-medium text-slate-900 dark:text-slate-100" />
          <Truncated
            text={[r.category, r.code].filter(Boolean).join(" · ") || "—"}
            className="block text-xs text-slate-500"
          />
        </div>
      ),
    },
    { header: "Department", cell: (r) => <span className={cn(!r.deptId && "italic text-slate-500")}>{r.dept}</span> },
    { header: "In", align: "right", cell: (r) => <span className="tabular-nums">{clock(r.firstAt)}</span> },
    { header: list === "out" ? "Went out" : "Last punch", align: "right", cell: (r) => <span className="tabular-nums">{r.firstAt === r.lastAt ? "—" : clock(r.lastAt)}</span> },
    ...(detail ? [{ ...detail, cell: (r: PeopleRow) => <span className="tabular-nums">{detail.cell(r)}</span> }] : []),
  ];

  const look = LOOK[list];
  const label = PEOPLE_LISTS.find((l) => l.key === list)?.label;
  return (
    <section id="people" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
      <header className={cn("relative isolate overflow-hidden rounded-t-2xl bg-gradient-to-r px-5 py-4 text-white transition-colors", look.band)}>
        <span aria-hidden className="absolute -right-10 -top-16 -z-10 h-44 w-44 rounded-full bg-white/20 blur-2xl" />
        <span aria-hidden className="absolute -bottom-20 left-1/3 -z-10 h-40 w-40 rounded-full bg-black/10 blur-2xl" />
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 40px vendored icon; next/image buys nothing here */}
          <img src={look.art} alt="" className="h-11 w-11 shrink-0 drop-shadow-[0_4px_6px_rgb(0_0_0/0.25)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">People</p>
            <h3 className="flex items-baseline gap-2 text-xl font-bold tracking-tight">
              {label}
            </h3>
          </div>
        </div>
      </header>
      <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
        {/*
          button-shape: exempt -- each list is its own colour, the same as its
          card at the top and the header band (user 2026-10-31: "separate for
          all headings colours designs and styles"); ToggleGroup draws every
          word alike with only the lit one in the primary colour.
        */}
        <div role="tablist" aria-label="Which people" className="-my-2 flex gap-1.5 overflow-x-auto px-0.5 py-2 scrollbar-none">
          {PEOPLE_LISTS.map((l) => {
            const lk = LOOK[l.key];
            const on = l.key === list;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => pick(l.key)}
                className={cn(
                  "inline-flex h-9 min-w-0 shrink-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-2 text-xs font-semibold ring-1 ring-inset transition duration-200 xl:shrink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  on
                    ? cn("-translate-y-0.5 bg-gradient-to-r text-white shadow-lg ring-white/20", lk.band, lk.lit)
                    : lk.idle,
                )}
              >
                <lk.icon className="hidden h-3.5 w-3.5 shrink-0 2xl:block" aria-hidden />
                {l.label}
              </button>
            );
          })}
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={pg.paged}
        getKey={(r) => r.bio}
        bare
        paginate={false}
        empty={`Nobody under ${label} right now.`}
      />
      {pg.pageCount > 1 && (
        <div className="border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <PaginationBar
            page={pg.page}
            pageCount={pg.pageCount}
            total={pg.total}
            pageSize={pg.pageSize}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </div>
      )}
    </section>
  );
}
