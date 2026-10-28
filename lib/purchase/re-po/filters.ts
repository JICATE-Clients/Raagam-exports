/**
 * THE FILTERS ON PO FROM REQUIREMENT (user 2026-10-26, canvas "PO Order Filters"
 * v6: one row of pills, reordered 2026-10-28 — PO Type · Order Type · Buyer ·
 * Orders · Item Class · Category · Vendor │ Order by · Budget · Progress; the
 * chain from Buyer to Vendor narrows top-down only). Each filter is there to stop one mistake, and the
 * rules live here, pure, so the screen and `scripts/check-re-po-filters.mts`
 * read one definition:
 *
 * - **Order by** — material arriving after the order ships. The day to order is
 *   the ship date less the vendor's lead days less `INSPECTION_DAYS`.
 * - **Budget** — one order with no approved budget sends the WHOLE PO to the MD
 *   and holds the other orders on it up; filtering lets those go on their own PO.
 * - **Type · Buyer · Category** — picking a look-alike number.
 * - **Progress** — re-ordering what a colleague already part-ordered.
 * - **Orders** — going straight to one number among many (user 2026-10-26: a pill
 *   after Item Class listing the RE / SWO / IWO numbers the filters before it leave).
 *
 * EVERY FILTER IS MULTI-SELECT (user 2026-10-26: "Multi-Select dropdowns/chips for
 * all primary filter fields"). A group with nothing chosen lets everything through;
 * several chosen in one group mean ANY of them (RE or SWO), and the groups AND
 * together (RE or SWO, and Late).
 *
 * TWO RULES EVERY COUNT OBEYS. A choice's count is the orders it would leave with
 * every OTHER filter applied (`countFor` skips its own group), so a choice that
 * reads 0 really would empty the list — the screen greys it. And a TICKED order is
 * never filtered out: filters narrow the list being picked from, never the PO.
 */
import type { RequirementLine, SourceKind } from "./types";

/** Between the material arriving and it being ready to cut (user 2026-10-26: 7 accepted). */
export const INSPECTION_DAYS = 7;

export type OrderByBand = "late" | "week" | "fortnight" | "later" | "nodate";
export const ORDER_BY_BANDS: { value: OrderByBand; label: string }[] = [
  { value: "late", label: "Late" },
  { value: "week", label: "Within 7 days" },
  { value: "fortnight", label: "8–14 days" },
  { value: "later", label: "Later" },
  { value: "nodate", label: "No ship date" },
];

export type BudgetState = "ok" | "none";
export const BUDGET_STATES: { value: BudgetState; label: string }[] = [
  { value: "ok", label: "Approved" },
  { value: "none", label: "No approved budget" },
];

export type Progress = "new" | "part";
export const PROGRESS_STATES: { value: Progress; label: string }[] = [
  { value: "new", label: "Not ordered yet" },
  { value: "part", label: "Part ordered" },
];

export const KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: "re", label: "RE" },
  { value: "swo", label: "SWO" },
  { value: "iwo", label: "IWO" },
];

/** An SWO's / IWO's `customer` holds its season or style ref, not a buyer (0740). */
export const NO_BUYER = "__none__";

/** A draft PO already holding part of an order's balance — drafts count as ordered (0748 `ord`). */
export type DraftHold = { source_id: string; req_key: string; code: string; by: string | null };

/** One order as the filters see it, within the chosen item class. */
export type OrderFacts = {
  id: string;
  no: string;
  kind: SourceKind;
  /** The RE's buyer; NULL on an SWO / IWO. */
  buyer: string | null;
  /** What the second line under the number reads — the buyer, or the SWO / IWO's own note. */
  note: string | null;
  shipDate: string | null;
  categoryIds: Set<string>;
  lines: number;
  budget: BudgetState;
  progress: Progress;
  /** The first draft PO holding a line of this order, if any. */
  held: { code: string; by: string | null } | null;
};

export type FilterState = {
  /** Order ids — narrows the tick list to them. */
  order: string[];
  orderBy: OrderByBand[];
  kind: SourceKind[];
  category: string[];
  budget: BudgetState[];
  buyer: string[];
  progress: Progress[];
};
export const NO_FILTERS: FilterState = { order: [], orderBy: [], kind: [], category: [], budget: [], buyer: [], progress: [] };
export type FilterKey = keyof FilterState;

/** Is any filter group narrowing the list? (An empty group is not.) */
export const hasFilters = (f: FilterState) => Object.values(f).some((v: readonly string[]) => v.length > 0);

