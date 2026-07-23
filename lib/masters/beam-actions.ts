"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { beamInput, type BeamInput } from "./beam-types";
import { checkDuplicateName } from "./dup-guard";
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
  revalidatePath("/masters/production");
  revalidatePath("/masters/production/beams");
}

export async function createBeam(data: BeamInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = beamInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "beams", p.data.beam_no, {
    nameColumn: "beam_no",
    label: "Beam No",
  });
  if (!dup.ok) return fail(dup.error);
  // Clear vendor when location_type is not 'P'
  const payload = {
    ...p.data,
    vendor_id: p.data.location_type === "P" ? p.data.vendor_id : null,
  };
  const { data: row, error } = await s.from("beams").insert(payload).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateBeam(id: string, data: BeamInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = beamInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "beams", p.data.beam_no, {
    nameColumn: "beam_no",
    label: "Beam No",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  // Clear vendor when location_type is not 'P'
  const payload = {
    ...p.data,
    vendor_id: p.data.location_type === "P" ? p.data.vendor_id : null,
  };
  const { error } = await s.from("beams").update(payload).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteBeam(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "beams", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
