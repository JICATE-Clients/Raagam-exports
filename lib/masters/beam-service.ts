import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Beam, BeamVendorOption } from "./beam-types";

export async function listBeams(): Promise<Beam[]> {
  const s = await createClient();
  const { data } = await s
    .from("beams")
    .select("*, vendor:master_vendors(id,name)")
    .order("beam_no", { nullsFirst: false });
  return (data ?? []) as Beam[];
}

export async function listBeamVendors(): Promise<BeamVendorOption[]> {
  const s = await createClient();
  const { data } = await s.from("master_vendors").select("id, name").order("name");
  return (data ?? []) as BeamVendorOption[];
}
