"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { today as todayAtFactory } from "@/lib/calendar";
import { DATE_PRESETS, matchesDateWindow, resolveDateWindow } from "@/lib/date-filter";
import { creatorName, hasCreatedInfo } from "@/components/ui/created-columns";

/**
 * THE GROUPED FILTER DRAWER — Material BOM's panel (2026-09-21), lifted out so
 * every Orders child draws the same one (user, 2026-09-23: "we have built the
 * filter ui with logic in material bom now we need to implement it in order
 * module fully child").
 *
 * WHY A PRIMITIVE AND NOT A COPY. AGENTS.md's recurring lesson: the fan-out is
 * always on the hand-rolled half. `BomFilterDrawer` was one component serving
 * one screen with its facets hard-coded inside it, so a second screen could
 * only get the look by copying the file — and the copies drift the week after.
 * Here the LOOK and the MATCHING are one declaration: a screen lists its facets
 * as data (`FacetGroup[]`), and `useFacetFilter` draws the panel, counts the
 * badge and filters the rows from that one list. There is no way to declare a
 * facet the panel shows and the filter ignores, or the reverse.
 *
 * THE PANEL'S RULES, all inherited from Material BOM's drawer and not
 * re-litigated per screen:
 *
 * - Groups of related facets, each titled with an icon; at most three across.
 *   A `wide` facet takes its group's whole row; the rest pair up.
 * - A pick filters AT ONCE — no Apply, no tag row, no "Save view" (nothing can
 *   store a view, and a button that does nothing is worse than none). A set
 *   facet reads as set (heavier weight, firmer border) and the Filters badge
 *   counts it; choosing its "All / Any" clears it.
 * - OPTIONS ARE ONLY WHAT THE ROWS HOLD. A `value` facet offers the distinct
 *   values present, so no option can only ever produce an empty list.
 * - A COUNTED facet shows `(n)` beside every option and disables a zero —
 *   shown, never hidden, so the list does not reshuffle as work moves; the
 *   option currently selected is never disabled.
 * - Date facets use the app's one date vocabulary (`lib/date-filter.ts`), so
 *   "This Month" means the same thing here as in every Created Date filter.
 *
 * Compact by spacing, not by type: 10px labels, 28px selects, p-2 groups, and
 * the panel capped at ~20rem per group rather than stretched across the pane:
 *   per group: 2 fields × ~140px + 1.5 gap + 2 × p-2 ≈ 312px → 20rem.
 */

export type FacetOption = { value: string; label: string };

export type FacetDef<R> = {
  key: string;
  label: string;
  /** The "no filter" option's wording. Default "All". */
  all?: string;
  /** Takes the group's full row. */
  wide?: boolean;
  /** A DATE facet — the row's ISO date or timestamp; offered the shared
   *  presets and a custom From / To range. */
  date?: (r: R) => string | Date | null | undefined;
  /** A VALUE facet — options are the distinct values the rows hold, sorted;
   *  a row matches on equality (trimmed). */
  value?: (r: R) => string | null | undefined;
  /** A BUCKETED facet — explicit options and the test for each. */
  options?: FacetOption[];
  match?: (r: R, v: string) => boolean;
  /** Show `(n)` beside each option and disable a zero. Bucketed options keep
   *  their declared order (an order of work); value facets sort A→Z. */
  counted?: boolean;
};

export type FacetGroup<R> = {
  title: string;
  icon?: ReactNode;
  facets: FacetDef<R>[];
};

export type FacetValues = Record<string, string>;

type DrawnOption = FacetOption & { disabled?: boolean };
type DrawnField = {
  key: string;
  label: string;
  all: string;
  wide?: boolean;
  date?: boolean;
  options: DrawnOption[];
};

/* ───────────────────────── shared facet builders ───────────────────────── */

/** Days from the factory's today to an ISO date; null for no date. The same
 *  arithmetic as `DaysOut` on a queue card, so a "· 4d" and "Due within 7
 *  days" can never disagree. */
export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  return Math.round((at - now) / 86_400_000);
}

export const URGENCY_OPTIONS: FacetOption[] = [
  { value: "late", label: "Late" },
  { value: "week", label: "Due within 7 days" },
  { value: "month", label: "Due in 8–30 days" },
  { value: "later", label: "Due after 30 days" },
  { value: "none", label: "No delivery date" },
];

export function matchesUrgency(iso: string | null | undefined, u: string): boolean {
  if (!u) return true;
  const d = daysFromToday(iso);
  if (u === "none") return d == null;
  if (d == null) return false;
  if (u === "late") return d < 0;
  if (u === "week") return d >= 0 && d <= 7;
  if (u === "month") return d > 7 && d <= 30;
  return d > 30;
}

