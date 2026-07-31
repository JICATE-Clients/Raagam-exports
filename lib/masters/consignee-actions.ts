"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { consigneeInput, type ConsigneeInput } from "./consignee-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";
import {
  PARTY_LINKS,
  partySeed,
  publishParty,
  detachPublished,
  reattachPublished,
} from "./party-publish";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
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

/**
 * A GSTIN identifies exactly one registered party, so two consignees may never
 * share one. The screen's live check is only an advisory hint — two operators
 * can both pass it and both save — so this is the authoritative one
 * (client 2026-07-28).
 *
 * GSTIN only, deliberately. PAN is NOT unique across rows (one PAN carries one
 * GSTIN per state), so guarding `pan_no` would reject a legitimate multi-state
 * consignee.
 */
async function checkGstinUnique(
  s: Awaited<ReturnType<typeof createClient>>,
  gstNo: string | null | undefined,
  excludeId?: string,
): Promise<string | null> {
  const v = (gstNo ?? "").trim();
  if (!v) return null;
  const res = await checkDuplicateName(s, "consignees", v, {
    nameColumn: "gst_no",
    excludeId,
    label: "GST number",
  });
  return res.ok ? null : res.error;
}

/** The one "Also …" tick box on this master. */
const CONSIGNEE_LINKS = [PARTY_LINKS.consigneeNotify] as const;

/**
 * Reconcile "Also Notify" with the Notify master. This is the answer to open
 * question J: `also_notify` does NOT gate the Notify tab — that tab lists which
 * notify parties this consignee ships to, which is a different question from
 * whether the consignee is itself one.
 */
async function syncAlsoFlags(
  s: Awaited<ReturnType<typeof createClient>>,
  id: string,
  data: ConsigneeInput,
): Promise<Result> {
  const res = await publishParty(
    s,
    PARTY_LINKS.consigneeNotify,
    id,
    data.also_notify,
    partySeed(data),
  );
  if (!res.ok) return res;
  revalidatePath("/masters/associates/notify");
  return { ok: true };
}

export async function createConsignee(data: ConsigneeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = consigneeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupErr = await checkGstinUnique(s, p.data.gst_no);
  if (dupErr) return fail(dupErr);
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
  const pub = await syncAlsoFlags(s, created.id, p.data);
  if (!pub.ok) return pub;
  rev();
  return { ok: true };
}

export async function updateConsignee(id: string, data: ConsigneeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = consigneeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupErr = await checkGstinUnique(s, p.data.gst_no, id);
  if (dupErr) return fail(dupErr);
  const { contacts: _c, markings: _m, notify_refs: _n, ...header } = p.data;
  void _c;
  void _m;
  void _n;
  // Before the header write — see the note in updateApplicant.
  const pub = await syncAlsoFlags(s, id, p.data);
  if (!pub.ok) return pub;
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

export async function deleteConsignee(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // Free anything this consignee published (see deleteApplicant).
  const det = await detachPublished(s, CONSIGNEE_LINKS, id);
  if (!det.ok) return fail(det.error);
  // Own contacts cascade; if referenced elsewhere, deactivate instead of delete.
  const res = await deleteOrDeactivate(s, "consignees", id, "inactive");
  if (!res.ok) return fail(res.error);
  if (res.inactive && det.detached.length) {
    const relinkErr = await reattachPublished(s, det.detached, id);
    if (relinkErr) return fail(`Consignee deactivated, but its published records could not be re-linked: ${relinkErr}`);
  }
  rev();
  revalidatePath("/masters/associates/notify");
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
