import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listSizeGroups } from "@/lib/masters/size-group-service";
import { listCategories } from "@/lib/masters/category-service";
import { listLevies } from "@/lib/masters/levy-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { SizeGroup } from "@/lib/masters/size-group-types";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { GarmentStyle } from "./types";
import { withCreators } from "@/lib/created-by";

/**
 * A row normalized to {id, code, name} for a RecordPicker.
 *
 * `inactive` is optional and carried, not filtered out: `RecordPicker` hides a
 * switched-off row itself but keeps the one a record already holds, tagged
 * "(inactive)". A service that dropped them in SQL would show a filled field as
 * empty and blank the FK on the next save — the standing "Disabled rows" rule.
 */
export type PickerRow = { id: string; code: string | null; name: string; inactive?: boolean };

/**
 * A component option, carrying the two fields that say which coordinates it
 * belongs to (`lib/masters/component-coordinates.ts`).
 *
 * Widened rather than filtered here, and for the same reason `PickerRow` above
 * carries `inactive` rather than dropping switched-off rows in SQL: the
 * narrowing depends on the Coordinate cell BESIDE the Component cell, which
 * changes per row and without a round trip. A service cannot answer it, and a
 * screen that re-derived it would be a second copy of the rule.
 *
 * Still assignable to `PickerRow`, so every existing picker call site is
 * unaffected.
 */
export type ComponentPickerRow = PickerRow & {
  all_coordinates: boolean;
  coordinate_names: string[];
};

