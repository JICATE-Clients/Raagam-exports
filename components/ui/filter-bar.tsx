"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/ui/date-range-filter";

/**
 * Compact filter toolbar for every list screen — masters, assign grids and the
 * registers under `app/(app)`. The search box stays visible; the filter
 * <Select>s (passed as children) collapse behind a "Filters" button with an
 * active-count badge, and lay out in a tidy responsive grid when expanded —
 * instead of each dropdown spanning the full page width.
 *
 * It lived in `components/masters/` while masters were its only caller. It sits
 * here now because the registers import it too, and because the thing it
 * renders (`components/ui/date-range-filter.tsx`) was always here.
 *
 * `dateFilter` adds the shared Created Date facet as the LAST cell of that
 * grid — one cell that widens to `col-span-3` while a custom range is open, so
 * its dropdown and two date boxes stay on a single row instead of being split
 * across two by auto-placement (see date-range-filter.tsx).
 * It is rendered here rather than passed in as a child so every list in
 * the app words it, orders it and lays it out identically — the same reason the
 * Status facet lives inside `MasterListShell` — and so a screen with no other
 * facet still gets the "Filters" button. Wire it from `useMasterFilter`'s
 * `dateFilter` bundle; it hides itself when the rows carry no `created_at`.
 */
export function FilterBar({
  search,
  onSearch,
  searchPlaceholder = "Search…",
  children,
  activeCount = 0,
  onReset,
  right,
  searchRef,
  dateFilter,
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  /** The filter <Select> controls, laid out in a responsive grid when open. */
  children?: ReactNode;
  /**
   * The Created Date facet — `useMasterFilter`'s `dateFilter` bundle, optionally
   * with a different `label`/`id`. Omit only where the rows have no creation
   * date at all; `enabled: false` (which the bundle sets itself) hides it.
   */
  dateFilter?: {
    value: string;
    onChange: (v: string) => void;
    enabled?: boolean;
    label?: string;
    id?: string;
  };
  /** Number of filters currently applied — shown as a badge on the button. */
  activeCount?: number;
  onReset?: () => void;
  /** Right-aligned status text (e.g. "3 of 12 · 0 missing"). */
  right?: ReactNode;
  /** Ref to the search input, so a parent can focus it (Ctrl+F shortcut). */
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const showDate = !!dateFilter && dateFilter.enabled !== false;
  const hasFilters = !!children || showDate;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          uppercase
          ref={searchRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full text-base sm:w-64 md:text-sm"
        />

        {hasFilters && (
          /* `size="md"` (h-9), matching the search Input beside it and the
             screen's Add button — LAYOUT.md §10 "The header row". This was
             `size="sm" className="h-9"` for a while: the height was right and
             nothing else was, so the button kept `sm`'s 12px text and 6px icon
             gap. A call site patching one property of a control's size is the
             shape --check text-size-noop exists to catch; --check toolbar-size
             catches this one.

             A plain block comment, not a braced JSX one: inside `cond && ( … )`
             the braces open a second expression beside the element, which is a
             parse error. */
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <SlidersHorizontal />
            Filters
            {activeCount > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        )}

        {activeCount > 0 && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-9 items-center gap-1 px-2 text-sm font-medium text-primary hover:underline"
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </button>
        )}

        <div className="flex-1" />
        {right && <div className="text-xs text-muted-foreground">{right}</div>}
      </div>

      {hasFilters && open && (
        <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {children}
          {/* Last, so adding it never reshuffles the facets a screen already had. */}
          {showDate && (
            <DateRangeFilter
              id={dateFilter!.id}
              label={dateFilter!.label}
              value={dateFilter!.value}
              onChange={dateFilter!.onChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
