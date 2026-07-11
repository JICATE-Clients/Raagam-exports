"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { quoteCostingInput, computeRollup, type QuoteCostingInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/sales/quotes");
  revalidatePath("/sales");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Build the DB row from validated input — roll-up recomputed here (not trusted from the client). */
function toRow(data: QuoteCostingInput) {
  const rollup = computeRollup(data);
  return {
    status: data.status,
    costing_date: data.costing_date,
    opportunity_id: data.opportunity_id,
    customer_id: data.customer_id,
    style_id: data.style_id,
    currency_code: clean(data.currency_code),
    weight: Number(data.weight) || 0,
    fabric_cost: Number(data.fabric_cost) || 0,
    trims_cost: Number(data.trims_cost) || 0,
    cmt_cost: Number(data.cmt_cost) || 0,
    garment_process_cost: Number(data.garment_process_cost) || 0,
    other_expenses: Number(data.other_expenses) || 0,
    garment_waste_pct: Number(data.garment_waste_pct) || 0,
    margin_pct: Number(data.margin_pct) || 0,
    notes: clean(data.notes),
    ...rollup,
  };
}

export async function createQuoteCosting(data: QuoteCostingInput): Promise<Result> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = quoteCostingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("quote_costings")
    .insert(toRow(p.data))
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create costing");
  await writeAudit({
    action: "quote_costing.created",
    entityType: "quote_costing",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateQuoteCosting(id: string, data: QuoteCostingInput): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const p = quoteCostingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("quote_costings").update(toRow(p.data)).eq("id", id);
  if (error) return fail(error.message);
  await writeAudit({
    action: "quote_costing.updated",
    entityType: "quote_costing",
    entityId: id,
  });
  rev();
  return { ok: true };
}

export async function deleteQuoteCosting(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("quote_costings").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
