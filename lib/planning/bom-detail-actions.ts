"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

// ============================================================================
// Helpers
// ============================================================================

function revalidateFabricBom(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/fabric-bom");
}

function revalidateGarmentBom(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/garment-bom");
}

function revalidateAccessoryBom(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/accessory-bom");
}

// ============================================================================
// FABRIC BOM — CRUD & workflow
// ============================================================================

export async function createFabricBom(
  data: {
    style_id?: string | null;
    sales_order_id?: string | null;
    customer_id?: string | null;
    amendment_no?: number;
    catalogue_no?: string | null;
    description?: string | null;
  },
): Promise<{ ok: true; bomId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: bom, error } = await supabase
    .from("fabric_boms")
    .insert({ ...data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !bom) return { ok: false, error: error?.message ?? "Failed" };

  revalidateFabricBom();
  return { ok: true, bomId: bom.id };
}

export async function submitFabricBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_boms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${id}`);
  return { ok: true };
}

export async function approveFabricBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("fabric_boms")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "fabric_bom.approved",
    entityType: "fabric_bom",
    entityId: id,
  });

  revalidateFabricBom(`/planning/fabric-bom/${id}`);
  return { ok: true };
}

// --- Dye Colors ---

export async function addFabricBomDyeColor(
  bomId: string,
  data: {
    color_type: string;
    description: string;
    process_loss_pct?: number;
    sub_type?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_dye_colors")
    .insert({ fabric_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function updateFabricBomDyeColor(
  colorId: string,
  bomId: string,
  data: {
    description?: string;
    process_loss_pct?: number;
    sub_type?: string | null;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_dye_colors")
    .update(data)
    .eq("id", colorId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function deleteFabricBomDyeColor(
  colorId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_dye_colors")
    .delete()
    .eq("id", colorId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

// --- Fabrics ---

export async function addFabricBomFabric(
  bomId: string,
  data: {
    sno?: number;
    category_id?: string | null;
    item_id?: string | null;
    item_sub_type?: string | null;
    gsm_range?: string | null;
    no_of_colors?: number;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_fabrics")
    .insert({ fabric_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function deleteFabricBomFabric(
  fabricId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete child cloths first
  await supabase.from("fabric_bom_cloths").delete().eq("fabric_id", fabricId);
  const { error } = await supabase
    .from("fabric_bom_fabrics")
    .delete()
    .eq("id", fabricId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

// --- Cloths ---

export async function addFabricBomCloth(
  fabricId: string,
  bomId: string,
  data: {
    sno?: number;
    cloth_name?: string | null;
    fabric_short_name?: string | null;
    uom_id?: string | null;
    yarn_short_name?: string | null;
    shade_id?: string | null;
    warp_weft?: string | null;
    yarn_reqd_form?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_cloths")
    .insert({ fabric_id: fabricId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function updateFabricBomCloth(
  clothId: string,
  bomId: string,
  data: {
    cloth_name?: string | null;
    fabric_short_name?: string | null;
    uom_id?: string | null;
    yarn_short_name?: string | null;
    shade_id?: string | null;
    warp_weft?: string | null;
    yarn_reqd_form?: string | null;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_cloths")
    .update(data)
    .eq("id", clothId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function deleteFabricBomCloth(
  clothId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_cloths")
    .delete()
    .eq("id", clothId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

// --- Components ---

export async function addFabricBomComponent(
  bomId: string,
  data: {
    sno?: number;
    component_id?: string | null;
    coordinate?: string | null;
    category_id?: string | null;
    item_type?: string | null;
    item_sub_type?: string | null;
    item_id?: string | null;
    gsm?: number | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_components")
    .insert({ fabric_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function deleteFabricBomComponent(
  componentId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  await supabase.from("fabric_bom_combos").delete().eq("component_id", componentId);
  const { error } = await supabase
    .from("fabric_bom_components")
    .delete()
    .eq("id", componentId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

// --- Combos ---

export async function addFabricBomCombo(
  componentId: string,
  bomId: string,
  data: {
    sno?: number;
    assort_color?: string | null;
    item_sub_type?: string | null;
    item_id?: string | null;
    gsm?: number | null;
    item_process_type?: string | null;
    item_color?: string | null;
    print_name?: string | null;
    specifications?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_combos")
    .insert({ component_id: componentId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

export async function deleteFabricBomCombo(
  comboId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_combos")
    .delete()
    .eq("id", comboId);
  if (error) return { ok: false, error: error.message };

  revalidateFabricBom(`/planning/fabric-bom/${bomId}`);
  return { ok: true };
}

// ============================================================================
// GARMENT BOM — CRUD & workflow
// ============================================================================

export async function createGarmentBom(
  data: {
    style_id?: string | null;
    sales_order_id?: string | null;
    customer_id?: string | null;
    order_no?: string | null;
    oc_no?: string | null;
    amendment_no?: number;
    reason?: string | null;
    task_owner_id?: string | null;
  },
): Promise<{ ok: true; bomId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: bom, error } = await supabase
    .from("garment_boms")
    .insert({ ...data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !bom) return { ok: false, error: error?.message ?? "Failed" };

  revalidateGarmentBom();
  return { ok: true, bomId: bom.id };
}

export async function submitGarmentBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_boms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${id}`);
  return { ok: true };
}

