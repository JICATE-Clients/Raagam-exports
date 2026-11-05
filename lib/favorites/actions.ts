"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";
import { hasPermission } from "@/lib/auth/types";
import { favoriteAllowed, isPinnablePath, resolveFavorite, screenKey } from "./registry";

/**
 * Writes for Home Favourites (0812). Every write goes through the person's own session, so
 * `user_favorites_own` (own rows only) and `favorite_defaults_write` (system_admin edit) are
 * the guards; the checks below only turn a refusal into a sentence.
 *
 * A key is accepted only if it RESOLVES (registry action, or a pinnable screen) and the person
 * may open it — a stored tile they cannot see would be a row nobody can ever remove.
 */

type Result = { ok: true } | { ok: false; error: string };

async function me() {
  const user = await getAppUser();
  if (!user) throw new Error("Sign in again to change your favourites.");
  return user;
}

function usable(user: NonNullable<Awaited<ReturnType<typeof getAppUser>>>, key: string): boolean {
  const item = resolveFavorite(key);
  return !!item && favoriteAllowed(user, item);
}

/** Is this key one of the person's DEFAULTS (everyone's or a role's)? A default is hidden,
 *  never deleted — deleting their row would just let the admin's row bring it back. */
async function isDefaultFor(roleIds: string[], key: string): Promise<boolean> {
  const s = await createClient();
  const scope = roleIds.length ? `role_id.is.null,role_id.in.(${roleIds.join(",")})` : "role_id.is.null";
  const { data, error } = await s.from("favorite_defaults").select("item_key").eq("item_key", key).or(scope).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * The Edit sheet's Done: the WHOLE list, in the order shown, each with its tick. Positions are
 * rewritten for every row, so the order on screen is the order stored. A pin left out of the
 * list is deleted; a default left out cannot be (it is the admin's), so it is kept as-is.
 */
export async function saveMyFavorites(list: { key: string; hidden: boolean }[]): Promise<Result> {
  try {
    const user = await me();
    const rows = list
      .filter((f) => usable(user, f.key))
      .map((f, i) => ({ user_id: user.id, item_key: f.key, position: i + 1, hidden: f.hidden }));
    const s = await createClient();
    if (rows.length) {
      const { error } = await s.from("user_favorites").upsert(rows, { onConflict: "user_id,item_key" });
      if (error) return { ok: false, error: error.message };
    }
    const keep = rows.map((r) => r.item_key);
    let del = s.from("user_favorites").delete().eq("user_id", user.id);
    if (keep.length) del = del.not("item_key", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
    const { error: delErr } = await del;
    if (delErr) return { ok: false, error: delErr.message };
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your favourites." };
  }
}

/** ☆ on a screen, or a tile added from the Edit sheet's search. `on` = show it on Home. */
export async function setFavorite(key: string, on: boolean): Promise<Result> {
  try {
    const user = await me();
    if (on && !usable(user, key)) return { ok: false, error: "This screen can't be pinned." };
    const s = await createClient();
    const isDefault = await isDefaultFor(user.roleIds ?? [], key);
    if (on || isDefault) {
      // On: un-hide a default, or add a pin at the end (position null = after the arranged ones).
      // Off on a default: hide it.
      const { error } = await s
        .from("user_favorites")
        .upsert({ user_id: user.id, item_key: key, hidden: !on }, { onConflict: "user_id,item_key" });
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await s.from("user_favorites").delete().eq("user_id", user.id).eq("item_key", key);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change your favourites." };
  }
}

/** Pin or unpin the screen a pathname belongs to (the top bar's ☆, the search palette's pin). */
export async function setScreenFavorite(pathname: string, on: boolean): Promise<Result> {
  if (!isPinnablePath(pathname)) return { ok: false, error: "This page can't be pinned." };
  return setFavorite(screenKey(pathname), on);
}

/**
 * ONE-TIME MOVE of the pins the search palette used to keep in this browser's localStorage
 * (`raagam:favorites`). Those followed the MACHINE, not the person — on a shared shop-floor PC
 * the next operator saw them. Anything unusable is dropped; an existing row is left alone.
 */
export async function importBrowserPins(hrefs: string[]): Promise<Result> {
  try {
    const user = await me();
    const rows = [...new Set(hrefs.filter((h) => typeof h === "string" && isPinnablePath(h)).map(screenKey))]
      .filter((k) => usable(user, k))
      .map((k) => ({ user_id: user.id, item_key: k, hidden: false }));
    if (!rows.length) return { ok: true };
    const s = await createClient();
    const { error } = await s
      .from("user_favorites")
      .upsert(rows, { onConflict: "user_id,item_key", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not move your pins." };
  }
}

/**
 * Administration ▸ Users & Access ▸ Home Favourites: replace ONE scope's defaults
 * ("everyone" or a role id) with this ordered list. The policy is the guard; the check here
 * turns its refusal into words.
 */
export async function saveFavoriteDefaults(scope: string, keys: string[]): Promise<Result> {
  try {
    const user = await me();
    if (!hasPermission(user, "system_admin", "edit")) return { ok: false, error: "You don't have permission to change Home defaults." };
    const clean = [...new Set(keys)].filter((k) => resolveFavorite(k));
    const roleId = scope === "everyone" ? null : scope;
    if (roleId !== null && !/^[0-9a-f-]{36}$/i.test(roleId)) return { ok: false, error: "Unknown role." };
    const s = await createClient();
    const del = roleId === null
      ? s.from("favorite_defaults").delete().is("role_id", null)
      : s.from("favorite_defaults").delete().eq("role_id", roleId);
    const { error: delErr } = await del;
    if (delErr) return { ok: false, error: delErr.message };
    if (clean.length) {
      const { error } = await s
        .from("favorite_defaults")
        .insert(clean.map((k, i) => ({ role_id: roleId, item_key: k, position: i + 1 })));
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/");
    revalidatePath("/admin/home-favourites");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the defaults." };
  }
}
