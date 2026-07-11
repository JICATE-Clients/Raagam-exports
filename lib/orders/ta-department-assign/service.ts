import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listEmployeeLocations } from "@/lib/masters/employee-service";
import type { EmployeeLocation } from "@/lib/masters/employee-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { PickerItem } from "@/components/masters/record-picker";
import type { TaDepartmentAssign } from "./types";

export async function getTaDepartmentAssigns(): Promise<TaDepartmentAssign[]> {
  const s = await createClient();
  const { data } = await s
    .from("ta_department_assigns")
    .select(
      "*, location:locations(id, code, name), department:config_lookups(id, code, name), " +
        "lines:ta_department_assign_lines(*, activity:ta_activities(id, short_name, name))",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as TaDepartmentAssign[]).map((d) => ({
    ...d,
    lines: [...(d.lines ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}

export type TaDeptAssignFormData = {
  locations: EmployeeLocation[];
  departments: ConfigLookup[];
  activities: PickerItem[];
};

/** Picker option lists the editor needs, fetched in parallel. */
export async function getTaDeptAssignFormData(): Promise<TaDeptAssignFormData> {
  const s = await createClient();
  const [locations, deptRes, actRes] = await Promise.all([
    listEmployeeLocations(),
    s.from("config_lookups").select("*").eq("kind", "department").eq("is_active", true).order("name"),
    s.from("ta_activities").select("id, short_name, name").eq("is_active", true).order("name"),
  ]);

  const activities: PickerItem[] = (
    (actRes.data ?? []) as { id: string; short_name: string; name: string }[]
  ).map((a) => ({ id: a.id, code: a.short_name, name: a.name }));

  return {
    locations,
    departments: (deptRes.data ?? []) as ConfigLookup[],
    activities,
  };
}
