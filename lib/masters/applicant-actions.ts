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

  /**
   * A PARTY THAT IS BOTH A CUSTOMER AND A CONSIGNEE PUBLISHES THEM LINKED
   * (client 2026-09-01: "if a customer is flagged as 'Also Customer' = YES and
   * 'Also Consignee' = YES, their name and shipping details must automatically
   * list and auto-populate in the Consignee section of the order").
   *
   * ## THE BUG THIS FIXES, AND WHY IT LOOKED LIKE AN ORDER-SCREEN BUG
   *
   * `customer-actions.ts` has always published its consignee with
   * `{ customer_id: id }`. This did not — it passed no `extra` at all — so an
   * applicant with BOTH boxes ticked created a customer and a consignee that
   * were the same real party and pointed at each other through nothing.
   *
   * Order Entry narrows the Consignee list to `consignees.customer_id`, and
   * since 2026-08-29 it does so with no fallback ("it will retrieve and list
   * ONLY the consignees registered under the selected Buyer/Customer"). So the
   * unlinked rows resolved to an empty list, on exactly the customers whose
   * consignee had been created FROM the applicant — which is why it read as
   * "the consignee list fails to load for certain customers" rather than as a
   * missing foreign key. The order screen was right; the data it read was not.
   * Measured 2026-09-01: 3 of the 4 both-ticked applicants were unlinked
   * (AARSAN AMERICAS LLC, JOSTENS, TAPE A 'L' OEIL); 0502 backfills them.
   *
   * ## READ BACK, RATHER THAN RETURNING THE ID FROM `publishParty`
   *
   * Returning it would change a signature five masters share, and this is the
   * only caller that needs it. The read is keyed on `source_applicant_id`,
   * which is the same column `publishParty` just wrote and the one it looks a
   * published row up by — so this cannot find a different row than the line
   * above created.
   *
   * ## `extra` IS INSERT-ONLY, WHICH IS CORRECT AND IS WHY 0502 EXISTS
   *
   * On the update path `publishParty` deliberately touches only the name — "the
   * rest of this row belongs to whoever has been editing it" — so this cannot
   * re-link a consignee that already exists, and must not: an operator who
   * deliberately pointed one at a different customer keeps their answer. Rows
   * created before today are repaired once, by migration, not on every save.
   */
  let consigneeExtra: Record<string, unknown> | undefined;
  if (data.also_customer && data.also_consignee) {
    const { data: published } = await s
      .from("customers")
      .select("id")
      .eq("source_applicant_id", id)
      .maybeSingle();
    if (published?.id) consigneeExtra = { customer_id: published.id };
  }

  const cons = await publishParty(
    s,
    PARTY_LINKS.applicantConsignee,
    id,
    data.also_consignee,
    seed,
    consigneeExtra,
  );
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
