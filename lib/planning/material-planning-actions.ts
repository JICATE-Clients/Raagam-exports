"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  materialExcessPlanInputSchema,
  materialRateInputSchema,
  fabricOrderInputSchema,
  fabricConsumptionInputSchema,
  excessOrderInputSchema,
} from "./material-planning-types";
import type {
  MaterialExcessPlanInput,
  MaterialRateInput,
  FabricOrderInput,
  FabricConsumptionInput,
  ExcessOrderInput,
} from "./material-planning-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidateMp(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
}

// ============================================================================
// 1. MATERIAL EXCESS PLAN
// ============================================================================

export async function createMaterialExcessPlan(
  data: MaterialExcessPlanInput,
): Promise<{ ok: true; planId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = materialExcessPlanInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { data: plan, error } = await supabase
    .from("material_excess_plans")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !plan) return { ok: false, error: error?.message ?? "Failed" };
  const planId = plan.id;

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("material_excess_plan_items")
      .insert({ ...itemData, id: undefined, excess_plan_id: planId })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("material_excess_plan_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidateMp("/planning/material-excess-plan");
  return { ok: true, planId };
}

export async function updateMaterialExcessPlan(
  id: string,
  data: MaterialExcessPlanInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialExcessPlanInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { error } = await supabase
    .from("material_excess_plans")
    .update(header)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("material_excess_plan_items").delete().eq("excess_plan_id", id);

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("material_excess_plan_items")
      .insert({ ...itemData, id: undefined, excess_plan_id: id })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("material_excess_plan_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidateMp(`/planning/material-excess-plan/${id}`, "/planning/material-excess-plan");
  return { ok: true };
}

export async function deleteMaterialExcessPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_excess_plans").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp("/planning/material-excess-plan");
  return { ok: true };
}

export async function submitMaterialExcessPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_excess_plans")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-excess-plan/${id}`, "/planning/material-excess-plan");
  return { ok: true };
}

export async function approveMaterialExcessPlan(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_excess_plans")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "material_excess_plan.approved", entityType: "material_excess_plan", entityId: id });
  revalidateMp(`/planning/material-excess-plan/${id}`, "/planning/material-excess-plan");
  return { ok: true };
}

// ============================================================================
// 2. MATERIAL RATE
// ============================================================================

export async function createMaterialRate(
  data: MaterialRateInput,
): Promise<{ ok: true; rateId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = materialRateInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { data: rate, error } = await supabase
    .from("material_rates")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !rate) return { ok: false, error: error?.message ?? "Failed" };
  const rateId = rate.id;

  if (items.length > 0) {
    await supabase
      .from("material_rate_items")
      .insert(items.map((i) => ({ ...i, id: undefined, material_rate_id: rateId })));
  }

  revalidateMp("/planning/material-rate");
  return { ok: true, rateId };
}

export async function updateMaterialRate(
  id: string,
  data: MaterialRateInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialRateInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { error } = await supabase.from("material_rates").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("material_rate_items").delete().eq("material_rate_id", id);

  if (items.length > 0) {
    await supabase
      .from("material_rate_items")
      .insert(items.map((i) => ({ ...i, id: undefined, material_rate_id: id })));
  }

  revalidateMp(`/planning/material-rate/${id}`, "/planning/material-rate");
  return { ok: true };
}

export async function deleteMaterialRate(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_rates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp("/planning/material-rate");
  return { ok: true };
}

export async function submitMaterialRate(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_rates")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-rate/${id}`, "/planning/material-rate");
  return { ok: true };
}

export async function approveMaterialRate(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("material_rates")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "material_rate.approved", entityType: "material_rate", entityId: id });
  revalidateMp(`/planning/material-rate/${id}`, "/planning/material-rate");
  return { ok: true };
}

// ============================================================================
// 3. FABRIC ORDER
// ============================================================================

