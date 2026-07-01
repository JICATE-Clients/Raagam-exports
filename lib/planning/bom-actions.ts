"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import {
  fabricComponentInput,
  fabricProcessInput,
  materialItemInput,
  netConsumption,
  type FabricBomInput,
  type MaterialBomInput,
  type FabricComponentInput,
  type FabricProcessInput,
  type MaterialItemInput,
} from "@/lib/planning/types";

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateBomPaths(orderId: string): void {
  revalidatePath(`/planning/orders/${orderId}`);
  revalidatePath("/planning/boms");
  revalidatePath("/planning");
}

// ---------- fabric bom ----------

export async function createFabricBom(
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase.from("fabric_boms").insert({
    sales_order_id: orderId,
    status: "draft",
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function updateFabricBom(
  bomId: string,
  orderId: string,
  data: Partial<Omit<FabricBomInput, "sales_order_id">>,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_boms")
    .update(data)
    .eq("id", bomId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function addFabricComponent(
  bomId: string,
  orderId: string,
  data: FabricComponentInput,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = fabricComponentInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const net = netConsumption(
    parsed.data.consumption,
    parsed.data.process_loss_pct,
  );

  const supabase = await createClient();
  const { error } = await supabase.from("fabric_bom_components").insert({
    ...parsed.data,
    fabric_bom_id: bomId,
    net_consumption: net,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function updateFabricComponent(
  componentId: string,
  orderId: string,
  data: FabricComponentInput,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = fabricComponentInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const net = netConsumption(
    parsed.data.consumption,
    parsed.data.process_loss_pct,
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_components")
    .update({ ...parsed.data, net_consumption: net })
    .eq("id", componentId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function deleteFabricComponent(
  componentId: string,
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_components")
    .delete()
    .eq("id", componentId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function addFabricProcess(
  bomId: string,
  orderId: string,
  data: FabricProcessInput,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = fabricProcessInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("fabric_bom_processes").insert({
    ...parsed.data,
    fabric_bom_id: bomId,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function deleteFabricProcess(
  processId: string,
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabric_bom_processes")
    .delete()
    .eq("id", processId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

// ---------- material bom ----------

export async function createMaterialBom(
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase.from("material_boms").insert({
    sales_order_id: orderId,
    status: "draft",
    created_by: user?.id ?? null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function updateMaterialBom(
  bomId: string,
  orderId: string,
  data: Partial<Omit<MaterialBomInput, "sales_order_id">>,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_boms")
    .update(data)
    .eq("id", bomId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function addMaterialItem(
  bomId: string,
  orderId: string,
  data: MaterialItemInput,
): Promise<ActionResult> {
  if (!(await can("planning", "create"))) throw new Error("Forbidden");

  const parsed = materialItemInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("material_bom_items").insert({
    ...parsed.data,
    material_bom_id: bomId,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function updateMaterialItem(
  itemId: string,
  orderId: string,
  data: MaterialItemInput,
): Promise<ActionResult> {
  if (!(await can("planning", "edit"))) throw new Error("Forbidden");

  const parsed = materialItemInput.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_items")
    .update(parsed.data)
    .eq("id", itemId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}

export async function deleteMaterialItem(
  itemId: string,
  orderId: string,
): Promise<ActionResult> {
  if (!(await can("planning", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_bom_items")
    .delete()
    .eq("id", itemId);

  if (error) return { ok: false, error: error.message };

  revalidateBomPaths(orderId);
  return { ok: true };
}
