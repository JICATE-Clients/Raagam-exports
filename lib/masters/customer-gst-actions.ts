"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

const gstChangesInput = z
  .array(
    z.object({
      id: z.string().uuid(),
      gst_no: z.string().nullable(),
    }),
  )
  .default([]);
export type CustomerGstChange = z.infer<typeof gstChangesInput>[number];

/**
 * Bulk-set GSTIN (gst_no) on customers. Only the changed rows are passed in;
 * they're grouped by target value and written with the shared
 * `.update({...}).in("id", ids)` idiom — so a bulk-apply of many customers to
 * one value collapses to a single statement. Never `updateCustomer` (which
 * rewrites the child grids) and never a Promise.all of per-row updates.
 * Mirrors saveCustomerTcs (tcs-actions.ts) / saveVendorGst (vendor-gst-actions.ts).
 */
export async function saveCustomerGst(changes: CustomerGstChange[]): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = gstChangesInput.safeParse(changes);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (p.data.length === 0) return { ok: true };

  // group by target value so identical assignments share one UPDATE
  const groups = new Map<string, { gst_no: string | null; ids: string[] }>();
  for (const c of p.data) {
    const key = c.gst_no ?? "";
    const g = groups.get(key) ?? { gst_no: c.gst_no, ids: [] };
    g.ids.push(c.id);
    groups.set(key, g);
  }

  const s = await createClient();
  for (const g of groups.values()) {
    const { error } = await s.from("customers").update({ gst_no: g.gst_no }).in("id", g.ids);
    if (error) return fail(error.message);
  }

  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/gst-assign-to-customers");
  return { ok: true };
}
