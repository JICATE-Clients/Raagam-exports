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
 * The Created Date filter, as ONE cell of `FilterBar`'s panel grid — a cell that
 * WIDENS when it has two date boxes to hold.
 *
 * ## Why it is one cell and not three
 *
 * The panel is a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`, and
 * this used to return a FRAGMENT of three sibling `<div>`s so each landed in a
 * cell of its own. Three independent grid items is exactly what let
 * auto-placement break the control across rows: on Material Attributes, with
 * Item Class and Category ahead of it, the dropdown and From Date filled row 1
 * and **To Date wrapped underneath** — a date range reading as two unrelated
 * fields (client 2026-08-11). Where it broke depended on how many facets the
 * screen put in front of it, so the same control split differently on every
 * screen and no per-screen fix could have been right.
 *
 * The fix is a SPAN, and it works because of a property of CSS Grid rather than
 * a preference: **a multi-column grid item is never SPLIT by auto-placement** —
 * it either fits in the columns left on the current row or moves to the next row
 * whole. `sm:col-span-2 lg:col-span-3` is therefore the entire guarantee. The
 * `sm:grid-cols-3` inside it only decides how the three controls share the space
 * the span already claimed, and it puts each of them on the panel's own column
 * rhythm — so they line up with the facets above and no date box is squeezed to
 * a third of a cell, which is what wrapping all three in one ordinary cell would
 * have done.
 *
 * Two things that look like details:
 *
 *  - **The wrapper is unclassed unless the range is custom.** With no preset, or
 *    a fixed one like "This Month", there is nothing to widen for: it stays a
 *    plain single cell, exactly the width every other facet has, so a screen
 *    that never opens a custom range is untouched.
 *  - **Base keeps `grid-cols-1` and NO span.** The panel is one column on a
 *    phone and everything in it stacks; `col-span-2` there would ask for a
 *    second column that does not exist, generate an implicit one, and break the
 *    panel outright.
 *
 * ## State
 *
 * The two date boxes appear only for "Custom Date Range", which is why the empty
 * custom state has to survive a round trip through the encoded value — see the
 * header of `lib/date-filter.ts`. This component holds NO state of its own; the
 * encoded string is the entire truth, so the same filter can be reset by a
 * parent, restored from a URL, or driven by a test with no coordination.
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
  const custom = preset === "custom";

  const set = (next: { preset: DatePreset | ""; from: string; to: string }) =>
    onChange(encodeDateFilter(next));

  // The resolved window, spelled out under the dropdown. A preset is a promise
  // ("This Month"); this is the promise kept, in DD/MM/YYYY. Not shown for a
  // custom range — it would just echo the two boxes back.
  const summary = preset && !custom ? describeDateFilter(value) : "";

  return (
    <div
      className={
        custom
          ? "grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-3 lg:col-span-3"
          : undefined
      }
    >
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

      {custom && (
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
    </div>
  );
}