/** "Delivery Urgency" over whichever date a row is due by. */
export function urgencyFacet<R>(
  get: (r: R) => string | null | undefined,
  label = "Delivery Urgency",
  key = "urgency",
): FacetDef<R> {
  return {
    key,
    label,
    all: "Any urgency",
    options: URGENCY_OPTIONS,
    match: (r, v) => matchesUrgency(get(r), v),
  };
}

/** "Created Date" — reads `created_at` unless told otherwise. */
export function createdDateFacet<R>(
  get: (r: R) => string | Date | null | undefined = (r) =>
    (r as { created_at?: string | null }).created_at,
): FacetDef<R> {
  return { key: "createdDate", label: "Created Date", all: "Any date", date: get };
}

/** "Created By" — `creatorName`, which never returns a uuid, so a row whose
 *  creator is unknown matches only "Anyone", never a blank option. */
export function createdByFacet<R>(): FacetDef<R> {
  return { key: "createdBy", label: "Created By", all: "Anyone", value: (r) => creatorName(r) };
}

/** A yes / no facet over one predicate. */
export function flagFacet<R>(
  key: string,
  label: string,
  test: (r: R) => boolean,
  yes: string,
  no: string,
): FacetDef<R> {
  return {
    key,
    label,
    all: "Any",
    options: [
      { value: "yes", label: yes },
      { value: "no", label: no },
    ],
    match: (r, v) => (v === "yes" ? test(r) : !test(r)),
  };
}

/**
 * The Created pair as a group — only when the rows carry `created_at`
 * (`hasCreatedInfo`), the same guard `withCreatedColumns` applies to a table,
 * so a service that does not select it offers no filter that matches nothing.
 */
export function createdGroup<R>(rows: R[], icon?: ReactNode): FacetGroup<R>[] {
  if (!hasCreatedInfo(rows)) return [];
  return [{ title: "Created", icon, facets: [createdDateFacet<R>(), createdByFacet<R>()] }];
}

/* ─────────────────────────────── the hook ─────────────────────────────── */

const NO_VALUES: FacetValues = {};

function distinctSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function facetMatches<R>(f: FacetDef<R>, r: R, v: string): boolean {
  if (!v) return true;
  if (f.date) return matchesDateWindow(f.date(r), resolveDateWindow(v));
  if (f.match) return f.match(r, v);
  if (f.value) return (f.value(r) ?? "").trim() === v;
  return true;
}

/** Is this value actually filtering? An open-but-empty custom range
 *  (`"custom::"`) is a UI state, not a filter — it never lights the badge. */
function isActive<R>(f: FacetDef<R>, v: string | undefined): boolean {
  if (!v) return false;
  return f.date ? resolveDateWindow(v) != null : true;
}

/**
 * Facet state + matching + the drawn panel, from one declaration.
 *
 * `matches(row)` is the facet test only — the screen composes it with its own
 * search box, so the search keeps whatever haystack that screen already had.
 * `panel` goes straight into `<FilterBar panel={…}>`, `activeCount` into its
 * badge.
 *
 * COUNTS ARE OVER `rows`, not over the already-filtered list, so an option's
 * `(n)` does not collapse to zero the moment a second facet is set — the same
 * reading the BOM Status facet has always had.
 */
export function useFacetFilter<R>(
  rows: R[],
  groups: FacetGroup<R>[],
  /**
   * WHERE THE LIST OPENS — e.g. Budget Approval opens on "Awaiting approval".
   * Reset returns HERE, not to empty, and the badge counts only what differs
   * from it: the page's own default is not a filter the operator applied.
   * Pass a module constant.
   */
  initial: FacetValues = NO_VALUES,
) {
  const [values, setValues] = useState<FacetValues>(initial);

  const facets = useMemo(() => groups.flatMap((g) => g.facets), [groups]);

  const drawn = useMemo(
    () =>
      groups
        .map((g) => ({
          title: g.title,
          icon: g.icon,
          fields: g.facets.map((f): DrawnField => {
            const selected = values[f.key] ?? "";
            if (f.date) {
              return { key: f.key, label: f.label, all: f.all ?? "Any date", wide: f.wide, date: true, options: DATE_PRESETS };
            }
            const base: FacetOption[] =
              f.options ??
              distinctSorted(rows.map((r) => f.value?.(r))).map((v) => ({ value: v, label: v }));
            const options: DrawnOption[] = f.counted
              ? base.map((o) => {
                  const n = rows.filter((r) => facetMatches(f, r, o.value)).length;
                  return { ...o, label: `${o.label} (${n})`, disabled: n === 0 && o.value !== selected };
                })
              : base;
            return {
              key: f.key,
              label: f.label,
              all: f.counted ? `${f.all ?? "All"} (${rows.length})` : (f.all ?? "All"),
              wide: f.wide,
              options,
            };
          }),
        }))
        .filter((g) => g.fields.length > 0),
    [groups, rows, values],
  );

  const activeCount = facets.filter(
    (f) => (values[f.key] ?? "") !== (initial[f.key] ?? "") && (isActive(f, values[f.key]) || !!initial[f.key]),
  ).length;

  /* STABLE while nothing changes, so a caller's `useMemo(filtered)` can list
     it as a dependency. Pass `groups` as a module constant or a `useMemo` —
     an inline array re-creates it every render (correct, just unmemoised). */
  const matches = useCallback(
    (r: R) => facets.every((f) => facetMatches(f, r, values[f.key] ?? "")),
    [facets, values],
  );

  const set = useCallback((key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v })), []);
  const reset = useCallback(() => setValues(initial), [initial]);

  const panel = drawn.length > 0 ? <FilterDrawer groups={drawn} values={values} onChange={set} /> : undefined;

  return { values, set, reset, matches, activeCount, panel };
}

