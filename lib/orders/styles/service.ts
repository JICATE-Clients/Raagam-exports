import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listCountries } from "@/lib/masters/country-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import type { Customer } from "@/lib/masters/customer-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { GarmentStyle } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string };

/** All styles with embedded customer + child grids (mirrors listCustomers). */
export async function getGarmentStyles(): Promise<GarmentStyle[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_styles")
    .select(
      "*, customer:customers(id,code,name), " +
        "coordinates:garment_style_coordinates(*), " +
        "components:garment_style_components(*), " +
        "sizes:garment_style_sizes(*)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as GarmentStyle[]).map((r) => ({
    ...r,
    coordinates: [...(r.coordinates ?? [])].sort((a, b) => a.sno - b.sno),
    components: [...(r.components ?? [])].sort((a, b) => a.sno - b.sno),
    sizes: [...(r.sizes ?? [])].sort((a, b) => a.sno - b.sno),
  }));
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

export type StyleFormData = {
  customers: Customer[];
  countries: Country[];
  uoms: PickerRow[];
  samples: PickerRow[];
  lookups: ConfigLookup[];
};

/** Every picker option list the Style editor needs, fetched in parallel. */
export async function getStyleFormData(): Promise<StyleFormData> {
  const [customers, countries, uoms, samples, lookups] = await Promise.all([
    listCustomers(),
    listCountries(),
    getUomRows(),
    getApprovedSampleRows(),
    listConfigLookups(),
  ]);
  return { customers, countries, uoms, samples, lookups };
}
