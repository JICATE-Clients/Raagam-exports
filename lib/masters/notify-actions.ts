"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { notifyInput, type NotifyInput } from "./notify-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/notify");
}

type ContactRow = Omit<NotifyInput["contacts"][number], "sno"> & { sno: number };

/** Drop fully-empty contact rows (no picker + all text blank) and renumber sno. */
function normalizeContacts(data: NotifyInput): ContactRow[] {
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

export async function createNotify(data: NotifyInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = notifyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s.from("notifies").insert(header).select("id").single();
  if (error) return fail(error.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("notify_contacts")
      .insert(rows.map((r) => ({ ...r, notify_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateNotify(id: string, data: NotifyInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = notifyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { contacts: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("notifies").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the contact grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("notify_contacts").delete().eq("notify_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeContacts(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("notify_contacts")
      .insert(rows.map((r) => ({ ...r, notify_id: id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteNotify(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("notifies").delete().eq("id", id); // contacts cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
