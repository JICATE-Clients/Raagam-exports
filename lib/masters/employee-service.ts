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
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as EmployeeLocation[];
}
