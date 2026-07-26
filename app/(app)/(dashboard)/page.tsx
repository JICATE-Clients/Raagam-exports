import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can, requireUser } from "@/lib/auth/server";
import { getCaps, getPulse } from "@/lib/dashboard/service";
import { parseRange } from "@/lib/dashboard/range";
import type { DashboardFilters } from "@/lib/dashboard/types";
import { SectionHeading } from "@/components/dashboard/cards";
import { DeniedBanner, HeroBanner } from "@/components/dashboard/hero";
import {
  ActivitySkeleton,
  ApprovalsSkeleton,
  ChartRowSkeleton,
  KpiRowSkeleton,
  LeaderboardSkeleton,
  StageGridSkeleton,
} from "@/components/dashboard/skeletons";
import { HeadlineSection } from "./sections/headline";
import { AnalyticsSection } from "./sections/analytics";
import { ManufacturingSection } from "./sections/manufacturing";
import { ApprovalsSection } from "./sections/approvals";
import { ActivityAndAlerts } from "./sections/activity-alerts";
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
 * is three links, the chart tooltips are CSS `group-hover`, and the charts are
 * hand-rolled SVG rather than recharts — which would force a client boundary
 * and render nothing on the server. The only interactive control in view, the
 * theme toggle, belongs to the shell.
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
  searchParams: Promise<{ range?: string; location?: string; denied?: string }>;
}) {
  const [user, sp, caps] = await Promise.all([
    requireUser(),
    searchParams,
    getCaps(),
  ]);

  const filters: DashboardFilters = {
    range: parseRange(sp.range),
    location: sp.location ?? user.defaultLocationId ?? null,
  };

  // Carried through the range links so switching period never drops the
  // permission notice that requirePermission() redirected here to show.
  const carry = { denied: sp.denied, location: sp.location };

  const [pulse, canCreateOrder] = await Promise.all([
    getPulse(caps),
    can("orders", "create"),
  ]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 md:space-y-7">
      <HeroBanner
        name={user.fullName?.split(" ")[0] ?? "there"}
        subtitle="Raagam Exports · Operations overview"
        pulse={pulse}
        range={filters.range}
        carry={carry}
        action={
          canCreateOrder ? (
            <Link
              href="/orders/order-booking"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-elev transition-colors hover:bg-primary-hover"
            >
              <Plus className="h-4 w-4" />
              New order
            </Link>
          ) : undefined
        }
      />

      {sp.denied && <DeniedBanner module={sp.denied} />}

      <SectionHeading index="01" title="Performance" />
      <Suspense fallback={<KpiRowSkeleton />}>
        <HeadlineSection filters={filters} caps={caps} />
      </Suspense>

      {caps.reports && (
        <>
          {/* Hidden entirely without reports:view — the RPCs self-gate in SQL,
              so the charts would render empty and read as broken. */}
          <SectionHeading index="02" title="Business analytics" />
          <Suspense fallback={<ChartRowSkeleton />}>
            <AnalyticsSection filters={filters} caps={caps} />
          </Suspense>
        </>
      )}

      {caps.production && (
        <>
          <SectionHeading index="03" title="Manufacturing" />
          <Suspense fallback={<StageGridSkeleton />}>
            <ManufacturingSection filters={filters} caps={caps} />
          </Suspense>
        </>
      )}

      <SectionHeading index="04" title="Approvals & activity" />
      <Suspense fallback={<ApprovalsSkeleton />}>
        <ApprovalsSection caps={caps} />
      </Suspense>
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityAndAlerts caps={caps} />
      </Suspense>

      <SectionHeading index="05" title="Quick actions" />
      <QuickActionsSection />

      {caps.reports && (
        <Suspense fallback={<LeaderboardSkeleton />}>
          <LeaderboardSection filters={filters} caps={caps} />
        </Suspense>
      )}
    </div>
  );
}
