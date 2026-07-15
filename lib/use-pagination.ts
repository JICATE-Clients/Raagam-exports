"use client";

import { useMemo, useState } from "react";

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
 */
export function usePagination<T>(items: T[], initialPageSize = 10): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  function setPageSize(size: number) {
    setPageSizeState(size);
    setPage(1);
  }

  return { page: safePage, pageCount, setPage, paged, total: items.length, pageSize, setPageSize };
}