/** All styles with embedded customer + child grids (mirrors listCustomers). */
export async function getGarmentStyles(): Promise<GarmentStyle[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_styles")
    .select(
      "*, customer:customers(id,code,name), " +
        // The nested embed is what carries a component's processes (0392). The
        // grid is per-component, so they cannot be a flat child of the style.
        "coordinates:garment_style_coordinates(*), " +
        "components:garment_style_components(*, processes:garment_style_component_processes(*)), " +
        "sizes:garment_style_sizes(*)",
    )
    .order("created_at", { ascending: false });

  /**
   * A FAILED QUERY IS NOT AN EMPTY TABLE.
   *
   * This was `const { data } = …` with `data ?? []` below, so any error became a
   * list of zero styles — no error boundary, no console, nothing. It hid a real
   * outage for days (found 2026-08-10): `garment_style_component_processes` does
   * not exist until 0392 is applied, so the embed above returned HTTP 400 and
   * EVERY request rendered an empty Style list. The screen looked like a shop
   * with no styles entered yet.
   *
   * That is the same failure shape as the `created_by` sweep — "not an error,
   * not a missing column, just empty" — and it is the reason the shape is worth
   * refusing rather than tidying. Throwing hands it to the route's error
   * boundary, which says something is broken instead of quietly lying.
   *
   * Only 4 of 103 services in this repo check `error`; this is the house pattern
   * where it is checked (`lib/hr/*-service.ts`), not a new invention.
   */
  if (error) throw new Error(`Could not load styles: ${error.message}`);

  return withCreators(((data ?? []) as unknown as GarmentStyle[]).map((r) => ({
    ...r,
    coordinates: [...(r.coordinates ?? [])].sort((a, b) => a.sno - b.sno),
    components: [...(r.components ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((c) => ({ ...c, processes: [...(c.processes ?? [])].sort((a, b) => a.sno - b.sno) })),
    sizes: [...(r.sizes ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}

/** UOMs normalized for the Unit RecordPicker. */
async function getUomRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s.from("uoms").select("id, code, name").order("name");
  return (data ?? []) as PickerRow[];
}

/**
 * Approved samples for the "Approved Sample No" picker.
 *
 * IT SHOWS THE SAMPLE NUMBER NOW. The note that used to sit here — "samples
 * have no human sample-number column (only id + type + status)" — stopped being
 * true at migration 0272, which added `samples.code` (SMP-0001) with a unique
 * index and an `assign_code` trigger. It went on labelling rows `proto —
 * 2026-08-13` regardless, so a field called "Approved Sample **No**" was the
 * one place in the app that could not show one.
 *
 * The type and date stay in the label, after the number: two samples of one
 * style differ by exactly that, and a bare SMP-0004 is not something an
 * operator can recognise across a list.
 *
 * `code` FALLS BACK TO THE TYPE rather than to nothing. Every row inserted
 * since 0272 has a number; anything older does not, and a picker row with a
 * blank code is unsearchable — the operator types what they see and matches
 * nothing.
 *
 * The list is EMPTY in this database — `samples` has no rows at all — which is
 * why "Approved Sample No" is no longer a required field (client 2026-08-13);
 * see the note on the Save gate in the Style screen.
 */
async function getApprovedSampleRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("samples")
    .select("id, code, type, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return (
    (data ?? []) as { id: string; code: string | null; type: string; created_at: string }[]
  ).map((r) => ({
    id: r.id,
    code: r.code ?? r.type,
    name: `${r.code ?? r.type} — ${r.type}, ${r.created_at.slice(0, 10)}`,
  }));
}

/**
 * Fabrics for the Components grid.
 *
 * There is no fabric table — a fabric is an `items` row whose class is FABRIC.
 * Scoped HERE rather than in the screen, per the cascading-picker rule: the
 * layer that knows the class does the narrowing, and `ItemPicker` has no class
 * filter of its own.
 *
 * The `is_active` / `inactive` flags ride along deliberately — the picker hides
 * a switched-off row itself but must still show the one a component already
 * holds, so a service that pre-filtered them out in SQL would blank a saved
 * fabric. That is the standing "Disabled rows" rule.
 */
async function getFabricRows(): Promise<FabricRow[]> {
  const s = await createClient();
  const { data: classes } = await s
    .from("config_lookups")
    .select("id, code")
    .eq("kind", "item_class");
  const fabricIds = new Set(
    ((classes ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "FABRIC")
      .map((c) => c.id),
  );
  if (fabricIds.size === 0) return [];

  const { data } = await s
    .from("items")
    .select("id, code, name, item_class_id, is_active, fabric_structure_id, fabric_type_id")
    .order("name");
  return ((data ?? []) as FabricRow[]).filter(
    (i) => i.item_class_id && fabricIds.has(i.item_class_id),
  );
}

/**
 * Coordinates — `items` under item class GARMENTS.
 *
 * A COORDINATE IS A GARMENT (0396). A Set style is two to six garments sold
 * together, so TOP / BOTTOM / INNER / OUTER / PIECES are `items` of class GAR,
 * not values of a `coordinate` lookup. That lookup held two rows named "1" and
 * "2" and nothing had ever maintained it.
 *
 * Scoped HERE, not in the screen — the same cascading-picker rule `getFabricRows`
 * follows, and for the same reason: `ItemPicker` has no class filter of its own.
 * The disable flag rides along so a coordinate a style already holds still
 * resolves after someone switches it off.
 */
async function getGarmentRows(): Promise<FabricRow[]> {
  const s = await createClient();
  const { data: classes } = await s
    .from("config_lookups")
    .select("id, code")
    .eq("kind", "item_class");
  const garIds = new Set(
    ((classes ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === "GAR")
      .map((c) => c.id),
  );
  if (garIds.size === 0) return [];

  const { data } = await s
    .from("items")
    .select("id, code, name, item_class_id, is_active, fabric_structure_id, fabric_type_id")
    .order("name");
  return ((data ?? []) as FabricRow[]).filter(
    (i) => i.item_class_id && garIds.has(i.item_class_id),
  );
}

/**
 * Components — the real `components` master (0228), whose own header calls
 * itself a promotion of the "too thin" flat `component` lookup kind. The Style
 * screen was pointed at a THIRD list, kind 'style_component', which held zero
 * rows (0396).
 *
 * `short_name` is the master's display field; **`inactive` is its disable flag,
 * not `blocked`** — 0299 renamed the column on every Master Data table, and this
 * function asked for the old name. PostgREST answers a select over a column that
 * does not exist with an ERROR, not with nulls, so `data` came back null and this
 * returned `[]`: the Component cell was an empty dropdown on every row, the same
 * symptom 0396 had just fixed by repointing it off a lookup kind that held no
 * rows. Two ways to be wrong about one field, and the second read as the first.
 *
 * The near miss is worth naming, because `blocked` is CORRECT eleven lines from
 * here: 0299's header excludes `garment_styles` and `ta_styles` as Orders-module
 * tables, so this one file legitimately spells the flag both ways. Read it
 * through `isInactive()` rather than by hand wherever the row type allows.
 */
async function getComponentRows(): Promise<ComponentPickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("components")
    .select("id, short_name, inactive, all_coordinates, coordinates:component_coordinates(coordinate)")
    .order("short_name");
  return (
    (data ?? []) as {
      id: string;
      short_name: string;
      inactive: boolean | null;
      all_coordinates: boolean | null;
      coordinates: { coordinate: string | null }[] | null;
    }[]
  ).map((c) => ({
    id: c.id,
    code: null,
    name: c.short_name,
    inactive: c.inactive ?? false,
    // `all_coordinates` is NOT NULL with default true in 0228, so the coalesce
    // is for the shape PostgREST hands back, not for a row that could be null.
    // Defaulting the OTHER way would hide every component behind an empty
    // coordinate list — see `componentAllowsCoordinate`'s third case.
    all_coordinates: c.all_coordinates ?? true,
    coordinate_names: (c.coordinates ?? [])
      .map((x) => x.coordinate ?? "")
      .filter(Boolean),
  }));
}

/**
 * Processes offered on a component line.
 *
 * `for_components` is the master's own applicability flag (0227) — the same
 * question this grid is asking, already answered on the master. There is no
 * printing/embroidery discriminator to filter on; those are process NAMES.
 */
async function getComponentProcessRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("processes")
    .select("id, name, inactive")
    .eq("for_components", true)
    .order("name");
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null }[]).map((p) => ({
    id: p.id,
    code: null,
    name: p.name,
    inactive: p.inactive ?? false,
  }));
}

/** A fabric option — the whole row, so the picker can read the disable flag. */
export type FabricRow = {
  id: string;
  code: string;
  name: string;
  item_class_id: string | null;
  is_active: boolean | null;
  /**
   * THE FABRIC'S OWN STRUCTURE AND TYPE, off the item master (0279).
   *
   * These are what let picking a Fabric fill the Structure and Type beside it
   * on the Components grid. They are the master's answer, not a guess: a row
   * like "MELANGE SINGLE JERSEY (24'S GREY MELANGE) 100%" carries
   * `fabric_type_id` -> Melange, and "SOLID FLEECE (…)" carries -> Solid.
   *
   * Null on a garment row (`getGarmentRows` shares this type) and on any fabric
   * whose master record has not been filled in — which is why the screen treats
   * null as LEAVE THE CELL ALONE rather than writing it through.
   */
  fabric_structure_id: string | null;
  fabric_type_id: string | null;
};

export type StyleFormData = {
  customers: Customer[];
  /* `countries` left with the Country field (client 2026-08-11). It was a
     `listCountries()` on every page load feeding one picker; nothing reads it
     now, and a fetch no caller consumes is work the operator waits for. The
     COLUMN `garment_styles.country_id` is untouched — see types.ts. */
  uoms: PickerRow[];
  samples: PickerRow[];
  lookups: ConfigLookup[];
  fabrics: FabricRow[];
  processes: PickerRow[];
  sizeGroups: SizeGroup[];
  /**
   * The Category master, UNSCOPED. The screen filters it to the chosen Item
   * Class, exactly as material-master-screen.tsx does — the cascade is a
   * client concern because the class changes without a round trip.
   */
  /** Coordinates: `items` of class GARMENTS (0396). */
  garments: FabricRow[];
  /** The `components` master (0228), not the empty lookup kind. Carries each
   *  component's coordinate scope so the grid can narrow the cell per row. */
  componentRows: ComponentPickerRow[];
  categories: Category[];
  /**
   * Only here to reach `CategoryQuickCreateSheet`. `CategoryPicker` switches
   * its "+ Add" from the name-only inline form to the full class-aware sheet
   * ONLY when handed both `levies` and `fabricStructures` (`useFullQc` in
   * lookup-picker.tsx) — so omitting this silently downgrades the control the
   * client asked for, with no error anywhere.
   */
  levies: Levy[];
};

/** Every picker option list the Style editor needs, fetched in parallel. */
export async function getStyleFormData(): Promise<StyleFormData> {
  const [customers, uoms, samples, lookups, fabrics, processes, sizeGroups, categories, levies, garments, componentRows] =
    await Promise.all([
      listCustomers(),
      getUomRows(),
      getApprovedSampleRows(),
      listConfigLookups(),
      getFabricRows(),
      getComponentProcessRows(),
      listSizeGroups(),
      listCategories(),
      listLevies(),
      getGarmentRows(),
      getComponentRows(),
    ]);
  return {
    customers, uoms, samples, lookups, fabrics, processes, sizeGroups,
    categories, levies, garments, componentRows,
  };
}
