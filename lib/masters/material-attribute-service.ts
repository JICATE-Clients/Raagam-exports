import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { MaterialAttribute } from "./material-attribute-types";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** What the usage check needs off a set: the pair that identifies it
 *  (`uq_material_attributes_class_category`, 0347, unique on exactly these two)
 *  and its line ids, which the list query has already loaded. */
type AttributeUsageInput = Pick<MaterialAttribute, "id" | "item_class_id" | "category_id"> & {
  lines?: { id: string }[] | null;
};

const pairKey = (itemClassId: string, categoryId: string) => `${itemClassId}|${categoryId}`;

/**
 * "In use by a Material" is NOT an FK — which is exactly why `deleteOrBlock`
 * kept offering Delete on a set a Material was using (client 2026-08-11).
 * `first_referencing_table` (0344) reads the catalog, so it sees only real
 * foreign keys one level deep, and this linkage is out of its reach twice over:
 *
 *  - a Material (`items`) has NO column pointing at `material_attributes.id`.
 *    The set IS its (Item Class + Category) pair — that is the whole meaning of
 *    the record, "for this pair, ask these questions";
 *  - the per-material ANSWERS (`item_attribute_values.attribute_line_id`, 0341)
 *    are TWO hops away, through `material_attribute_lines` — and that hop is
 *    `on delete cascade`, which the RPC skips by design (`confdeltype <> 'c'`),
 *    because for every other master a cascade child is the row's own detail.
 *
 * So no FK change fixes this and the guard has to be written out. Both halves
 * are counted, because neither contains the other:
 *
 *  - the PAIR is primary and is the half that still works after an edit;
 *  - the ANSWERS are counted too, but cannot be relied on alone. Until
 *    2026-08-27 `updateMaterialAttribute` replaced its lines wholesale, so an
 *    ordinary edit orphaned every answer of the set (`attribute_line_id` set to
 *    NULL) — live, the LABEL set read 2 materials by pair and 0 by answer. That
 *    action RECONCILES by `attribute_id` now and a save no longer orphans
 *    anything, but the pair stays primary: **the 10 rows already orphaned are
 *    not recoverable** (the value text cannot say which question it answered,
 *    and `audit_log` holds no entry for any attribute table), so the answer
 *    count still under-reports for every set edited before that date.
 *
 * Distinct item ids across both, so a material counted twice is one Material.
 *
 * COMPLETE ONLY WHILE `items` IS UNSCOPED. This counts under the caller's own
 * session, so it is exact only because every SELECT policy on `items` and
 * `item_attribute_values` is PERMISSIVE `using (true)` for `authenticated` with
 * no RESTRICTIVE policy and `relforcerowsecurity` false (re-verified 2026-08-11).
 * Give `items` a unit/factory/branch policy and this SILENTLY UNDER-REPORTS for
 * exactly the users that policy narrows — and no error handling can catch it,
 * because an RLS-filtered count is indistinguishable from a correct one at every
 * layer: an error has a signature, a quietly narrowed row set does not. At that
 * point the count must move to a `SECURITY DEFINER` RPC (mind AGENTS.md "Function
 * grants" — born anon-callable by two independent grants) or a `BEFORE DELETE`
 * trigger, which would also cover the paths this guard cannot reach at all.
 * Not built today: `items` has no scoping column yet, so its shape is unknown.
 *
 * TWO queries for the WHOLE list, never one per row. Both fetch rows and count
 * in JS rather than asking per set, which is what keeps this linear; the same
 * shape `listMaterials` already uses against `items`.
 */
