import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/auth/types";
import { mergeFavorites, type DefaultRow, type FavoriteSource, type MineRow } from "./merge";
import { favoriteAllowed, resolveFavorite } from "./registry";

/**
 * Reads for Home Favourites (0812). Both tables are read with the person's OWN session —
 * `favorite_defaults` is readable by every login, `user_favorites` only by its owner — so
 * nothing here needs the service role.
 */

/** What the browser is handed: keys and facts, never a label or an icon (the registry
 *  resolves those on the client, so a component cannot cross the server boundary). */
export type MyFavorite = {
  key: string;
  source: FavoriteSource;
  hidden: boolean;
  /** A live count worth a wider tile ("5 waiting"); absent when there is nothing to say. */
  badge?: string;
};

/**
 * The person's whole list, hidden ones included (the Edit sheet shows them unticked), minus
 * anything unknown or not theirs to open. Memoised per request: the phone and desktop
 * layouts both render on every request and must not read it twice.
 *
 * A FAILED READ IS AN EMPTY BAR, NOT AN ERROR PAGE — Home is where everyone lands, and a
 * missing tile row must never be what stops someone reaching the rest of it. The error is
 * logged rather than swallowed.
 */
export const getMyFavorites = cache(async (user: AppUser): Promise<MyFavorite[]> => {
  const s = await createClient();
  const roleIds = user.roleIds ?? [];
  const scope = roleIds.length ? `role_id.is.null,role_id.in.(${roleIds.join(",")})` : "role_id.is.null";
  const [defs, mine] = await Promise.all([
    s.from("favorite_defaults").select("item_key, role_id, position").or(scope),
    s.from("user_favorites").select("item_key, position, hidden").eq("user_id", user.id).order("created_at"),
  ]);
  if (defs.error || mine.error) {
    console.error("[favorites] read failed", defs.error?.message ?? mine.error?.message);
    return [];
  }
  const merged = mergeFavorites((defs.data ?? []) as DefaultRow[], (mine.data ?? []) as MineRow[], roleIds);
  const out: MyFavorite[] = [];
  for (const f of merged) {
    const item = resolveFavorite(f.key);
    if (!item || !favoriteAllowed(user, item)) continue;
    out.push({ key: f.key, source: f.source, hidden: f.hidden });
  }
  await addBadges(out);
  return out;
});

/**
 * Live counts, only for tiles that are on show. One today — the approvals queue — because it
 * is the one count a tile can carry that the person must act on. A count that would need a
 * second query per tile is not added here without a reason on screen to want it.
 */
async function addBadges(list: MyFavorite[]): Promise<void> {
  const approvals = list.find((f) => f.key === "a:my-approvals" && !f.hidden);
  if (!approvals) return;
  const s = await createClient();
  const { data, error } = await s.rpc("approval_my_queue", { p_workflow_key: null, p_tenant_id: null, p_limit: 1, p_offset: 0 });
  if (error) return; // no badge is a correct-looking tile, never a wrong number
  const total = Number(((data ?? []) as { total_count?: number }[])[0]?.total_count ?? 0);
  if (total > 0) approvals.badge = `${total} waiting`;
}

/** The keys showing for this person — what the ☆ in the top bar reads to know "pinned". */
export async function getMyShownKeys(user: AppUser): Promise<string[]> {
  return (await getMyFavorites(user)).filter((f) => !f.hidden).map((f) => f.key);
}

/** Admin screen: every default, every scope. */
export type DefaultsByScope = Record<string, string[]>; // "everyone" | role id → keys in order

export async function listFavoriteDefaults(): Promise<DefaultsByScope> {
  const s = await createClient();
  const { data, error } = await s.from("favorite_defaults").select("item_key, role_id, position").order("position");
  if (error) throw new Error(error.message); // admin screen: a failed read is an error, not "no defaults"
  const out: DefaultsByScope = {};
  for (const r of (data ?? []) as DefaultRow[]) (out[r.role_id ?? "everyone"] ??= []).push(r.item_key);
  return out;
}
