"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { shipmentCostInput, type ShipmentCostInput } from "@/lib/finance/types";
import { computeMaterialsRollup } from "@/lib/finance/pnl-service";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

// ---------- addCost ----------

export async function addCost(payload: ShipmentCostInput): Promise<ActionResult> {
  if (!(await can("finance", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = shipmentCostInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase.from("shipment_costs").insert({
    ...parsed.data,
    source: "manual",
    created_by: user?.id ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/finance/pnl/${parsed.data.shipment_id}`);
  revalidatePath("/finance/pnl");
  return { ok: true };
}

// ---------- deleteCost ----------

export async function deleteCost(
  costId: string,
  shipmentId: string,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  // Only manual cost lines may be deleted; auto rows are replaced by pullMaterialsCost
  const { data: cost } = await supabase
    .from("shipment_costs")
    .select("source")
    .eq("id", costId)
    .single();

  if ((cost?.source as string | undefined) === "auto") {
    return {
      ok: false,
      error:
        "Auto-generated costs can only be replaced via 'Pull materials cost', not deleted individually",
    };
  }

  const { error } = await supabase.from("shipment_costs").delete().eq("id", costId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/finance/pnl/${shipmentId}`);
  revalidatePath("/finance/pnl");
  return { ok: true };
}

// ---------- pullMaterialsCost ----------

export async function pullMaterialsCost(
  shipmentId: string,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) {
    throw new Error("Forbidden");
  }

  const { total, poCount } = await computeMaterialsRollup(shipmentId);

  if (poCount === 0) {
    return {
      ok: false,
      error: "No approved purchase orders found via linked orders",
    };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  // Replace any prior auto materials row for this shipment
  await supabase
    .from("shipment_costs")
    .delete()
    .eq("shipment_id", shipmentId)
    .eq("cost_type", "materials")
    .eq("source", "auto");

  const { error } = await supabase.from("shipment_costs").insert({
    shipment_id: shipmentId,
    cost_type: "materials",
    description: `Materials rollup (${poCount} PO${poCount !== 1 ? "s" : ""})`,
    amount: total,
    source: "auto",
    reference_type: "po_rollup",
    reference_id: null,
    created_by: user?.id ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/finance/pnl/${shipmentId}`);
  revalidatePath("/finance/pnl");
  return { ok: true };
}
