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

export async function createCustomer(data: CustomerInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = customerInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: created, error } = await s
    .from("customers")
    .insert(headerOnly(p.data))
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
  const { error } = await s.from("customers").update(headerOnly(p.data)).eq("id", id);
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
