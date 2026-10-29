"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAppUser } from "@/lib/auth/server";
import { resolveWriteLocation } from "@/lib/auth/location";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { checkDuplicateName } from "@/lib/masters/dup-guard";
import { createClient } from "@/lib/supabase/server";
import { canRh } from "./auth";
import { toCsv } from "./csv";
import { drainOutbox } from "./outbox";
import { readPhoto, removePhoto, uploadPhoto } from "./photo-upload";
import { fail, ok, type Result } from "./result";
import {
  assignSchema,
  editReportSchema,
  firstIssue,
  fixSchema,
  jobsFilterSchema,
  noteSchema,
  placeSchema,
  rateSchema,
  reasonSchema,
  reclassifySchema,
  routingOverrideSchema,
  spotCheckSchema,
  submitBrokenSchema,
  teamSchema,
  ticketIdSchema,
  tradeSchema,
  unitSettingsSchema,
  complaintCategorySchema,
  resolutionSchema,
  submitComplaintSchema,
  type ComplaintCategoryInput,
  type PlaceInput,
  type SubmitComplaintInput,
  type RoutingOverrideInput,
  type TeamInput,
  type TradeInput,
  type UnitSettingsInput,
} from "./schemas";
import { listJobs } from "./service";
import {
  STATUS_LABEL,
  type ComplaintReceipt,
  type Priority, type Severity, type SimilarTicket, type SubmitReceipt } from "./types";

/*
 * Resolve Hub writes. Every lifecycle change is ONE guarded RPC (plan §4) —
 * the database decides who may do what to which ticket, and its refusal is a
 * sentence (errcode P0001) handed straight back as `error`. These actions do
 * the cheap checks first (signed in, holds the key at all, the input parses),
 * so an obviously-refused call never reaches the database.
 *
 * After a transition commits, the ticket's outbox is drained in `after()` —
 * best-effort, never part of the result: the `resolve-outbox` job retries
 * anything this misses.
 *
 * Types are imported, never re-exported: a type re-exported from a
 * "use server" file is a runtime ReferenceError that tsc does not see.
 */

const NO_ACCESS = "You do not have access to do this in Help & Repairs";

type PgError = { code?: string; message: string } | null;

/** The operator's sentence for a database refusal. */
function dbError(e: NonNullable<PgError>): string {
  if (e.code === "P0001") return e.message;
  if (e.code === "23505") return "That already exists";
  if (e.code === "42501") return NO_ACCESS;
  return `Could not save: ${e.message}`;
}

function touch(ticketId?: string | null, drain = !!ticketId) {
  revalidatePath("/resolve", "layout");
  if (drain) {
    after(async () => {
      try {
        await drainOutbox({ ticketId: ticketId ?? undefined, source: "action" });
      } catch {
        // the resolve-outbox job picks it up
      }
    });
  }
}

async function signedIn(): Promise<string | null> {
  return (await getAppUser())?.id ?? null;
}

/** Run one ticket RPC: id parse, permission, call, revalidate, drain. */
async function transition<T = unknown>(
  rpc: string,
  id: unknown,
  args: Record<string, unknown>,
  need: Parameters<typeof canRh>[0] = "view",
): Promise<Result<T>> {
  const pid = ticketIdSchema.safeParse(id);
  if (!pid.success) return fail("That ticket could not be found");
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh(need))) return fail(NO_ACCESS);
  const s = await createClient();
  const { data, error } = await s.rpc(rpc, { p_ticket_id: pid.data, ...args });
  if (error) return fail(dbError(error));
  touch(pid.data);
  return ok(data as T);
}

// ---- reporting --------------------------------------------------------------

