import { SectionHeading } from "@/components/dashboard/cards";
import {
  ActivitySkeleton,
  ApprovalsSkeleton,
  ChartRowSkeleton,
  HeroSkeleton,
  KpiRowSkeleton,
  MiniStripSkeleton,
} from "@/components/dashboard/skeletons";

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
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6 md:space-y-7">
      <HeroSkeleton />
      <SectionHeading index="01" title="Performance" />
      <KpiRowSkeleton />
      <MiniStripSkeleton />
      <SectionHeading index="02" title="Business analytics" />
      <ChartRowSkeleton />
      <SectionHeading index="04" title="Approvals & activity" />
      <ApprovalsSkeleton />
      <ActivitySkeleton />
    </div>
  );
}
