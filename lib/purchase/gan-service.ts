import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GanQualityCheck, GanQualityParameter } from "./gan-types";
import { withCreators } from "@/lib/created-by";

export type GanWithParams = GanQualityCheck & {
  parameters: GanQualityParameter[];
};

export async function listGanChecks(grnId: string): Promise<GanQualityCheck[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gan_quality_checks")
    .select("*")
    .eq("grn_id", grnId)
    .order("created_at");
  return withCreators((data ?? []) as GanQualityCheck[]);
}

export async function getGanCheck(id: string): Promise<GanWithParams | null> {
  const supabase = await createClient();

  const { data: check } = await supabase
    .from("gan_quality_checks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!check) return null;

  const { data: params } = await supabase
    .from("gan_quality_parameters")
    .select("*")
    .eq("check_id", id)
    .order("sort_order");

  return {
    ...(check as GanQualityCheck),
    parameters: (params ?? []) as GanQualityParameter[],
  };
}