export async function submitBroken(fd: FormData): Promise<Result<SubmitReceipt>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const parsed = submitBrokenSchema.safeParse({
    place_id: fd.get("place_id"),
    trade_id: fd.get("trade_id"),
    title: fd.get("title") ?? "",
    description: fd.get("description") || null,
    is_dangerous: fd.get("is_dangerous"),
    gps_lat: fd.get("gps_lat"),
    gps_lng: fd.get("gps_lng"),
    source: fd.get("source") || "form",
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const photo = await readPhoto(fd);
  if (!photo.ok) return photo;
  let path: string | null = null;
  if (photo.data) {
    const up = await uploadPhoto(photo.data);
    if (!up.ok) return up;
    path = up.data;
  }

  const s = await createClient();
  const { data, error } = await s.rpc("rh_submit_broken", {
    p_place_id: v.place_id,
    p_trade_id: v.trade_id,
    p_title: v.title,
    p_description: v.description ?? null,
    p_is_dangerous: v.is_dangerous,
    p_photo_path: path,
    p_gps_lat: v.gps_lat,
    p_gps_lng: v.gps_lng,
    p_source: v.source,
  });
  if (error) {
    await removePhoto(path);
    return fail(dbError(error));
  }
  const r = (Array.isArray(data) ? data[0] : data) as SubmitReceipt;
  touch(r.ticket_id);
  return ok(r);
}

export async function findSimilar(placeId: string): Promise<Result<SimilarTicket[]>> {
  const p = ticketIdSchema.safeParse(placeId);
  if (!p.success) return ok([]);
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const s = await createClient();
  const { data, error } = await s.rpc("rh_similar_open", { p_place_id: p.data });
  if (error) return fail(dbError(error));
  return ok(
    ((data ?? []) as SimilarTicket[]).map((t) => ({ ...t, joiners: Number(t.joiners) || 0 })),
  );
}

export async function joinTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_join", id, {});
}

export async function withdrawTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_withdraw", id, {});
}

export async function editReport(id: string, title: string, description: string | null): Promise<Result<unknown>> {
  const p = editReportSchema.safeParse({ id, title, description });
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_edit_report", p.data.id, {
    p_title: p.data.title,
    p_description: p.data.description ?? null,
  });
}

export async function disputeTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("why it is not fixed").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_dispute", id, { p_reason: r.data });
}

export async function rateTicket(id: string, stars: number, comment: string | null): Promise<Result<unknown>> {
  const p = rateSchema.safeParse({ id, stars, comment });
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_rate", p.data.id, { p_stars: p.data.stars, p_comment: p.data.comment ?? null });
}

export async function addNote(id: string, body: string, visibility: "internal" | "reporter"): Promise<Result<unknown>> {
  const p = noteSchema.safeParse({ id, body, visibility });
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_add_note", p.data.id, { p_body: p.data.body, p_visibility: p.data.visibility });
}

// ---- work -------------------------------------------------------------------

export async function claimTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_claim", id, {}, "work");
}

export async function startTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_start", id, {});
}

export async function blockTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("what it is waiting for").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_block", id, { p_reason: r.data });
}

export async function unblockTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_unblock", id, {});
}

export async function fixTicket(fd: FormData): Promise<Result<{ status: string; spot_check: boolean }>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const p = fixSchema.safeParse({ id: fd.get("id"), note: fd.get("note") || null });
  if (!p.success) return fail(firstIssue(p.error));
  const photo = await readPhoto(fd);
  if (!photo.ok) return photo;
  if (!photo.data) return fail("Add a photo of the fix");
  const up = await uploadPhoto(photo.data);
  if (!up.ok) return up;

  const s = await createClient();
  const { data, error } = await s.rpc("rh_fix", {
    p_ticket_id: p.data.id,
    p_photo_path: up.data,
    p_note: p.data.note ?? null,
  });
  if (error) {
    await removePhoto(up.data);
    return fail(dbError(error));
  }
  touch(p.data.id);
  const r = (Array.isArray(data) ? data[0] : data) as { status?: string; spot_check?: boolean } | null;
  return ok({ status: r?.status ?? "fixed", spot_check: !!r?.spot_check });
}

