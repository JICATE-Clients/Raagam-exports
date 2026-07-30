"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  garmentPpmInputSchema,
  processingPpmInputSchema,
  purchasePpmInputSchema,
  ppmCancelInputSchema,
  ppmCompletionInputSchema,
  garmentPpmCancellationInputSchema,
} from "./ppm-types";
import type {
  GarmentPpmInput,
  ProcessingPpmInput,
  PurchasePpmInput,
  PpmCancelInput,
  PpmCompletionInput,
  GarmentPpmCancellationInput,
} from "./ppm-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidatePpm(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
}

// ============================================================================
// 1. GARMENT PPM
// ============================================================================

export async function createGarmentPpm(
  data: GarmentPpmInput,
): Promise<{ ok: true; ppmId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = garmentPpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { packs, quantities, fabrics, processes, accessories, ...header } = parsed.data;

  // Insert header
  const { data: ppm, error } = await supabase
    .from("garment_ppms")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !ppm) return { ok: false, error: error?.message ?? "Failed" };
  const ppmId = ppm.id;

  // Insert packs
  if (packs.length > 0) {
    await supabase
      .from("garment_ppm_packs")
      .insert(packs.map((p) => ({ ...p, id: undefined, garment_ppm_id: ppmId })));
  }

  // Insert quantities with nested coordinates/combos/sizes
  for (const qty of quantities) {
    const { coordinates, combos, ...qtyData } = qty;
    const { data: qtyRow } = await supabase
      .from("garment_ppm_quantities")
      .insert({ ...qtyData, id: undefined, garment_ppm_id: ppmId })
      .select("id")
      .single();
    if (!qtyRow) continue;

    if (coordinates.length > 0) {
      await supabase
        .from("garment_ppm_coordinates")
        .insert(coordinates.map((c) => ({ ...c, id: undefined, quantity_id: qtyRow.id })));
    }

    for (const combo of combos) {
      const { sizes, ...comboData } = combo;
      const { data: comboRow } = await supabase
        .from("garment_ppm_combos")
        .insert({ ...comboData, id: undefined, quantity_id: qtyRow.id })
        .select("id")
        .single();
      if (!comboRow) continue;

      if (sizes.length > 0) {
        await supabase
          .from("garment_ppm_sizes")
          .insert(sizes.map((s) => ({ ...s, id: undefined, combo_id: comboRow.id })));
      }
    }
  }

  // Insert fabrics with sizes
  for (const fabric of fabrics) {
    const { sizes, ...fabData } = fabric;
    const { data: fabRow } = await supabase
      .from("garment_ppm_fabrics")
      .insert({ ...fabData, id: undefined, garment_ppm_id: ppmId })
      .select("id")
      .single();
    if (!fabRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("garment_ppm_fabric_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, fabric_id: fabRow.id })));
    }
  }

  // Insert processes with items
  for (const proc of processes) {
    const { items, ...procData } = proc;
    const { data: procRow } = await supabase
      .from("garment_ppm_processes")
      .insert({ ...procData, id: undefined, garment_ppm_id: ppmId })
      .select("id")
      .single();
    if (!procRow) continue;

    if (items.length > 0) {
      await supabase
        .from("garment_ppm_process_items")
        .insert(items.map((i) => ({ ...i, id: undefined, process_id: procRow.id })));
    }
  }

  // Insert accessories with sizes
  for (const acc of accessories) {
    const { sizes, ...accData } = acc;
    const { data: accRow } = await supabase
      .from("garment_ppm_accessories")
      .insert({ ...accData, id: undefined, garment_ppm_id: ppmId })
      .select("id")
      .single();
    if (!accRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("garment_ppm_accessory_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, accessory_id: accRow.id })));
    }
  }

  revalidatePpm("/planning/garment-ppm");
  return { ok: true, ppmId };
}

export async function updateGarmentPpm(
  id: string,
  data: GarmentPpmInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = garmentPpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { packs, quantities, fabrics, processes, accessories, ...header } = parsed.data;

  const { error } = await supabase
    .from("garment_ppms")
    .update(header)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Delete all children and re-insert (simplest cascade approach)
  await Promise.all([
    supabase.from("garment_ppm_packs").delete().eq("garment_ppm_id", id),
    supabase.from("garment_ppm_quantities").delete().eq("garment_ppm_id", id),
    supabase.from("garment_ppm_fabrics").delete().eq("garment_ppm_id", id),
    supabase.from("garment_ppm_processes").delete().eq("garment_ppm_id", id),
    supabase.from("garment_ppm_accessories").delete().eq("garment_ppm_id", id),
  ]);

  // Re-insert (reuse create logic pattern)
  if (packs.length > 0) {
    await supabase
      .from("garment_ppm_packs")
      .insert(packs.map((p) => ({ ...p, id: undefined, garment_ppm_id: id })));
  }

  for (const qty of quantities) {
    const { coordinates, combos, ...qtyData } = qty;
    const { data: qtyRow } = await supabase
      .from("garment_ppm_quantities")
      .insert({ ...qtyData, id: undefined, garment_ppm_id: id })
      .select("id")
      .single();
    if (!qtyRow) continue;

    if (coordinates.length > 0) {
      await supabase
        .from("garment_ppm_coordinates")
        .insert(coordinates.map((c) => ({ ...c, id: undefined, quantity_id: qtyRow.id })));
    }

    for (const combo of combos) {
      const { sizes, ...comboData } = combo;
      const { data: comboRow } = await supabase
        .from("garment_ppm_combos")
        .insert({ ...comboData, id: undefined, quantity_id: qtyRow.id })
        .select("id")
        .single();
      if (!comboRow) continue;

      if (sizes.length > 0) {
        await supabase
          .from("garment_ppm_sizes")
          .insert(sizes.map((s) => ({ ...s, id: undefined, combo_id: comboRow.id })));
      }
    }
  }

  for (const fabric of fabrics) {
    const { sizes, ...fabData } = fabric;
    const { data: fabRow } = await supabase
      .from("garment_ppm_fabrics")
      .insert({ ...fabData, id: undefined, garment_ppm_id: id })
      .select("id")
      .single();
    if (!fabRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("garment_ppm_fabric_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, fabric_id: fabRow.id })));
    }
  }

  for (const proc of processes) {
    const { items, ...procData } = proc;
    const { data: procRow } = await supabase
      .from("garment_ppm_processes")
      .insert({ ...procData, id: undefined, garment_ppm_id: id })
      .select("id")
      .single();
    if (!procRow) continue;

    if (items.length > 0) {
      await supabase
        .from("garment_ppm_process_items")
        .insert(items.map((i) => ({ ...i, id: undefined, process_id: procRow.id })));
    }
  }

  for (const acc of accessories) {
    const { sizes, ...accData } = acc;
    const { data: accRow } = await supabase
      .from("garment_ppm_accessories")
      .insert({ ...accData, id: undefined, garment_ppm_id: id })
      .select("id")
      .single();
    if (!accRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("garment_ppm_accessory_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, accessory_id: accRow.id })));
    }
  }

  revalidatePpm(`/planning/garment-ppm/${id}`, "/planning/garment-ppm");
  return { ok: true };
}

export async function deleteGarmentPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();

  // Children cascade via FK
  const { error } = await supabase.from("garment_ppms").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePpm("/planning/garment-ppm");
  return { ok: true };
}

export async function submitGarmentPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_ppms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidatePpm(`/planning/garment-ppm/${id}`, "/planning/garment-ppm");
  return { ok: true };
}

export async function approveGarmentPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_ppms")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({ action: "garment_ppm.approved", entityType: "garment_ppm", entityId: id });
  revalidatePpm(`/planning/garment-ppm/${id}`, "/planning/garment-ppm");
  return { ok: true };
}

