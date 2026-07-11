"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Compact filter toolbar for Master Data list/assign screens. The search box
 * stays visible; the filter <Select>s (passed as children) collapse behind a
 * "Filters" button with an active-count badge, and lay out in a tidy responsive
 * grid when expanded — instead of each dropdown spanning the full page width.
 */
export function FilterBar({
  search,
  onSearch,
  searchPlaceholder = "Search…",
  children,
  activeCount = 0,
  onReset,
  right,
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  /** The filter <Select> controls, laid out in a responsive grid when open. */
  children?: ReactNode;
  /** Number of filters currently applied — shown as a badge on the button. */
  activeCount?: number;
  onReset?: () => void;
  /** Right-aligned status text (e.g. "3 of 12 · 0 missing"). */
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasFilters = !!children;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full text-base sm:w-64 md:text-sm"
        />

        {hasFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
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
        </div>
      )}
    </div>
  );
}
