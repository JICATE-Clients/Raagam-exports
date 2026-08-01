import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Employee, EmployeeLocation } from "./employee-types";

export async function listEmployees(): Promise<Employee[]> {
  const s = await createClient();
  const { data } = await s.from("employees").select("*").order("name");
  return (data ?? []) as Employee[];
}

/** Locations master (GST entities) for the Employee Location picker. */
export async function listEmployeeLocations(): Promise<EmployeeLocation[]> {
  const s = await createClient();
  const { data } = await s
    .from("locations")
    // Flag selected, not filtered on: this list also backs the editor of an
    // existing employee, and an employee posted to a since-closed location must
    // still show it. LocationPicker hides it from the choices.
    .select("id, code, name, is_active")
    .order("name");
  return (data ?? []) as EmployeeLocation[];
}
