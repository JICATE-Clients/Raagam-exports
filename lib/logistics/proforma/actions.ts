"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  proformaInput,
  proformaLineInput,
  PROFORMA_STATUSES,
  type ProformaInput,
  type ProformaLineInput,
  type ProformaStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; proformaId: string } | { ok: false; error: string };

const LIST_PATH = "/logistics/proforma";

export async function createProforma(
  payload: ProformaInput,
): Promise<CreateResult> {
  if (!(await can("logistics", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = proformaInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proforma_invoices")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create proforma invoice" };
  }

  await writeAudit({
    action: "proforma_invoice.created",
    entityType: "proforma_invoice",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, proformaId: data.id };
}

export async function addProformaLine(
  proformaId: string,
  data: ProformaLineInput,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = proformaLineInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("proforma_invoice_lines")
    .insert({ ...parsed.data, proforma_id: proformaId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${proformaId}`);
  return { ok: true };
}

export async function deleteProformaLine(
  lineId: string,
  proformaId: string,
): Promise<ActionResult> {
  if (!(await can("logistics", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("proforma_invoice_lines")
    .delete()
    .eq("id", lineId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${proformaId}`);
  return { ok: true };
}

export async function setProformaStatus(
  proformaId: string,
  status: ProformaStatus,
): Promise<ActionResult> {
  if (!(await can("logistics", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!PROFORMA_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("proforma_invoices")
    .update({ status })
    .eq("id", proformaId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${proformaId}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}
