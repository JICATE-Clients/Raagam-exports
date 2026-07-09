"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { consigneeInput, type ConsigneeInput } from "./consignee-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/consignee");
}

type ContactRow = Omit<ConsigneeInput["contacts"][number], "sno"> & { sno: number };

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Drop fully-empty contact rows (no picker + all text blank) and renumber sno. */
function normalizeContacts(data: ConsigneeInput): ContactRow[] {
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

/** Drop blank Marking rows and renumber sno. */
function normalizeMarkings(data: ConsigneeInput): { sno: number; marking: string | null }[] {
  return data.markings
    .map((m) => ({ marking: clean(m.marking) }))
    .filter((m) => m.marking)
    .map((m, i) => ({ ...m, sno: i + 1 }));
}

/** Drop empty Notify-ref rows (no notify picked) and renumber sno. */
function normalizeNotifyRefs(data: ConsigneeInput): { sno: number; notify_id: string }[] {
  return data.notify_refs
    .filter((n): n is { sno: number; notify_id: string } => !!n.notify_id)
    .map((n, i) => ({ notify_id: n.notify_id, sno: i + 1 }));
}

/** Replace both simple child grids wholesale (delete-all-then-reinsert). */
async function writeChildGrids(
  s: Awaited<ReturnType<typeof createClient>>,
  consigneeId: string,
  data: ConsigneeInput,
  replace: boolean,
): Promise<string | null> {
  if (replace) {
    const { error: dm } = await s.from("consignee_markings").delete().eq("consignee_id", consigneeId);
    if (dm) return dm.message;
    const { error: dn } = await s.from("consignee_notifies").delete().eq("consignee_id", consigneeId);
    if (dn) return dn.message;
  }
  const markings = normalizeMarkings(data);
  if (markings.length) {
    const { error } = await s
      .from("consignee_markings")
      .insert(markings.map((m) => ({ ...m, consignee_id: consigneeId })));
    if (error) return error.message;
  }
  const notifyRefs = normalizeNotifyRefs(data);
  if (notifyRefs.length) {
    const { error } = await s
      .from("consignee_notifies")
      .insert(notifyRefs.map((n) => ({ ...n, consignee_id: consigneeId })));
    if (error) return error.message;
  }
  return null;
}

export async function createConsignee(data: ConsigneeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = consigneeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _c, markings: _m, notify_refs: _n, ...header } = p.data;
  void _c;
  void _m;
  void _n;
  const { data: created, error } = await s
    .from("consignees")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("consignee_contacts")
      .insert(rows.map((r) => ({ ...r, consignee_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  const gridErr = await writeChildGrids(s, created.id, p.data, false);
  if (gridErr) return fail(gridErr);
  rev();
  return { ok: true };
}

export async function updateConsignee(id: string, data: ConsigneeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = consigneeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _c, markings: _m, notify_refs: _n, ...header } = p.data;
  void _c;
  void _m;
  void _n;
  const { error } = await s.from("consignees").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace all child grids wholesale (small, fully-loaded sets).
  const { error: delErr } = await s.from("consignee_contacts").delete().eq("consignee_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("consignee_contacts")
      .insert(rows.map((r) => ({ ...r, consignee_id: id })));
    if (cErr) return fail(cErr.message);
  }
  const gridErr = await writeChildGrids(s, id, p.data, true);
  if (gridErr) return fail(gridErr);
  rev();
  return { ok: true };
}

export async function deleteConsignee(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("consignees").delete().eq("id", id); // contacts cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