export async function createFabricOrder(
  data: FabricOrderInput,
): Promise<{ ok: true; orderId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = fabricOrderInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { colors, structures, styles, ...header } = parsed.data;

  const { data: order, error } = await supabase
    .from("fabric_orders")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? "Failed" };
  const orderId = order.id;

  // Insert colors
  if (colors.length > 0) {
    await supabase
      .from("fabric_order_colors")
      .insert(colors.map((c) => ({ ...c, id: undefined, fabric_order_id: orderId })));
  }

  // Insert structures
  if (structures.length > 0) {
    await supabase
      .from("fabric_order_structures")
      .insert(structures.map((s) => ({ ...s, id: undefined, fabric_order_id: orderId })));
  }

  // Insert styles with nested details→combos→sizes
  for (const style of styles) {
    const { details, ...styleData } = style;
    const { data: styleRow } = await supabase
      .from("fabric_order_styles")
      .insert({ ...styleData, id: undefined, fabric_order_id: orderId })
      .select("id")
      .single();
    if (!styleRow) continue;

    for (const detail of details) {
      const { combos, sizes: directSizes, ...detailData } = detail;
      const { data: detailRow } = await supabase
        .from("fabric_order_details")
        .insert({ ...detailData, id: undefined, style_id: styleRow.id })
        .select("id")
        .single();
      if (!detailRow) continue;

      // Insert combos with sizes
      for (const combo of combos) {
        const { sizes, ...comboData } = combo;
        const { data: comboRow } = await supabase
          .from("fabric_order_combos")
          .insert({ ...comboData, id: undefined, detail_id: detailRow.id })
          .select("id")
          .single();
        if (!comboRow) continue;

        if (sizes.length > 0) {
          await supabase
            .from("fabric_order_sizes")
            .insert(sizes.map((s) => ({ ...s, id: undefined, combo_id: comboRow.id, detail_id: null })));
        }
      }

      // Insert direct sizes (GREY stage, no combo)
      if (directSizes.length > 0) {
        await supabase
          .from("fabric_order_sizes")
          .insert(directSizes.map((s) => ({ ...s, id: undefined, detail_id: detailRow.id, combo_id: null })));
      }
    }
  }

  revalidateMp("/planning/fabric-order");
  return { ok: true, orderId };
}

export async function updateFabricOrder(
  id: string,
  data: FabricOrderInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = fabricOrderInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { colors, structures, styles, ...header } = parsed.data;

  const { error } = await supabase.from("fabric_orders").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Delete all children and re-insert
  await Promise.all([
    supabase.from("fabric_order_colors").delete().eq("fabric_order_id", id),
    supabase.from("fabric_order_structures").delete().eq("fabric_order_id", id),
    supabase.from("fabric_order_styles").delete().eq("fabric_order_id", id),
  ]);

  if (colors.length > 0) {
    await supabase
      .from("fabric_order_colors")
      .insert(colors.map((c) => ({ ...c, id: undefined, fabric_order_id: id })));
  }

  if (structures.length > 0) {
    await supabase
      .from("fabric_order_structures")
      .insert(structures.map((s) => ({ ...s, id: undefined, fabric_order_id: id })));
  }

  for (const style of styles) {
    const { details, ...styleData } = style;
    const { data: styleRow } = await supabase
      .from("fabric_order_styles")
      .insert({ ...styleData, id: undefined, fabric_order_id: id })
      .select("id")
      .single();
    if (!styleRow) continue;

    for (const detail of details) {
      const { combos, sizes: directSizes, ...detailData } = detail;
      const { data: detailRow } = await supabase
        .from("fabric_order_details")
        .insert({ ...detailData, id: undefined, style_id: styleRow.id })
        .select("id")
        .single();
      if (!detailRow) continue;

      for (const combo of combos) {
        const { sizes, ...comboData } = combo;
        const { data: comboRow } = await supabase
          .from("fabric_order_combos")
          .insert({ ...comboData, id: undefined, detail_id: detailRow.id })
          .select("id")
          .single();
        if (!comboRow) continue;

        if (sizes.length > 0) {
          await supabase
            .from("fabric_order_sizes")
            .insert(sizes.map((s) => ({ ...s, id: undefined, combo_id: comboRow.id, detail_id: null })));
        }
      }

      if (directSizes.length > 0) {
        await supabase
          .from("fabric_order_sizes")
          .insert(directSizes.map((s) => ({ ...s, id: undefined, detail_id: detailRow.id, combo_id: null })));
      }
    }
  }

  revalidateMp(`/planning/fabric-order/${id}`, "/planning/fabric-order");
  return { ok: true };
}

export async function deleteFabricOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp("/planning/fabric-order");
  return { ok: true };
}

export async function submitFabricOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_orders")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${id}`, "/planning/fabric-order");
  return { ok: true };
}

