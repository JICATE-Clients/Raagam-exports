"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { paymentTermInput, type PaymentTermInput } from "./payment-term-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/payment-term");
}

export async function createPaymentTerm(data: PaymentTermInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = paymentTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("payment_terms").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updatePaymentTerm(id: string, data: PaymentTermInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = paymentTermInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("payment_terms").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePaymentTerm(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("payment_terms").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
