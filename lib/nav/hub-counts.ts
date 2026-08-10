import "server-only";
import { createClient } from "@/lib/supabase/server";
import { HUB_COUNT_TABLES } from "./hub-count-map";

export { hubCountTable, declaredCountHrefs } from "./hub-count-map";

/**
 * Live record counts for the cards on a sub-module hub.
 *
 * ## Why this file exists
 *
 * `/masters/materials` has shown a per-entity record count on every card since
 * it was built, and it is the single thing that makes that hub readable: an
 * operator can see at a glance which masters are populated and which are still
 * empty. The other 37 hubs (`components/shell/group-hub.tsx`, rendering
 * `lib/nav/module-groups.ts`) show no number at all. This is the data half of
 * closing that gap.
 *
 * The Materials page gets its counts by calling seventeen list services and
 * taking `.length` — every row of every master, fetched in full, to display a
 * number. That does not scale to 129 cards, and the naive alternative (one
 * `count: "exact", head: true` per card, the shape `lib/dashboard/service.ts`
 * uses) is thirteen HTTP round-trips on a hub page. So the counts go through
 * ONE RPC — `hub_record_counts(text[])`, migration 0391 — which is SECURITY
 * INVOKER and therefore counts exactly what the caller's RLS policies allow.
 * Read that migration's header before changing anything here.
 *
 * ## ABSENT IS NOT ZERO
 *
 * The returned `Map` has a key ONLY for a card that has a real, readable,
 * countable table behind it. Everything else — a report view, a tool, a hub
 * that links to another hub, a table this user cannot read, a screen whose
 * table was never built — is simply not in the map, and the card renders with
 * no number.
 *
 * That distinction carries the whole meaning. `0` says "this screen is empty,
 * go and add the first record"; absent says "a record count is not a thing
 * this card has". Defaulting an unmeasurable card to 0 would paint two dozen
 * perfectly healthy screens as empty and send operators looking for data that
 * was never supposed to be there.
 *
 * ## The map is keyed on href, and lives next door
 *
 * `lib/nav/module-groups.ts` must stay a compile-time literal with no runtime
 * imports — `scripts/check-module-groups.mts` runs under
 * `node --experimental-strip-types` and cannot resolve `@/`. Keying on `href`
 * instead of adding a `countKey` to every one of the 129 entries keeps the
 * registry a pure navigation declaration, and means a card listed in two groups
 * (`/orders` and `/orders/styles` both are) cannot be given two different
 * tables.
 *
 * The literal itself is `lib/nav/hub-count-map.ts`, split out for the same
 * reason — it has no imports, so a check can read it under type stripping while
 * this file's `server-only` Supabase call stays out of the way.
 */

/**
 * Live record counts for a hub's cards, in ONE database round-trip.
 *
 * Takes the group's `children` structurally (`{ href }[]`) rather than importing
 * `GroupChild`, so this module never imports `lib/nav/module-groups.ts` and the
 * registry keeps its no-runtime-imports guarantee in both directions.
 *
 * A card is in the returned Map only when a number genuinely applies to it —
 * see "ABSENT IS NOT ZERO" above. A card whose table is empty is present with
 * the value `0`, and that is a different statement.
 */
export async function hubCounts(
  children: readonly { href: string }[],
): Promise<Map<string, number>> {
  const tables = [
    ...new Set(
      children
        .map((c) => HUB_COUNT_TABLES[c.href])
        .filter((t): t is string => typeof t === "string"),
    ),
  ];
  if (tables.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hub_record_counts", {
    p_tables: tables,
  });

  if (error) {
    // A hub is navigation. It must render with no numbers rather than 500
    // because a count failed — including before 0391 has been applied to the
    // environment, which is exactly the state a fresh clone is in.
    console.warn("[hub-counts] hub_record_counts failed:", error.message);
    return new Map();
  }

  const byTable = new Map<string, number>();
  for (const row of (data ?? []) as { table_name: string; row_count: number }[]) {
    byTable.set(row.table_name, Number(row.row_count));
  }

  const byHref = new Map<string, number>();
  for (const c of children) {
    const table = HUB_COUNT_TABLES[c.href];
    if (typeof table !== "string") continue;
    const n = byTable.get(table);
    // No row came back: unknown table, not a relation, or not readable by this
    // caller. All three mean "no count", never 0.
    if (n === undefined) continue;
    byHref.set(c.href, n);
  }
  return byHref;
}
