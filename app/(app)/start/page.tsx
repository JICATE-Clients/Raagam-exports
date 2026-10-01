import { redirect } from "next/navigation";
import { canViewHref, requireUser } from "@/lib/auth/server";
import { hasPermission, type Module } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/server";
import { NAV } from "@/components/shell/nav";
import { myStaff } from "@/lib/people/order-people";

/**
 * WHERE A PERSON LANDS AFTER SIGNING IN (user 2026-10-01: "plan the dynamic
 * routing … it should open as my profile"). Not a page anyone sees — it decides
 * and redirects. Sign-in, the set-password step and the auth callback send
 * here instead of straight to the Dashboard; a link that already names a page
 * (`?redirect=` on the login screen) never comes here at all.
 *
 *   1. The person's roles that name a Home page (0670), in role-name order —
 *      the first one they may actually OPEN. A home page they cannot view is
 *      skipped rather than followed into the "denied" bounce.
 *   2. Otherwise MY PROFILE, when none of their roles opens any module: a
 *      staff login given no module access used to land on an empty Dashboard.
 *   3. Otherwise MY WORK when the login is a staff member (2026-10-01): the
 *      person's own orders, T&A tasks, approvals and CAD work, rather than the
 *      company-wide Dashboard. A login linked to no staff record — an
 *      administrator, a test account — has no "mine" to show.
 *   4. Otherwise the Dashboard, exactly as before.
 *
 * The roles are read with the service role, pinned to the session's own id —
 * the same reason `lib/hr/my-profile.ts` gives, and the same safety: nothing in
 * the request names whose roles to read.
 */
export default async function StartPage() {
  const user = await requireUser();

  const { data } = await createAdminClient()
    .from("user_roles")
    .select("roles(name, home_path)")
    .eq("user_id", user.id);

  type RoleJoin = { name: string; home_path: string | null };
  const homes = ((data ?? []) as unknown as { roles: RoleJoin | RoleJoin[] | null }[])
    .flatMap((r) => (Array.isArray(r.roles) ? r.roles : r.roles ? [r.roles] : []))
    .filter((r): r is RoleJoin & { home_path: string } => !!r.home_path)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const h of homes) {
    // `/me` and `/my-work` need no permission; any other home must be one they may open.
    if (h.home_path === "/me" || h.home_path === "/my-work" || (await canViewHref(h.home_path))) redirect(h.home_path);
  }

  const opensAModule =
    user.isSuperAdmin ||
    NAV.some((n) => n.href !== "/" && hasPermission(user, n.module as Module, "view"));

  if (!opensAModule) redirect("/me");
  redirect((await myStaff(user.id)) ? "/my-work" : "/");
}