/**
 * The orders of one class, one row each. `budgeted` holds the line keys
 * `po_budget_check` matched to an approved budget line — an order is "ok" only
 * when EVERY line of it in this class is, because one unmatched line is enough
 * to send the PO to the MD.
 */
export function orderFacts(
  classLines: readonly RequirementLine[],
  budgeted: ReadonlySet<string>,
  holds: readonly DraftHold[],
  lineKey: (l: RequirementLine) => string,
): OrderFacts[] {
  const by = new Map<string, RequirementLine[]>();
  for (const l of classLines) by.set(l.source_id, [...(by.get(l.source_id) ?? []), l]);
  const keys = new Set(classLines.map(lineKey));
  return [...by.entries()]
    .map(([id, ls]) => {
      const first = ls[0];
      const hold = holds.find((h) => h.source_id === id && keys.has(`${h.source_id}::${h.req_key}`));
      return {
        id,
        no: first.source_no,
        kind: first.source_kind,
        buyer: first.source_kind === "re" ? first.customer : null,
        note: first.customer,
        shipDate: first.delivery_date,
        categoryIds: new Set(ls.map((l) => l.category_id).filter((c): c is string => !!c)),
        lines: ls.length,
        budget: ls.every((l) => budgeted.has(lineKey(l))) ? "ok" : "none",
        progress: ls.some((l) => l.ordered_qty > 0) ? "part" : "new",
        held: hold ? { code: hold.code, by: hold.by } : null,
      } satisfies OrderFacts;
    })
    // NUMBER ORDER (user 2026-10-27, screenshot 3762: "order number is showing in mixed
    // format … make properly aligned number wise listing"). It was ship date first, so
    // RE/0002 sat above RE/0001. Numeric collation reads 0002 < 0010 < 0100 even unpadded;
    // the "Order by" filter is still how the urgent ones are found.
    .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true, sensitivity: "base" }));
}

const dayNo = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** Days left to raise the PO in time — negative = already late. NULL without a ship date. */
export function daysToOrder(shipDate: string | null, todayIso: string, leadDays: number): number | null {
  if (!shipDate) return null;
  return dayNo(shipDate) - dayNo(todayIso) - leadDays - INSPECTION_DAYS;
}

export function orderByBand(days: number | null): OrderByBand {
  if (days == null) return "nodate";
  if (days < 0) return "late";
  if (days <= 7) return "week";
  if (days <= 14) return "fortnight";
  return "later";
}

/** The value each filter reads off an order. */
function valueOf(o: OrderFacts, k: Exclude<FilterKey, "category">, band: OrderByBand): string {
  switch (k) {
    case "order":
      return o.id;
    case "orderBy":
      return band;
    case "kind":
      return o.kind;
    case "budget":
      return o.budget;
    case "buyer":
      return o.buyer ?? NO_BUYER;
    case "progress":
      return o.progress;
  }
}

/** Does the order pass every filter (but `skip`)? `band` is its Order by band. */
export function passes(o: OrderFacts, f: FilterState, band: OrderByBand, skip?: FilterKey): boolean {
  for (const k of Object.keys(f) as FilterKey[]) {
    const chosen: readonly string[] = f[k];
    if (k === skip || chosen.length === 0) continue;
    if (k === "category" ? !chosen.some((c) => o.categoryIds.has(c)) : !chosen.includes(valueOf(o, k, band))) return false;
  }
  return true;
}

/** How many orders `value` alone in group `k` would leave, the other groups applied. */
export function countFor(
  orders: readonly OrderFacts[],
  bands: ReadonlyMap<string, OrderByBand>,
  f: FilterState,
  k: FilterKey,
  value: string,
): number {
  const probe = { ...f, [k]: [value] } as FilterState;
  return orders.filter((o) => passes(o, probe, bands.get(o.id) ?? "nodate")).length;
}

/** The list to pick from: ticked orders first (always), then every order the filters let through. */
export function visibleOrders(
  orders: readonly OrderFacts[],
  bands: ReadonlyMap<string, OrderByBand>,
  f: FilterState,
  ticked: readonly string[],
): { ticked: OrderFacts[]; rest: OrderFacts[] } {
  const t = new Set(ticked);
  return {
    ticked: ticked.map((id) => orders.find((o) => o.id === id)).filter((o): o is OrderFacts => !!o),
    rest: orders.filter((o) => !t.has(o.id) && passes(o, f, bands.get(o.id) ?? "nodate")),
  };
}

/** Add days to an ISO date — a line's default delivery is the PO date plus the vendor's lead days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}
