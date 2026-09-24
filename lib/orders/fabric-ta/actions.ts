"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { capsTextNullable } from "@/lib/validation/formats";
import { FABRIC_TA_STEP_CODES, MAX_TOLERANCE_PCT, type FabricTaStepCode } from "./engine";

type Result = { ok: true } | { ok: false; error: string };

/**
 * The one write the Fabric T&A tracker has: what a PERSON says about a step
 * (`order_fabric_ta_marks`, 0609). Status and quantities are never written —
 * they are derived from the PO / GRN / process documents on every read.
 * Same shape as the trims tracker's `saveTrimTaMark`, on purpose.
 */
const markInput = z.object({
  salesOrderId: z.string().uuid(),
  itemId: z.string().uuid(),
  stepCode: z.enum(FABRIC_TA_STEP_CODES as [FabricTaStepCode, ...FabricTaStepCode[]]),
  tolerancePct: z.coerce.number().min(0).max(MAX_TOLERANCE_PCT),
  doneOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .or(z.literal("").transform(() => null)),
  // Capitals are stored, not displayed (AGENTS.md "CAPITALS") — in the schema.
  remarks: capsTextNullable(),
  assignedStaffId: z.string().uuid().nullable(),
});

export type FabricTaMarkInput = z.input<typeof markInput>;

export async function saveFabricTaMark(raw: FabricTaMarkInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "You do not have permission to edit order T&A." };
  const parsed = markInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const m = parsed.data;

  // A done date in the future is a claim about something that has not happened.
  if (m.doneOn && m.doneOn > today()) return { ok: false, error: "Done on cannot be a future date." };

  const sb = await createClient();
  const { error } = await sb.from("order_fabric_ta_marks").upsert(
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

  // The tracker lives in the Fabric BOM editor's T&A tab, which re-fetches
  // itself after a save; revalidating the editor's route covers a reload.
  revalidatePath("/orders/fabric-bom");
  return { ok: true };
}

/**
 * The tracker for the order a Fabric BOM belongs to — what the Fabric BOM
 * editor's T&A tab loads. The editor knows its GARMENT ORDER (the amendment
 * document); the tracker is keyed by the ORDER (RE No), because one RE can hold
 * several garment-order documents and the fabric pipeline is the order's.
 *
 * A server action rather than a prop because the editor is one client screen
 * that opens many BOMs; the heavy read (the requirement report) runs only when
 * the tab asks for it.
 */
export async function loadFabricTaForGarmentOrder(
  garmentOrderId: string,
): Promise<{ ok: true; result: import("./service").FabricTaResult } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(garmentOrderId).success) return { ok: false, error: "Pick an order first." };
  // The permission check and the order hop run together — the answer is still
  // refused before anything is returned, it just no longer costs a round trip.
  const sb = await createClient();
  const [allowed, { data, error }] = await Promise.all([
    can("orders", "view"),
    sb.from("garment_order_amendments").select("sales_order_id").eq("id", garmentOrderId).maybeSingle(),
  ]);
  if (!allowed) return { ok: false, error: "You do not have permission to view order T&A." };
  // A failed read is an error, never an empty tracker (see the service header).
  if (error) return { ok: false, error: `Could not read the order: ${error.message}` };
  const so = (data as { sales_order_id: string | null } | null)?.sales_order_id;
  if (!so) return { ok: false, error: "This garment order has no RE Number behind it yet." };
  const { getFabricTa } = await import("./service");
  try {
    return { ok: true, result: await getFabricTa({ salesOrderId: so }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the T&A." };
  }
}