export async function materialAttributeUsage(
  s: SupabaseClient,
  attrs: AttributeUsageInput[],
): Promise<Map<string, number>> {
  // Distinct item ids per attribute-set id — the two halves overlap.
  const items = new Map<string, Set<string>>();
  const add = (attrId: string, itemId: string) => {
    const set = items.get(attrId) ?? new Set<string>();
    set.add(itemId);
    items.set(attrId, set);
  };

  // ---- (b) the pair ----------------------------------------------------
  // A set with either half NULL is matched by nothing: the unique index is
  // partial on both-non-null, and a half-identified set means nothing.
  const byPair = new Map<string, string>();
  for (const a of attrs) {
    if (!a.item_class_id || !a.category_id) continue;
    byPair.set(pairKey(a.item_class_id, a.category_id), a.id);
  }
  if (byPair.size > 0) {
    const classIds = new Set<string>();
    const catIds = new Set<string>();
    for (const a of attrs) {
      if (!a.item_class_id || !a.category_id) continue;
      classIds.add(a.item_class_id);
      catIds.add(a.category_id);
    }
    // `.in` × `.in` is the CROSS PRODUCT of the two lists, i.e. a superset of
    // the pairs actually wanted — it narrows the rows fetched and nothing more.
    // The exact pair is matched in JS below; filtering on the SQL alone would
    // credit a material to a set that merely shares its Item Class.
    const { data, error } = await s
      .from("items")
      .select("id, item_class_id, category_id")
      .in("item_class_id", Array.from(classIds))
      .in("category_id", Array.from(catIds));
    // THROW, never swallow. A discarded error here reads as "used by 0
    // Materials", which is the exact verdict that lets the delete through —
    // the guard would disable itself on any transient failure and say nothing.
    // The caller decides what to do with that; both callers are below.
    if (error) throw new Error(`Could not read Materials to check attribute-set usage: ${error.message}`);
    // An INACTIVE material still counts. The row exists and still answers this
    // set's questions; a master switched off is not a master deleted.
    for (const row of (data ?? []) as { id: string; item_class_id: string | null; category_id: string | null }[]) {
      if (!row.item_class_id || !row.category_id) continue;
      const attrId = byPair.get(pairKey(row.item_class_id, row.category_id));
      if (attrId) add(attrId, row.id);
    }
  }

  // ---- (c) the stored answers ------------------------------------------
  const attrByLine = new Map<string, string>();
  for (const a of attrs) for (const l of a.lines ?? []) attrByLine.set(l.id, a.id);
  if (attrByLine.size > 0) {
    const { data, error } = await s
      .from("item_attribute_values")
      .select("item_id, attribute_line_id")
      .in("attribute_line_id", Array.from(attrByLine.keys()));
    if (error) throw new Error(`Could not read Material answers to check attribute-set usage: ${error.message}`);
    for (const row of (data ?? []) as { item_id: string; attribute_line_id: string | null }[]) {
      const attrId = row.attribute_line_id ? attrByLine.get(row.attribute_line_id) : undefined;
      if (attrId) add(attrId, row.item_id);
    }
  }

  return new Map(Array.from(items, ([id, set]) => [id, set.size]));
}

/** One wording for the list column and the refused-delete message, so the badge
 *  the operator saw and the error they get back cannot disagree. */
export function materialsUsedByLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} Material${count === 1 ? "" : "s"}`;
}

export async function listMaterialAttributes(): Promise<MaterialAttribute[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_attributes")
    .select("*, lines:material_attribute_lines(*, options:material_attribute_line_options(*))")
    .order("created_at");
  const rows = ((data ?? []) as MaterialAttribute[]).map((m) => ({
    ...m,
    lines: [...(m.lines ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((l) => ({ ...l, options: [...(l.options ?? [])].sort((a, b) => a.sno - b.sno) })),
  }));
  // The two halves fail in OPPOSITE directions on purpose. Here the flag is only
  // a courtesy — it greys a button — so a failed count degrades to "not known to
  // be in use" and the screen keeps working; disabling every Delete on a
  // transient read would block legitimate work. `deleteMaterialAttribute` fails
  // CLOSED on the same error, so an enabled button still gets refused: the worst
  // case is a confusing refusal, never a set deleted out from under a Material.
  //
  // WHAT KEEPS THE PERMISSIVE HALF SAFE IS THAT THIS FLAG IS NEVER AN INPUT TO
  // THE ACTION. `deleteMaterialAttribute` re-fetches the set and RECOUNTS; it
  // never trusts `in_use` from the client. "Optimise" that by posting the flag
  // through and a degraded list stops being harmless the same day, because the
  // enabled button becomes the verdict instead of merely preceding it.
  let usage = new Map<string, number>();
  try {
    usage = await materialAttributeUsage(s, rows);
  } catch (e) {
    // Say so. A silent degradation is indistinguishable from "nothing is in
    // use": every bin goes live, the column reads empty, and the operator gets
    // a refusal loop from the action with no breadcrumb anywhere to explain it.
    console.error("[material-attributes] usage check failed; Delete shown as available:", e);
    usage = new Map();
  }
  return withCreators(
    rows.map((m) => {
      const used_by = materialsUsedByLabel(usage.get(m.id) ?? 0);
      return { ...m, in_use: used_by !== null, used_by };
    }),
  );
}
