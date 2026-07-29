"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  materialBomInput,
  materialBomProductInput,
  bomShortageInput,
  bomShortageItemInput,
  bomTransferInput,
  bomTransferItemInput,
} from "./bom-types";
import type {
  MaterialBomInput,
  MaterialBomProductInput,
  BomShortageInput,
  BomShortageItemInput,
  BomTransferInput,
  BomTransferItemInput,
} from "./bom-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidateBom(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/material-bom");
}

export async function createMaterialBom(
  data: MaterialBomInput,
): Promise<{ ok: true; bomId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = materialBomInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: bom, error } = await supabase
    .from("material_boms")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !bom) return { ok: false, error: error?.message ?? "Failed" };

  revalidateBom();
  return { ok: true, bomId: bom.id };
}

export async function updateMaterialBom(
  id: string,
  data: MaterialBomInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialBomInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_boms")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${id}`);
  return { ok: true };
}

export async function addMaterialBomProduct(
  data: MaterialBomProductInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialBomProductInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_products")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${data.material_bom_id}`);
  return { ok: true };
}

export async function deleteMaterialBomProduct(
  itemId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_products")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function updateMaterialBomProduct(
  itemId: string,
  bomId: string,
  data: MaterialBomProductInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialBomProductInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { material_bom_id: _mbid, ...updateData } = parsed.data;
  void _mbid;
  const { error } = await supabase
    .from("material_bom_products")
    .update(updateData)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function addMaterialBomProcessSequence(
  bomId: string,
  data: {
    process_type: "yarn" | "fabric";
    sno: number;
    item_id?: string | null;
    item_process_type?: string | null;
    process_seq_name?: string | null;
    sort_order?: number;
  },
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_process_sequences")
    .insert({ material_bom_id: bomId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function deleteMaterialBomProcessSequence(
  seqId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  // Delete child stages first
  await supabase
    .from("material_bom_process_stages")
    .delete()
    .eq("sequence_id", seqId);
  const { error } = await supabase
    .from("material_bom_process_sequences")
    .delete()
    .eq("id", seqId);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function addMaterialBomProcessStage(
  sequenceId: string,
  bomId: string,
  data: {
    sno: number;
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
    .from("material_bom_process_stages")
    .insert({ sequence_id: sequenceId, ...data, sort_order: data.sort_order ?? 0 });
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function updateMaterialBomProcessStage(
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
    .from("material_bom_process_stages")
    .update(data)
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function deleteMaterialBomProcessStage(
  stageId: string,
  bomId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_process_stages")
    .delete()
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${bomId}`);
  return { ok: true };
}

export async function submitMaterialBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_boms")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateBom(`/planning/material-bom/${id}`);
  return { ok: true };
}

export async function approveMaterialBom(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("material_boms")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "material_bom.approved",
    entityType: "material_bom",
    entityId: id,
  });

  revalidateBom(`/planning/material-bom/${id}`);
  return { ok: true };
}

// ============================================================================
// BOM Shortage (FrmBOM_Shortage)
// ============================================================================

function revalidateShortage(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/bom-shortage");
}

export async function createBomShortage(
  data: BomShortageInput,
): Promise<{ ok: true; shortageId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = bomShortageInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: shortage, error } = await supabase
    .from("bom_shortages")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !shortage) return { ok: false, error: error?.message ?? "Failed" };

  revalidateShortage();
  return { ok: true, shortageId: shortage.id };
}

export async function addBomShortageItem(
  data: BomShortageItemInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = bomShortageItemInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_shortage_items")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateShortage(`/planning/bom-shortage/${data.shortage_id}`);
  return { ok: true };
}

export async function deleteBomShortageItem(
  itemId: string,
  shortageId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_shortage_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateShortage(`/planning/bom-shortage/${shortageId}`);
  return { ok: true };
}

export async function submitBomShortage(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_shortages")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateShortage(`/planning/bom-shortage/${id}`);
  return { ok: true };
}

export async function approveBomShortage(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("bom_shortages")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "bom_shortage.approved",
    entityType: "bom_shortage",
    entityId: id,
  });

  revalidateShortage(`/planning/bom-shortage/${id}`);
  return { ok: true };
}

// ============================================================================
// BOM Transfer (FrmBOMXfrs)
// ============================================================================

function revalidateTransfer(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/planning");
  revalidatePath("/planning/bom-transfer");
}

export async function createBomTransfer(
  data: BomTransferInput,
): Promise<{ ok: true; transferId: string } | ErrResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = bomTransferInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: transfer, error } = await supabase
    .from("bom_transfers")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !transfer) return { ok: false, error: error?.message ?? "Failed" };

  revalidateTransfer();
  return { ok: true, transferId: transfer.id };
}

export async function addBomTransferItem(
  data: BomTransferItemInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = bomTransferItemInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_transfer_items")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateTransfer(`/planning/bom-transfer/${data.transfer_id}`);
  return { ok: true };
}

export async function deleteBomTransferItem(
  itemId: string,
  transferId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_transfer_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidateTransfer(`/planning/bom-transfer/${transferId}`);
  return { ok: true };
}

export async function submitBomTransfer(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("bom_transfers")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidateTransfer(`/planning/bom-transfer/${id}`);
  return { ok: true };
}

export async function approveBomTransfer(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("planning", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("bom_transfers")
    .update({
      status: "approved",
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "bom_transfer.approved",
    entityType: "bom_transfer",
    entityId: id,
  });

  revalidateTransfer(`/planning/bom-transfer/${id}`);
  return { ok: true };
}
