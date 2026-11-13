import { Suspense } from "react";
import type { AppUser } from "@/lib/auth/types";
import type { DashboardCaps } from "@/lib/dashboard/types";
import { DeniedBanner } from "@/components/dashboard/hero";
import {
  MobileDay,
  MobileFavorites,
  MobileGlance,
  MobileHero,
  MobileInsights,
  MobileSkeleton,
  MobileWaiting,
  MobileWeek,
} from "@/components/dashboard/mobile-home";

/**
 * THE PHONE'S FIRST PAGE IS FAVOURITES (user 2026-11-13: "home also as favorite icon, in fav
 * page just show the favorites, waiting on you"; desktop stays the same).
 *
 * Below md there is no separate Home: the bottom bar's first tab wears the star and opens
 * this — the Favourites tiles, then Waiting on you, and nothing else. The order-book hero,
 * Your day, At a glance, This week and Insights moved behind the fixed "Home" tile, the first
 * of the Favourites (`/?view=home` → PhoneFullHome below, screenshot 4141) (all still on the
 * desktop dashboard). `/` and `/favourites` both render it on a phone, from this ONE
 * component, so the two cannot drift apart. From md up neither route renders it (`md:hidden`).
 */
export function PhoneHome({ user, caps, denied }: { user: AppUser; caps: DashboardCaps; denied?: string }) {
  return (
    <div data-mobile-home className="flex flex-col gap-[18px] md:hidden">
      {denied && <DeniedBanner module={denied} />}
      <Suspense fallback={<MobileSkeleton h="h-24" />}>
        <MobileFavorites user={user} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-28" />}>
        <MobileWaiting caps={caps} />
      </Suspense>
    </div>
  );
}

/**
 * THE OLD HOME, OPENED FROM THE FAVOURITES "Home" TILE (user 2026-11-13, screenshot 4141).
 * `/?view=home` on a phone: the order-book band, Your day, Waiting on you, At a glance, This
 * week and Insights — everything the phone Home showed before Favourites became the first
 * page, minus the Favourites tiles themselves (that is the page this was opened from).
 */
export function PhoneFullHome({ user, caps, denied }: { user: AppUser; caps: DashboardCaps; denied?: string }) {
  return (
    <div data-mobile-home className="flex flex-col gap-[18px] md:hidden">
      {denied && <DeniedBanner module={denied} />}
      <Suspense fallback={<div className="-mx-4 -mt-4 h-14 bg-[#0a2e4d]" />}>
        <MobileHero caps={caps} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-28" />}>
        <MobileDay user={user} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-28" />}>
        <MobileWaiting caps={caps} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-40" />}>
        <MobileGlance caps={caps} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-48" />}>
        <MobileWeek user={user} />
      </Suspense>
      <Suspense fallback={<MobileSkeleton h="h-48" />}>
        <MobileInsights caps={caps} />
      </Suspense>
    </div>
  );
}
