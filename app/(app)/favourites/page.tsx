import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { getMyFavorites } from "@/lib/favorites/service";
import { FavoritesBar } from "@/components/favorites/favorites-bar";

/**
 * THE FAVOURITES MODULE (user 2026-11-05: "as module like home, under fav", screenshot 4073)
 * — a rail item of its own, right under Home (the Dashboard, which stays as it was). The same
 * list as the phone home's Favourites section: one read, one Edit sheet, one set of rules
 * (lib/favorites).
 *
 * `requireUser`, like the dashboard: every login has a bar, and each tile already hides itself
 * when its screen is not the person's to open.
 */
export default async function FavouritesPage() {
  const user = await requireUser();
  const items = await getMyFavorites(user);
  return (
    <div className="space-y-4">
      <PageHeader title="Favourites" back={false} />
      <FavoritesBar items={items} variant="desktop" />
    </div>
  );
}