export async function approveFabricOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_orders")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "fabric_order.approved", entityType: "fabric_order", entityId: id });
  revalidateMp(`/planning/fabric-order/${id}`, "/planning/fabric-order");
  return { ok: true };
}

// ============================================================================
// 4. FABRIC CONSUMPTION
// ============================================================================

export async function createFabricConsumption(
  data: FabricConsumptionInput,
): Promise<{ ok: true; consumptionId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = fabricConsumptionInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { components, entries, combos, garment_sizes, ...header } = parsed.data;

  const { data: consumption, error } = await supabase
    .from("fabric_consumptions")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !consumption) return { ok: false, error: error?.message ?? "Failed" };
  const consumptionId = consumption.id;

  // Insert components
  if (components.length > 0) {
    await supabase
      .from("fabric_consumption_components")
      .insert(components.map((c) => ({ ...c, id: undefined, consumption_id: consumptionId })));
  }

  // Insert entries with nested sizes
  for (const entry of entries) {
    const { sizes, ...entryData } = entry;
    const { data: entryRow } = await supabase
      .from("fabric_consumption_entries")
      .insert({ ...entryData, id: undefined, consumption_id: consumptionId })
      .select("id")
      .single();
    if (!entryRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("fabric_consumption_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, entry_id: entryRow.id })));
    }
  }

  // Insert combos
  if (combos.length > 0) {
    await supabase
      .from("fabric_consumption_combos")
      .insert(combos.map((c) => ({ ...c, id: undefined, consumption_id: consumptionId })));
  }

  // Insert garment sizes
  if (garment_sizes.length > 0) {
    await supabase
      .from("fabric_consumption_garment_sizes")
      .insert(garment_sizes.map((g) => ({ ...g, id: undefined, consumption_id: consumptionId })));
  }

  revalidateMp("/planning/fabric-consumption");
  return { ok: true, consumptionId };
}

export async function updateFabricConsumption(
  id: string,
  data: FabricConsumptionInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = fabricConsumptionInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { components, entries, combos, garment_sizes, ...header } = parsed.data;

  const { error } = await supabase.from("fabric_consumptions").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Delete all children and re-insert
  await Promise.all([
    supabase.from("fabric_consumption_components").delete().eq("consumption_id", id),
    supabase.from("fabric_consumption_entries").delete().eq("consumption_id", id),
    supabase.from("fabric_consumption_combos").delete().eq("consumption_id", id),
    supabase.from("fabric_consumption_garment_sizes").delete().eq("consumption_id", id),
  ]);

  if (components.length > 0) {
    await supabase
      .from("fabric_consumption_components")
      .insert(components.map((c) => ({ ...c, id: undefined, consumption_id: id })));
  }

  for (const entry of entries) {
    const { sizes, ...entryData } = entry;
    const { data: entryRow } = await supabase
      .from("fabric_consumption_entries")
      .insert({ ...entryData, id: undefined, consumption_id: id })
      .select("id")
      .single();
    if (!entryRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("fabric_consumption_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, entry_id: entryRow.id })));
    }
  }

  if (combos.length > 0) {
    await supabase
      .from("fabric_consumption_combos")
      .insert(combos.map((c) => ({ ...c, id: undefined, consumption_id: id })));
  }

  if (garment_sizes.length > 0) {
    await supabase
      .from("fabric_consumption_garment_sizes")
      .insert(garment_sizes.map((g) => ({ ...g, id: undefined, consumption_id: id })));
  }

  revalidateMp(`/planning/fabric-consumption/${id}`, "/planning/fabric-consumption");
  return { ok: true };
}

export async function deleteFabricConsumption(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumptions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp("/planning/fabric-consumption");
  return { ok: true };
}

export async function submitFabricConsumption(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_consumptions")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${id}`, "/planning/fabric-consumption");
  return { ok: true };
}

export async function approveFabricConsumption(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_consumptions")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "fabric_consumption.approved", entityType: "fabric_consumption", entityId: id });
  revalidateMp(`/planning/fabric-consumption/${id}`, "/planning/fabric-consumption");
  return { ok: true };
}

// ============================================================================
// 5. EXCESS ORDER
// ============================================================================

export async function createExcessOrder(
  data: ExcessOrderInput,
): Promise<{ ok: true; orderId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = excessOrderInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { data: order, error } = await supabase
    .from("excess_orders")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? "Failed" };
  const orderId = order.id;

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("excess_order_items")
      .insert({ ...itemData, id: undefined, excess_order_id: orderId })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("excess_order_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidateMp("/planning/excess-order");
  return { ok: true, orderId };
}

export async function updateExcessOrder(
  id: string,
  data: ExcessOrderInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = excessOrderInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { error } = await supabase.from("excess_orders").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("excess_order_items").delete().eq("excess_order_id", id);

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("excess_order_items")
      .insert({ ...itemData, id: undefined, excess_order_id: id })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("excess_order_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidateMp(`/planning/excess-order/${id}`, "/planning/excess-order");
  return { ok: true };
}

export async function deleteExcessOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("excess_orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp("/planning/excess-order");
  return { ok: true };
}

export async function submitExcessOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("excess_orders")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/excess-order/${id}`, "/planning/excess-order");
  return { ok: true };
}

export async function approveExcessOrder(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("excess_orders")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "excess_order.approved", entityType: "excess_order", entityId: id });
  revalidateMp(`/planning/excess-order/${id}`, "/planning/excess-order");
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Material Excess Plan
// ============================================================================

export async function addMaterialExcessPlanItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_excess_plan_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-excess-plan/${data.excess_plan_id}`);
  return { ok: true };
}

