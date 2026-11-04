"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { binInput, binRangeCodes, binRangeInput, type BinInput, type BinRangeInput } from "./bin-types";
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
    if (!next) return fail("Enter a bin code");
    p.data.bin_code = next;
  }
  const dup = await checkDuplicateName(s, "bins", p.data.bin_code, { nameColumn: "bin_code" });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("bins").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

/**
 * THE NEW-BIN FORM'S SAVE (client 2026-11-04): Prefix + From…To → one bin per number, all
 * in the chosen store with the same description. All or nothing — if any code in the
 * range is already a bin, nothing is made and the message names them, so a half-made
 * range never has to be untangled by hand.
 */
export async function createBinRange(data: BinRangeInput): Promise<CreateResult & { message?: string }> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = binRangeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const codes = binRangeCodes(p.data.prefix, p.data.from_no, p.data.to_no);
  const s = await createClient();
  const { data: taken, error: readErr } = await s.from("bins").select("bin_code").in("bin_code", codes);
  if (readErr) return fail(readErr.message);
  if (taken && taken.length > 0) {
    const names = (taken as { bin_code: string }[]).map((t) => t.bin_code).sort();
    const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
    return fail(`Already exists: ${shown}. Change the prefix or the From–To range.`);
  }
  const description = p.data.description?.trim() || null;
  const { data: made, error } = await s
    .from("bins")
    .insert(codes.map((bin_code) => ({ bin_code, store_id: p.data.store_id, description, inactive: p.data.inactive })))
    .select("id");
  if (error) return fail(error.message);
  rev();
  return {
    ok: true,
    id: (made?.[0] as { id: string } | undefined)?.id ?? "",
    message: codes.length === 1 ? `Bin ${codes[0]} added.` : `${codes.length} bins added (${codes[0]} – ${codes[codes.length - 1]}).`,
  };
}

export async function updateBin(id: string, data: BinInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = binInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // A blank code means "keep the one it has" — the Bin screen's Edit form no longer asks
  // for it (2026-11-04). A code that IS sent (an import) is still duplicate-checked.
  const { bin_code, ...rest } = p.data;
  const patch: Partial<BinInput> = { ...rest };
  if (bin_code.trim()) {
    const dup = await checkDuplicateName(s, "bins", bin_code, { nameColumn: "bin_code", excludeId: id });
    if (!dup.ok) return fail(dup.error);
    patch.bin_code = bin_code;
  }
  const { error } = await s.from("bins").update(patch).eq("id", id);
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
