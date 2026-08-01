"use client";

import { useCallback, useMemo, useState } from "react";
import { matchesDateWindow, resolveDateWindow } from "@/lib/date-filter";

/**
 * The Created Date facet for a screen that does NOT use `useMasterFilter`.
 *
 * Screens built on `useMasterFilter` get this facet built in and should not
 * reach for this hook — it exists for the dozen or so list screens that predate
 * that hook and still hand-roll `useState(query) + useMemo(filtered)`: the GST
 * and HSN assign grids, and the Sales registers. Without it each of those would
 * carry its own copy of "resolve the preset, compare in the factory's timezone,
 * and don't count an empty Custom range", which is exactly how two screens end
 * up disagreeing about what "This Month" means.
 *
 * Three lines at a call site:
 *
 *   const dt = useCreatedDateFilter(rows);
 *   const filtered = useMemo(() => rows.filter(dt.matches).filter(…), [rows, dt.matches]);
 *   <FilterBar dateFilter={dt.bind} activeCount={n + dt.active} …>
 *
 * `dt.matches` is stable until the chosen range changes, so it belongs in the
 * memo's dependency list — that is what makes picking a date re-filter at all.
 */
export function useCreatedDateFilter<T>(
  rows: T[],
  /** Row → its creation timestamp. Defaults to `row.created_at`. */
  createdAt?: (row: T) => string | Date | null | undefined,
) {
  const [value, setValue] = useState("");

  const read =
    createdAt ?? ((r: T) => (r as { created_at?: string | null } | null)?.created_at);

  // Derived from the data, never declared: a service that lists its columns by
  // hand may not fetch `created_at`, and a filter that silently matches nothing
  // is worse than no filter. See `useMasterFilter` for the same reasoning.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enabled = useMemo(() => rows.some((r) => read(r) != null), [rows]);

  // Resolved ONCE per range change, not per row — `today()` runs an Intl
  // formatter — and every row is then judged against the same instant, so a
  // pass that straddles midnight cannot file two rows on different days.
  const window = useMemo(() => resolveDateWindow(value), [value]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useCallback((row: T) => matchesDateWindow(read(row), window), [window]);

  // An open-but-empty Custom range is a UI state, not a filter — ask the
  // resolved window, never `!!value`, or the badge lights up over nothing.
  const active = window ? 1 : 0;

  return {
    value,
    matches,
    active,
    reset: useCallback(() => setValue(""), []),
    /** Spread straight onto `<FilterBar dateFilter={…}>`. */
    bind: { value, onChange: setValue, enabled },
  };
}
