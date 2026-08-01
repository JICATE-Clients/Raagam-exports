"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DATE_PRESETS,
  decodeDateFilter,
  describeDateFilter,
  encodeDateFilter,
  type DatePreset,
} from "@/lib/date-filter";

/**
 * The Created Date filter, as a row of `FilterBar` grid cells.
 *
 * It renders a FRAGMENT, not a wrapper — `FilterBar`'s panel is a
 * `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`, so each `<div>`
 * here has to be a direct grid child to line up with the Status and extra
 * facets beside it. Wrapping them would make the whole control one cell and
 * squeeze three fields into a quarter of the row.
 *
 * The two date boxes appear only for "Custom Date Range", which is why the
 * empty custom state has to survive a round trip through the encoded value —
 * see the header of `lib/date-filter.ts`. This component holds NO state of its
 * own; the encoded string is the entire truth, so the same filter can be reset
 * by a parent, restored from a URL, or driven by a test with no coordination.
 */
export function DateRangeFilter({
  id = "filter-created",
  label = "Created Date",
  value,
  onChange,
}: {
  /** Prefix for the three field ids — unique per screen if two lists share a page. */
  id?: string;
  /** Defaults to "Created Date"; override only if the column means something else. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { preset, from, to } = decodeDateFilter(value);

  const set = (next: { preset: DatePreset | ""; from: string; to: string }) =>
    onChange(encodeDateFilter(next));

  // The resolved window, spelled out under the dropdown. A preset is a promise
  // ("This Month"); this is the promise kept, in DD/MM/YYYY. Not shown for a
  // custom range — it would just echo the two boxes back.
  const summary = preset && preset !== "custom" ? describeDateFilter(value) : "";

  return (
    <>
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Select
          id={id}
          value={preset}
          onChange={(e) => {
            const next = e.target.value as DatePreset | "";
            // Leaving Custom drops the dates with it, so re-picking Custom
            // starts blank instead of silently re-applying a range the operator
            // last saw two filters ago.
            set(next === "custom" ? { preset: next, from, to } : { preset: next, from: "", to: "" });
          }}
          className="text-base md:text-sm"
        >
          <option value="">All</option>
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        {summary && <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>}
      </div>

      {preset === "custom" && (
        <>
          <div>
            <Label htmlFor={`${id}-from`}>From Date</Label>
            {/* `max`/`min` keep the two boxes from crossing while clicking. A
                typed date can still cross them; resolveDateWindow swaps it. */}
            <Input
              id={`${id}-from`}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => set({ preset: "custom", from: e.target.value, to })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-to`}>To Date</Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => set({ preset: "custom", from, to: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
        </>
      )}
    </>
  );
}
