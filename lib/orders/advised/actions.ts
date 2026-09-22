"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  DEFAULT_MATERIAL_TYPE,
  TBA_MATERIAL_TYPE,
} from "@/lib/orders/material-bom-amendment/types";
import {
  advisedConversionInput,
  ADVISED_CONVERT_FIELDS,
  type AdvisedConversionInput,
  type AdvisedConvertField,
} from "./types";

type ConvertResult =
  | { ok: true }
  | { ok: false; error: string; field?: AdvisedConvertField };

/**
 * Convert an advised Material BOM line to Available — the buyer has confirmed.
 *
 * ## ONE TARGETED UPDATE, NEVER THE MATERIAL BOM EDITOR'S SAVE
 *
 * The editor saves by deleting and re-inserting every line, requirement and
 * process — all of which an approved RE's lock refuses (0576). This writes ONE
 * row: `type` → Available, plus the confirmed brand, artwork code,
 * specification, colour and size. `converted_at` / `converted_by` are stamped
 * by the database (`stamp_advised_conversion`, 0588) — one writer, and it
 * cannot be skipped.
 *
 * ## IT DOES NOT ASK `assertOrderUnlocked`, DELIBERATELY
 *
 * Conversion is the ONE edit an approved RE admits (user, 2026-09-19): 0588
 * widens the lock's allowlist for exactly these columns on a line that WAS
 * advised, and keeps quantity, item and rate locked. The trigger is the
 * authority on what passes; a courtesy guard here would refuse the very case
 * the rule was widened for. Anything else this update touched would be refused
 * by the trigger, with the lock's own sentence.
 */
export async function convertAdvisedItem(
  lineId: string,
  input: AdvisedConversionInput,
): Promise<ConvertResult> {
  // Converting edits a Material BOM line, so it answers to the permission that
  // edits one.
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };

  const p = advisedConversionInput.safeParse(input);
  if (!p.success) {
    const issue = p.error.issues[0];
    const path = issue?.path[0];
    const field = (ADVISED_CONVERT_FIELDS as readonly string[]).includes(String(path))
      ? (path as AdvisedConvertField)
      : undefined;
    return { ok: false, error: issue?.message ?? "Check the confirmed details", field };
  }

  const s = await createClient();

  /* ONLY AN ADVISED LINE CONVERTS. A second click, or a line converted in
     another tab, is told so rather than re-stamped as though it had just
     happened. */
  const { data: row, error: readErr } = await s
    .from("material_bom_amendment_items")
    .select("id, type, amendment_id")
    .eq("id", lineId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "That line is no longer on the Material BOM" };
  if ((row as { type: string }).type !== TBA_MATERIAL_TYPE) {
    return { ok: false, error: "This material is already Available — nothing to convert" };
  }

  const { data: updated, error } = await s
    .from("material_bom_amendment_items")
    .update({
      type: DEFAULT_MATERIAL_TYPE,
      brand: p.data.brand ?? null,
      artwork_code: p.data.artwork_code ?? null,
      specification: p.data.specification ?? null,
      item_color_id: p.data.item_color_id ?? null,
      size: p.data.size ?? null,
    })
    .eq("id", lineId)
    // Only while still advised — the read above and this write are two calls.
    .eq("type", TBA_MATERIAL_TYPE)
    .select("id");
  if (error) return { ok: false, error: error.message };
  /* AN UPDATE THAT MATCHED NOTHING IS NOT A SUCCESS — RLS filtering the row
     out, or the line converted between the read and the write. PostgREST
     reports neither as an error (the 0517 lesson). */
  if ((updated ?? []).length === 0) {
    return { ok: false, error: "The line could not be converted — it may have changed. Reopen it and try again" };
  }

  await writeAudit({
    action: "material_bom_item.converted",
    entityType: "material_bom_amendment",
    entityId: (row as { amendment_id: string }).amendment_id,
  });
  revalidatePath("/orders/advised-items");
  revalidatePath("/orders/material-bom");
  return { ok: true };
}
