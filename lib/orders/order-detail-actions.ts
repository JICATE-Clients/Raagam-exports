"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { coordinateColorInput, orderDescriptionInput, orderTrimInput, orderFabricInput, approvalParamInput } from "./order-detail-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(orderId: string): void { revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); }

export async function addCoordinateColor(data: unknown, orderId: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = coordinateColorInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_coordinate_colors").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true, id: row.id };
}

export async function addOrderDescription(data: unknown, orderId: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderDescriptionInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_descriptions").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true, id: row.id };
}

export async function addOrderTrim(data: unknown, orderId: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderTrimInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_trims").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true, id: row.id };
}

export async function addOrderFabric(data: unknown, orderId: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderFabricInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_fabrics").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true, id: row.id };
}

export async function addApprovalParam(data: unknown, orderId: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = approvalParamInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_approval_params").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true, id: row.id };
}

export async function deleteOrderDetailRow(table: string, id: string, orderId: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const allowed = [
    "order_coordinate_colors", "order_descriptions", "order_trims",
    "order_fabrics", "order_fabric_components", "order_fabric_yarn_colors",
    "order_approval_params",
  ];
  if (!allowed.includes(table)) return fail("Invalid table");
  const s = await createClient();
  const { error } = await s.from(table).delete().eq("id", id);
  if (error) return fail(error.message);
  rev(orderId);
  return { ok: true };
}
