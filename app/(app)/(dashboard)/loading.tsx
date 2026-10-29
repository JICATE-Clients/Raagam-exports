import {
  ActivitySkeleton,
  ApprovalsSkeleton,
  CalendarSkeleton,
  ChartRowSkeleton,
  HeroSkeleton,
  KpiRowSkeleton,
  MiniStripSkeleton,
} from "@/components/dashboard/skeletons";
import { GlassBackdrop } from "@/components/dashboard/glass";

/**
 * Scoped to the (dashboard) route group on purpose.
 *
 * `loading.tsx` wraps nested routes too, so placing this one level up at
 * `app/(app)/loading.tsx` would flash a dashboard skeleton on the way to
 * /finance/payables and every other screen in the group. The route group gives
 * it a blast radius of exactly one page.
 *
 * Note this covers the page, not the layout: the shell does its own uncached
 * fetches (user, locations, store nav), and without Cache Components those
 * still block a cold navigation. So this pays off on client-side returns to /,
 * which is the common case.
 *
 * Mirrors page.tsx's 12-column bento (2026-10-29): left 8 = the welcome
 * card, period bar, figures and charts; right 4 = Needs you, the week and the
 * shortcuts, from the top. So nothing jumps when the real page lands.
 */
export default function DashboardLoading() {
  return (
    <div className="relative isolate mx-auto max-w-[1440px] space-y-4">
      <GlassBackdrop />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <HeroSkeleton />
          <KpiRowSkeleton />
          <MiniStripSkeleton />
          <ChartRowSkeleton />
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <ApprovalsSkeleton />
          <CalendarSkeleton />
          <ActivitySkeleton />
        </div>
      </div>
    </div>
  );
}
