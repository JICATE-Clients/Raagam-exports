"use client";

import { useDeferredValue, useMemo, useState } from "react";

/**
 * Search + faceted-filter state for a Master Data list screen. Generalizes
 * the `useState(query) + useMemo(filtered)` block every `*-master-screen.tsx`
 * used to hand-roll, and adds the same dropdown-filter shape
 * `material-hsn-assign-screen.tsx` already wires by hand — pair with
 * `FilterBar` (search/onSearch/activeCount/onReset) for the UI.
 *
 * Two things make typing in the search box cheap, both of which matter because
 * every master list is loaded whole and filtered in memory:
 *
 * 1. `useDeferredValue` on the query. The input echoes the keystroke at once
 *    (it renders from `query`), while the expensive re-filter runs at a lower
 *    priority from `deferredQuery` and is interruptible. Filtering used to run
 *    synchronously on every keystroke.
 * 2. `searchKey` (preferred over `search`) lets the haystack be built ONCE per
 *    data change instead of once per row per keystroke. With `search`, a
 *    callback like `(r, q) => searchText(r).toLowerCase().includes(q)` re-ran
 *    `searchText` — often a template string over several columns — and
 *    re-lowercased it for every row on every keystroke.
 *
 * `isStale` is true while the visible rows still reflect an older query, so a
 * caller can dim the table rather than silently showing results that don't match
 * what the operator just typed.
 */
export function useMasterFilter<T, F extends Record<string, string> = Record<string, never>>(
  rows: T[],
  config: {
    /**
     * Return true if `row` matches the lowercased, trimmed free-text `query`.
     * Prefer `searchKey` — it lets the haystack be memoized.
     */
    search?: (row: T, query: string) => boolean;
    /**
     * Row → its full searchable text. Lowercased and cached per row until `rows`
     * changes. Takes precedence over `search`.
     */
    searchKey?: (row: T) => string;
    /** One predicate per facet key; only applied when that facet has a value. */
    filters?: { [K in keyof F]: (row: T, value: F[K]) => boolean };
    initialFilters?: F;
  },
) {
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<F>(config.initialFilters ?? ({} as F));

  // Filtering lags typing by design — see the doc comment above.
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  /*
   * Per-row search text, cached in a WeakMap that lives for the hook's lifetime.
   *
   * Keying on the row OBJECT rather than memoizing an array is what makes this
   * robust: callers pass an inline `searchKey: d.searchText` whose identity
   * changes every render, so any `useMemo([..., config.searchKey])` would rebuild
   * constantly — the exact cost being removed here. A row's text is instead
   * computed once for the lifetime of that object, and rows are replaced
   * wholesale by the server on `router.refresh()`, so a changed record gets a new
   * object and is recomputed. Nothing to invalidate by hand.
   */
  const [textCache] = useState(() => new WeakMap<object, string>());

  const filtered = useMemo(() => {
    let out = rows;
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      const searchKey = config.searchKey;
      if (searchKey) {
        out = rows.filter((r) => {
          const key = r as object;
          let text = textCache.get(key);
          if (text === undefined) {
            text = searchKey(r).toLowerCase();
            textCache.set(key, text);
          }
          return text.includes(q);
        });
      } else if (config.search) {
        out = rows.filter((r) => config.search!(r, q));
      }
    }
    for (const key of Object.keys(config.filters ?? {}) as (keyof F)[]) {
      const val = filterValues[key];
      if (val) out = out.filter((r) => config.filters![key](r, val));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, deferredQuery, filterValues, textCache]);

  const activeCount = Object.values(filterValues).filter(Boolean).length;

  function setFilter(key: keyof F, value: string) {
    setFilterValues((f) => ({ ...f, [key]: value }));
  }
  function reset() {
    setQuery("");
    setFilterValues(config.initialFilters ?? ({} as F));
  }

  return { query, setQuery, filterValues, setFilter, filtered, activeCount, reset, isStale };
}