export async function ownerConfirm(id: string, note: string | null): Promise<Result<unknown>> {
  const p = spotCheckSchema.safeParse({ id, pass: true, note });
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_owner_confirm", p.data.id, { p_note: p.data.note ?? null });
}

// ---- triage -----------------------------------------------------------------

export async function assignTickets(
  ids: string[],
  assigneeId: string,
): Promise<Result<{ done: number; failed: { id: string; error: string }[] }>> {
  const p = assignSchema.safeParse({ ids, assigneeId });
  if (!p.success) return fail(firstIssue(p.error));
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("triage"))) return fail(NO_ACCESS);
  const s = await createClient();
  // One RPC per ticket = one authorization per ticket: a bulk assign cannot
  // carry a ticket the database would refuse on its own.
  const failed: { id: string; error: string }[] = [];
  let done = 0;
  for (const id of [...new Set(p.data.ids)]) {
    const { error } = await s.rpc("rh_assign", { p_ticket_id: id, p_assignee_id: p.data.assigneeId });
    if (error) failed.push({ id, error: dbError(error) });
    else {
      done++;
      after(async () => {
        try {
          await drainOutbox({ ticketId: id });
        } catch {
          // the resolve-outbox job picks it up
        }
      });
    }
  }
  revalidatePath("/resolve", "layout");
  return ok({ done, failed });
}

export async function spotCheck(id: string, pass: boolean, note: string | null): Promise<Result<unknown>> {
  const p = spotCheckSchema.safeParse({ id, pass, note });
  if (!p.success) return fail(firstIssue(p.error));
  if (!p.data.pass && !p.data.note) return fail("Say what is still wrong");
  return transition("rh_spot_check", p.data.id, { p_pass: p.data.pass, p_note: p.data.note ?? null }, "triage");
}

export async function cancelTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("why it is cancelled").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_cancel", id, { p_reason: r.data }, "triage");
}

export async function reclassifyTicket(
  id: string,
  v: { trade_id: string | null; severity: Severity; priority: Priority; is_routine: boolean },
): Promise<Result<unknown>> {
  const p = reclassifySchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  return transition(
    "rh_reclassify",
    id,
    {
      p_trade_id: p.data.trade_id,
      p_severity: p.data.severity,
      p_priority: p.data.priority,
      p_is_routine: p.data.is_routine,
    },
    "triage",
  );
}

/** All Jobs as CSV — header row, RFC 4180, dates DD/MM/YYYY. */
export async function exportJobsCsv(f: { status?: string; trade_id?: string; overdue?: boolean } = {}): Promise<Result<string>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("triage")) && !(await canRh("analytics"))) return fail(NO_ACCESS);
  const p = jobsFilterSchema.safeParse({
    status: f.status || undefined,
    trade_id: f.trade_id || undefined,
    overdue: f.overdue || undefined,
  });
  if (!p.success) return fail(firstIssue(p.error));
  try {
    const { rows } = await listJobs(p.data);
    return ok(
      toCsv(
        [
          "Ref No",
          "Status",
          "Title",
          "Place",
          "Trade",
          "Dangerous",
          "Severity",
          "Priority",
          "Owner",
          "Assignee",
          "Due",
          "Late",
          "Fixed",
          "Closed",
          "Reopened",
          "Created Date",
          "Created User",
        ],
        rows.map((r) => [
          r.ref_no,
          STATUS_LABEL[r.status] ?? r.status,
          r.title,
          r.place_name,
          r.trade_name,
          r.is_dangerous ? "Yes" : "No",
          r.severity,
          r.priority,
          r.owner_name,
          r.assignee_name,
          r.due_at ? fmtDateTime(r.due_at) : "",
          r.is_late ? "Yes" : "No",
          r.fixed_at ? fmtDate(r.fixed_at) : "",
          r.closed_at ? fmtDate(r.closed_at) : "",
          r.reopen_count,
          fmtDate(r.created_at),
          (r as { created_by_name?: string | null }).created_by_name ?? r.reporter_name ?? "",
        ]),
      ),
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not export");
  }
}

