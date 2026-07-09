import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Holiday } from "./holiday-types";

export async function listHolidays(): Promise<Holiday[]> {
  const s = await createClient();
  const { data } = await s.from("holidays").select("*").order("holiday_date");
  return (data ?? []) as Holiday[];
}
