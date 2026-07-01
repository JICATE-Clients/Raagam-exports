"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, getAppUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import {
  opportunityInput,
  styleInput,
  costSheetInput,
  quoteInput,
  computeFob,
  type OpportunityStage,
  type QuoteStatus,
  type CostSheet,
  type CostSheetItem,
} from "@/lib/sales/types";

type ActionResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Revalidation helpers
// ---------------------------------------------------------------------------

function revalidateSales(opportunityId?: string) {
  revalidatePath("/sales");
  if (opportunityId) revalidatePath(`/sales/${opportunityId}`);
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export async function createOpportunity(
  raw: unknown,
): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = opportunityInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("opportunities").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateSales();
  return { ok: true };
}

export async function updateOpportunityStage(
  id: string,
  stage: OpportunityStage,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("opportunities")
    .update({ stage })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateSales(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export async function createStyle(raw: unknown): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = styleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("styles").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateSales(parsed.data.opportunity_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cost Sheets
// ---------------------------------------------------------------------------

export async function createCostSheet(raw: unknown): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = costSheetInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { items, ...sheetFields } = parsed.data;
  const supabase = await createClient();

  // Determine next version for this opportunity
  const { data: maxRow } = await supabase
    .from("cost_sheets")
    .select("version")
    .eq("opportunity_id", sheetFields.opportunity_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((maxRow as { version: number } | null)?.version ?? 0) + 1;
  const computed_fob = computeFob(items);

  const { data: sheet, error: sheetErr } = await supabase
    .from("cost_sheets")
    .insert({ ...sheetFields, version, computed_fob, status: "draft" })
    .select("id")
    .single();

  if (sheetErr || !sheet) {
    return { ok: false, error: sheetErr?.message ?? "Failed to create cost sheet" };
  }

  const sheetId = (sheet as { id: string }).id;

  if (items.length > 0) {
    const { error: itemsErr } = await supabase.from("cost_sheet_items").insert(
      items.map((item, i) => ({
        cost_sheet_id: sheetId,
        category: item.category,
        description: item.description,
        quantity: item.quantity,
        uom_id: item.uom_id ?? null,
        unit_cost: item.unit_cost,
        amount: item.quantity * item.unit_cost,
        sort_order: item.sort_order ?? i,
      })),
    );
    if (itemsErr) return { ok: false, error: itemsErr.message };
  }

  revalidateSales(sheetFields.opportunity_id);
  return { ok: true };
}

export async function submitCostSheet(
  id: string,
  opportunityId: string,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_sheets")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateSales(opportunityId);
  return { ok: true };
}

export async function approveCostSheet(
  id: string,
  opportunityId: string,
): Promise<ActionResult> {
  if (!(await can("sales", "approve"))) return { ok: false, error: "Forbidden" };

  const user = await getAppUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_sheets")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "cost_sheet.approved",
    entityType: "cost_sheet",
    entityId: id,
    metadata: { opportunityId },
  });

  revalidateSales(opportunityId);
  return { ok: true };
}

export async function rejectCostSheet(
  id: string,
  opportunityId: string,
): Promise<ActionResult> {
  if (!(await can("sales", "approve"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("cost_sheets")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "cost_sheet.rejected",
    entityType: "cost_sheet",
    entityId: id,
    metadata: { opportunityId },
  });

  revalidateSales(opportunityId);
  return { ok: true };
}

export async function cloneCostSheet(
  id: string,
  opportunityId: string,
): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();

  const { data: source, error: fetchErr } = await supabase
    .from("cost_sheets")
    .select("*, cost_sheet_items(*)")
    .eq("id", id)
    .single();
  if (fetchErr || !source) {
    return { ok: false, error: fetchErr?.message ?? "Cost sheet not found" };
  }

  // Next version for this opportunity
  const { data: maxRow } = await supabase
    .from("cost_sheets")
    .select("version")
    .eq("opportunity_id", opportunityId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((maxRow as { version: number } | null)?.version ?? 0) + 1;

  const s = source as CostSheet & { cost_sheet_items: CostSheetItem[] };

  const { data: newSheet, error: insertErr } = await supabase
    .from("cost_sheets")
    .insert({
      opportunity_id: opportunityId,
      style_id: s.style_id ?? null,
      version,
      status: "draft",
      currency_code: s.currency_code ?? null,
      target_fob: s.target_fob ?? null,
      computed_fob: s.computed_fob,
      margin_pct: s.margin_pct ?? null,
      notes: s.notes ?? null,
      parent_cost_sheet_id: id,
    })
    .select("id")
    .single();
  if (insertErr || !newSheet) {
    return { ok: false, error: insertErr?.message ?? "Failed to clone" };
  }

  const newSheetId = (newSheet as { id: string }).id;
  const sourceItems = (s.cost_sheet_items ?? []) as CostSheetItem[];

  if (sourceItems.length > 0) {
    const { error: itemsErr } = await supabase.from("cost_sheet_items").insert(
      sourceItems.map(({ id: _id, cost_sheet_id: _csId, ...rest }) => ({
        ...rest,
        cost_sheet_id: newSheetId,
      })),
    );
    if (itemsErr) return { ok: false, error: itemsErr.message };
  }

  revalidateSales(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function createQuote(raw: unknown): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = quoteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("quotes").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateSales(parsed.data.opportunity_id);
  return { ok: true };
}

export async function setQuoteStatus(
  id: string,
  status: QuoteStatus,
  opportunityId: string,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();

  const extraFields: Record<string, unknown> =
    status === "sent" ? { sent_at: new Date().toISOString() } : {};

  const { error } = await supabase
    .from("quotes")
    .update({ status, ...extraFields })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // On accept: mark the opportunity as won
  if (status === "accepted") {
    const { error: stageErr } = await supabase
      .from("opportunities")
      .update({ stage: "won" })
      .eq("id", opportunityId);
    if (stageErr) return { ok: false, error: stageErr.message };

    await writeAudit({
      action: "quote.accepted",
      entityType: "quote",
      entityId: id,
      metadata: { opportunityId },
    });
  }

  revalidateSales(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

const sampleInput = z.object({
  opportunity_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  quote_id: z.string().uuid().optional().nullable(),
  type: z.enum(["proto", "fit", "sms", "pp", "top"]),
  status: z
    .enum(["requested", "in_progress", "sent", "approved", "rejected"])
    .default("requested"),
  courier_ref: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createSample(raw: unknown): Promise<ActionResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = sampleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("samples").insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateSales(parsed.data.opportunity_id);
  return { ok: true };
}
