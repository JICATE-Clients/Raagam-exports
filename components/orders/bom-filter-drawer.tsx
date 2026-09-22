"use client";

import type { ReactNode } from "react";
import { CalendarRange, ChevronDown, Factory, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MATERIAL BOM ▸ THE FILTERS PANEL AS A GROUPED DRAWER (user, 2026-09-21,
 * from the artifact "BOM Filter Drawer").
 *
 * THREE GROUPS, TWO ROWS EACH — Status & dates · Customer & urgency ·
 * Production & BOM. The widest field of a group takes its first row and the two
 * short ones share the second, so nine facets read as three questions rather
 * than a wall of dropdowns.
 *
 * NO TAG ROW AND NO ACTION BAR (user, 2026-09-21: "hide/remove the active
 * filter tags row … keep only the clean dropdown panel"). The chips repeated
 * what the dropdowns already show, and with the bar gone there is no Apply —
 * so a pick filters the queue AT ONCE, as every other facet in the app does.
 * A set dropdown still reads as set (heavier weight, firmer border), and the
 * Filters button's badge counts them. Each facet is cleared by choosing its
 * "All / Any" option; there is no Clear all (Reset was removed from this row
 * earlier at the user's request).
 *
 * NO "SAVE VIEW". The artifact offered one; nothing in the app can store a
 * filter view yet, and a button that does nothing is worse than none.
 *
 * COMPACT BY SPACING, NOT BY TYPE (user, 2026-09-21: "compact tight"). Text
 * sizes are the artifact's; padding, gaps and control heights were cut:
 * groups p-3 → p-2, gaps 2 → 1.5, selects h-8 → h-7, and the whole panel is
 * capped rather than stretched across the pane —
 *
 *   per group: 2 fields × ~140px + 1.5 gap + 2 × p-2  ≈ 312px
 *   three groups + two dividers                        ≈ 940px → max-w-[60rem]
 *
 * THE MATCHING STAYS IN `bom-queue.tsx` (`matchesFacets`) — this file only
 * declares the facet shape and draws the panel.
 */

export type Urgency = "" | "late" | "week" | "month" | "later" | "none";

export const URGENCY_OPTIONS: { value: Exclude<Urgency, "">; label: string }[] = [
  { value: "late", label: "Late" },
  { value: "week", label: "Due within 7 days" },
  { value: "month", label: "Due in 8–30 days" },
  { value: "later", label: "Due after 30 days" },
  { value: "none", label: "No delivery date" },
];

export type QueueFacets = {
  customer: string;
  delivery: string;
  urgency: Urgency;
  orderDate: string;
  qty: "" | "known" | "missing";
  styles: "" | "single" | "multiple";
  started: "" | "none" | "empty" | "lines";
  createdBy: string;
};

export const NO_FACETS: QueueFacets = {
  customer: "",
  delivery: "",
  urgency: "",
  orderDate: "",
  qty: "",
  styles: "",
  started: "",
  createdBy: "",
};

/** The facets plus Status — everything the drawer edits. */
export type BomFilterValues = QueueFacets & { status: string };

type Option = { value: string; label: string; disabled?: boolean };

type FieldDef = {
  key: keyof BomFilterValues;
  label: string;
  all: string;
  options: Option[];
  date?: boolean;
  wide?: boolean;
};

/* `lib/date-filter.ts`'s presets, encoded the same way (`DateRangeFilter`), so
   `matchesCreatedDate` reads the value unchanged. */
const DATE_PRESETS: Option[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom Date Range" },
];

export function BomFilterDrawer({
  value,
  onChange,
  statusOptions,
  customerOptions,
  creatorOptions,
}: {
  /** What the queue is showing now. */
  value: BomFilterValues;
  /** Called on every pick — the queue re-filters at once. */
  onChange: (next: BomFilterValues) => void;
  /** Status WITH counts, in `BOM_STATUS_RANK` order. */
  statusOptions: Option[];
  /** Only what the queue holds — an option that can only produce an empty list
   *  is not offered. */
  customerOptions: string[];
  creatorOptions: string[];
}) {
  const set = (k: keyof BomFilterValues, v: string) => onChange({ ...value, [k]: v });

  const groups: { title: string; icon: ReactNode; fields: FieldDef[] }[] = [
    {
      title: "Status & dates",
      icon: <CalendarRange className="h-3.5 w-3.5" />,
      fields: [
        { key: "status", label: "Status", all: "All statuses", options: statusOptions, wide: true },
        { key: "orderDate", label: "Order Date", all: "Any date", options: DATE_PRESETS, date: true },
        { key: "delivery", label: "Delivery Date", all: "Any date", options: DATE_PRESETS, date: true },
      ],
    },
    {
      title: "Customer & urgency",
      icon: <Users className="h-3.5 w-3.5" />,
      fields: [
        {
          key: "customer",
          label: "Customer",
          all: "All customers",
          options: customerOptions.map((c) => ({ value: c, label: c })),
          wide: true,
        },
        { key: "urgency", label: "Delivery Urgency", all: "Any urgency", options: URGENCY_OPTIONS },
        {
          key: "createdBy",
          label: "Created By",
          all: "Anyone",
          options: creatorOptions.map((c) => ({ value: c, label: c })),
        },
      ],
    },
    {
      title: "Production & BOM",
      icon: <Factory className="h-3.5 w-3.5" />,
      fields: [
        {
          key: "qty",
          label: "Production Qty",
          all: "Any",
          options: [
            { value: "known", label: "Has a quantity" },
            { value: "missing", label: "No quantity yet" },
          ],
          wide: true,
        },
        {
          key: "styles",
          label: "Styles",
          all: "Any",
          options: [
            { value: "single", label: "Single style" },
            { value: "multiple", label: "Multiple styles" },
          ],
        },
        {
          key: "started",
          label: "BOM Started",
          all: "Any",
          options: [
            { value: "none", label: "No BOM yet" },
            { value: "empty", label: "BOM with no lines" },
            { value: "lines", label: "BOM with lines" },
          ],
        },
      ],
    },
  ];

  return (
    <section
      aria-label="Filters"
      className="max-w-[60rem] rounded-lg border border-border bg-surface shadow-xs"
    >
      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {groups.map((g) => (
          <div key={g.title} className="grid min-w-0 content-start gap-1.5 p-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <span className="text-muted-foreground/70">{g.icon}</span>
              {g.title}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {g.fields.map((f) => (
                <FilterField key={f.key} def={f} value={value[f.key]} onChange={(v) => set(f.key, v)} />
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
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `bom-filter-${def.key}`;
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
