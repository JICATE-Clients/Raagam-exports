"use client";

import { useEffect, useState } from "react";

/**
 * Recently-opened items (checklist "Favorites & Recent Items"). `recordRecent`
 * is called on navigation (e.g. from the search palette) and keeps a short MRU
 * list in localStorage; `useRecent` reads it, re-reading whenever `reloadKey`
 * changes so a host can refresh it on open.
 */
const KEY = "raagam:recent";
const MAX = 8;

export interface RecentItem {
  href: string;
  title: string;
  sub?: string;
}

export function recordRecent(item: RecentItem) {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: RecentItem[] = raw ? JSON.parse(raw) : [];
    const next = [item, ...list.filter((r) => r.href !== item.href)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function useRecent(reloadKey?: unknown): RecentItem[] {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      setRecent(raw ? (JSON.parse(raw) as RecentItem[]) : []);
    } catch {
      setRecent([]);
    }
  }, [reloadKey]);
  return recent;
}
