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

/**
 * THE NEXT CODE FROM THE STORE'S PREFIX (0800, user 2026-11-03). YARN- with YARN-001 and
 * YARN-007 already there gives YARN-008: one past the highest number after the prefix,
 * three digits. Null when the store has no prefix.
 */
async function nextBinCode(s: Awaited<ReturnType<typeof createClient>>, storeId: string): Promise<string | null> {
  const { data: store } = await s.from("stores").select("bin_prefix").eq("id", storeId).maybeSingle();
  const prefix = ((store as { bin_prefix: string | null } | null)?.bin_prefix ?? "").trim().toUpperCase();
  if (!prefix) return null;
  const { data: rows } = await s.from("bins").select("bin_code").ilike("bin_code", `${prefix}%`);
  let top = 0;
  for (const r of (rows ?? []) as { bin_code: string | null }[]) {
    const tail = (r.bin_code ?? "").toUpperCase().slice(prefix.length);
    if (/^\d+$/.test(tail)) top = Math.max(top, Number(tail));
  }
  return `${prefix}${String(top + 1).padStart(3, "0")}`;
}

export async function createBin(data: BinInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = binInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  if (!p.data.bin_code.trim()) {
    const next = await nextBinCode(s, p.data.store_id);
    if (!next) return fail("Enter a bin code, or give this store a Bin Prefix on the Stores master");
    p.data.bin_code = next;
  }
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
  if (!p.data.bin_code.trim()) return fail("Bin code is required");
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
export async function createBinInCurrentUnit(
  binCode: string,
  description: string | null = null,
  /** The store the bin box is picking into (0800): the new bin belongs to it. */
  storeId: string | null = null,
): Promise<CreateResult> {
  const { location } = await getCurrentLocation();
  if (!location) return fail("Pick your working unit in the top bar first");
  if (!storeId) return fail("Pick the store first — a bin is a rack in a store");
  return createBin({
    bin_code: binCode.trim().toUpperCase(),
    store_id: storeId,
    description: description?.trim().toUpperCase() || null,
    inactive: false,
  });
}
