/**
 * Turn a report page's `searchParams` into the filter set the RPCs expect.
 * Pure and dependency-free so both the server page and the client filter bar can
 * agree on the same defaults.
 */

import type { ItemReportFilters } from "./item-types";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `12m` (default) | `year` | `month` | `custom`. */
export function resolvePeriod(
  preset: string,
  from: string,
  to: string,
): { preset: string; from: string; to: string } {
  const today = new Date();

  if (preset === "custom" && from && to) return { preset, from, to };

  if (preset === "month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { preset, from: iso(start), to: iso(today) };
  }

  if (preset === "year") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return { preset, from: iso(start), to: iso(today) };
  }

  const start = new Date(
    Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()),
  );
  return { preset: "12m", from: iso(start), to: iso(today) };
}

export interface ResolvedItemFilters extends ItemReportFilters {
  preset: string;
  groupBy: string;
}

export function readItemFilters(
  params: SearchParams,
  defaultGroupBy: string,
): ResolvedItemFilters {
  const period = resolvePeriod(one(params.preset), one(params.from), one(params.to));
  return {
    ...period,
    location: one(params.location) || null,
    store: one(params.store) || null,
    itemClass: one(params.itemClass) || null,
    category: one(params.category) || null,
    subCategory: one(params.subCategory) || null,
    item: one(params.item) || null,
    vendor: one(params.vendor) || null,
    groupBy: one(params.groupBy) || defaultGroupBy,
  };
}

/** The shape the client filter bar renders from. */
export function filterState(f: ResolvedItemFilters) {
  return {
    preset: f.preset,
    from: f.from,
    to: f.to,
    location: f.location ?? "",
    store: f.store ?? "",
    itemClass: f.itemClass ?? "",
    category: f.category ?? "",
    groupBy: f.groupBy,
  };
}
