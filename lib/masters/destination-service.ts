import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Destination } from "./destination-types";

export async function listDestinations(): Promise<Destination[]> {
  const s = await createClient();
  const { data } = await s
    .from("destinations")
    .select("*")
    .order("name", { nullsFirst: false });
  return (data ?? []) as Destination[];
}
