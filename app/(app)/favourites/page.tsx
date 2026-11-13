import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getMyFavorites } from "@/lib/favorites/service";
import { FavoritesBar } from "@/components/favorites/favorites-bar";
import { PhoneHome } from "@/components/dashboard/phone-home";

/**
 * THE FAVOURITES MODULE (user 2026-11-05: "as module like home, under fav", screenshot 4073)
 * — a rail item of its own, right under Home (the Dashboard, which stays as it was). The same
 * list as the phone home's Favourites section: one read, one Edit sheet, one set of rules
 * (lib/favorites).
 *
 * ON A PHONE this is the first page, with Home inside it (user 2026-11-13): it renders
 * `PhoneHome`, the same layout `/` renders below md, so the two cannot differ. The desktop
 * view (`hidden md:block`) is unchanged.
 *
 * `requireUser`, like the dashboard: every login has a bar, and each tile already hides itself
 * when its screen is not the person's to open. `getMyFavorites` is `cache()`d per request, so
 * the phone and desktop halves share one read.
 */
export default async function FavouritesPage() {
  const user = await requireUser();
  const items = await getMyFavorites(user);
  return (
    <>
      <PhoneHome user={user} />
      <div className="hidden space-y-4 md:block">
        <PageHeader title="Favourites" back={false} />
        <FavoritesBar items={items} variant="desktop" />
      </div>
    </>
  );
}
