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

  /** Add every given key to the selection (legacy "Tag All" over a filtered set). */
  const selectAll = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => new Set([...prev, ...keys]));
  }, []);

  /** Remove every given key from the selection. */
  const deselect = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }, []);

  /** Flip each given key's membership (legacy "Toggle" over a filtered set). */
  const invert = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (next.has(k) ? next.delete(k) : next.add(k)));
      return next;
    });
  }, []);

  const selectedIds = useMemo(() => [...selectedKeys], [selectedKeys]);

  return {
    selectedKeys,
    selectedIds,
    toggle,
    toggleAll,
    clear,
    selectAll,
    deselect,
    invert,
  };
}
