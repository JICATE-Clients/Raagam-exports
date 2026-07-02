"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { shortageInput, shortageQty } from "./types";
import type { ShortageInput } from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; shortageId: string } | ErrResult;

function revalidateShortages(): void {
  revalidatePath("/planning/shortages");
  revalidatePath("/planning");
}

// ---------- raise ----------

export async function raiseShortage(payload: ShortageInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = shortageInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { required_qty, available_qty, ...rest } = parsed.data;
  const shortage_qty = shortageQty(required_qty, available_qty);

  const user = await getAppUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("material_shortages")
    .insert({
      ...rest,
      required_qty,
      available_qty,
      shortage_qty,
      status: "open",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to raise shortage" };
  }

  revalidateShortages();
  return { ok: true, shortageId: data.id };
}

// ---------- submit ----------

export async function submitShortage(id: string): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("material_shortages")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.status !== "open") {
    return { ok: false, error: "Shortage is not in open status" };
  }

  const { error } = await supabase
    .from("material_shortages")
    .update({ status: "submitted" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidateShortages();
  return { ok: true };
}

// ---------- approve ----------

export async function approveShortage(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("material_shortages")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Shortage is not in submitted status" };
  }

  const { error } = await supabase
    .from("material_shortages")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "shortage.approved",
    entityType: "material_shortage",
    entityId: id,
  });

  // TODO downstream to Purchase: raise an indent / RFQ from the approved shortage.

  revalidateShortages();
  return { ok: true };
}

// ---------- reject ----------

export async function rejectShortage(id: string): Promise<ActionResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("material_shortages")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.status !== "submitted") {
    return { ok: false, error: "Shortage is not in submitted status" };
  }

  const { error } = await supabase
    .from("material_shortages")
    .update({ status: "rejected" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "shortage.rejected",
    entityType: "material_shortage",
    entityId: id,
  });

  revalidateShortages();
  return { ok: true };
}

// ---------- resolve ----------

export async function resolveShortage(
  id: string,
  resolutionNote: string | null,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("material_shortages")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.status !== "approved") {
    return { ok: false, error: "Only an approved shortage can be resolved" };
  }

  const { error } = await supabase
    .from("material_shortages")
    .update({ status: "resolved", resolution_note: resolutionNote || null })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidateShortages();
  return { ok: true };
}

// ---------- delete (open/rejected only) ----------

export async function deleteShortage(id: string): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("material_shortages")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!row || !["open", "rejected"].includes(row.status)) {
    return { ok: false, error: "Only open or rejected shortages can be deleted" };
  }

  const { error } = await supabase.from("material_shortages").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateShortages();
  return { ok: true };
}
