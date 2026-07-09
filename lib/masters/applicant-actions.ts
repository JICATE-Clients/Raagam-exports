"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { applicantInput, type ApplicantInput } from "./applicant-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/applicant");
}

type ContactRow = Omit<ApplicantInput["contacts"][number], "sno"> & { sno: number };

/** Drop fully-empty contact rows (no picker + all text blank) and renumber sno. */
function normalizeContacts(data: ApplicantInput): ContactRow[] {
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

export async function createApplicant(data: ApplicantInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = applicantInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("applicants")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("applicant_contacts")
      .insert(rows.map((r) => ({ ...r, applicant_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateApplicant(id: string, data: ApplicantInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = applicantInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("applicants").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the contact grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("applicant_contacts").delete().eq("applicant_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("applicant_contacts")
      .insert(rows.map((r) => ({ ...r, applicant_id: id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteApplicant(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("applicants").delete().eq("id", id); // contacts cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
