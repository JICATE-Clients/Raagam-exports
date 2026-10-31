"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getCurrentLocation } from "@/lib/auth/location";
import { capsTextNullable } from "@/lib/validation/formats";

/**
 * PRODUCTION DC ACTIONS (0784). The draft is ordinary rows under RLS (the sending unit,
 * `stores` permission, status draft); the two stock steps are one database function each —
 * `production_dc_dispatch` and `production_dc_receive` — all or nothing, never two client
 * inserts (the half-posted transfer `transferStock` still risks).
 */

type Result = { ok: true; id: string } | { ok: false; error: string };

const lineInput = z.object({
  item_id: z.string().uuid({ message: "Pick an item on every line" }),
  description: z.string().nullable().optional(),
  sent_qty: z.coerce.number().positive({ message: "Every line needs a qty" }),
  from_store_id: z.string().uuid({ message: "Pick a store on every line" }),
  bin_id: z.string().uuid().nullable().optional(),
  lot_no: capsTextNullable(),
});

const dcInput = z.object({
  to_location_id: z.string().uuid({ message: "Pick the unit it goes to" }),
  dc_date: z.string().min(1, "Pick the DC date"),
  vehicle_no: capsTextNullable(),
  transporter: capsTextNullable(),
  eway_bill_no: capsTextNullable(),
  notes: capsTextNullable(),
  lines: z.array(lineInput).min(1, "Add at least one line"),
});
export type ProductionDcInput = z.input<typeof dcInput>;

function friendly(message: string): string {
  if (/Insufficient stock/i.test(message)) return "Not enough stock in the store for one of the lines — check the qty";
  return message;
}

function revalidate(id?: string) {
  revalidatePath("/stores/production-dc");
  if (id) revalidatePath(`/stores/production-dc/${id}/print`);
}

/** Save the draft (new or existing) and, when `dispatch`, send it in the same call. */
export async function saveProductionDc(id: string | null, payload: ProductionDcInput, dispatch: boolean): Promise<Result> {
  if (!(await can("stores", id ? "edit" : "create"))) return { ok: false, error: "You do not have permission to raise a Production DC" };
  const parsed = dcInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { lines, ...header } = parsed.data;

  const { location } = await getCurrentLocation();
  if (!location) return { ok: false, error: "Pick your working unit in the top bar first" };
  if (header.to_location_id === location.id) return { ok: false, error: "A Production DC goes to ANOTHER unit" };

  const supabase = await createClient();
  let dcId = id;
  if (dcId) {
    const { error } = await supabase.from("delivery_challans").update(header).eq("id", dcId).eq("status", "draft");
    if (error) return { ok: false, error: error.message };
    const { error: delErr } = await supabase.from("dc_line_items").delete().eq("delivery_challan_id", dcId);
    if (delErr) return { ok: false, error: delErr.message };
  } else {
    const { data, error } = await supabase
      .from("delivery_challans")
      .insert({ ...header, dc_kind: "production", location_id: location.id, status: "draft", purpose: "Production DC" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save the DC" };
    dcId = (data as { id: string }).id;
  }

  const { error: lineErr } = await supabase
    .from("dc_line_items")
    .insert(lines.map((l, i) => ({ ...l, delivery_challan_id: dcId, sort_order: i, returned_qty: 0 })));
  if (lineErr) {
    if (!id) await supabase.from("delivery_challans").delete().eq("id", dcId);
    return { ok: false, error: lineErr.message };
  }

  if (dispatch) {
    const { error } = await supabase.rpc("production_dc_dispatch", { p_dc_id: dcId });
    if (error) {
      revalidate(dcId!);
      // The draft is kept: the operator fixes the qty and dispatches again.
      return { ok: false, error: `Saved as a draft, not dispatched: ${friendly(error.message)}` };
    }
    await writeAudit({ action: "production_dc.dispatched", entityType: "delivery_challan", entityId: dcId! });
  } else {
    await writeAudit({ action: id ? "production_dc.updated" : "production_dc.created", entityType: "delivery_challan", entityId: dcId! });
  }
  revalidate(dcId!);
  return { ok: true, id: dcId! };
}

export async function deleteProductionDc(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to delete a Production DC" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_challans")
    .delete()
    .eq("id", id)
    .eq("dc_kind", "production")
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a draft from your unit can be deleted" };
  await writeAudit({ action: "production_dc.deleted", entityType: "delivery_challan", entityId: id });
  revalidate();
  return { ok: true };
}

const receiveInput = z.array(
  z.object({
    line_id: z.string().uuid(),
    received_qty: z.coerce.number().nonnegative(),
    shortage_reason: z.string().trim().nullable().optional(),
    store_id: z.string().uuid().nullable().optional(),
    bin_id: z.string().uuid().nullable().optional(),
  }),
);
export type ProductionDcReceiveInput = z.input<typeof receiveInput>;

export async function receiveProductionDc(id: string, lines: ProductionDcReceiveInput): Promise<Result> {
  if (!(await can("stores", "edit"))) return { ok: false, error: "You do not have permission to receive a Production DC" };
  const parsed = receiveInput.safeParse(lines);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("production_dc_receive", {
    p_dc_id: id,
    p_lines: parsed.data.map((l) => ({ ...l, shortage_reason: l.shortage_reason?.toUpperCase() ?? null })),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  await writeAudit({ action: "production_dc.received", entityType: "delivery_challan", entityId: id });
  revalidate(id);
  return { ok: true, id };
}
