"use client";

import { useMemo, useState } from "react";

/**
 * Search + faceted-filter state for a Master Data list screen. Generalizes
 * the `useState(query) + useMemo(filtered)` block every `*-master-screen.tsx`
 * used to hand-roll, and adds the same dropdown-filter shape
 * `material-hsn-assign-screen.tsx` already wires by hand — pair with
 * `FilterBar` (search/onSearch/activeCount/onReset) for the UI.
 */
export function useMasterFilter<T, F extends Record<string, string> = Record<string, never>>(
  rows: T[],
  config: {
    /** Return true if `row` matches the lowercased, trimmed free-text `query`. */
    search: (row: T, query: string) => boolean;
    /** One predicate per facet key; only applied when that facet has a value. */
    filters?: { [K in keyof F]: (row: T, value: F[K]) => boolean };
    initialFilters?: F;
  },
) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<F>(config.initialFilters ?? ({} as F));

  const filtered = useMemo(() => {
    let out = rows;
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((r) => config.search(r, q));
    for (const key of Object.keys(config.filters ?? {}) as (keyof F)[]) {
      const val = filterValues[key];
      if (val) out = out.filter((r) => config.filters![key](r, val));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filterValues]);

  const activeCount = Object.values(filterValues).filter(Boolean).length;

  function setFilter(key: keyof F, value: string) {
    setFilterValues((f) => ({ ...f, [key]: value }));
  }
  function reset() {
    setQuery("");
    setFilterValues(config.initialFilters ?? ({} as F));
  }

  return { query, setQuery, filterValues, setFilter, filtered, activeCount, reset };
}