/* ─────────────────────────────── the panel ─────────────────────────────── */

const COLS: Record<number, string> = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" };
const CAP: Record<number, string> = { 1: "max-w-[20rem]", 2: "max-w-[40rem]", 3: "max-w-[60rem]" };

function FilterDrawer({
  groups,
  values,
  onChange,
}: {
  groups: { title: string; icon?: ReactNode; fields: DrawnField[] }[];
  values: FacetValues;
  onChange: (key: string, v: string) => void;
}) {
  /* THREE GROUPS AT MOST is the width the panel was measured at — a screen
     with more to say folds it into three questions, as Material BOM did. */
  const across = Math.min(groups.length, 3);
  return (
    <section
      aria-label="Filters"
      className={cn("rounded-lg border border-border bg-surface shadow-xs", CAP[across])}
    >
      <div
        className={cn(
          "grid grid-cols-1 divide-y divide-border lg:divide-x lg:divide-y-0",
          COLS[across],
        )}
      >
        {groups.map((g) => (
          <div key={g.title} className="grid min-w-0 content-start gap-1.5 p-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              {g.icon && <span className="text-muted-foreground/70 [&>svg]:h-3.5 [&>svg]:w-3.5">{g.icon}</span>}
              {g.title}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {g.fields.map((f) => (
                <FilterField
                  key={f.key}
                  def={f}
                  value={values[f.key] ?? ""}
                  onChange={(v) => onChange(f.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One field: a 10px label, a 28px select with a chevron, and — on a date field
 * set to "Custom Date Range" — a From / To pair beneath it.
 *
 * A RAW `<select>`, so it sets the autofill opt-outs itself (AGENTS.md "Browser
 * autofill"): the `Select` primitive is `h-9` with its own chevron, and this
 * panel is `h-7` by design.
 */
function FilterField({
  def,
  value,
  onChange,
}: {
  def: DrawnField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `filter-${def.key}`;
  const custom = !!def.date && value.startsWith("custom");
  const [, from = "", to = ""] = custom ? value.split(":") : [];

  return (
    <div className={cn("grid min-w-0 gap-0.5", def.wide && "col-span-2")}>
      <label htmlFor={id} className="text-[10px] font-medium uppercase text-muted-foreground">
        {def.label}
      </label>
      <div className="relative">
        <select
          id={id}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={custom ? "custom" : value}
          onChange={(e) => onChange(e.target.value === "custom" ? "custom::" : e.target.value)}
          className={cn(
            "h-7 w-full appearance-none rounded-md border bg-surface pl-2 pr-7 text-xs text-foreground",
            "transition-colors hover:border-border-strong",
            "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15",
            value ? "border-border-strong font-medium" : "border-border",
          )}
        >
          <option value="">{def.all}</option>
          {def.options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled && o.value !== value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
      </div>
      {custom && (
        <div className="mt-0.5 grid grid-cols-2 gap-1">
          <input
            type="date"
            aria-label={`${def.label} from`}
            value={from}
            max={to || undefined}
            onChange={(e) => onChange(`custom:${e.target.value}:${to}`)}
            className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground hover:border-border-strong"
          />
          <input
            type="date"
            aria-label={`${def.label} to`}
            value={to}
            min={from || undefined}
            onChange={(e) => onChange(`custom:${from}:${e.target.value}`)}
            className="h-7 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground hover:border-border-strong"
          />
        </div>
      )}
    </div>
  );
}
