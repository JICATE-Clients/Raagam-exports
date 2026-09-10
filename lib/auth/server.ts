import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPreviewedRoleIds, getRolesPreview } from "./role-simulation";
import {
  type AppUser,
  type Module,
  type Action,
  type PermissionKey,
  hasPermission,
} from "./types";

/**
 * Load the signed-in user with profile + effective permissions.
 * `cache()` dedupes within a single request (layout + page both call it).
 *
 * ROLE PREVIEW OVERLAYS HERE, NOT AT EACH CALL SITE. Every nav surface
 * (`GlobalSidebar`, `ContextSidebar`, `mobile-nav`, `lib/search/service.ts`)
 * and every page guard (`requirePermission`, `can`) reads its `AppUser`
 * through this one function, so overlaying the previewed role's permissions
 * here — rather than teaching each of those "am I previewing?" — is what makes
 * a preview land everywhere at once with no other file needing to know it
 * exists. See `lib/auth/role-simulation.ts` for why this is a cookie.
 */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: perms }, { data: roles }, previewedRoleIds] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.rpc("my_permissions"),
      supabase.rpc("my_roles"),
      getPreviewedRoleIds(),
    ]);

  const realIsSuperAdmin = profile?.is_super_admin ?? false;
  const permissions = ((perms ?? []) as { module: string; action: string }[]).map(
    (p) => `${p.module}:${p.action}` as PermissionKey,
  );

  const base: AppUser = {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    phone: profile?.phone ?? user.phone ?? null,
    fullName: profile?.full_name ?? null,
    isSuperAdmin: realIsSuperAdmin,
    realIsSuperAdmin,
    simulatedRoleIds: [],
    defaultLocationId: profile?.default_location_id ?? null,
    currentLocationId: profile?.current_location_id ?? null,
    roleNames: ((roles ?? []) as { name: string }[]).map((r) => r.name),
    permissions,
  };

  // Only a REAL Super Admin's own cookie can put them into preview — a role
  // being previewed can never grant itself the switcher back (`realIsSuperAdmin`
  // is never overwritten here, only `isSuperAdmin` is).
  if (!realIsSuperAdmin || previewedRoleIds.length === 0) return base;

  const preview = await getRolesPreview(supabase, previewedRoleIds);
  // Every previewed role was deleted, or the cookie is stale/forged: fail OPEN
  // to the admin's real identity rather than leaving them stuck mid-preview
  // with no way to reach the switcher that would clear it.
  if (!preview) return base;

  return {
    ...base,
    isSuperAdmin: false,
    simulatedRoleIds: preview.ids,
    roleNames: preview.names,
    permissions: preview.permissions,
  };
});

/** Require an authenticated user or redirect to /login. */
export async function requireUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) redirect("/login");
  return user;
}

/** Require a specific permission or redirect (to dashboard with a notice). */
export async function requirePermission(
  module: Module,
  action: Action,
): Promise<AppUser> {
  const user = await requireUser();
  if (!hasPermission(user, module, action)) {
    redirect("/?denied=" + module);
  }
  return user;
}

/** Boolean check for server code (no redirect). */
export async function can(module: Module, action: Action): Promise<boolean> {
  return hasPermission(await getAppUser(), module, action);
}
