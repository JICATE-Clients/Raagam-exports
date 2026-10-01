import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMyStaffId } from "./self-service";
import { getPreviewedRoleIds, getRolesPreview } from "./role-simulation";
import { screenOfPath, type CatalogScreen } from "@/lib/permissions/screen-catalog";
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
  /* ONE LOAD PER REQUEST, IN AN ACTION TOO (2026-09-24, "every click takes
     3 s"). React's `cache()` above only dedupes during a RENDER; inside a
     server action it calls straight through, so every `can()` in an action
     re-read the user — 2 round trips (~520 ms) each, and an action commonly
     makes two or three. The request's own `headers()` object is one instance
     for the whole request (Next caches it per request), so a WeakMap keyed on
     it is a memo that lives exactly as long as the request and no longer:
     nothing crosses to another request or another user. */
  const key = await requestKey();
  const hit = key ? perRequest.get(key) : undefined;
  if (hit) return hit;
  const load = loadAppUser();
  if (key) perRequest.set(key, load);
  return load;
});

const perRequest = new WeakMap<object, Promise<AppUser | null>>();

async function requestKey(): Promise<object | null> {
  try {
    return (await headers()) as unknown as object;
  } catch {
    return null; // outside a request (a script, a cron with no request store)
  }
}

/**
 * Drop this request's remembered user — for an action that CHANGES who the
 * user is mid-request (the unit switch, a role preview), so the page it
 * re-renders before replying reads the new state, not the one memoised above.
 */
export async function forgetAppUser(): Promise<void> {
  const key = await requestKey();
  if (key) perRequest.delete(key);
}

async function loadAppUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  /* getClaims(), NOT getUser(): the JWT is verified LOCALLY against the
     project's published ES256 key (see lib/supabase/middleware.ts) — the
     same guarantee with no round trip to Supabase Auth. */
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return null;
  const user = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
  };

  const [{ data: profile }, { data: perms }, { data: roles }, { data: screenFacts }, previewedRoleIds] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.rpc("my_permissions"),
      supabase.rpc("my_roles"),
      /* 0658: the screen-level facts, from roles AND active email access —
         in the same parallel batch, so screen permissions cost no extra
         round trip. A failed read leaves them absent = module mode, the
         answer every user had before screen permissions existed. */
      supabase.rpc("my_screen_permissions"),
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
    mustChangePassword: profile?.must_change_password === true,
    /* "My Profile" (user 2026-10-01): a regular staff member — HR access but
       no HR role — gets their own record instead of the Staff list. Only
       looked up for a login that can open HR at all (lib/auth/self-service.ts). */
    myStaffId: await resolveMyStaffId({
      userId: user.id,
      email: profile?.email ?? user.email ?? null,
      isSuperAdmin: realIsSuperAdmin,
      permissions,
    }),
    isSuperAdmin: realIsSuperAdmin,
    realIsSuperAdmin,
    simulatedRoleIds: [],
    defaultLocationId: profile?.default_location_id ?? null,
    currentLocationId: profile?.current_location_id ?? null,
    roleNames: ((roles ?? []) as { name: string }[]).map((r) => r.name),
    permissions,
    ...screenFactsOf(screenFacts),
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
    moduleMode: preview.moduleMode,
    screenGrants: preview.screenGrants,
  };
}

/** `my_screen_permissions()` rows → the two AppUser fields; absent on a failed read. */
function screenFactsOf(rows: unknown): Pick<AppUser, "moduleMode" | "screenGrants"> {
  if (!Array.isArray(rows)) return {};
  const moduleMode: PermissionKey[] = [];
  const screenGrants: string[] = [];
  for (const r of rows as { kind: string; key: string }[]) {
    if (r.kind === "module") moduleMode.push(r.key as PermissionKey);
    else if (r.kind === "screen") screenGrants.push(r.key);
  }
  return { moduleMode, screenGrants };
}

/**
 * THE SCREEN THIS REQUEST IS ON — from `x-pathname`, which the proxy SETS on
 * every request (lib/supabase/middleware.ts), so it cannot be supplied by the
 * browser. A server action POSTs to its page's own URL, so an action is
 * attributed to the screen it was used on. Null outside a request, on a hub,
 * or on an unregistered route: the check then answers at module grain.
 */
export async function currentScreen(): Promise<CatalogScreen | null> {
  try {
    return screenOfPath((await headers()).get("x-pathname"));
  } catch {
    return null; // outside a request
  }
}

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
  /* 0658: the screen the page is — so a role or a person's email access that
     grants only some screens of this module is refused on the others, with
     no edit to any of the ~242 pages that call this. */
  if (!hasPermission(user, module, action, await currentScreen())) {
    redirect("/?denied=" + module);
  }
  return user;
}

/** Boolean check for server code (no redirect). Screen-aware (0658): inside a
 *  page render or a server action it answers for the screen the request is on. */
export async function can(module: Module, action: Action): Promise<boolean> {
  return hasPermission(await getAppUser(), module, action, await currentScreen());
}

/**
 * May the user OPEN this href — its screen's View? For the hubs that redirect
 * to "the first child", so they redirect to the first one the user may see.
 * An href that is not a screen (a hub) answers true.
 */
export async function canViewHref(href: string): Promise<boolean> {
  const screen = screenOfPath(href);
  if (!screen) return true;
  return hasPermission(await getAppUser(), screen.module, "view", screen);
}
