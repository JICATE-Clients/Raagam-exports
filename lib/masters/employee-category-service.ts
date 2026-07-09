import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeCategory } from "./employee-category-types";

export async function listEmployeeCategories(): Promise<EmployeeCategory[]> {
  const s = await createClient();
  const { data } = await s.from("employee_categories").select("*").order("name");
  return (data ?? []) as EmployeeCategory[];
}
