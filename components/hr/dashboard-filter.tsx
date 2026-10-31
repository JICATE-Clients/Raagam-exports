"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Loader2, X } from "lucide-react";
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
 */
export function HrDashboardFilter({
  kind,
  counts,
  depts,
  picked,
}: {
  kind: PersonKind;
  /** People on the reader per side, for the switch's labels. */
  counts: Record<PersonKind, number>;
  depts: DeptOption[];
  picked: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function go(next: { kind?: PersonKind; depts?: string[] }) {
    const q = new URLSearchParams(params.toString());
    if (next.kind) q.set("kind", next.kind);
    if (next.depts !== undefined) {
      // "" (no department) travels as "none" — an empty value would vanish.
      if (next.depts.length) q.set("dept", next.depts.map((d) => d || "none").join(","));
      else q.delete("dept");
    }
    const s = q.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <ToggleGroup
        label="Staff or Worker"
        role="tablist"
        value={kind}
        onChange={(k) => go({ kind: k, depts: [] })}
        options={PERSON_KINDS.map((k) => ({ value: k.value, label: `${k.label} (${counts[k.value]})` }))}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
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
      {isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
    </div>
  );
}
