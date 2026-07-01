"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  productionEntryInput,
  productionLineInput,
  isConfirmable,
  STAGE_MILESTONE,
  type ProductionEntryInput,
  type ProductionLineInput,
  type ProductionStage,
} from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateResult = { ok: true; id: string } | ErrResult;

// ---- entries ----

/** Record a new production entry (status = 'recorded'). Supervisor action. */
export async function recordEntry(
  payload: ProductionEntryInput,
): Promise<CreateResult> {
  if (!(await can("production", "create"))) throw new Error("Forbidden");

  const parsed = productionEntryInput.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("production_entries")
    .insert({
      ...parsed.data,
      status: "recorded",
      recorded_by: user?.id ?? null,
      entry_date: parsed.data.entry_date ?? new Date().toISOString().split("T")[0],
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/production");
  return { ok: true, id: data.id };
}

/** Update a recorded (unconfirmed) entry. Only 'recorded' entries may be edited. */
export async function updateEntry(
  entryId: string,
  payload: Partial<ProductionEntryInput>,
): Promise<ActionResult> {
  if (!(await can("production", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // verify entry exists and is still in 'recorded' state
  const { data: existing, error: fetchErr } = await supabase
    .from("production_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();

  if (fetchErr || !existing) return { ok: false, error: "Entry not found" };
  if (!isConfirmable(existing as { status: "recorded" | "confirmed" })) {
    return { ok: false, error: "Only recorded entries may be edited" };
  }

  const { error } = await supabase
    .from("production_entries")
    .update(payload)
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/production");
  return { ok: true };
}

/**
 * Confirm a recorded entry: marks it confirmed, records who/when.
 * Requires 'production:approve' permission.
 */
export async function confirmEntry(entryId: string): Promise<ActionResult> {
  if (!(await can("production", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // verify the entry is in 'recorded' state
  const { data: existing, error: fetchErr } = await supabase
    .from("production_entries")
    .select("id, status, stage, sales_order_id")
    .eq("id", entryId)
    .single();

  if (fetchErr || !existing) return { ok: false, error: "Entry not found" };
  if (!isConfirmable(existing as { status: "recorded" | "confirmed" })) {
    return { ok: false, error: "Entry is already confirmed" };
  }

  const { error } = await supabase
    .from("production_entries")
    .update({
      status: "confirmed",
      confirmed_by: user?.id ?? null,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "production.entry.confirm",
    entityType: "production_entry",
    entityId: entryId,
    metadata: {
      stage: (existing as { stage: string }).stage,
      sales_order_id: (existing as { sales_order_id: string }).sales_order_id,
    },
  });

  // Production → T&A: confirming a stage completes its matching Order T&A
  // milestone. Uses the privileged client because a production manager does not
  // hold orders:edit (ta_milestones RLS). Best-effort — a sync hiccup must not
  // fail the confirmation.
  try {
    const stage = (existing as { stage: ProductionStage }).stage;
    const orderId = (existing as { sales_order_id: string }).sales_order_id;
    const milestoneName = STAGE_MILESTONE[stage];
    const today = new Date().toISOString().split("T")[0];
    const admin = createAdminClient();
    await admin
      .from("ta_milestones")
      .update({ status: "done", actual_date: today })
      .eq("sales_order_id", orderId)
      .eq("name", milestoneName)
      .neq("status", "done");
    revalidatePath("/"); // refresh the Order T&A dashboard
  } catch {
    // best-effort milestone sync
  }

  revalidatePath("/production");
  return { ok: true };
}

/**
 * Log a rework entry derived from an existing entry.
 * Copies the original's order/stage/line/colour/size, sets is_rework=true,
 * and records the rejected qty as the good_qty being re-processed.
 */
export async function logRework(
  fromEntryId: string,
  overrides?: Partial<ProductionEntryInput>,
): Promise<CreateResult> {
  if (!(await can("production", "create"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: source, error: fetchErr } = await supabase
    .from("production_entries")
    .select(
      "id, sales_order_id, stage, line_id, color, size, reject_qty, entry_date",
    )
    .eq("id", fromEntryId)
    .single();

  if (fetchErr || !source) return { ok: false, error: "Source entry not found" };

  const src = source as {
    id: string;
    sales_order_id: string;
    stage: string;
    line_id: string | null;
    color: string | null;
    size: string | null;
    reject_qty: number;
    entry_date: string;
  };

  const { data, error } = await supabase
    .from("production_entries")
    .insert({
      sales_order_id: src.sales_order_id,
      stage: src.stage,
      line_id: overrides?.line_id ?? src.line_id,
      entry_date: overrides?.entry_date ?? new Date().toISOString().split("T")[0],
      color: overrides?.color ?? src.color,
      size: overrides?.size ?? src.size,
      good_qty: overrides?.good_qty ?? src.reject_qty,
      reject_qty: overrides?.reject_qty ?? 0,
      is_rework: true,
      status: "recorded",
      recorded_by: user?.id ?? null,
      note: overrides?.note ?? `Rework of entry ${src.id}`,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/production");
  return { ok: true, id: data.id };
}

// ---- production lines ----

export async function createLine(
  payload: ProductionLineInput,
): Promise<CreateResult> {
  if (!(await can("production", "create"))) throw new Error("Forbidden");

  const parsed = productionLineInput.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_lines")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/production");
  return { ok: true, id: data.id };
}

export async function updateLine(
  lineId: string,
  payload: Partial<ProductionLineInput>,
): Promise<ActionResult> {
  if (!(await can("production", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("production_lines")
    .update(payload)
    .eq("id", lineId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/production");
  return { ok: true };
}
