"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { paymentTermInput, type PaymentTermInput } from "./payment-term-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
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

/**
 * Add / rename a payment term from a Payment Terms FIELD, not the master screen.
 *
 * Why these exist, and why they write `payment_terms`: until 2026-07-31 the six
 * Payment Terms fields rendered `LookupDialogPicker kind="payment_term"`, whose
 * inline Add writes `config_lookups` (lookup-dialog-picker.tsx:139) while their
 * options came from THIS master via `paymentTermsAsLookups()`. So a term added
 * from a field landed in a table nothing reads — it vanished on the next refresh
 * — and the id handed back was not a valid `payment_term_id`, which is an FK
 * into `public.payment_terms` since 0375. Same defect as State's, same fix:
 * `components/masters/payment-term-picker.tsx` calls these.
 *
 * DESCRIPTION ONLY, deliberately. The inline form is one Name box (DataPicker
 * derives the code and shows no Code input), so `pay_mode`, the AT phrase,
 * `credit_days` and `with_interest` keep their table defaults and are filled in
 * on the master screen. A quick-add must not invent commercial terms — a term
 * silently created as "0 credit days, no pay mode" would read as deliberate.
 * `entry_no` is an identity column and assigns itself.
 */
export async function createPaymentTermQuick(
  description: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = paymentTermInput.safeParse({
    entry_date: new Date().toISOString().slice(0, 10),
    description,
  });
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (!p.data.description?.trim()) return fail("Description is required");
  const s = await createClient();
  // The master carries its display text in `description`, not `name`.
  const dup = await checkDuplicateName(s, "payment_terms", p.data.description, {
    nameColumn: "description",
    label: "description",
  });
  if (!dup.ok) return fail(dup.error);
  const { data, error } = await s
    .from("payment_terms")
    .insert(p.data)
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: data.id };
}

export async function updatePaymentTermQuick(id: string, description: string): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const s = await createClient();
  // Read the rest of the record back rather than defaulting it — renaming a term
  // from a field must not wipe its credit days or silently reactivate it.
  const { data: existing } = await s
    .from("payment_terms")
    .select("entry_date, pay_mode, at_basis, at_when, at_event, with_interest, credit_days, inactive")
    .eq("id", id)
    .single();
  if (!existing) return fail("Payment term not found");
  const p = paymentTermInput.safeParse({ ...existing, description });
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  if (!p.data.description?.trim()) return fail("Description is required");
  const dup = await checkDuplicateName(s, "payment_terms", p.data.description, {
    nameColumn: "description",
    label: "description",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("payment_terms").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePaymentTerm(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "payment_terms", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