// ============================================================================
// 2. PROCESSING PPM
// ============================================================================

export async function createProcessingPpm(
  data: ProcessingPpmInput,
): Promise<{ ok: true; ppmId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = processingPpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, yarns, ...header } = parsed.data;

  const { data: ppm, error } = await supabase
    .from("processing_ppms")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !ppm) return { ok: false, error: error?.message ?? "Failed" };
  const ppmId = ppm.id;

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("processing_ppm_items")
      .insert({ ...itemData, id: undefined, processing_ppm_id: ppmId })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("processing_ppm_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  if (yarns.length > 0) {
    await supabase
      .from("processing_ppm_yarns")
      .insert(yarns.map((y) => ({ ...y, id: undefined, processing_ppm_id: ppmId })));
  }

  revalidatePpm("/planning/processing-ppm");
  return { ok: true, ppmId };
}

export async function updateProcessingPpm(
  id: string,
  data: ProcessingPpmInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = processingPpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { items, yarns, ...header } = parsed.data;

  const { error } = await supabase.from("processing_ppms").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await Promise.all([
    supabase.from("processing_ppm_items").delete().eq("processing_ppm_id", id),
    supabase.from("processing_ppm_yarns").delete().eq("processing_ppm_id", id),
  ]);

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("processing_ppm_items")
      .insert({ ...itemData, id: undefined, processing_ppm_id: id })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("processing_ppm_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  if (yarns.length > 0) {
    await supabase
      .from("processing_ppm_yarns")
      .insert(yarns.map((y) => ({ ...y, id: undefined, processing_ppm_id: id })));
  }

  revalidatePpm(`/planning/processing-ppm/${id}`, "/planning/processing-ppm");
  return { ok: true };
}

