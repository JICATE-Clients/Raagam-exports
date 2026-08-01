"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { applicantInput, type ApplicantInput } from "./applicant-types";
import { checkDuplicateName } from "./dup-guard";
import {
  PARTY_LINKS,
  partySeed,
  publishParty,
  deleteParty,
  type PartyDeleteResult,
} from "./party-publish";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = PartyDeleteResult;

function fail(msg: string): { ok: false; error: string } {
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

/**
 * Reconcile the two tick boxes with the masters they publish into. Also
 * revalidates those masters' pages — a row appearing in Customer because
 * someone ticked a box over in Applicant is exactly the kind of change a cached
 * list will otherwise hide until the next hard refresh.
 */
async function syncAlsoFlags(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
  data: ApplicantInput,
): Promise<Result> {
  const seed = partySeed(data);
  const cust = await publishParty(s, PARTY_LINKS.applicantCustomer, id, data.also_customer, seed);
  if (!cust.ok) return cust;
  const cons = await publishParty(s, PARTY_LINKS.applicantConsignee, id, data.also_consignee, seed);
  if (!cons.ok) return cons;
  revalidatePath("/masters/associates/customer");
  revalidatePath("/masters/associates/consignee");
  return { ok: true };
}

export async function createApplicant(data: ApplicantInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = applicantInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "applicants", p.data.name);
  if (!dup.ok) return fail(dup.error);
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
  const pub = await syncAlsoFlags(s, created.id, p.data);
  if (!pub.ok) return pub;
  rev();
  return { ok: true };
}

export async function updateApplicant(id: string, data: ApplicantInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = applicantInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "applicants", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { contacts: _drop, ...header } = p.data;
  void _drop;
  // BEFORE the header write, deliberately. A refused untick (the published
  // customer is on a sales order) must leave the record exactly as it was —
  // write the flag first and the screen would show "Also Customer: No" beside a
  // customer that still exists, and every later save would hit the same refusal
  // with no way to back out.
  const pub = await syncAlsoFlags(s, id, p.data);
  if (!pub.ok) return pub;
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

export async function deleteApplicant(id: string): Promise<DeleteResult> {
  const s = await createClient();
  // Takes the Customer and Consignee it published, and anything THEY published,
  // all or nothing (0378). Own contacts cascade in SQL.
  const res = await deleteParty(s, "applicants", id);
  if (!res.ok) return fail(res.error);
  rev();
  return res;
}
