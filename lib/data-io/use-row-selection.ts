"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Row-selection state for a `DataTable` with `selectable`. Keys are the row's
 * `getKey` value (the record id). Provides toggle / select-all / clear plus the
 * flat `selectedIds` list that bulk actions consume.
 */
export function useRowSelection() {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Toggle all: clears if every key is already selected, else selects all. */
  const toggleAll = useCallback((allKeys: string[]) => {
    setSelectedKeys((prev) =>
      prev.size === allKeys.length ? new Set() : new Set(allKeys),
    );
  }, []);

  const clear = useCallback(() => setSelectedKeys(new Set()), []);

  const selectedIds = useMemo(() => [...selectedKeys], [selectedKeys]);

  return { selectedKeys, selectedIds, toggle, toggleAll, clear };
}
