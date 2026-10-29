import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { MODULE_LABELS, type Module } from "@/lib/auth/types";
import { startOfMonth, today } from "@/lib/calendar";
import { windowLabel } from "@/lib/dashboard/range";
import {
  DASHBOARD_RANGES,
  RANGE_LABELS,
  type DashboardFilters,
  type DashboardRange,
} from "@/lib/dashboard/types";
import { AutoRefresh } from "./auto-refresh";
import { CustomRangeForm } from "./custom-range-form";
import { GLASS } from "./glass";

/** Query values a link must carry so it changes ONE thing — see RangeTabs. */
export type Carry = Record<string, string | undefined>;

/** `/` with `carry` plus `set` — an unset value is dropped, never sent empty. */
export function dashHref(carry: Carry, set: Carry = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...carry, ...set })) if (v) params.set(k, v);
  const q = params.toString();
  return q ? `/?${q}` : "/";
}

/**
 * The range selector: links, not a GET form.
 *
 * A `<form method="get">` submitting from `/` drops every other query
 * parameter, which would silently swallow `?denied=` — the permission notice
 * that `requirePermission()` redirects here specifically to show. Links let us
 * carry it through explicitly, and `<Link>` prefetches so the switch feels
 * immediate where a form submit would not.
 *
 * "Custom" opens on this month to date — the dates the operator most often
 * narrows from — and the toolbar's date form takes it from there.
 */
export function RangeTabs({ current, carry }: { current: DashboardRange; carry: Carry }) {
  const t = today();
  const href = (range: DashboardRange) =>
    range === "custom"
      ? dashHref(carry, { range, from: carry.from ?? startOfMonth(t), to: carry.to ?? t })
      : dashHref({ ...carry, from: undefined, to: undefined }, { range });

  return (
    /* The one-shape rule (user 2026-10-06): the words are `<Link>`s, so the
       SEG_* strings rather than `ToggleGroup`. */
    <div role="group" aria-label="Reporting period" data-segmented="" className={SEG_TRACK}>
      {DASHBOARD_RANGES.map((r) => {
        const active = r === current;
        return (
          <Link
            key={r}
            href={href(r)}
            aria-current={active ? "true" : undefined}
            className={cn(SEG_ITEM, active ? SEG_LIT : SEG_IDLE)}
          >
            {RANGE_LABELS[r]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Shown when the user was bounced off a module they can't open.
 *
 * `requirePermission()` redirects to `/?denied=<module>`, which makes the
 * dashboard the app's permission-denial landing page — so this must survive
 * every other change to the page. The module name is looked up rather than
 * printed: it arrives from the URL, and while React escapes it (so there is no
 * injection), an arbitrary string would produce a nonsense sentence.
 */
export function DeniedBanner({ module }: { module: string }) {
  const label = MODULE_LABELS[module as Module] ?? "the requested module";
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm text-warning"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        You don’t have permission to open <strong>{label}</strong>. Ask an
        administrator if you need access.
      </p>
    </div>
  );
}

/**
 * Greeting, title and the page's two actions.
 *
 * The date and greeting are rendered on the server in the factory's timezone.
 * A client-side clock would be one more hydration boundary, and nobody reads a
 * dashboard for the seconds.
 */
export function DashboardHeader({
  name,
  subtitle,
  action,
}: {
  name: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">
          {greeting}, {name} · {date}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-heading md:text-[1.7rem]">Operations Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

/**
 * The period bar: Today · Week · Month · Custom, the custom dates, the window
 * in words, and the live-refresh state (user 2026-10-28).
 *
 * The custom dates ARE a GET form — the one place a form is right here, since
 * two typed dates are not a link — and it restates `carry` as hidden fields so
 * the denied notice and the calendar's day survive the submit (the reason the
 * range itself is links).
 */
export function DashboardToolbar({
  filters,
  carry,
  asOf,
}: {
  filters: DashboardFilters;
  carry: Carry;
  asOf: string;
}) {
  const custom = filters.range === "custom";
  const hidden = Object.entries(carry).filter(
    (e): e is [string, string] => !!e[1] && e[0] !== "from" && e[0] !== "to" && e[0] !== "range",
  );

  return (
    <Card className={cn(GLASS, "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5")}>
      <RangeTabs current={filters.range} carry={carry} />
      {custom && <CustomRangeForm from={filters.from} to={filters.to} hidden={hidden} />}
      <span className="text-sm font-medium tabular-nums text-foreground">{windowLabel(filters)}</span>
      <span className="ml-auto">
        <AutoRefresh asOf={asOf} />
      </span>
    </Card>
  );
}