export async function updateMaterialExcessPlanItem(
  id: string, planId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_excess_plan_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-excess-plan/${planId}`);
  return { ok: true };
}

export async function deleteMaterialExcessPlanItem(
  id: string, planId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_excess_plan_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-excess-plan/${planId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Material Rate
// ============================================================================

export async function addMaterialRateItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_rate_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-rate/${data.material_rate_id}`);
  return { ok: true };
}

export async function updateMaterialRateItem(
  id: string, rateId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_rate_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-rate/${rateId}`);
  return { ok: true };
}

export async function deleteMaterialRateItem(
  id: string, rateId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("material_rate_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/material-rate/${rateId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Fabric Order
// ============================================================================

export async function addFabricOrderColor(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_colors").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${data.fabric_order_id}`);
  return { ok: true };
}

export async function updateFabricOrderColor(
  id: string, orderId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_colors").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function deleteFabricOrderColor(
  id: string, orderId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_colors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function addFabricOrderStructure(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_structures").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${data.fabric_order_id}`);
  return { ok: true };
}

export async function updateFabricOrderStructure(
  id: string, orderId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_structures").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function deleteFabricOrderStructure(
  id: string, orderId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_structures").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function addFabricOrderStyle(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_styles").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${data.fabric_order_id}`);
  return { ok: true };
}

export async function updateFabricOrderStyle(
  id: string, orderId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_styles").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function deleteFabricOrderStyle(
  id: string, orderId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_styles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function addFabricOrderDetail(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_details").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${data.fabric_order_id}`);
  return { ok: true };
}

export async function updateFabricOrderDetail(
  id: string, orderId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_details").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

export async function deleteFabricOrderDetail(
  id: string, orderId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_order_details").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-order/${orderId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Fabric Consumption
// ============================================================================

export async function addFabricConsumptionComponent(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_components").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${data.consumption_id}`);
  return { ok: true };
}

export async function updateFabricConsumptionComponent(
  id: string, consumptionId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_components").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${consumptionId}`);
  return { ok: true };
}

export async function deleteFabricConsumptionComponent(
  id: string, consumptionId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_components").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${consumptionId}`);
  return { ok: true };
}

export async function addFabricConsumptionEntry(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_entries").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${data.consumption_id}`);
  return { ok: true };
}

export async function updateFabricConsumptionEntry(
  id: string, consumptionId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_entries").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${consumptionId}`);
  return { ok: true };
}

export async function deleteFabricConsumptionEntry(
  id: string, consumptionId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("fabric_consumption_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/fabric-consumption/${consumptionId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Excess Order
// ============================================================================

export async function addExcessOrderItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("excess_order_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/excess-order/${data.excess_order_id}`);
  return { ok: true };
}

export async function updateExcessOrderItem(
  id: string, orderId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("excess_order_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/excess-order/${orderId}`);
  return { ok: true };
}

export async function deleteExcessOrderItem(
  id: string, orderId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("excess_order_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateMp(`/planning/excess-order/${orderId}`);
  return { ok: true };
}
