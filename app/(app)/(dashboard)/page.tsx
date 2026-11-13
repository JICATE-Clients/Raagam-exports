import { Suspense } from "react";
import { requireUser } from "@/lib/auth/server";
import { getCaps, getLinesReporting } from "@/lib/dashboard/service";
import { parseCustom, parseRange } from "@/lib/dashboard/range";
import type { DashboardFilters } from "@/lib/dashboard/types";
import { isCalendarDate, today } from "@/lib/calendar";
import { DeniedBanner, type Carry } from "@/components/dashboard/hero";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { GlassBackdrop } from "@/components/dashboard/glass";
import {
  ApprovalsSkeleton,
  CalendarSkeleton,
  ChartRowSkeleton,
  KpiRowSkeleton,
  StageGridSkeleton,
} from "@/components/dashboard/skeletons";
import { cn } from "@/lib/utils";
import { BoardAgeing, BoardBuying, BoardKpis } from "./sections/board";
import { WelcomeSection, WelcomeSkeleton } from "./sections/welcome";
import { OrderBookSection } from "./sections/order-book";
import { ManufacturingSection } from "./sections/manufacturing";
import { NeedsYouSection } from "./sections/activity-alerts";
import { CalendarSection } from "./sections/calendar";
import { PhoneFullHome, PhoneHome } from "@/components/dashboard/phone-home";

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
/** A band's row: stacked on a narrow pane, side by side from xl. */
const ROW = "flex flex-col gap-3 xl:flex-row xl:items-stretch";
/** A picture row SHARES what the window has left, from xl. Not a fixed height: at 125% Windows
 *  scaling a "320px" row is 400 screen pixels and the pane is ~680 CSS px, so a fixed row
 *  scrolled (screenshot 4009). The page root fills `<main>` (a flex column, app/(app)/layout.tsx)
 *  with a 600px floor, and the two picture rows split the rest. A card fills its cell and
 *  clips; it never grows the row. */
const FIXED_ROW = "xl:min-h-0 xl:flex-1";
/** Two-thirds / one-third of a row; a wrapper whose section rendered nothing is dropped. */
const WIDE = "min-w-0 empty:hidden xl:flex-[2] [&>*]:h-full xl:[&>*]:overflow-hidden";
const NARROW = "min-w-0 empty:hidden xl:flex-1 [&>*]:h-full xl:[&>*]:overflow-hidden";
/** A narrow cell that shrinks when its card reports good news (`data-all-clear`, fix 1), so the
 *  card beside it takes the width. */
const NARROW_SHRINKS = `${NARROW} xl:has-[[data-all-clear]]:flex-[0.6]`;

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
    /** `home` on a phone = the full old Home, opened from the Favourites "Home" tile (2026-11-13). */
    view?: string;
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
    <>
    {/* THE PHONE: Favourites with Home inside it (user 2026-11-13) — the same layout
        /favourites renders on a phone. Desktop below is unchanged. */}
    {sp.view === "home" ? (
      <PhoneFullHome user={user} caps={caps} denied={sp.denied} />
    ) : (
      <PhoneHome user={user} denied={sp.denied} />
    )}

    {/* THE DESKTOP DASHBOARD — from md up only. */}
    {/* `isolate` so the backdrop's -z-10 stays inside this page, behind the
        cards, instead of slipping under the shell's own panel. */}
    <div className="relative isolate mx-auto hidden max-w-[1440px] flex-col gap-3 md:flex xl:min-h-[600px] xl:flex-1">
      <GlassBackdrop />
      <h1 className="sr-only">Operations Dashboard</h1>

      {sp.denied && <DeniedBanner module={sp.denied} />}

      {/* ONE SCREEN (user 2026-11-03, plan https://claude.ai/artifact/3vUk4Cth5KjKYAELNGgEiU,
          option A "Glass", all four decisions approved). Seven stacked bands became three rows
          that fit the content pane at 1920×1080: your day + the KPI tiles, then two rows of
          picture cards at a FIXED height, so a card fills its cell and never grows it. Below
          xl (1280px) the rows stack and the page scrolls — one screen is a desktop promise.
          Rows stay flex with `empty:hidden`: a section a role cannot see leaves an empty
          wrapper, and its neighbour takes the width instead of sitting beside a hole.
          Removed: Recent activity (the bell and Audit log hold it), Quick actions (the
          sidebar and Ctrl+K), the insight strip (it repeated the book chart in words), and
          the Trend / Top lists cards (their Revenue, Output and Top buyers are tabs of the
          order book card; the rest stay on Reports). */}

      <div className={ROW}>
        <div className="min-w-0 empty:hidden xl:w-[24rem] xl:flex-none [&>*]:h-full">
          <Suspense fallback={<WelcomeSkeleton name={firstName} />}>
            <WelcomeSection user={user} compact />
          </Suspense>
        </div>
        <div className="min-w-0 flex-1 empty:hidden">
          <Suspense fallback={<KpiRowSkeleton />}>
            <BoardKpis caps={caps} />
          </Suspense>
        </div>
      </div>

      {/* NO PERIOD BAND (plan option A, 2026-11-03): the period changes only Production and
          the Top buyers tab, so the switch lives in those two cards' headers. The minute
          refresh the band carried is mounted here on its own — it renders nothing. */}
      <AutoRefresh />

      <div className={cn(ROW, FIXED_ROW)}>
        <div className={WIDE}>
          <Suspense fallback={<ChartRowSkeleton />}>
            <OrderBookSection filters={filters} caps={caps} carry={carry} />
          </Suspense>
        </div>
        <div className={NARROW}>
          <Suspense fallback={<ApprovalsSkeleton />}>
            <NeedsYouSection caps={caps} />
          </Suspense>
        </div>
        <div className={NARROW}>
          <Suspense fallback={<CalendarSkeleton />}>
            <CalendarSection user={user} cursor={day ?? t} scope={scope} carry={carry} />
          </Suspense>
        </div>
      </div>

      <div className={cn(ROW, FIXED_ROW)}>
        {caps.production && (
          <div className={WIDE}>
            <Suspense fallback={<StageGridSkeleton />}>
              <ManufacturingSection filters={filters} caps={caps} lines={lines} carry={carry} />
            </Suspense>
          </div>
        )}
        <div className={NARROW_SHRINKS}>
          <Suspense fallback={<ChartRowSkeleton />}>
            <BoardAgeing caps={caps} />
          </Suspense>
        </div>
        <div className={NARROW}>
          <Suspense fallback={<ChartRowSkeleton />}>
            <BoardBuying caps={caps} />
          </Suspense>
        </div>
      </div>
    </div>
    </>
  );
}
