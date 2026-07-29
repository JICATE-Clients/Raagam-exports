"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import type { ReportField } from "@/lib/reports/registry";

export interface FilterOption {
  id: string;
  name: string;
}

export interface ItemFilterOptions {
  locations: FilterOption[];
  stores: FilterOption[];
  itemClasses: FilterOption[];
  categories: FilterOption[];
}

export interface ItemFilterState {
  preset: string;
  from: string;
  to: string;
  location: string;
  store: string;
  itemClass: string;
  category: string;
  groupBy: string;
}

/**
 * Filter bar shared by the item reports. A plain `<form method="get">` so the
 * whole state lives in the URL — the server page re-reads searchParams and
 * re-queries, which keeps the report shareable and bookmarkable and avoids any
 * client-side data fetching.
 *
 * `groupBy` is populated from ITEM_DIMENSIONS plus the material attributes read
 * live from Masters, so a newly-defined attribute becomes a grouping axis here
 * without this component changing.
 */
export function ItemReportFilters({
  options,
  groupByFields,
  current,
  basePath,
  showGroupBy = true,
}: {
  options: ItemFilterOptions;
  groupByFields: ReportField[];
  current: ItemFilterState;
  basePath: string;
  showGroupBy?: boolean;
}) {
  const field =
    "h-8 rounded-md border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // Controlled so the dropdown renders a browsable, arrow-key list (see
  // components/ui/select.tsx) rather than committing on first keystroke.
  const [preset, setPreset] = useState(current.preset);
  const [location, setLocation] = useState(current.location);
  const [store, setStore] = useState(current.store);
  const [itemClass, setItemClass] = useState(current.itemClass);
  const [category, setCategory] = useState(current.category);
  const [groupBy, setGroupBy] = useState(current.groupBy);

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
        <input type="date" name="from" defaultValue={current.from} className={field} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">To</span>
        <input type="date" name="to" defaultValue={current.to} className={field} />
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
          {options.locations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Store</span>
        <Select
          name="store"
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className={field}
        >
          <option value="">All stores</option>
          {options.stores.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Item class</span>
        <Select
          name="itemClass"
          value={itemClass}
          onChange={(e) => setItemClass(e.target.value)}
          className={field}
        >
          <option value="">All classes</option>
          {options.itemClasses.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Category</span>
        <Select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={field}
        >
          <option value="">All categories</option>
          {options.categories.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>

      {showGroupBy && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Group by</span>
          <Select
            name="groupBy"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className={field}
          >
            {groupByFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
      )}

      <button
        type="submit"
        className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground active:scale-95"
      >
        Apply
      </button>
      <Link
        href={basePath}
        className="flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
      >
        Reset
      </Link>
    </form>
  );
}
