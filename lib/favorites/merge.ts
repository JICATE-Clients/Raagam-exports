/**
 * THE ONE RULE FOR WHAT A PERSON'S FAVOURITES BAR HOLDS (0812). Pure, so the Home bar, the
 * Edit sheet and `scripts/check-favorites.mts` read the same answer.
 *
 *   everyone's defaults + their roles' defaults + their own pins
 *     − what they hid − (later, by the caller) what they may not open
 *   in THEIR order where they set one, else the admin's order.
 *
 * Worked out on every read, never copied into the person's rows: a tile an admin adds next
 * month must reach someone who arranged their bar today (decision 2, 2026-11-05).
 */

export type DefaultRow = { item_key: string; role_id: string | null; position: number };
export type MineRow = { item_key: string; position: number | null; hidden: boolean };

export type FavoriteSource = "everyone" | "role" | "mine";
export type MergedFavorite = { key: string; source: FavoriteSource; hidden: boolean };

export function mergeFavorites(defaults: DefaultRow[], mine: MineRow[], roleIds: string[] = []): MergedFavorite[] {
  const roleRank = new Map(roleIds.map((id, i) => [id, i]));
  // A default for a role the person does not hold is not theirs — the caller usually filters
  // already, but the rule must not depend on it.
  const theirs = defaults.filter((d) => d.role_id === null || roleRank.has(d.role_id));
  // Everyone's first, then each role in the order the person's roles are listed, each by the
  // admin's position. Stable, so equal positions keep the order they were read in.
  const ordered = [...theirs].sort((a, b) => {
    const ra = a.role_id === null ? -1 : roleRank.get(a.role_id)!;
    const rb = b.role_id === null ? -1 : roleRank.get(b.role_id)!;
    return ra - rb || a.position - b.position;
  });

  const byKey = new Map<string, MergedFavorite>();
  for (const d of ordered) {
    if (byKey.has(d.item_key)) continue; // the same tile from two roles shows once
    byKey.set(d.item_key, { key: d.item_key, source: d.role_id === null ? "everyone" : "role", hidden: false });
  }
  const mineByKey = new Map(mine.map((m) => [m.item_key, m]));
  for (const m of mine) {
    const hit = byKey.get(m.item_key);
    if (hit) hit.hidden = m.hidden;
    // A hidden row only means something on a default; a pin is un-pinned by deleting its row.
    else if (!m.hidden) byKey.set(m.item_key, { key: m.item_key, source: "mine", hidden: false });
  }

  const base = [...byKey.values()];
  const baseIndex = new Map(base.map((f, i) => [f.key, i]));
  const pos = (f: MergedFavorite) => mineByKey.get(f.key)?.position ?? null;
  // Arranged tiles first, in the person's order; never-arranged ones after, in the base order.
  return base.sort((a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    if (pa !== null && pb !== null) return pa - pb || baseIndex.get(a.key)! - baseIndex.get(b.key)!;
    if (pa !== null) return -1;
    if (pb !== null) return 1;
    return baseIndex.get(a.key)! - baseIndex.get(b.key)!;
  });
}
