"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import {
  assetInput,
  assetAssignmentInput,
  courierInput,
  courierDespatchInput,
} from "./extras-types";
import type {
  AssetInput,
  AssetAssignmentInput,
  CourierInput,
  CourierDespatchInput,
} from "./extras-types";

type Err = { ok: false; error: string };
type Ok = { ok: true };
type R = Ok | Err;

async function guard(action: "create" | "edit" | "delete" | "approve"): Promise<void> {
  if (!(await can("system_admin", action))) throw new Error("Forbidden");
}
async function uid(): Promise<string | null> {
  const u = await getAppUser();
  return u?.id ?? null;
}
function bad(m: string): Err {
  return { ok: false, error: m };
}

// ============================================================================
// Assets
// ============================================================================
function revA(id?: string): void {
  if (id) revalidatePath(`/admin/assets/${id}`);
  revalidatePath("/admin/assets");
  revalidatePath("/admin");
}

export async function createAsset(payload: AssetInput): Promise<{ ok: true; id: string } | Err> {
  await guard("create");
  const p = assetInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data, error } = await s
    .from("assets")
    .insert({ ...p.data, status: "active", created_by: await uid() })
    .select("id")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to create asset");
  revA(data.id);
  return { ok: true, id: data.id };
}

export async function assignAsset(assetId: string, payload: AssetAssignmentInput): Promise<R> {
  await guard("edit");
  const p = assetAssignmentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { data: asset } = await s.from("assets").select("status").eq("id", assetId).maybeSingle();
  if (!asset) return bad("Asset not found");
  if (asset.status !== "active") return bad("Only an active asset can be assigned");
  const { error } = await s
    .from("asset_assignments")
    .insert({ ...p.data, asset_id: assetId, status: "assigned", created_by: await uid() });
  if (error) return bad(error.message);
  await s.from("assets").update({ status: "assigned" }).eq("id", assetId);
  revA(assetId);
  return { ok: true };
}

export async function returnAsset(assignmentId: string, assetId: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s
    .from("asset_assignments")
    .update({ status: "returned", returned_date: new Date().toISOString().slice(0, 10) })
    .eq("id", assignmentId);
  if (error) return bad(error.message);
  await s.from("assets").update({ status: "active" }).eq("id", assetId);
  revA(assetId);
  return { ok: true };
}

export async function setAssetStatus(assetId: string, status: "retired" | "disposed" | "active"): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("assets").update({ status }).eq("id", assetId);
  if (error) return bad(error.message);
  revA(assetId);
  return { ok: true };
}

export async function deleteAsset(assetId: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: asset } = await s.from("assets").select("status").eq("id", assetId).maybeSingle();
  if (!asset || asset.status === "assigned") return bad("An assigned asset cannot be deleted");
  const { error } = await s.from("assets").delete().eq("id", assetId);
  if (error) return bad(error.message);
  revA();
  return { ok: true };
}

// ============================================================================
// Couriers
// ============================================================================
function revC(): void {
  revalidatePath("/admin/couriers");
  revalidatePath("/admin");
}

export async function createCourier(payload: CourierInput): Promise<R> {
  await guard("create");
  const p = courierInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("couriers").insert(p.data);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function setCourierActive(id: string, isActive: boolean): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("couriers").update({ is_active: isActive }).eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function deleteCourier(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { error } = await s.from("couriers").delete().eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}

export async function createDespatch(payload: CourierDespatchInput): Promise<R> {
  await guard("create");
  const p = courierDespatchInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const s = await createClient();
  const { error } = await s.from("courier_despatches").insert({ ...p.data, status: "draft", created_by: await uid() });
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function markCourierDespatched(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("courier_despatches").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "draft") return bad("Only a draft despatch can be despatched");
  const { error } = await s.from("courier_despatches").update({ status: "despatched" }).eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function recordPod(id: string, podReference: string | null): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { data: row } = await s.from("courier_despatches").select("status").eq("id", id).maybeSingle();
  if (!row || row.status !== "despatched") return bad("POD can only be recorded on a despatched item");
  const { error } = await s
    .from("courier_despatches")
    .update({ status: "delivered", pod_reference: podReference, pod_date: new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function cancelDespatch(id: string): Promise<R> {
  await guard("edit");
  const s = await createClient();
  const { error } = await s.from("courier_despatches").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
export async function deleteDespatch(id: string): Promise<R> {
  await guard("delete");
  const s = await createClient();
  const { data: row } = await s.from("courier_despatches").select("status").eq("id", id).maybeSingle();
  if (!row || !["draft", "cancelled"].includes(row.status)) return bad("Only draft or cancelled despatches can be deleted");
  const { error } = await s.from("courier_despatches").delete().eq("id", id);
  if (error) return bad(error.message);
  revC();
  return { ok: true };
}
