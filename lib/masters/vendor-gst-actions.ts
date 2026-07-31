"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { nullableKind } from "@/lib/validation/formats";
import { describeGstIssue } from "./gst-bulk";
import { GST_REG_STATUSES } from "./vendor-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

const gstChangeInput = z.object({
  id: z.string().uuid(),
  gst_reg_status: z.enum(GST_REG_STATUSES).nullable(),
  // The SAME rule the Vendor master enforces (vendor-types.ts), not a bare
  // string. This screen writes `master_vendors.gst_no` directly, so an
  // unvalidated bulk apply could put "TBD" on 300 vendors — values the master
  // form then refuses to save, stranding every one of those records on its next
  // edit. `nullableKind` also normalises (trim + uppercase), so a lowercase
  // paste is corrected rather than rejected.
  gst_no: nullableKind("gstin"),
});
const gstChangesInput = z.array(gstChangeInput).default([]);
/** The client shape — `gst_no` before the schema's uppercase transform. */
export type VendorGstChange = z.input<typeof gstChangeInput>;

/**
 * Bulk-set GST Type (gst_reg_status) + GSTIN (gst_no) on vendors. Only the
 * changed rows are passed in; they're grouped by their target value tuple and
 * written with the shared `.update({...}).in("id", ids)` idiom — so a bulk-apply
 * of many vendors to one value collapses to a single statement. Never
 * `updateVendor` (which rewrites the address child grid) and never a
 * Promise.all of per-row updates. Mirrors saveCustomerTcs (tcs-actions.ts).
 */
export async function saveVendorGst(changes: VendorGstChange[]): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = gstChangesInput.safeParse(changes);
  // Name the value that failed. One Save carries every edited row, so a bare
  // "Invalid GSTIN" leaves the operator hunting through a 300-row grid for it.
  if (!p.success) return fail(describeGstIssue(p.error, changes));
  if (p.data.length === 0) return { ok: true };

  // group by target value so identical assignments share one UPDATE
  const groups = new Map<string, { gst_reg_status: string | null; gst_no: string | null; ids: string[] }>();
  for (const c of p.data) {
    // `?? null`, because the schema's field is optional: an omitted gst_no and
    // an explicit null both mean "clear it", and the column is nullable.
    const gstNo = c.gst_no ?? null;
    const key = `${c.gst_reg_status ?? ""}|${gstNo ?? ""}`;
    const g = groups.get(key) ?? { gst_reg_status: c.gst_reg_status, gst_no: gstNo, ids: [] };
    g.ids.push(c.id);
    groups.set(key, g);
  }

  const s = await createClient();
  for (const g of groups.values()) {
    const { error } = await s
      .from("master_vendors")
      .update({ gst_reg_status: g.gst_reg_status, gst_no: g.gst_no })
      .in("id", g.ids);
    if (error) return fail(error.message);
  }

  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/gst-assign-to-vendors");
  return { ok: true };
}
