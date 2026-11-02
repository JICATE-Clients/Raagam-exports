"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { binInput, type BinInput } from "./bin-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";
import { getCurrentLocation } from "@/lib/auth/location";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/bins");
}

export async function createBin(data: BinInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = binInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "bins", p.data.bin_code, { nameColumn: "bin_code" });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("bins").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateBin(id: string, data: BinInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = binInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "bins", p.data.bin_code, { nameColumn: "bin_code", excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("bins").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteBin(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "bins", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

/**
 * A BIN MADE WHERE IT IS NEEDED (user 2026-11-02). The "Add Bin" form behind a bin box's
 * "+ Add" (GRN / QC / Edit GRN) creates the bin in the unit the keeper is working in — a bin at Raagam HO belongs to HO —
 * through `createBin`'s own rules (permission, schema, duplicate guard).
 */
export async function createBinInCurrentUnit(binCode: string, description: string | null = null): Promise<CreateResult> {
  const { location } = await getCurrentLocation();
  if (!location) return fail("Pick your working unit in the top bar first");
  return createBin({
    bin_code: binCode.trim().toUpperCase(),
    location_id: location.id,
    description: description?.trim().toUpperCase() || null,
    inactive: false,
  });
}
