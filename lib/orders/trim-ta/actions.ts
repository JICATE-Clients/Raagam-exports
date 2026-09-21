"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { capsTextNullable } from "@/lib/validation/formats";
import { MAX_TOLERANCE_PCT, TRIM_STEP_CODES, type TrimStepCode } from "./engine";
import { getTrimTa, type TrimTaResult } from "./service";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The one write the trims tracker has: what a PERSON says about a step
 * (`order_trim_ta_marks`, 0608). Status and quantities are never written — they
 * are derived from the PO / GRN / DC documents on every read.
 */
const markInput = z.object({
  salesOrderId: z.string().uuid(),
  itemId: z.string().uuid(),
  stepCode: z.enum(TRIM_STEP_CODES as [TrimStepCode, ...TrimStepCode[]]),
  tolerancePct: z.coerce.number().min(0).max(MAX_TOLERANCE_PCT),
  doneOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .or(z.literal("").transform(() => null)),
  // Capitals are stored, not displayed (AGENTS.md "CAPITALS") — in the schema,
  // so every writer gets it.
  remarks: capsTextNullable(),
  assignedStaffId: z.string().uuid().nullable(),
});

export type TrimTaMarkInput = z.input<typeof markInput>;

export async function saveTrimTaMark(raw: TrimTaMarkInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "You do not have permission to edit order T&A." };
  const parsed = markInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const m = parsed.data;

  // A done date in the future is a claim about something that has not
  // happened. Today is the latest a person can say a step finished.
  if (m.doneOn && m.doneOn > today()) return { ok: false, error: "Done on cannot be a future date." };

  const sb = await createClient();
  const { error } = await sb.from("order_trim_ta_marks").upsert(
    {
      sales_order_id: m.salesOrderId,
      item_id: m.itemId,
      step_code: m.stepCode,
      tolerance_pct: m.tolerancePct,
      done_on: m.doneOn,
      remarks: m.remarks || null,
      assigned_staff_id: m.assignedStaffId,
    },
    { onConflict: "sales_order_id,item_id,step_code" },
  );
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * The Material BOM editor's "Trims T&A" section reads through this (client
 * 2026-09-21: the tracker lives INSIDE Material BOM, not as its own screen).
 * The editor knows its garment order; the schedule is keyed on the sales order
 * behind it, so the hop is made here, server-side.
 *
 * `getTrimTa` throws on a failed read — returned here as a sentence, because an
 * empty section would read as "no trims", which is a real answer.
 */
export async function loadTrimTaForGarmentOrder(
  garmentOrderId: string,
): Promise<{ ok: true; data: TrimTaResult } | { ok: false; error: string }> {
  if (!(await can("orders", "view"))) return { ok: false, error: "You do not have permission to view orders." };
  if (!z.string().uuid().safeParse(garmentOrderId).success) return { ok: false, error: "No garment order given." };

  const sb = await createClient();
  const { data: go, error } = await sb
    .from("garment_order_amendments")
    .select("sales_order_id")
    .eq("id", garmentOrderId)
    .maybeSingle();
  if (error) return { ok: false, error: `The garment order could not be read: ${error.message}` };
  const soId = (go as { sales_order_id: string | null } | null)?.sales_order_id;
  if (!soId) return { ok: false, error: "This garment order has no sales order behind it yet." };

  try {
    return { ok: true, data: await getTrimTa({ salesOrderId: soId }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Trims T&A could not be read." };
  }
}
