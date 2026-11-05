"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { useAppUser } from "@/lib/auth/permission-context";
import { allScreens } from "@/lib/permissions/screen-catalog";
import {
  actionKeys,
  favoriteAllowed,
  favoriteWellStyle,
  isPinnablePath,
  resolveFavorite,
  screenKey,
} from "@/lib/favorites/registry";
import type { FavoriteSource } from "@/lib/favorites/merge";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * ONE ORDERED LIST OF TILES, EDITED THE SAME WAY EVERYWHERE (0812): the person's Edit sheet on
 * Home and the admin's Home Favourites screen. Tick to show, ↑ ↓ to reorder (buttons, not drag
 * — the keyboard contract has no drag), search to add.
 *
 * - `mode="person"`: a DEFAULT can only be unticked (hidden), never removed — it is the
 *   admin's and would come back; a PIN has a ✕. Candidates are what THIS person may open.
 * - `mode="admin"`: every row has a ✕ and no tick; candidates are every action and every
 *   screen, because the admin is choosing for other people (each still filtered by their own
 *   permission when Home reads it).
 */

export type EditRow = { key: string; source: FavoriteSource; hidden: boolean };

const TAG: Record<FavoriteSource, { text: string; className: string }> = {
  everyone: { text: "For everyone", className: "bg-primary-soft text-primary" },
  role: { text: "From your role", className: "bg-primary-soft text-primary" },
  mine: { text: "Your pin", className: "bg-success-soft text-success" },
};

export function FavoriteListEditor({
  rows,
  onChange,
  mode,
  idPrefix,
}: {
  rows: EditRow[];
  onChange: (rows: EditRow[]) => void;
  mode: "person" | "admin";
  /** Unique per editor on the page, so every control keeps a stable id. */
  idPrefix: string;
}) {
  const user = useAppUser();
  const [query, setQuery] = useState("");

  const inList = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);

  /** What can be added: actions first, then screens matching the search. */
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mayOpen = (key: string) => {
      const item = resolveFavorite(key);
      return !!item && (mode === "admin" || favoriteAllowed(user, item));
    };
    const acts = actionKeys().filter((k) => !inList.has(k) && mayOpen(k));
    const matches = (key: string) => {
      if (!q) return true;
      const it = resolveFavorite(key);
      return !!it && (it.label.toLowerCase().includes(q) || it.where.toLowerCase().includes(q));
    };
    const screens = q
      ? allScreens()
          .filter((s) => s.note !== "unavailable" && isPinnablePath(s.key))
          .map((s) => screenKey(s.key))
          .filter((k) => !inList.has(k) && mayOpen(k) && matches(k))
      : [];
    return [...acts.filter(matches), ...[...new Set(screens)]].slice(0, q ? 10 : 12);
  }, [query, inList, mode, user]);

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="rounded-control border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No tiles yet. Add one below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const item = resolveFavorite(r.key);
            if (!item) return null;
            const Icon = item.icon;
            const id = `${idPrefix}-${i}`;
            const tag = TAG[r.source];
            return (
              <li
                key={r.key}
                className={cn(
                  "flex items-center gap-2.5 rounded-control border border-border bg-surface px-2.5 py-2",
                  r.hidden && "opacity-55",
                )}
              >
                {mode === "person" && (
                  <input
                    id={id}
                    type="checkbox"
                    checked={!r.hidden}
                    onChange={(e) => onChange(rows.map((x) => (x.key === r.key ? { ...x, hidden: !e.target.checked } : x)))}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                    aria-label={`Show ${item.label} on Home`}
                  />
                )}
                <span className="grid size-8 shrink-0 place-items-center rounded-[9px]" style={favoriteWellStyle(item.hue)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <label htmlFor={mode === "person" ? id : undefined} className="min-w-0 flex-1 text-sm font-semibold">
                  {item.label}
                  {mode === "person" && (
                    <span className={cn("ml-1.5 rounded-full px-1.5 py-px align-[1px] text-[10.5px] font-bold", tag.className)}>
                      {tag.text}
                    </span>
                  )}
                  <Truncated text={item.where} className="block text-xs font-normal text-muted-foreground" />
                </label>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${item.label} up`}
                    className="grid size-7 place-items-center rounded-control border border-border text-muted-foreground hover:bg-surface-muted disabled:opacity-35"
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label={`Move ${item.label} down`}
                    className="grid size-7 place-items-center rounded-control border border-border text-muted-foreground hover:bg-surface-muted disabled:opacity-35"
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </button>
                  {(mode === "admin" || r.source === "mine") && (
                    <button
                      type="button"
                      data-row-remove
                      onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                      aria-label={`Remove ${item.label}`}
                      className="grid size-7 place-items-center rounded-control border border-border text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-q`} className="text-xs font-semibold text-muted-foreground">
          Add a tile or a screen
        </label>
        <div className="flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {/* caps-input: exempt -- a search query, not a stored value */}
          <input
            id={`${idPrefix}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screens"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            data-form-type="other"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {query.trim() ? "No screen matches that." : "Everything you can open is already in the list."}
          </p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {candidates.map((k) => {
              const it = resolveFavorite(k)!;
              const Icon = it.icon;
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => onChange([...rows, { key: k, source: mode === "admin" ? "role" : "mine", hidden: false }])}
                    className="flex w-full items-center gap-2 rounded-control bg-surface-muted px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-primary-soft"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-[7px]" style={favoriteWellStyle(it.hue)}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      {it.label}
                      <Truncated text={it.where} className="block text-[11px] font-normal text-muted-foreground" />
                    </span>
                    <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