export async function deleteProcessingPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("processing_ppms").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm("/planning/processing-ppm");
  return { ok: true };
}

export async function submitProcessingPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("processing_ppms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/processing-ppm/${id}`, "/planning/processing-ppm");
  return { ok: true };
}

export async function approveProcessingPpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("processing_ppms")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "processing_ppm.approved", entityType: "processing_ppm", entityId: id });
  revalidatePpm(`/planning/processing-ppm/${id}`, "/planning/processing-ppm");
  return { ok: true };
}

// ============================================================================
// 3. PURCHASE PPM
// ============================================================================

export async function createPurchasePpm(
  data: PurchasePpmInput,
): Promise<{ ok: true; ppmId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = purchasePpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { data: ppm, error } = await supabase
    .from("purchase_ppms")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !ppm) return { ok: false, error: error?.message ?? "Failed" };
  const ppmId = ppm.id;

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("purchase_ppm_items")
      .insert({ ...itemData, id: undefined, purchase_ppm_id: ppmId })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("purchase_ppm_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidatePpm("/planning/purchase-ppm");
  return { ok: true, ppmId };
}

export async function updatePurchasePpm(
  id: string,
  data: PurchasePpmInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = purchasePpmInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { error } = await supabase.from("purchase_ppms").update(header).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("purchase_ppm_items").delete().eq("purchase_ppm_id", id);

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("purchase_ppm_items")
      .insert({ ...itemData, id: undefined, purchase_ppm_id: id })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("purchase_ppm_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidatePpm(`/planning/purchase-ppm/${id}`, "/planning/purchase-ppm");
  return { ok: true };
}

export async function deletePurchasePpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_ppms").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm("/planning/purchase-ppm");
  return { ok: true };
}

