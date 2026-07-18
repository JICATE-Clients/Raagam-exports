"use server";

import { revalidatePath } from "next/cache";
import { can, getAppUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import {
  opportunityInput,
  bulkOpportunityInput,
  styleInput,
  costSheetInput,
  quoteInput,
  sampleInput,
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

/**
 * Bulk create: one opportunity per selected buyer (legacy "Create opportunities
 * — By Customer"). Title defaults to the buyer name and currency to the buyer's
 * currency; `code` (OPP-####) and `owner_id` are assigned by the DB.
 */
export async function createOpportunitiesForBuyers(
  raw: unknown,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = bulkOpportunityInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { buyer_ids, season } = parsed.data;

  const supabase = await createClient();
  const { data: buyers, error: buyersError } = await supabase
    .from("buyers")
    .select("id, name, currency_code")
    .in("id", buyer_ids);
  if (buyersError) return { ok: false, error: buyersError.message };
  if (!buyers || buyers.length === 0) {
    return { ok: false, error: "No matching customers found." };
  }

  const rows = buyers.map((b) => ({
    buyer_id: b.id,
    title: b.name,
    season: season ?? null,
    stage: "enquiry" as const,
    currency_code: b.currency_code ?? null,
  }));

  const { error } = await supabase.from("opportunities").insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidateSales();
  return { ok: true, count: rows.length };
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
  const { combos, sizes, ...header } = parsed.data;
  const { data: row, error } = await supabase.from("styles").insert(header).select("id").single();
  if (error) return { ok: false, error: error.message };

  // Save combos with nested sizes
  if (combos && combos.length > 0) {
    for (let ci = 0; ci < combos.length; ci++) {
      const { sizes: comboSizes, ...comboHeader } = combos[ci];
      const { data: comboRow, error: comboErr } = await supabase
        .from("style_combos")
        .insert({ style_id: row.id, sno: ci + 1, ...comboHeader })
        .select("id")
        .single();
      if (comboErr) continue;
      if (comboSizes && comboSizes.length > 0) {
        await supabase.from("style_combo_sizes").insert(
          comboSizes.map((s, si) => ({ style_combo_id: comboRow.id, sno: si + 1, ...s })),
        );
      }
    }
  }

  // Save direct sizes (when no combos)
  if (sizes && sizes.length > 0) {
    await supabase.from("style_sizes").insert(
      sizes.map((s, si) => ({ style_id: row.id, sno: si + 1, ...s })),
    );
  }

  revalidateSales(parsed.data.opportunity_id);
  revalidatePath("/sales/styles");
  return { ok: true };
}

export async function updateStyle(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const parsed = styleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("styles")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateSales(parsed.data.opportunity_id);
  revalidatePath("/sales/styles");
  return { ok: true };
}

export async function deleteStyle(id: string): Promise<ActionResult> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.from("styles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateSales();
  revalidatePath("/sales/styles");
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
  revalidatePath("/sales/samples");
  return { ok: true };
}

export async function updateSample(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const parsed = sampleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("samples")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateSales(parsed.data.opportunity_id);
  revalidatePath("/sales/samples");
  return { ok: true };
}

export async function deleteSample(id: string): Promise<ActionResult> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.from("samples").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateSales();
  revalidatePath("/sales/samples");
  return { ok: true };
}
