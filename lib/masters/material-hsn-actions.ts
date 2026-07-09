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
      hsn_id: z.string().uuid().nullable(),
    }),
  )
  .default([]);
export type MaterialHsnChange = z.infer<typeof hsnChangesInput>[number];

/**
 * Bulk-set HSN (items.hsn_id, a FK to config_lookups kind 'hsn_code') on
 * materials/items. Only the changed rows are passed in; they're grouped by
 * target value and written with the shared `.update({...}).in("id", ids)` idiom
 * — so a bulk-apply of many items to one HSN collapses to a single statement.
 * Never a full item update (which would rewrite spec/child data) and never a
 * Promise.all of per-row updates. Mirrors saveVendorGst / saveCustomerGst.
 */
export async function saveMaterialHsn(changes: MaterialHsnChange[]): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = hsnChangesInput.safeParse(changes);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (p.data.length === 0) return { ok: true };

  // group by target value so identical assignments share one UPDATE
  const groups = new Map<string, { hsn_id: string | null; ids: string[] }>();
  for (const c of p.data) {
    const key = c.hsn_id ?? "";
    const g = groups.get(key) ?? { hsn_id: c.hsn_id, ids: [] };
    g.ids.push(c.id);
    groups.set(key, g);
  }

  const s = await createClient();
  for (const g of groups.values()) {
    const { error } = await s.from("items").update({ hsn_id: g.hsn_id }).in("id", g.ids);
    if (error) return fail(error.message);
  }

  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/hsn-assign");
  return { ok: true };
}
