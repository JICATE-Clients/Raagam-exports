"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { DATE_MAX } from "@/components/ui/input";

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

  // Controlled so the dropdown lists options for arrow-key picking (the value is
  // submitted via GET through the Select's hidden input / native select name).
  const [preset, setPreset] = useState(current.preset);
  const [location, setLocation] = useState(current.location);

  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Period</span>
        <Select
          name="preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className={field}
        >
          <option value="12m">Last 12 months</option>
          <option value="year">This year</option>
          <option value="month">This month</option>
          <option value="custom">Custom…</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">From</span>
        <input type="date" max={DATE_MAX} name="from" defaultValue={current.from} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">To</span>
        <input type="date" max={DATE_MAX} name="to" defaultValue={current.to} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Entity</span>
        <Select
          name="location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className={field}
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
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