export async function submitPurchasePpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_ppms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/purchase-ppm/${id}`, "/planning/purchase-ppm");
  return { ok: true };
}

export async function approvePurchasePpm(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_ppms")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "purchase_ppm.approved", entityType: "purchase_ppm", entityId: id });
  revalidatePpm(`/planning/purchase-ppm/${id}`, "/planning/purchase-ppm");
  return { ok: true };
}

// ============================================================================
// 4. PPM CANCEL
// ============================================================================

export async function createPpmCancel(
  data: PpmCancelInput,
): Promise<{ ok: true; cancelId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = ppmCancelInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { items, ...header } = parsed.data;

  const { data: cancel, error } = await supabase
    .from("ppm_cancels")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !cancel) return { ok: false, error: error?.message ?? "Failed" };
  const cancelId = cancel.id;

  for (const item of items) {
    const { sizes, ...itemData } = item;
    const { data: itemRow } = await supabase
      .from("ppm_cancel_items")
      .insert({ ...itemData, id: undefined, ppm_cancel_id: cancelId })
      .select("id")
      .single();
    if (!itemRow) continue;

    if (sizes.length > 0) {
      await supabase
        .from("ppm_cancel_sizes")
        .insert(sizes.map((s) => ({ ...s, id: undefined, item_id: itemRow.id })));
    }
  }

  revalidatePpm("/planning/ppm-cancel");
  return { ok: true, cancelId };
}

export async function deletePpmCancel(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("ppm_cancels").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm("/planning/ppm-cancel");
  return { ok: true };
}

export async function submitPpmCancel(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppm_cancels")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/ppm-cancel/${id}`, "/planning/ppm-cancel");
  return { ok: true };
}

export async function approvePpmCancel(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppm_cancels")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "ppm_cancel.approved", entityType: "ppm_cancel", entityId: id });
  revalidatePpm(`/planning/ppm-cancel/${id}`, "/planning/ppm-cancel");
  return { ok: true };
}

// ============================================================================
// 5. PPM COMPLETION
// ============================================================================

export async function createPpmCompletion(
  data: PpmCompletionInput,
): Promise<{ ok: true; completionId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = ppmCompletionInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: completion, error } = await supabase
    .from("ppm_completions")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !completion) return { ok: false, error: error?.message ?? "Failed" };

  revalidatePpm("/planning/ppm-completion");
  return { ok: true, completionId: completion.id };
}

export async function updatePpmCompletion(
  id: string,
  data: PpmCompletionInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = ppmCompletionInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("ppm_completions")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePpm(`/planning/ppm-completion/${id}`, "/planning/ppm-completion");
  return { ok: true };
}

export async function deletePpmCompletion(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("ppm_completions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm("/planning/ppm-completion");
  return { ok: true };
}

export async function submitPpmCompletion(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppm_completions")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/ppm-completion/${id}`, "/planning/ppm-completion");
  return { ok: true };
}

export async function approvePpmCompletion(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ppm_completions")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "ppm_completion.approved", entityType: "ppm_completion", entityId: id });
  revalidatePpm(`/planning/ppm-completion/${id}`, "/planning/ppm-completion");
  return { ok: true };
}

// ============================================================================
// 6. GARMENT PPM CANCELLATION
// ============================================================================

export async function createGarmentPpmCancellation(
  data: GarmentPpmCancellationInput,
): Promise<{ ok: true; cancelId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = garmentPpmCancellationInputSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { styles, ...header } = parsed.data;

  const { data: cancel, error } = await supabase
    .from("garment_ppm_cancellations")
    .insert({ ...header, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !cancel) return { ok: false, error: error?.message ?? "Failed" };
  const cancelId = cancel.id;

  for (const style of styles) {
    const { coordinates, combos, ...styleData } = style;
    const { data: styleRow } = await supabase
      .from("garment_ppm_cancel_styles")
      .insert({ ...styleData, id: undefined, cancellation_id: cancelId })
      .select("id")
      .single();
    if (!styleRow) continue;

    if (coordinates.length > 0) {
      await supabase
        .from("garment_ppm_cancel_coordinates")
        .insert(coordinates.map((c) => ({ ...c, id: undefined, style_id: styleRow.id })));
    }

    for (const combo of combos) {
      const { sizes, ...comboData } = combo;
      const { data: comboRow } = await supabase
        .from("garment_ppm_cancel_combos")
        .insert({ ...comboData, id: undefined, style_id: styleRow.id })
        .select("id")
        .single();
      if (!comboRow) continue;

      if (sizes.length > 0) {
        await supabase
          .from("garment_ppm_cancel_sizes")
          .insert(sizes.map((s) => ({ ...s, id: undefined, combo_id: comboRow.id })));
      }
    }
  }

  revalidatePpm("/planning/garment-ppm-cancel");
  return { ok: true, cancelId };
}

export async function deleteGarmentPpmCancellation(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_cancellations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm("/planning/garment-ppm-cancel");
  return { ok: true };
}

export async function submitGarmentPpmCancellation(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_ppm_cancellations")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm-cancel/${id}`, "/planning/garment-ppm-cancel");
  return { ok: true };
}

export async function approveGarmentPpmCancellation(id: string): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");
  const user = await getAppUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_ppm_cancellations")
    .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "garment_ppm_cancel.approved", entityType: "garment_ppm_cancellation", entityId: id });
  revalidatePpm(`/planning/garment-ppm-cancel/${id}`, "/planning/garment-ppm-cancel");
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Garment PPM
// ============================================================================

