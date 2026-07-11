"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

const hsnChangesInput = z
  .array(
    z.object({
      id: z.string().uuid(),
      hsn_code: z.string().trim().nullable(),
    }),
  )
  .default([]);
export type ProcessHsnChange = z.infer<typeof hsnChangesInput>[number];

/**
 * Bulk-set HSN (processes.hsn_code, a plain TEXT column) on sub-contract
 * processes. Only the changed rows are passed in; they're grouped by target
 * value and written with the shared `.update({...}).in("id", ids)` idiom — so a
 * bulk-apply of many processes to one HSN collapses to a single statement.
 * Never a full process update (which would rewrite header/sub-category data) and
 * never a Promise.all of per-row updates. Mirrors saveMaterialHsn.
 */
export async function saveProcessHsn(changes: ProcessHsnChange[]): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = hsnChangesInput.safeParse(changes);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (p.data.length === 0) return { ok: true };

  // group by target value so identical assignments share one UPDATE
  const groups = new Map<string, { hsn_code: string | null; ids: string[] }>();
  for (const c of p.data) {
    const val = c.hsn_code ? c.hsn_code : null; // normalise "" → null
    const key = val ?? "";
    const g = groups.get(key) ?? { hsn_code: val, ids: [] };
    g.ids.push(c.id);
    groups.set(key, g);
  }

  const s = await createClient();
  for (const g of groups.values()) {
    const { error } = await s.from("processes").update({ hsn_code: g.hsn_code }).in("id", g.ids);
    if (error) return fail(error.message);
  }

  revalidatePath("/masters");
  revalidatePath("/masters/gst");
  revalidatePath("/masters/gst/hsn-assign-process");
  return { ok: true };
}