// ---- administration (configuration tables, RLS resolve:create) -------------

async function adminGate(): Promise<string | null> {
  if (!(await signedIn())) return "Sign in to continue";
  if (!(await canRh("admin"))) return NO_ACCESS;
  return null;
}

function revalidateSetup() {
  revalidatePath("/resolve", "layout");
}

export async function saveTrade(v: TradeInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = tradeSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  for (const [col, label] of [
    ["name", "name"],
    ["code", "code"],
  ] as const) {
    const dup = await checkDuplicateName(s, "rh_trades", p.data[col], {
      nameColumn: col,
      excludeId: p.data.id,
      label,
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { id, ...row } = p.data;
  const res = id
    ? await s.from("rh_trades").update(row).eq("id", id).select("id").single()
    : await s.from("rh_trades").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidateSetup();
  return ok({ id: (res.data as { id: string }).id });
}

export async function setTradeInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That trade could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_trades").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}

export async function savePlace(v: PlaceInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = placeSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  if (p.data.id && p.data.parent_id === p.data.id) return fail("A place cannot be inside itself");
  const s = await createClient();
  // RLS scopes rh_places to the current unit, so the check is per unit too.
  for (const [col, label] of [
    ["name", "name"],
    ["code", "code"],
  ] as const) {
    const dup = await checkDuplicateName(s, "rh_places", p.data[col], {
      nameColumn: col,
      excludeId: p.data.id,
      label,
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { id, ...row } = p.data;
  const res = id
    ? await s.from("rh_places").update(row).eq("id", id).select("id").single()
    : await s.from("rh_places").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidateSetup();
  return ok({ id: (res.data as { id: string }).id });
}

export async function setPlaceInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That place could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_places").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}

/** A fresh QR token for a place — the old sticker stops working. */
export async function issueQr(placeId: string): Promise<Result<string>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(placeId).success) return fail("That place could not be found");
  const s = await createClient();
  const { data, error } = await s.rpc("rh_issue_qr", { p_place_id: placeId });
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok(String(data));
}

export async function markQrPrinted(ids: string[]): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const list = ids.filter((i) => ticketIdSchema.safeParse(i).success);
  if (!list.length) return fail("Pick the places that were printed");
  const s = await createClient();
  const { error } = await s.rpc("rh_mark_qr_printed", { p_place_ids: list });
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}

export async function saveTeam(v: TeamInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = teamSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const dup = await checkDuplicateName(s, "rh_teams", p.data.name, { excludeId: p.data.id });
  if (!dup.ok) return fail(dup.error);
  const { id, members, ...row } = p.data;
  const res = id
    ? await s.from("rh_teams").update(row).eq("id", id).select("id").single()
    : await s.from("rh_teams").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  const teamId = (res.data as { id: string }).id;

  // Members: upsert the list, then remove anyone no longer on it.
  if (members.length) {
    const { error } = await s
      .from("rh_team_members")
      .upsert(
        members.map((m) => ({ team_id: teamId, profile_id: m.profile_id, active: m.active })),
        { onConflict: "team_id,profile_id" },
      );
    if (error) return fail(dbError(error));
  }
  let del = s.from("rh_team_members").delete().eq("team_id", teamId);
  if (members.length) del = del.not("profile_id", "in", `(${members.map((m) => m.profile_id).join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return fail(dbError(delErr));

  revalidateSetup();
  return ok({ id: teamId });
}

export async function saveRoutingOverride(v: RoutingOverrideInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = routingOverrideSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const { id, ...row } = p.data;
  const res = id
    ? await s.from("rh_routing_overrides").update(row).eq("id", id).select("id").single()
    : await s.from("rh_routing_overrides").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidateSetup();
  return ok({ id: (res.data as { id: string }).id });
}

export async function deleteRoutingOverride(id: string): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That rule could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_routing_overrides").delete().eq("id", id);
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}

export async function saveUnitSettings(v: UnitSettingsInput): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = unitSettingsSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const loc = await resolveWriteLocation();
  if (!loc.ok) return fail(loc.error);
  const s = await createClient();
  const { triage_weights, ...rest } = p.data;
  const { error } = await s
    .from("rh_unit_settings")
    .upsert(
      {
        location_id: loc.locationId,
        ...rest,
        ...(triage_weights ? { triage_weights } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "location_id" },
    );
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}

// ---- complaints (plan §10) ----------------------------------------------------

/**
 * Raise a complaint. For an anonymous one the database links it to nobody
 * (reporter, creator and activity actor all NULL) and returns the tracking
 * token ONCE — this action passes it to the screen and keeps no copy: it is
 * not logged, not revalidated into a path, not put in the error text.
 */
export async function submitComplaint(v: SubmitComplaintInput): Promise<Result<ComplaintReceipt>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const p = submitComplaintSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const { data, error } = await s.rpc("rh_submit_complaint", {
    p_category_id: p.data.category_id,
    p_subject: p.data.subject,
    p_description: p.data.description,
    p_is_anonymous: p.data.is_anonymous,
    p_about_superior: p.data.about_superior,
  });
  if (error) return fail(dbError(error));
  const r = (Array.isArray(data) ? data[0] : data) as Partial<ComplaintReceipt> | null;
  if (!r?.ref_no) return fail("The complaint was not recorded. Try again.");
  // Drain even for an anonymous complaint (no id to name): the handler's
  // alert is what starts their 72 hours.
  touch(r.ticket_id ?? null, true);
  return ok({
    ticket_id: r.ticket_id ?? null,
    ref_no: r.ref_no,
    tracking_token: r.tracking_token ?? null,
    handler_name: r.handler_name ?? null,
    response_due_at: r.response_due_at ?? null,
  });
}

export async function assignComplaint(id: string, assigneeId: string): Promise<Result<unknown>> {
  if (!ticketIdSchema.safeParse(assigneeId).success) return fail("Pick who will handle it");
  return transition("rh_c_assign", id, { p_assignee_id: assigneeId });
}

export async function startComplaint(id: string): Promise<Result<unknown>> {
  return transition("rh_c_start", id, {});
}

export async function resolveComplaint(id: string, message: string): Promise<Result<unknown>> {
  const m = resolutionSchema.safeParse(message);
  if (!m.success) return fail(firstIssue(m.error));
  return transition("rh_c_resolve", id, { p_resolution_message: m.data });
}

export async function withdrawComplaint(id: string): Promise<Result<unknown>> {
  return transition("rh_c_withdraw", id, {});
}

export async function saveComplaintCategory(v: ComplaintCategoryInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = complaintCategorySchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  // RLS scopes categories to the current unit, so the checks are per unit.
  for (const [col, label] of [
    ["name", "name"],
    ["code", "code"],
  ] as const) {
    const dup = await checkDuplicateName(s, "rh_complaint_categories", p.data[col], {
      nameColumn: col,
      excludeId: p.data.id,
      label,
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { id, members, ...row } = p.data;
  const res = id
    ? await s.from("rh_complaint_categories").update(row).eq("id", id).select("id").single()
    : await s.from("rh_complaint_categories").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  const categoryId = (res.data as { id: string }).id;

  if (members.length) {
    const { error } = await s
      .from("rh_category_members")
      .upsert(
        members.map((m) => ({ category_id: categoryId, profile_id: m.profile_id, role: m.role })),
        { onConflict: "category_id,profile_id" },
      );
    if (error) return fail(dbError(error));
  }
  let del = s.from("rh_category_members").delete().eq("category_id", categoryId);
  if (members.length) del = del.not("profile_id", "in", `(${members.map((m) => m.profile_id).join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return fail(dbError(delErr));

  revalidateSetup();
  return ok({ id: categoryId });
}

export async function setComplaintCategoryInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That category could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_complaint_categories").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidateSetup();
  return ok();
}
