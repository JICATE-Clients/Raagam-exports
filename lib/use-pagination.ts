"use client";

import { useMemo, useState } from "react";
import { DEFAULT_PAGE_SIZE, usePageSize } from "@/lib/page-size";

export interface UsePaginationResult<T> {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  paged: T[];
  total: number;
  pageSize: number;
  setPageSize: (pageSize: number) => void;
}

/**
 * Client-side pagination over an already-loaded array. Master screens fetch
 * the full table server-side and filter in-memory, so this just slices —
 * no server round-trip. If the source array shrinks (e.g. delete, or a
 * search narrows the results), `page` clamps to the new last valid page
 * instead of showing an empty page. Changing `pageSize` (e.g. via the
 * PaginationBar's rows-per-page picker) resets back to page 1.
 *
 * THE PAGE SIZE IS THE APP-WIDE ONE (`lib/page-size.ts`) unless a caller PINS
 * it. `usePagination(rows)` reads the operator's "Rows per page" preference and
 * `setPageSize` writes it — so the picker under any one list is the global
 * option, not a local one that forgets itself on the next screen. Eighteen
 * lists used to pass `10` here and each kept its own `useState`; that argument
 * is gone from all of them.
 *
 * `usePagination(rows, n)` pins the size to `n` and keeps `setPageSize` local.
 * `ChildGrid` is the one caller: a grid's `pageSize` prop is part of that
 * grid's layout (how many lines fit beside the totals row), which is not what
 * an operator meant by choosing 50 rows on a listing.
 */
export function usePagination<T>(items: T[], pinnedPageSize?: number): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [globalSize, setGlobalSize] = usePageSize();
  const [localSize, setLocalSize] = useState(pinnedPageSize ?? DEFAULT_PAGE_SIZE);
  const pinned = pinnedPageSize !== undefined;
  const pageSize = pinned ? localSize : globalSize;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  function setPageSize(size: number) {
    if (pinned) setLocalSize(size);
    else setGlobalSize(size);
    setPage(1);
  }

  return { page: safePage, pageCount, setPage, paged, total: items.length, pageSize, setPageSize };
}
