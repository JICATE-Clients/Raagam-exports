"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { defectDetailInput, type DefectDetailInput } from "./defect-detail-types";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/quality");
  revalidatePath("/masters/quality/defect-details");
}

export async function createDefectDetail(data: DefectDetailInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = defectDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Check composite uniqueness on (defect_catg_id, defect_id, defect_det_id)
  const { data: existing } = await s
    .from("defect_details")
    .select("id")
    .eq("defect_catg_id", p.data.defect_catg_id)
    .eq("defect_id", p.data.defect_id)
    .eq("defect_det_id", p.data.defect_det_id)
    .limit(1);
  if (existing && existing.length > 0)
    return fail(`Code "${p.data.defect_catg_id}.${p.data.defect_id}.${p.data.defect_det_id}" already exists.`);
  const { data: row, error } = await s.from("defect_details").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateDefectDetail(id: string, data: DefectDetailInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = defectDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Check composite uniqueness excluding the current row
  const { data: existing } = await s
    .from("defect_details")
    .select("id")
    .eq("defect_catg_id", p.data.defect_catg_id)
    .eq("defect_id", p.data.defect_id)
    .eq("defect_det_id", p.data.defect_det_id)
    .neq("id", id)
    .limit(1);
  if (existing && existing.length > 0)
    return fail(`Code "${p.data.defect_catg_id}.${p.data.defect_id}.${p.data.defect_det_id}" already exists.`);
  const { error } = await s.from("defect_details").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDefectDetail(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "defect_details", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
