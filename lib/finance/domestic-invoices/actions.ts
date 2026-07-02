"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  domesticInvoiceInput,
  DGI_STATUSES,
  type DomesticInvoiceInput,
  type DgiStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/finance/domestic-invoices";

export async function createDomesticInvoice(
  payload: DomesticInvoiceInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");
  const parsed = domesticInvoiceInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("domestic_garment_invoices").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setDomesticInvoiceStatus(
  id: string,
  status: DgiStatus,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");
  if (!DGI_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("domestic_garment_invoices")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function deleteDomesticInvoice(id: string): Promise<ActionResult> {
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");
  const supabase = await createClient();
  const { error } = await supabase.from("domestic_garment_invoices").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(LIST_PATH);
  return { ok: true };
}
