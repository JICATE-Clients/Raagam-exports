import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_LABELS, type Module } from "@/lib/auth/types";
import {
  DASHBOARD_RANGES,
  RANGE_LABELS,
  type DashboardRange,
  type PulseRing as PulseRingData,
} from "@/lib/dashboard/types";
import { ProgressRing } from "./charts";

/**
 * The range selector: three links, not a GET form.
 *
 * A `<form method="get">` submitting from `/` drops every other query
 * parameter, which would silently swallow `?denied=` — the permission notice
 * that `requirePermission()` redirects here specifically to show. Links let us
 * carry it through explicitly, and `<Link>` prefetches so the switch feels
 * immediate where a form submit would not.
 */
export function RangeTabs({
  current,
  carry,
}: {
  current: DashboardRange;
  carry?: Record<string, string | undefined>;
}) {
  const href = (range: DashboardRange) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(carry ?? {})) if (v) params.set(k, v);
    params.set("range", range);
    return `/?${params.toString()}`;
  };

  return (
    <div
      className="flex gap-0.5 rounded-lg border border-border bg-surface p-[3px] shadow-elev"
      role="group"
      aria-label="Reporting period"
    >
      {DASHBOARD_RANGES.map((r) => {
        const active = r === current;
        return (
          <Link
            key={r}
            href={href(r)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
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
 * Greeting, date, health rings and the range selector.
 *
 * The date is rendered on the server in the factory's timezone. A client-side
 * clock would be one more hydration boundary on a page whose whole point is
 * shipping no client JavaScript, and nobody reads a dashboard for the seconds.
 */
export function HeroBanner({
  name,
  subtitle,
  pulse,
  range,
  carry,
  action,
}: {
  name: string;
  subtitle: string;
  pulse: PulseRingData[];
  range: DashboardRange;
  carry?: Record<string, string | undefined>;
  action?: React.ReactNode;
}) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <section className="relative flex flex-wrap items-end justify-between gap-6 overflow-hidden rounded-xl border border-border bg-surface bg-[image:var(--smoke)] px-6 py-5 shadow-elev inset-shadow-sheen">
      {/* Soft brand haze in the corner. Decorative, hence aria-hidden. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-24 h-56 w-80 rounded-full bg-primary-soft opacity-60 blur-3xl"
      />

      <div className="relative min-w-[280px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {subtitle}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {greeting}, {name}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{date}</p>

        {pulse.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            {pulse.map((p) => (
              <ProgressRing
                key={p.label}
                pct={p.pct}
                tone={p.tone}
                label={p.label}
                note={p.note}
              />
            ))}
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-2.5">
        <RangeTabs current={range} carry={carry} />
        {action}
      </div>
    </section>
  );
}
