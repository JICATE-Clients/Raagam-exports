import { can, requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { listFavoriteDefaults } from "@/lib/favorites/service";
import { HomeFavouritesScreen } from "./home-favourites-screen";

/**
 * Administration ▸ Users & Access ▸ Home Favourites (0812, user 2026-11-05).
 *
 * The tiles people START with on Home: one list for EVERYONE — the only layer that reaches a
 * regular staff member, who signs in by email access and holds no role — and one per role on
 * top. Each person can still hide, reorder and add their own from Home's Edit; a change here
 * reaches them on their next visit, because Home works the list out on every read.
 */
export default async function HomeFavouritesPage() {
  await requirePermission("system_admin", "view");
  const s = await createClient();
  const [defaults, roles, canEdit] = await Promise.all([
    listFavoriteDefaults(),
    s.from("roles").select("id, name").order("name"),
    can("system_admin", "edit"),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  return (
    <div className="space-y-4">
      <PageHeader title="Home Favourites" description="The tiles each role starts with on Home." />
      <HomeFavouritesScreen
        defaults={defaults}
        roles={(roles.data ?? []) as { id: string; name: string }[]}
        canEdit={canEdit}
      />
    </div>
  );
}
