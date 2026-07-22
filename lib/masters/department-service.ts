import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Department } from "./department-types";

/** All departments with their Location grid rows (sno-ordered). */
export async function listDepartments(): Promise<Department[]> {
  const s = await createClient();
  const { data } = await s
    .from("departments")
    .select("*, locations:department_locations(id, sno, location_id, all_divisions, divisions:department_location_divisions(id, division_id, sno))")
    .order("short_name");
  return ((data ?? []) as Department[]).map((d) => ({
    ...d,
    item_classes: d.item_classes ?? [],
    locations: [...(d.locations ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}
