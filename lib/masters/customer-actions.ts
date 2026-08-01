"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { customerInput, type CustomerInput } from "./customer-types";
import { checkDuplicateName } from "./dup-guard";
import {
  PARTY_LINKS,
  partySeed,
  publishParty,
  deleteParty,
  type PartyDeleteResult,
} from "./party-publish";
import { customerGeneralSeed } from "./party-fetch";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = PartyDeleteResult;

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/customer");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Drop fully-empty contact rows and renumber sno. */
function normalizeContacts(data: CustomerInput) {
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

function normalizeApplicants(data: CustomerInput) {
  return data.applicants
    .filter((a) => !!a.applicant_id)
    .map((a, i) => ({ sno: i + 1, applicant_id: a.applicant_id as string }));
}

/** Drop empty agent rows (no type + no agent) and renumber sno. */
function normalizeAgents(data: CustomerInput) {
  return data.agents
    .filter((a) => a.agent_type_id || a.agent_id)
    .map((a, i) => ({ sno: i + 1, agent_type_id: a.agent_type_id ?? null, agent_id: a.agent_id ?? null }));
}

/** Drop empty supplied-item rows, renumber sno within each section. */
function normalizeSupplied(data: CustomerInput) {
  const bySection: Record<string, number> = {};
  return data.supplied_items
    .filter((r) => !!r.category_id)
    .map((r) => {
      bySection[r.section] = (bySection[r.section] ?? 0) + 1;
      return { section: r.section, category_id: r.category_id as string, sno: bySection[r.section] };
    });
}

/** Drop empty vendor rows, renumber sno within each list_kind. */
function normalizeVendors(data: CustomerInput) {
  const byKind: Record<string, number> = {};
  return data.nominated_vendors
    .filter((r) => !!r.vendor_id)
    .map((r) => {
      byKind[r.list_kind] = (byKind[r.list_kind] ?? 0) + 1;
      return { list_kind: r.list_kind, vendor_id: r.vendor_id as string, sno: byKind[r.list_kind] };
    });
}

/** Drop blank marking rows and renumber sno. */
function normalizeMarkings(data: CustomerInput) {
  return data.markings
    .map((m) => ({ marking: clean(m.marking) }))
    .filter((m) => !!m.marking)
    .map((m, i) => ({ ...m, sno: i + 1 }));
}

/** Replace every child grid wholesale for a given customer id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
  data: CustomerInput,
): Promise<Result> {
  const tables = [
    "customer_contacts",
    "customer_applicants",
    "customer_agents",
    "customer_supplied_items",
    "customer_nominated_vendors",
    "customer_markings",
  ];
  for (const t of tables) {
    const { error } = await s.from(t).delete().eq("customer_id", customerId);
    if (error) return fail(error.message);
  }

  const inserts: [string, Record<string, unknown>[]][] = [
    ["customer_contacts", normalizeContacts(data)],
    ["customer_applicants", normalizeApplicants(data)],
    ["customer_agents", normalizeAgents(data)],
    ["customer_supplied_items", normalizeSupplied(data)],
    ["customer_nominated_vendors", normalizeVendors(data)],
    ["customer_markings", normalizeMarkings(data)],
  ];
  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s.from(table).insert(rows.map((r) => ({ ...r, customer_id: customerId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/** Strip all child arrays so only the header columns are written. */
function headerOnly(data: CustomerInput) {
  const {
    contacts: _c,
    applicants: _a,
    agents: _g,
    supplied_items: _s,
    nominated_vendors: _v,
    markings: _m,
    ...header
  } = data;
  void _c;
  void _a;
  void _g;
  void _s;
  void _v;
  void _m;
  return header;
}

/**
 * A GSTIN identifies exactly one registered party, so two customers may never
 * share one. The screen checks this live while typing, but that hint is
 * advisory and racy — two operators can both pass it and both save. This is the
 * authoritative check (client 2026-07-28).
 *
 * Deliberately GSTIN only. PAN is NOT unique across rows: one PAN carries one
 * GSTIN per state, so a multi-state customer legitimately appears several times
 * under the same PAN, and guarding it would block real data.
 */
async function checkGstinUnique(
  s: Awaited<ReturnType<typeof createClient>>,
  gstNo: string | null | undefined,
  excludeId?: string,
): Promise<string | null> {
  const v = (gstNo ?? "").trim();
  if (!v) return null;
  const res = await checkDuplicateName(s, "customers", v, {
    nameColumn: "gst_no",
    excludeId,
    label: "GST number",
  });
  return res.ok ? null : res.error;
}

/** Reconcile "Also Consignee" / "Also Notify" with the masters they publish into. */
async function syncAlsoFlags(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
  data: CustomerInput,
): Promise<Result> {
  const seed = partySeed(data);
  // A consignee published by a customer belongs to that customer — seed the
  // owning-customer picker rather than leaving the operator to re-pick the very
  // record they published it from. (`customer_id` is that picker; it is NOT the
  // publish link, which is `source_customer_id`.)
  //
  // `customerGeneralSeed` rides along in the same INSERT-only `extra`: the
  // General half a Customer can answer — currency 1/2/3, ship mode, ship type,
  // pay mode, GST No — which `partySeed` deliberately omits because it is
  // shared by all five publish pairs and an APPLICANT holds none of it. A
  // customer does, and a consignee born without it sent the operator to retype
  // what they had just keyed one screen over. Still birth-only: unticking and
  // re-ticking re-seeds, an ordinary save does not. To pull a Customer's
  // details into an EXISTING consignee — including its Contact and Marking
  // grids, which no INSERT can reach from here — the Consignee screen has
  // "Fetch from Customer" (lib/masters/party-fetch.ts).
  //
  // `payment_term_id` is NOT in that seed and must not be added: the Customer's
  // `receivable_term_id` points at `receivable_terms`, the Consignee's at
  // `config_lookups`. See the note in party-fetch.ts.
  const cons = await publishParty(s, PARTY_LINKS.customerConsignee, id, data.also_consignee, seed, {
    customer_id: id,
    ...customerGeneralSeed(data),
  });
  if (!cons.ok) return cons;
  const notif = await publishParty(s, PARTY_LINKS.customerNotify, id, data.also_notify, seed);
  if (!notif.ok) return notif;
  revalidatePath("/masters/associates/consignee");
  revalidatePath("/masters/associates/notify");
  return { ok: true };
}

export async function createCustomer(data: CustomerInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = customerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupErr = await checkGstinUnique(s, p.data.gst_no);
  if (dupErr) return fail(dupErr);
  // Two customers must not share a NAME. The GSTIN guard above cannot stand
  // in for this: `gst_no` is nullable, so an unregistered party skips it
  // entirely. Mirrored live on screen by `useDuplicateName`.
  const dupName = await checkDuplicateName(s, "customers", p.data.name);
  if (!dupName.ok) return fail(dupName.error);
  const { data: created, error } = await s
    .from("customers")
    .insert(headerOnly(p.data))
    .select("id")
    .single();
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  const pub = await syncAlsoFlags(s, created.id, p.data);
  if (!pub.ok) return pub;
  rev();
  return { ok: true };
}

export async function updateCustomer(id: string, data: CustomerInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = customerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupErr = await checkGstinUnique(s, p.data.gst_no, id);
  if (dupErr) return fail(dupErr);
  const dupName = await checkDuplicateName(s, "customers", p.data.name, { excludeId: id });
  if (!dupName.ok) return fail(dupName.error);
  // Before the header write — see the note in updateApplicant. A refused untick
  // must leave the record untouched, not half-saved.
  const pub = await syncAlsoFlags(s, id, p.data);
  if (!pub.ok) return pub;
  const { error } = await s.from("customers").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteCustomer(id: string): Promise<DeleteResult> {
  const s = await createClient();
  // Takes the Consignee and Notify it published, and anything THEY published
  // (0378). Refused outright if this customer was itself published by an
  // Applicant — that one is removed by unticking the box that made it.
  const res = await deleteParty(s, "customers", id);
  if (!res.ok) return fail(res.error);
  rev();
  return res;
}