export async function approveGarmentBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("garment_boms")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "garment_bom.approved",
    entityType: "garment_bom",
    entityId: id,
  });

  revalidateGarmentBom(`/planning/garment-bom/${id}`);
  return { ok: true };
}

// --- Processes ---

export async function addGarmentBomProcess(
  bomId: string,
  data: {
    process_type: string;
    sno?: number;
    style_ref_no?: string | null;
    style_no?: string | null;
    article_no?: string | null;
    process_id?: string | null;
    against_pack_ref?: boolean;
    loss_pct?: number;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_bom_processes")
    .insert({ garment_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

export async function deleteGarmentBomProcess(
  processId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete grandchild placements, then child components
  const { data: comps } = await supabase
    .from("garment_bom_components")
    .select("id")
    .eq("process_id", processId);
  if (comps && comps.length > 0) {
    const compIds = comps.map((c: { id: string }) => c.id);
    await supabase.from("garment_bom_placements").delete().in("component_id", compIds);
  }
  await supabase.from("garment_bom_components").delete().eq("process_id", processId);
  const { error } = await supabase
    .from("garment_bom_processes")
    .delete()
    .eq("id", processId);
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

// --- Components ---

export async function addGarmentBomComponent(
  processId: string,
  bomId: string,
  data: {
    sno?: number;
    component_id?: string | null;
    coordinate?: string | null;
    design?: string | null;
    vendor_specification?: string | null;
    attachment_ref?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_bom_components")
    .insert({ process_id: processId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

export async function deleteGarmentBomComponent(
  componentId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  await supabase.from("garment_bom_placements").delete().eq("component_id", componentId);
  const { error } = await supabase
    .from("garment_bom_components")
    .delete()
    .eq("id", componentId);
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

// --- Placements ---

export async function addGarmentBomPlacement(
  componentId: string,
  bomId: string,
  data: {
    sno?: number;
    position?: string | null;
    design_detail?: string | null;
    combo_detail?: string | null;
    pack_ref_detail?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_bom_placements")
    .insert({ component_id: componentId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

export async function deleteGarmentBomPlacement(
  placementId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("garment_bom_placements")
    .delete()
    .eq("id", placementId);
  if (error) return { ok: false, error: error.message };

  revalidateGarmentBom(`/planning/garment-bom/${bomId}`);
  return { ok: true };
}

// ============================================================================
// ACCESSORY BOM — CRUD & workflow
// ============================================================================

export async function createAccessoryBom(
  data: {
    bom_type?: "purchased" | "in_factory";
    sales_order_id?: string | null;
    customer_id?: string | null;
    style_id?: string | null;
    order_no?: string | null;
    group_no?: string | null;
    amendment_no?: number;
    reason?: string | null;
    task_owner_id?: string | null;
  },
): Promise<{ ok: true; bomId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: bom, error } = await supabase
    .from("accessory_boms")
    .insert({ ...data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !bom) return { ok: false, error: error?.message ?? "Failed" };

  revalidateAccessoryBom();
  return { ok: true, bomId: bom.id };
}

export async function submitAccessoryBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_boms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${id}`);
  return { ok: true };
}

export async function approveAccessoryBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("accessory_boms")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "accessory_bom.approved",
    entityType: "accessory_bom",
    entityId: id,
  });

  revalidateAccessoryBom(`/planning/accessory-bom/${id}`);
  return { ok: true };
}

// --- Items ---

export async function addAccessoryBomItem(
  bomId: string,
  data: {
    sno?: number;
    category_id?: string | null;
    item_id?: string | null;
    availability_type?: string | null;
    bom_for?: string | null;
    supply_type?: string | null;
    vendor_id?: string | null;
    uom_id?: string | null;
    moq?: number | null;
    is_approval_required?: boolean;
    advised_item_name?: string | null;
    specifications?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_items")
    .insert({ accessory_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function updateAccessoryBomItem(
  itemId: string,
  bomId: string,
  data: {
    category_id?: string | null;
    item_id?: string | null;
    availability_type?: string | null;
    bom_for?: string | null;
    supply_type?: string | null;
    vendor_id?: string | null;
    uom_id?: string | null;
    moq?: number | null;
    is_approval_required?: boolean;
    advised_item_name?: string | null;
    specifications?: string | null;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_items")
    .update(data)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function deleteAccessoryBomItem(
  itemId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete children: consumptions (with sizes) and combinations
  const { data: cons } = await supabase
    .from("accessory_bom_consumptions")
    .select("id")
    .eq("item_id", itemId);
  if (cons && cons.length > 0) {
    const consIds = cons.map((c: { id: string }) => c.id);
    await supabase.from("accessory_bom_consumption_sizes").delete().in("consumption_id", consIds);
  }
  await supabase.from("accessory_bom_consumptions").delete().eq("item_id", itemId);
  await supabase.from("accessory_bom_combinations").delete().eq("item_id", itemId);
  const { error } = await supabase
    .from("accessory_bom_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

// --- Consumptions ---

export async function addAccessoryBomConsumption(
  itemId: string,
  bomId: string,
  data: {
    sno?: number;
    uom_id?: string | null;
    nos_per_pcs?: number;
    pcs_per_nos?: number;
    waste_pct?: number;
    allowance_qty?: number;
    style_ref_no?: string | null;
    is_sizewise?: boolean;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_consumptions")
    .insert({ item_id: itemId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function deleteAccessoryBomConsumption(
  consumptionId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  await supabase.from("accessory_bom_consumption_sizes").delete().eq("consumption_id", consumptionId);
  const { error } = await supabase
    .from("accessory_bom_consumptions")
    .delete()
    .eq("id", consumptionId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

// --- Consumption Sizes ---

export async function addAccessoryBomConsumptionSize(
  consumptionId: string,
  bomId: string,
  data: {
    sno?: number;
    garment_size?: string | null;
    nos_per_pcs?: number;
    pcs_per_nos?: number;
    allowance_pct?: number;
    allowance_qty?: number;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_consumption_sizes")
    .insert({ consumption_id: consumptionId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function deleteAccessoryBomConsumptionSize(
  sizeId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_consumption_sizes")
    .delete()
    .eq("id", sizeId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

// --- Processes ---

export async function addAccessoryBomProcess(
  bomId: string,
  data: {
    sno?: number;
    item_id?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_processes")
    .insert({ accessory_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function deleteAccessoryBomProcess(
  processId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  await supabase.from("accessory_bom_process_stages").delete().eq("process_id", processId);
  const { error } = await supabase
    .from("accessory_bom_processes")
    .delete()
    .eq("id", processId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

// --- Process Stages ---

export async function addAccessoryBomProcessStage(
  processId: string,
  bomId: string,
  data: {
    sno?: number;
    stage?: string | null;
    process_name?: string | null;
    loss_for?: string | null;
    loss_pct?: number;
    description?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_process_stages")
    .insert({ process_id: processId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function updateAccessoryBomProcessStage(
  stageId: string,
  bomId: string,
  data: {
    stage?: string | null;
    process_name?: string | null;
    loss_for?: string | null;
    loss_pct?: number;
    description?: string | null;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_process_stages")
    .update(data)
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}

export async function deleteAccessoryBomProcessStage(
  stageId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("accessory_bom_process_stages")
    .delete()
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  revalidateAccessoryBom(`/planning/accessory-bom/${bomId}`);
  return { ok: true };
}
