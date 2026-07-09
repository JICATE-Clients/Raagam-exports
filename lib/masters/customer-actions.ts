"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { customerInput, type CustomerInput } from "./customer-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/customer");
}

type ContactRow = Omit<CustomerInput["contacts"][number], "sno"> & { sno: number };

/** Drop fully-empty contact rows (no picker + all text blank) and renumber sno. */
function normalizeContacts(data: CustomerInput): ContactRow[] {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return data.contacts
    .map((c) => ({
      department_id: c.department_id ?? null,
      contact_name: clean(c.contact_name),
      designation_id: c.designation_id ?? null,
      land_line: clean(c.land_line),
      mobile: clean(c.mobile),
      email_id: clean(c.email_id),
      internal_department_id: c.internal_department_id ?? null,
    }))
    .filter(
      (c) =>
        c.department_id ||
        c.contact_name ||
        c.designation_id ||
        c.land_line ||
        c.mobile ||
        c.email_id ||
        c.internal_department_id,
    )
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

/** Drop empty applicant slots (no applicant picked) and renumber sno. */
function normalizeApplicants(data: CustomerInput): { sno: number; applicant_id: string }[] {
  return data.applicants
    .filter((a) => !!a.applicant_id)
    .map((a, i) => ({ sno: i + 1, applicant_id: a.applicant_id as string }));
}

/** Replace both child grids wholesale for a given customer id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
  data: CustomerInput,
): Promise<Result> {
  const { error: delC } = await s.from("customer_contacts").delete().eq("customer_id", customerId);
  if (delC) return fail(delC.message);
  const { error: delA } = await s
    .from("customer_applicants")
    .delete()
    .eq("customer_id", customerId);
  if (delA) return fail(delA.message);

  const contacts = normalizeContacts(data);
  if (contacts.length) {
    const { error } = await s
      .from("customer_contacts")
      .insert(contacts.map((r) => ({ ...r, customer_id: customerId })));
    if (error) return fail(error.message);
  }
  const applicants = normalizeApplicants(data);
  if (applicants.length) {
    const { error } = await s
      .from("customer_applicants")
      .insert(applicants.map((r) => ({ ...r, customer_id: customerId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

export async function createCustomer(data: CustomerInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = customerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _c, applicants: _a, ...header } = p.data;
  void _c;
  void _a;
  const { data: created, error } = await s
    .from("customers")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function updateCustomer(id: string, data: CustomerInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = customerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _c, applicants: _a, ...header } = p.data;
  void _c;
  void _a;
  const { error } = await s.from("customers").update(header).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteCustomer(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("customers").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
