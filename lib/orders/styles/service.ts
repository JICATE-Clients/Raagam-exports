import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listCountries } from "@/lib/masters/country-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listSizeGroups } from "@/lib/masters/size-group-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { SizeGroup } from "@/lib/masters/size-group-types";
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

/** All styles with embedded customer + child grids (mirrors listCustomers). */
export async function getGarmentStyles(): Promise<GarmentStyle[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_styles")
    .select(
      "*, customer:customers(id,code,name), " +
        "coordinates:garment_style_coordinates(*), " +
        // The nested embed is what carries a component's processes (0392). The
        // grid is per-component, so they cannot be a flat child of the style.
        "components:garment_style_components(*, processes:garment_style_component_processes(*)), " +
        "sizes:garment_style_sizes(*)",
    )
    .order("created_at", { ascending: false });

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
 * Approved samples for the "Approved Sample No" picker. NOTE: samples have no
 * human sample-number column (only id + type + status) — see
 * doc/masters-open-questions.md. We surface approved ones labelled by type.
 */
async function getApprovedSampleRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("samples")
    .select("id, type, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return ((data ?? []) as { id: string; type: string; created_at: string }[]).map(
    (r) => ({
      id: r.id,
      code: r.type,
      name: `${r.type} — ${r.created_at.slice(0, 10)}`,
    }),
  );
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
    .select("id, code, name, item_class_id, is_active")
    .order("name");
  return ((data ?? []) as FabricRow[]).filter(
    (i) => i.item_class_id && fabricIds.has(i.item_class_id),
  );
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
};

export type StyleFormData = {
  customers: Customer[];
  countries: Country[];
  uoms: PickerRow[];
  samples: PickerRow[];
  lookups: ConfigLookup[];
  fabrics: FabricRow[];
  processes: PickerRow[];
  sizeGroups: SizeGroup[];
};

/** Every picker option list the Style editor needs, fetched in parallel. */
export async function getStyleFormData(): Promise<StyleFormData> {
  const [customers, countries, uoms, samples, lookups, fabrics, processes, sizeGroups] =
    await Promise.all([
      listCustomers(),
      listCountries(),
      getUomRows(),
      getApprovedSampleRows(),
      listConfigLookups(),
      getFabricRows(),
      getComponentProcessRows(),
      listSizeGroups(),
    ]);
  return { customers, countries, uoms, samples, lookups, fabrics, processes, sizeGroups };
}
