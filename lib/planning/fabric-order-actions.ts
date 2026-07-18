"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { fabricOrderInput, domesticProdPlanInput } from "./fabric-order-types";
import type { FabricOrderInput, DomesticProdPlanInput } from "./fabric-order-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/planning"); revalidatePath("/planning/fabric-orders"); revalidatePath("/planning/domestic-production"); }

// ---------------------------------------------------------------------------
// Fabric Orders
// ---------------------------------------------------------------------------

export async function createFabricOrder(data: FabricOrderInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = fabricOrderInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { styles, ...header } = p.data;
  const { data: row, error } = await s.from("fabric_orders").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (styles.length > 0) {
    const { error: childErr } = await s.from("fabric_order_styles").insert(
      styles.map((st, i) => ({ fabric_order_id: row.id, sno: i + 1, ...st })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addFabricOrderStyle(fabricOrderId: string, data: { style_ref_no?: string | null; article_no?: string | null; delivery_date?: string | null }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("fabric_order_styles").select("sno").eq("fabric_order_id", fabricOrderId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("fabric_order_styles").insert({ fabric_order_id: fabricOrderId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function submitFabricOrder(id: string): Promise<Result> {
  if (!(await can("planning", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("fabric_orders").update({ status: "submitted" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteFabricOrder(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("fabric_orders").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Domestic Production Plans
// ---------------------------------------------------------------------------

export async function createDomesticProdPlan(data: DomesticProdPlanInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = domesticProdPlanInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { styles, ...header } = p.data;
  const { data: row, error } = await s.from("domestic_production_plans").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (styles.length > 0) {
    const { error: childErr } = await s.from("domestic_prod_plan_styles").insert(
      styles.map((st, i) => ({ plan_id: row.id, sno: i + 1, ...st })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addDomesticProdPlanStyle(planId: string, data: { style_ref_no?: string | null; style_no?: string | null; style_description?: string | null; uom_id?: string | null; order_qty?: number; no_of_box?: number }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("domestic_prod_plan_styles").select("sno").eq("plan_id", planId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("domestic_prod_plan_styles").insert({ plan_id: planId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function confirmDomesticProdPlan(id: string): Promise<Result> {
  if (!(await can("planning", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("domestic_production_plans").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDomesticProdPlan(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("domestic_production_plans").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
