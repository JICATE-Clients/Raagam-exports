import { Suspense } from "react";
import { requireUser } from "@/lib/auth/server";
import { getCaps, getLinesReporting } from "@/lib/dashboard/service";
import { parseCustom, parseRange } from "@/lib/dashboard/range";
import type { DashboardFilters } from "@/lib/dashboard/types";
import { isCalendarDate, today } from "@/lib/calendar";
import { DashboardToolbar, DeniedBanner, type Carry } from "@/components/dashboard/hero";
import { GlassBackdrop } from "@/components/dashboard/glass";
import {
  ActivitySkeleton,
  ApprovalsSkeleton,
  CalendarSkeleton,
  ChartRowSkeleton,
  KpiRowSkeleton,
  LeaderboardSkeleton,
  StageGridSkeleton,
} from "@/components/dashboard/skeletons";
import { BoardCharts, BoardRings, BoardStrip } from "./sections/board";
import { WelcomeSection, WelcomeSkeleton } from "./sections/welcome";
import { AnalyticsSection } from "./sections/analytics";
import { ManufacturingSection } from "./sections/manufacturing";
import { ActivitySection, NeedsYouSection } from "./sections/activity-alerts";
import { CalendarSection } from "./sections/calendar";
import { LeaderboardSection } from "./sections/leaderboards";
import { QuickActionsSection } from "./sections/quick-actions";

/**
 * Raagam ERP — executive dashboard. Serves "/" (the (dashboard) route group
 * adds no URL segment; it exists so `loading.tsx` applies to this page alone
 * rather than to every route in the (app) group).
 *
 * ## Zero client JavaScript
 *
 * Every section, tile and chart here is a server component. The range selector
 * is links, the calendar is links, the chart tooltips are CSS `group-hover`,
 * and the charts are hand-rolled SVG rather than recharts — which would force
 * a client boundary and render nothing on the server. The one client island is
 * `AutoRefresh` (2026-10-28), a timer that calls `router.refresh()` once a
 * minute; it holds no figures of its own.
 *
 * ## Streaming
 *
 * Each section fetches its own data inside its own `<Suspense>` boundary, so a
 * slow aggregate stalls one card instead of the page. Sections must therefore
 * stay in separate files: a suspended child in this function body wouldn't
 * stream.
 *
 * No cross-request caching. `'use cache'` needs `cacheComponents`, which
 * next.config.ts deliberately leaves off, and `unstable_cache` can't wrap these
 * queries at all — they go through a Supabase client built on `await cookies()`.
 * Every figure is permission- and location-scoped anyway, so a shared cache
 * entry would be a cross-tenant leak. React `cache()` handles per-request
 * dedupe inside the service.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    location?: string;
    denied?: string;
    /** The calendar panel's chosen day and scope — My Calendar's own params. */
    cd?: string;
    cs?: string;
  }>;
}) {
  const [user, sp, caps] = await Promise.all([
    requireUser(),
    searchParams,
    getCaps(),
  ]);

  // A custom range with unusable dates falls back to Month rather than failing.
  const asked = parseRange(sp.range);
  const custom = asked === "custom" ? parseCustom(sp.from, sp.to) : null;
  const filters: DashboardFilters = {
    range: custom ? "custom" : asked === "custom" ? "month" : asked,
    location: sp.location ?? user.defaultLocationId ?? null,
    ...(custom ?? {}),
  };

  const t = today();
  const firstName = user.fullName?.split(" ")[0] ?? "there";
  const day =sp.cd && isCalendarDate(sp.cd) ? sp.cd : undefined;
  const scope = sp.cs === "team" ? "team" : "mine";

  // Carried through every link on the page so changing ONE thing — the
  // period, the calendar day — never drops the others, nor the permission
  // notice that requirePermission() redirected here to show.
  const carry: Carry = {
    range: filters.range === "month" ? undefined : filters.range,
    from: filters.from,
    to: filters.to,
    denied: sp.denied,
    location: sp.location,
    cd: day,
    cs: scope === "team" ? "team" : undefined,
  };

  const lines = await getLinesReporting(caps);

  return (
    // `isolate` so the backdrop's -z-10 stays inside this page, behind the
    // cards, instead of slipping under the shell's own panel.
    <div className="relative isolate mx-auto max-w-[1440px] space-y-4">
      <GlassBackdrop />
      <h1 className="sr-only">Operations Dashboard</h1>

      {sp.denied && <DeniedBanner module={sp.denied} />}

      {/* ONE 12-COLUMN BENTO (user 2026-10-29: "more compact, like the HR
          profile"; that page is xl:grid-cols-12 with packed cards and no
          full-width section bands). Left 8: the day, the figures, the charts,
          then activity beside the Top lists; right 4 from
          the TOP of the page, so nothing sits beside empty space. Right: what
          needs you (approvals + alerts), the week, the shortcuts, then
          production as one compact card. Every block is a titled card, so
          the page has no free-standing section headings left. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          {/* THE WELCOME CARD (user 2026-10-29) replaces the three-line header:
              Nool greets, says how the day stands, and lists what is left. */}
          <Suspense fallback={<WelcomeSkeleton name={firstName} />}>
            {/* No buttons on the card (user 2026-10-29): My Calendar is the
                calendar panel's own "Open full calendar" link on the right,
                and New order lives in Orders. */}
            <WelcomeSection user={user} />
          </Suspense>

          <DashboardToolbar filters={filters} carry={carry} />

          {/* THE BOARD (approved plan 2026-10-30, "Raagam Dashboard
              Redesign"): six ring tiles, each a real share of a real whole
              (no targets are stored, so nothing is drawn "vs target"), then
              the order charts. Replaced the headline KPIs + mini-stat strip. */}
          <Suspense fallback={<KpiRowSkeleton />}>
            <BoardRings caps={caps} />
          </Suspense>
          <Suspense fallback={<ChartRowSkeleton />}>
            <BoardCharts caps={caps} />
          </Suspense>

          {/* Hidden entirely without reports:view — the RPCs self-gate in SQL,
              so the charts would render empty and read as broken. */}
          {caps.reports && (
            <Suspense fallback={<ChartRowSkeleton />}>
              <AnalyticsSection filters={filters} caps={caps} />
            </Suspense>
          )}

          {/* Recent activity and the Top lists share one grid, so neither sits
              alone in a full-width row (2026-10-29). */}
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            <Suspense fallback={<ActivitySkeleton />}>
              <ActivitySection caps={caps} />
            </Suspense>
            {caps.reports && (
              <Suspense fallback={<LeaderboardSkeleton />}>
                <LeaderboardSection filters={filters} caps={caps} />
              </Suspense>
            )}
          </div>

          <Suspense fallback={null}>
            <BoardStrip caps={caps} />
          </Suspense>
        </div>

        <aside className="min-w-0 space-y-4 xl:col-span-4" aria-label="Needs you, calendar and quick actions">
          <Suspense fallback={<ApprovalsSkeleton />}>
            <NeedsYouSection caps={caps} />
          </Suspense>
          <Suspense fallback={<CalendarSkeleton />}>
            <CalendarSection user={user} cursor={day ?? t} scope={scope} carry={carry} />
          </Suspense>
          <QuickActionsSection />
          {caps.production && (
            <Suspense fallback={<StageGridSkeleton />}>
              <ManufacturingSection filters={filters} caps={caps} lines={lines} />
            </Suspense>
          )}
        </aside>
      </div>
    </div>
  );
}
