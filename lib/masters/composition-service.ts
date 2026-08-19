import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Composition } from "./composition-types";
import type { PickerItem } from "@/components/masters/record-picker";
import type { CompositionBlend } from "@/lib/orders/amendments/combo-rules";

export async function listCompositions(): Promise<Composition[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("compositions")
    .select("*, lines:composition_lines(*)")
    .order("name", { nullsFirst: false });
  // THROW, never swallow. This read used to be `const { data } =`, and that is
  // not a style preference — PostgREST fails the WHOLE query on one unknown
  // column, so a wrong column name arrived here as `data = null`, became
  // `[]`, and printed an empty master at the operator with no error anywhere.
  // That is exactly how the order-side composition picker spent months looking
  // unwired (0430's second charge against this table). Same `if (error) throw`
  // every service in lib/orders/amendments carries, for the same reason.
  if (error) throw new Error(`Could not load compositions: ${error.message}`);
  return withCreators(((data ?? []) as Composition[]).map((c) => ({
    ...c,
    lines: [...(c.lines ?? [])].sort((x, y) => x.sno - y.sno),
  })));
}

/**
 * A composition as a PICKER row — plus the lines the order side matches on.
 *
 * `PickerItem & CompositionBlend`: one value serves both jobs, so the list the
 * operator picks from and the list `compositionForStructure()` derives against
 * can never be two different lists.
 *
 * Separate from `listCompositions` above deliberately. That one selects `*`,
 * embeds every line column and resolves creator names for the master's own
 * listing — none of which a grid cell needs, and it is called once per page
 * load of a screen that renders ~20 other option lists.
 */
// created-by: exempt -- options feeder for a picker, not a listing
export async function listCompositionsForPicker(): Promise<CompositionPickerRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("compositions")
    // `inactive` is SELECTED and never filtered in SQL. Filtering satisfies half
    // the Disabled Rows rule and breaks the other half: a composition an order
    // already holds would resolve to nothing, the cell would render empty, and
    // the next save would blank the FK. `RecordPicker` reads the flag straight
    // off the row (`PickerItem & Deactivatable`), so nothing has to map it.
    //
    // `lines` ride along because the derivation matches on them and a round
    // trip per structure row is not an option. The embed needs no constraint
    // name: `composition_lines` has exactly one FK back to `compositions`,
    // unlike `material_mixings`, whose two FKs to `items` force `getFabricRows`
    // to spell its own out in full.
    .select("id, short_name, name, inactive, lines:composition_lines(category_id, mixing_pct)")
    .order("name", { nullsFirst: false });
  if (error) {
    throw new Error(`Could not load compositions for the picker: ${error.message}`);
  }
  return (data ?? []).map((c) => ({
    id: c.id as string,
    code: (c.short_name as string | null) ?? null,
    // `name` is nullable in the schema. It is the blend itself since the master
    // began composing it from its own Mixing grid, so it is the right label —
    // but a pre-composition row can still be holding nothing.
    name: (c.name as string | null) ?? (c.short_name as string | null) ?? "(unnamed composition)",
    inactive: (c.inactive as boolean | null) ?? false,
    lines: ((c.lines ?? []) as { category_id: string | null; mixing_pct: number }[]).map((l) => ({
      category_id: l.category_id,
      mixing_pct: Number(l.mixing_pct),
    })),
  }));
}

export type CompositionPickerRow = PickerItem & CompositionBlend;