export async function addGarmentPpmPack(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_packs").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${data.garment_ppm_id}`);
  return { ok: true };
}

export async function updateGarmentPpmPack(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_packs").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function deleteGarmentPpmPack(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_packs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function addGarmentPpmFabric(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_fabrics").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${data.garment_ppm_id}`);
  return { ok: true };
}

export async function updateGarmentPpmFabric(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_fabrics").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function deleteGarmentPpmFabric(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_fabrics").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function addGarmentPpmProcess(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_processes").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${data.garment_ppm_id}`);
  return { ok: true };
}

export async function updateGarmentPpmProcess(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_processes").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function deleteGarmentPpmProcess(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_processes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function addGarmentPpmAccessory(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_accessories").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${data.garment_ppm_id}`);
  return { ok: true };
}

export async function updateGarmentPpmAccessory(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_accessories").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

export async function deleteGarmentPpmAccessory(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_accessories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm/${ppmId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Processing PPM
// ============================================================================

export async function addProcessingPpmItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("processing_ppm_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/processing-ppm/${data.processing_ppm_id}`);
  return { ok: true };
}

export async function updateProcessingPpmItem(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("processing_ppm_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/processing-ppm/${ppmId}`);
  return { ok: true };
}

export async function deleteProcessingPpmItem(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("processing_ppm_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/processing-ppm/${ppmId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Purchase PPM
// ============================================================================

export async function addPurchasePpmItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_ppm_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/purchase-ppm/${data.purchase_ppm_id}`);
  return { ok: true };
}

export async function updatePurchasePpmItem(
  id: string, ppmId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_ppm_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/purchase-ppm/${ppmId}`);
  return { ok: true };
}

export async function deletePurchasePpmItem(
  id: string, ppmId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_ppm_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/purchase-ppm/${ppmId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — PPM Cancel
// ============================================================================

export async function addPpmCancelItem(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("ppm_cancel_items").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/ppm-cancel/${data.ppm_cancel_id}`);
  return { ok: true };
}

export async function updatePpmCancelItem(
  id: string, cancelId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("ppm_cancel_items").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/ppm-cancel/${cancelId}`);
  return { ok: true };
}

export async function deletePpmCancelItem(
  id: string, cancelId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("ppm_cancel_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/ppm-cancel/${cancelId}`);
  return { ok: true };
}

// ============================================================================
// CHILD ROW CRUD — Garment PPM Cancellation
// ============================================================================

export async function addGarmentPpmCancelStyle(
  data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_cancel_styles").insert(data);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm-cancel/${data.cancellation_id}`);
  return { ok: true };
}

export async function updateGarmentPpmCancelStyle(
  id: string, cancelId: string, data: Record<string, unknown>,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_cancel_styles").update(data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm-cancel/${cancelId}`);
  return { ok: true };
}

export async function deleteGarmentPpmCancelStyle(
  id: string, cancelId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("garment_ppm_cancel_styles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePpm(`/planning/garment-ppm-cancel/${cancelId}`);
  return { ok: true };
}
