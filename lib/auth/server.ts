import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
 */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: perms }, { data: roles }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.rpc("my_permissions"),
      supabase.rpc("my_roles"),
    ]);

  const permissions = ((perms ?? []) as { module: string; action: string }[]).map(
    (p) => `${p.module}:${p.action}` as PermissionKey,
  );

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? null,
    phone: profile?.phone ?? user.phone ?? null,
    fullName: profile?.full_name ?? null,
    isSuperAdmin: profile?.is_super_admin ?? false,
    defaultLocationId: profile?.default_location_id ?? null,
    roleNames: ((roles ?? []) as { name: string }[]).map((r) => r.name),
    permissions,
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
