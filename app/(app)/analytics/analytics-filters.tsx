"use client";

import Link from "next/link";

interface Loc {
  id: string;
  code: string;
  name: string;
}

export function AnalyticsFiltersBar({
  locations,
  current,
}: {
  locations: Loc[];
  current: { preset: string; from: string; to: string; location: string };
}) {
  const field =
    "h-8 rounded-md border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Period</span>
        <select name="preset" defaultValue={current.preset} className={field}>
          <option value="12m">Last 12 months</option>
          <option value="year">This year</option>
          <option value="month">This month</option>
          <option value="custom">Custom…</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">From</span>
        <input type="date" name="from" defaultValue={current.from} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">To</span>
        <input type="date" name="to" defaultValue={current.to} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Entity</span>
        <select name="location" defaultValue={current.location} className={field}>
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground active:scale-95"
      >
        Apply
      </button>
      <Link
        href="/analytics"
        className="flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
      >
        Reset
      </Link>
    </form>
  );
}
