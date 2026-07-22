import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DefectDetail, DefectGroup } from "./defect-detail-types";

export async function listDefectDetails(): Promise<DefectDetail[]> {
  const s = await createClient();
  const { data } = await s
    .from("defect_details")
    .select("*, defect_group:defect_groups(id,name)")
    .order("defect_catg_id")
    .order("defect_id")
    .order("defect_det_id");
  return (data ?? []) as DefectDetail[];
}

export async function listDefectGroups(): Promise<DefectGroup[]> {
  const s = await createClient();
  const { data } = await s.from("defect_groups").select("id, name").order("name");
  return (data ?? []) as DefectGroup[];
}
