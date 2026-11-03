"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { getCurrentLocation } from "@/lib/auth/location";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

/**
 * GENERAL DC (0796) and DELIVERY RETURN (0797) — writes.
 *
 * The draft is ordinary rows under RLS (current unit, Stores OR Purchase, status draft). The
 * stock steps are one database function each — `general_dc_dispatch` and `dc_return_post` —
 * all or nothing.
 */

type Result = { ok: true; id: string } | { ok: false; error: string };

async function mayWork(action: "create" | "edit" | "delete") {
  return (await can("stores", action)) || (await can("materials_purchase", action));
}

const lineInput = z
  .object({
    item_id: z.string().uuid().nullable().optional(),
    description: capsName("Every line needs a description"),
    sent_qty: z.coerce.number().positive({ message: "Every line needs a qty" }),
    uom_id: z.string().uuid().nullable().optional(),
    from_store_id: z.string().uuid().nullable().optional(),
    bin_id: z.string().uuid().nullable().optional(),
    lot_no: capsTextNullable(),
    approx_value: z.coerce.number().nonnegative().nullable().optional(),
  })
  .refine((l) => !l.item_id || !!l.from_store_id, { message: "Pick the store a stock item leaves from" });

const dcInput = z
  .object({
    dc_date: z.string().min(1, "Pick the DC date"),
    is_returnable: z.boolean(),
    vendor_id: z.string().uuid().nullable().optional(),
    party_name: capsTextNullable(),
    party_address: capsTextNullable(),
    purpose: capsName("Say why the goods are going out"),
    expected_return_date: z.string().nullable().optional(),
    vehicle_no: capsTextNullable(),
    transporter: capsTextNullable(),
    notes: capsTextNullable(),
    lines: z.array(lineInput).min(1, "Add at least one line"),
  })
  .refine((d) => !!d.vendor_id || !!d.party_name, { message: "Pick a vendor or type the party's name" })
  .refine((d) => !d.is_returnable || !!d.expected_return_date, { message: "A returnable DC needs the expected return date" });
export type GeneralDcInput = z.input<typeof dcInput>;

function friendly(message: string): string {
  if (/Insufficient stock|negative/i.test(message)) return "Not enough stock in the store for one of the lines — check the qty";
  return message;
}

function revalidate(id?: string) {
  revalidatePath("/purchase/dc");
  revalidatePath("/purchase/general-delivery");
  revalidatePath("/purchase/delivery-returns");
  if (id) revalidatePath(`/purchase/general-delivery/${id}/print`);
}

/** Save the draft (new or existing) and, when `dispatch`, send it in the same call. */
export async function saveGeneralDc(id: string | null, payload: GeneralDcInput, dispatch: boolean): Promise<Result> {
  if (!(await mayWork(id ? "edit" : "create"))) return { ok: false, error: "You do not have permission to raise a General DC" };
  const parsed = dcInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { lines, ...rest } = parsed.data;
  const header = {
    ...rest,
    vendor_id: rest.vendor_id || null,
    // The party is the vendor OR the typed name — never both on one DC.
    party_name: rest.vendor_id ? null : rest.party_name,
    party_address: rest.vendor_id ? null : rest.party_address,
    expected_return_date: rest.is_returnable ? rest.expected_return_date || null : null,
  };

  const { location } = await getCurrentLocation();
  if (!location) return { ok: false, error: "Pick your working unit in the top bar first" };

  const supabase = await createClient();
  let dcId = id;
  if (dcId) {
    const { data, error } = await supabase
      .from("delivery_challans")
      .update(header)
      .eq("id", dcId)
      .eq("dc_kind", "general")
      .eq("status", "draft")
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "Only a draft of your unit can be changed" };
    const { error: delErr } = await supabase.from("dc_line_items").delete().eq("delivery_challan_id", dcId);
    if (delErr) return { ok: false, error: delErr.message };
  } else {
    const { data, error } = await supabase
      .from("delivery_challans")
      .insert({ ...header, dc_kind: "general", location_id: location.id, status: "draft" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save the DC" };
    dcId = (data as { id: string }).id;
  }

  const { error: lineErr } = await supabase.from("dc_line_items").insert(
    lines.map((l, i) => ({
      delivery_challan_id: dcId,
      item_id: l.item_id || null,
      description: l.description,
      sent_qty: l.sent_qty,
      uom_id: l.uom_id || null,
      // A free-text line moves no stock, so it carries no store / bin / lot.
      from_store_id: l.item_id ? l.from_store_id || null : null,
      bin_id: l.item_id ? l.bin_id || null : null,
      lot_no: l.item_id ? l.lot_no : null,
      approx_value: l.approx_value ?? null,
      sort_order: i,
      returned_qty: 0,
    })),
  );
  if (lineErr) {
    if (!id) await supabase.from("delivery_challans").delete().eq("id", dcId);
    return { ok: false, error: lineErr.message };
  }

  if (dispatch) {
    const { error } = await supabase.rpc("general_dc_dispatch", { p_dc_id: dcId });
    if (error) {
      revalidate(dcId!);
      return { ok: false, error: `Saved as a draft, not dispatched: ${friendly(error.message)}` };
    }
    await writeAudit({ action: "general_dc.dispatched", entityType: "delivery_challan", entityId: dcId! });
  } else {
    await writeAudit({ action: id ? "general_dc.updated" : "general_dc.created", entityType: "delivery_challan", entityId: dcId! });
  }
  revalidate(dcId!);
  return { ok: true, id: dcId! };
}

export async function deleteGeneralDc(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await mayWork("edit"))) return { ok: false, error: "You do not have permission to delete a General DC" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("delivery_challans")
    .delete()
    .eq("id", id)
    .eq("dc_kind", "general")
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a draft from your unit can be deleted" };
  await writeAudit({ action: "general_dc.deleted", entityType: "delivery_challan", entityId: id });
  revalidate();
  return { ok: true };
}

// ----------------------------------------------------------------- Delivery Return

const returnLine = z.object({
  dc_line_id: z.string().uuid(),
  returned_qty: z.coerce.number().nonnegative(),
  close_balance: z.boolean().optional(),
  close_reason: capsTextNullable(),
  store_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  lot_no: capsTextNullable(),
});
const returnInput = z.object({
  return_date: z.string().min(1, "Pick the return date"),
  party_dc_no: capsTextNullable(),
  notes: capsTextNullable(),
  lines: z.array(returnLine).min(1, "Enter what came back on at least one line"),
});
export type DcReturnInput = z.input<typeof returnInput>;

export async function postDcReturn(dcId: string, payload: DcReturnInput): Promise<Result> {
  if (!(await mayWork("edit"))) return { ok: false, error: "You do not have permission to receive a delivery back" };
  const parsed = returnInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { lines, ...header } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dc_return_post", { p_dc_id: dcId, p_lines: lines, p_header: header });
  if (error) return { ok: false, error: friendly(error.message) };
  const returnId = data as string;
  await writeAudit({ action: "dc_return.posted", entityType: "dc_return", entityId: returnId });
  revalidate(dcId);
  return { ok: true, id: returnId };
}
