"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { nullableKind } from "@/lib/validation/formats";
import { describeGstIssue } from "./gst-bulk";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

const gstChangeInput = z.object({
  id: z.string().uuid(),
  // The SAME rule the Customer master enforces (customer-types.ts), not a bare
  // string — this screen writes `customers.gst_no` directly, so anything it
  // accepts is something the master form may later refuse to save.
  // `nullableKind` also normalises (trim + uppercase).
  gst_no: nullableKind("gstin"),
});
const gstChangesInput = z.array(gstChangeInput).default([]);
/** The client shape — `gst_no` before the schema's uppercase transform. */
export type CustomerGstChange = z.input<typeof gstChangeInput>;

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
  // Name the value that failed — one Save carries every edited row.
  if (!p.success) return fail(describeGstIssue(p.error, changes));
  if (p.data.length === 0) return { ok: true };

  // group by target value so identical assignments share one UPDATE
  const groups = new Map<string, { gst_no: string | null; ids: string[] }>();
  for (const c of p.data) {
    // `?? null`, because the schema's field is optional: an omitted gst_no and
    // an explicit null both mean "clear it", and the column is nullable.
    const gstNo = c.gst_no ?? null;
    const g = groups.get(gstNo ?? "") ?? { gst_no: gstNo, ids: [] };
    g.ids.push(c.id);
    groups.set(gstNo ?? "", g);
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
