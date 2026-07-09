"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

const tcsChangesInput = z
  .array(
    z.object({
      id: z.string().uuid(),
      tcs_applicable: z.boolean(),
    }),
  )
  .default([]);
export type TcsChange = z.infer<typeof tcsChangesInput>[number];

/**
 * Bulk-set the `tcs_applicable` flag on customers. Only the changed rows are
 * passed in; they're grouped by target value and written with the shared
 * `.update({...}).in("id", ids)` idiom (≤ 2 statements) — never `updateCustomer`
 * (which rewrites all child grids) and never Promise.all-of-updates.
 */
export async function saveCustomerTcs(changes: TcsChange[]): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = tcsChangesInput.safeParse(changes);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (p.data.length === 0) return { ok: true };

  const trueIds = p.data.filter((c) => c.tcs_applicable).map((c) => c.id);
  const falseIds = p.data.filter((c) => !c.tcs_applicable).map((c) => c.id);

  const s = await createClient();
  if (trueIds.length) {
    const { error } = await s.from("customers").update({ tcs_applicable: true }).in("id", trueIds);
    if (error) return fail(error.message);
  }
  if (falseIds.length) {
    const { error } = await s.from("customers").update({ tcs_applicable: false }).in("id", falseIds);
    if (error) return fail(error.message);
  }

  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/tcs-assign-to-customers");
  return { ok: true };
}
