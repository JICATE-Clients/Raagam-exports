"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Loader2, UserSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { MultiSelect } from "@/components/ui/multi-select";
import { PERSON_KINDS, type PersonKind } from "@/lib/masters/category-timing-types";
import type { DeptOption } from "@/lib/hr/dashboard-service";

/**
 * The HR dashboard's filter: Staff | Worker, then any of that side's
 * departments (user 2026-10-31). It lives in the URL (`?kind=worker&dept=…`),
 * so the minute-by-minute refresh, a reload and a shared link all keep it, and
 * the server narrows every card from one place (`filterHrDashboard`).
 *
 * Switching side clears the departments: the list is scoped to the side in
 * view, so a department picked under Staff means nothing under Worker.
 *
 * AND A DAY (user 2026-11-03: "near the department add a date button, so that
 * if I want to see previous dates also we can see them"). `?day=` — not
 * `?date=`, which the Attendance page already spends on its Day sheet. Today
 * is the address with no `day`, so a bookmark of the dashboard stays live.
 * Nothing after today: a day that has not happened has no attendance.
 *
 * `variant="table"` is the same Department and Date over the People table
 * (same day: "in that big table also add department and date filters") —
 * without the side switch, which the bar above already holds. Both write the
 * same URL, so the two can never disagree about what is on screen.
 *
 * AND AN EMPLOYEE (user 2026-11-04: "add employee name filter all the places
 * near the dept filter"). `?name=` — part of a name or code, narrowed on the
 * server like a department (`filterHrDashboard`), written 300 ms after the
 * last keystroke so each letter does not reload the page.
 */
export function HrDashboardFilter({
  kind,
  counts,
  depts,
  picked,
  name = "",
  day,
  today,
  variant = "bar",
}: {
  /** The name / code being searched for (`?name=`). */
  name?: string;
  kind: PersonKind;
  /** People on the reader per side, for the switch's labels. */
  counts: Record<PersonKind, number>;
  depts: DeptOption[];
  picked: string[];
  /** The day on view and the factory's today (IST, YYYY-MM-DD). */
  day: string;
  today: string;
  variant?: "bar" | "table";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /*
   * ONE SEARCH, TWO BOXES (user 2026-11-04/05: letters flickered back while
   * typing, then "if I type in the bottom box and remove it in the top one it
   * shows the name again"). Two earlier cuts each kept a COPY of the search per
   * box and tried to decide when to copy the URL back in — and each rule was
   * wrong in some order of typing.
   *
   * There is no copy now. The URL's `?name=` is the search. A box shows it,
   * EXCEPT while the operator is typing in that box (focused, or a keystroke
   * not yet sent): then it shows what they typed, so a page re-rendering for
   * "ra" can never rewind the box to "r". The other box is never being typed
   * in, so it simply shows the URL — clear one, and the other is blank.
   */
  const [typed, setTyped] = useState(name);
  const [focused, setFocused] = useState(false);
  // The search sent but not yet back in the URL; null = nothing in flight.
  const [pending, setPending] = useState<string | null>(null);
  if (pending !== null && name === pending) setPending(null);
  const shown = focused || pending !== null ? typed : name;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function send(v: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = v.trim();
    if (next === name) {
      setPending(null);
      return;
    }
    setPending(next);
    go({ name: next });
  }
  function typeName(v: string) {
    setTyped(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(v), 300);
  }

  function go(next: { kind?: PersonKind; depts?: string[]; day?: string; name?: string }) {
    const q = new URLSearchParams(params.toString());
    if (next.name !== undefined) {
      if (next.name) q.set("name", next.name);
      else q.delete("name");
    }
    if (next.day !== undefined) {
      if (next.day && next.day < today) q.set("day", next.day);
      else q.delete("day");
    }
    if (next.kind) q.set("kind", next.kind);
    if (next.depts !== undefined) {
      // "" (no department) travels as "none" — an empty value would vanish.
      if (next.depts.length) q.set("dept", next.depts.map((d) => d || "none").join(","));
      else q.delete("dept");
    }
    const s = q.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  const table = variant === "table";
  const step = (n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    go({ day: d.toISOString().slice(0, 10) });
  };

  return (
    <div
      className={
        table
          ? "flex flex-wrap items-center gap-3"
          : "flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70"
      }
    >
      {!table && (
        <ToggleGroup
          label="Staff or Worker"
          role="tablist"
          value={kind}
          onChange={(k) => go({ kind: k, depts: [] })}
          options={PERSON_KINDS.map((k) => ({ value: k.value, label: `${k.label} (${counts[k.value]})` }))}
        />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Department</span>
        <MultiSelect
          label="Departments"
          compact
          hideChips
          summarizeLabels
          summaryNoun="departments"
          placeholder="All departments"
          className="w-full min-w-0 sm:w-72"
          options={depts.map((d) => ({ id: d.id || "none", label: `${d.name} (${d.people})` }))}
          values={picked.map((d) => d || "none")}
          onChange={(ids) => go({ depts: ids.map((d) => (d === "none" ? "" : d)) })}
          emptyLabel="Nobody on the reader here yet"
        />
        {picked.length > 0 && (
          <button
            type="button"
            onClick={() => go({ depts: [] })}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <UserSearch className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Employee</span>
        {/* caps-input: exempt -- a search box, not a stored value */}
        <Input
          type="search"
          aria-label="Employee name or code"
          placeholder="Name or code"
          className="w-full min-w-0 sm:w-52"
          value={shown}
          onFocus={() => {
            // Start from what the URL says now — the other box may have changed it.
            if (pending === null) setTyped(name);
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            // Leaving with a keystroke not yet sent: send it now, not in 300 ms.
            if (timer.current) send(typed);
          }}
          onChange={(e) => typeName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Date</span>
        <Button type="button" variant="outline" size="icon" aria-label="Previous day" onClick={() => step(-1)}>
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Date"
          className="w-40"
          max={today}
          value={day}
          onChange={(e) => e.target.value && go({ day: e.target.value })}
        />
        <Button type="button" variant="outline" size="icon" aria-label="Next day" disabled={day >= today} onClick={() => step(1)}>
          <ChevronRight />
        </Button>
        {day < today && (
          <button
            type="button"
            onClick={() => go({ day: today })}
            className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Today
          </button>
        )}
      </div>
      {isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
    </div>
  );
}
