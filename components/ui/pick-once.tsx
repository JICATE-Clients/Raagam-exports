"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * PICK ONCE, DECLARED ON THE GRID COLUMN (user 2026-11-02: "globally don't allow duplicates
 * in any entry in the application").
 *
 * A repeating grid over master data asks one question per row, so the same value on two rows
 * is duplication, not data. `DataPicker` always had the rule (`usedIds`), but every screen
 * had to compute the set and pass it, and 32 of 47 picker grids never did. Now a
 * `ChildGrid` column declares `unique: (row) => row.itemId`; the grid gathers that column's
 * values over EVERY row and hands them to the cell through this context, and the pickers
 * (`DataPicker` and everything built on it, `Combobox` and the `<Select>` built on that) read
 * it. A screen writes one prop; nothing is wired per cell.
 *
 * NOT EVERY GRID: five contacts in Marketing, three addresses in one city, the same item in
 * two colours on a BOM are real repeats. Those columns say so with
 * `// pick-once: exempt -- <reason>`, and `npm run check:pick-once` (inside `build:check`)
 * refuses a picker column that says neither.
 *
 * RESET AT EVERY PORTAL, like `RequiredScope`: context follows the RENDER tree, so a
 * quick-create sheet opened from a unique cell would otherwise block its own pickers'
 * values. `Sheet` and the `DataPicker` panel each open a clean scope.
 */
const PickOnceCtx = createContext<ReadonlySet<string> | null>(null);

export function PickOnceScope({ used, children }: { used: ReadonlySet<string> | null; children: ReactNode }) {
  return <PickOnceCtx.Provider value={used}>{children}</PickOnceCtx.Provider>;
}

/** The values the sibling rows already hold (this row's own included) — null outside a unique column. */
export function usePickOnce(): ReadonlySet<string> | null {
  return useContext(PickOnceCtx);
}
