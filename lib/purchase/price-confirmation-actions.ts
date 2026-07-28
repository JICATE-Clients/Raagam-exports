"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  priceConfirmationInput,
  priceConfirmationItemInput,
} from "./price-confirmation-types";
import type {
  PriceConfirmationInput,
  PriceConfirmationItemInput,
} from "./price-confirmation-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };

function revalidatePc(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/purchase");
  revalidatePath("/purchase/price-confirmations");
}

export async function createPriceConfirmation(
  data: PriceConfirmationInput,
): Promise<{ ok: true; pcId: string } | ErrResult> {
  if (!(await can("materials_purchase", "create"))) throw new Error("Forbidden");

  const parsed = priceConfirmationInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();

  const { data: pc, error } = await supabase
    .from("price_confirmations")
    .insert({ ...parsed.data, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !pc) return { ok: false, error: error?.message ?? "Failed" };

  revalidatePc();
  return { ok: true, pcId: pc.id };
}

export async function addPriceConfirmationItem(
  data: PriceConfirmationItemInput,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const parsed = priceConfirmationItemInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("price_confirmation_items")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidatePc(`/purchase/price-confirmations/${data.price_confirmation_id}`);
  return { ok: true };
}

export async function deletePriceConfirmationItem(
  itemId: string,
  pcId: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("price_confirmation_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePc(`/purchase/price-confirmations/${pcId}`);
  return { ok: true };
}

export async function submitPriceConfirmation(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("price_confirmations")
    .update({ status: "submitted" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  revalidatePc(`/purchase/price-confirmations/${id}`);
  return { ok: true };
}

export async function approvePriceConfirmation(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "approve"))) throw new Error("Forbidden");

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("price_confirmations")
    .update({
      status: "approved",
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "price_confirmation.approved",
    entityType: "price_confirmation",
    entityId: id,
  });

  revalidatePc(`/purchase/price-confirmations/${id}`);
  return { ok: true };
}

export async function rejectPriceConfirmation(
  id: string,
): Promise<OkResult | ErrResult> {
  if (!(await can("materials_purchase", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("price_confirmations")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "submitted");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "price_confirmation.rejected",
    entityType: "price_confirmation",
    entityId: id,
  });

  revalidatePc(`/purchase/price-confirmations/${id}`);
  return { ok: true };
}
