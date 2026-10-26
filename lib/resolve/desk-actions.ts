"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAppUser } from "@/lib/auth/server";
import { resolveWriteLocation } from "@/lib/auth/location";
import { checkDuplicateName } from "@/lib/masters/dup-guard";
import { createClient } from "@/lib/supabase/server";
import { canRh } from "./auth";
import {
  deskUnitSettingsSchema,
  kbArticleSchema,
  kbFeedbackSchema,
  kbQuerySchema,
  overrideSchema,
  reclassifyServiceSchema,
  resolveServiceSchema,
  serviceCategorySchema,
  serviceSlaSchema,
  startServiceSchema,
  submitServiceSchema,
  type DeskUnitSettingsInput,
  type KbArticleInput,
  type OverrideInput,
  type ReclassifyServiceInput,
  type ResolveServiceInput,
  type ServiceCategoryInput,
  type ServiceSlaInput,
  type StartServiceInput,
} from "./desk-schemas";
import { searchKb } from "./desk-service";
import type { KbSearchHit, ServiceReceipt } from "./desk-types";
import { drainOutbox } from "./outbox";
import { readPhoto, removePhoto, uploadPhoto } from "./photo-upload";
import { fail, ok, type Result } from "./result";
import { firstIssue, reasonSchema, ticketIdSchema } from "./schemas";

/*
 * Service Desk writes (doc/resolve/service-desk-plan.md §3). The shape of
 * actions.ts, deliberately: every lifecycle change is ONE guarded RPC whose
 * refusal is a sentence (P0001) handed straight back; these actions only do
 * the cheap checks first (signed in, holds the key at all, the input parses).
 * Who may do what to WHICH ticket is `rh__desk_actions` in SQL — the same list
 * the next-action panel renders, so the panel and the guard cannot disagree.
 *
 * After a transition commits, the outbox is drained in `after()` — best
 * effort; the `resolve-outbox` and `resolve-desk` jobs retry anything missed.
 *
 * Types are imported, never re-exported (a type re-exported from a
 * "use server" file is a runtime ReferenceError tsc does not see).
 */

const NO_ACCESS = "You do not have access to do this in Resolve Hub";

type PgError = { code?: string; message: string } | null;

function dbError(e: NonNullable<PgError>): string {
  if (e.code === "P0001") return e.message;
  if (e.code === "23505") return "That already exists";
  if (e.code === "42501") return NO_ACCESS;
  return `Could not save: ${e.message}`;
}

function drain(ticketId: string | null) {
  after(async () => {
    try {
      await drainOutbox({ ticketId: ticketId ?? undefined, source: "action" });
    } catch {
      // the resolve-outbox job picks it up
    }
  });
}

function touch(ticketId?: string | null) {
  revalidatePath("/resolve", "layout");
  if (ticketId) drain(ticketId);
}

async function signedIn(): Promise<string | null> {
  return (await getAppUser())?.id ?? null;
}

/** Run one service-ticket RPC: id parse, permission, call, revalidate, drain. */
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

// ---- intake ------------------------------------------------------------------

/**
 * One intake for both doors: the requester's own form (`source = form`, no
 * requester) and Log a Call (a channel + the caller). Logging on behalf needs
 * resolve:edit and skips the 10/24 h rate limit — the database checks both
 * (plan §1.8); this only refuses the obvious case early.
 */
async function submitService(fd: FormData, onBehalf: boolean): Promise<Result<ServiceReceipt>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh(onBehalf ? "work" : "view"))) return fail(NO_ACCESS);
  const parsed = submitServiceSchema.safeParse({
    category_id: fd.get("category_id"),
    title: fd.get("title") ?? "",
    description: fd.get("description") ?? "",
    impact: fd.get("impact"),
    source: onBehalf ? fd.get("source") : "form",
    requester_id: onBehalf ? fd.get("requester_id") : null,
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (onBehalf && !v.requester_id) return fail("Pick who is calling");
  if (onBehalf && v.source === "form") return fail("Pick how they contacted the desk");

  const photo = await readPhoto(fd);
  if (!photo.ok) return photo;
  let path: string | null = null;
  if (photo.data) {
    const up = await uploadPhoto(photo.data);
    if (!up.ok) return up;
    path = up.data;
  }

  const s = await createClient();
  const { data, error } = await s.rpc("rh_sd_submit", {
    p_category_id: v.category_id,
    p_title: v.title,
    p_description: v.description,
    p_impact: v.impact,
    p_photo_path: path,
    p_source: v.source,
    p_requester_id: v.requester_id,
  });
  if (error) {
    await removePhoto(path);
    return fail(dbError(error));
  }
  const r = (Array.isArray(data) ? data[0] : data) as ServiceReceipt | null;
  if (!r?.ticket_id) {
    await removePhoto(path);
    return fail("The request was not recorded. Try again.");
  }
  touch(r.ticket_id);
  return ok({ ...r, needs_sorting: !!r.needs_sorting });
}

/** IT Help Request — the requester's own form (FormData: category_id, title,
 *  description, impact, optional photo JPEG). */
export async function submitServiceRequest(fd: FormData): Promise<Result<ServiceReceipt>> {
  return submitService(fd, false);
}

/** Log a Call — the same fields plus `requester_id` and `source`
 *  (phone · email · chat · whatsapp). */
export async function logCall(fd: FormData): Promise<Result<ServiceReceipt>> {
  return submitService(fd, true);
}

/** KB suggestions while the requester types. Under two characters → []. */
export async function searchKnowledgeBase(q: string, categoryCode: string | null = null): Promise<Result<KbSearchHit[]>> {
  const p = kbQuerySchema.safeParse({ q, category_code: categoryCode });
  if (!p.success || p.data.q.length < 2) return ok([]);
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  try {
    return ok(await searchKb(p.data.q, p.data.category_code, 5));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not search");
  }
}

// ---- work --------------------------------------------------------------------

export async function claimServiceTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_sd_claim", id, {}, "work");
}

/**
 * Bulk assign from the desk queue. One RPC per ticket = one authorization per
 * ticket: a bulk assign cannot carry a ticket the database would refuse alone.
 */
export async function assignServiceTickets(
  ids: string[],
  assigneeId: string,
): Promise<Result<{ done: number; failed: { id: string; error: string }[] }>> {
  const list = [...new Set(ids)];
  if (!list.length) return fail("Pick at least one ticket");
  if (list.length > 200) return fail("Assign at most 200 tickets at once");
  if (!list.every((i) => ticketIdSchema.safeParse(i).success)) return fail("That ticket could not be found");
  if (!ticketIdSchema.safeParse(assigneeId).success) return fail("Pick who will work on it");
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("work")) && !(await canRh("triage"))) return fail(NO_ACCESS);
  const s = await createClient();
  const failed: { id: string; error: string }[] = [];
  let done = 0;
  for (const id of list) {
    const { error } = await s.rpc("rh_sd_assign", { p_ticket_id: id, p_assignee_id: assigneeId });
    if (error) failed.push({ id, error: dbError(error) });
    else {
      done++;
      drain(id);
    }
  }
  revalidatePath("/resolve", "layout");
  return ok({ done, failed });
}

/**
 * Start work. With `pause`, the technician's current in-progress ticket goes
 * On Hold first, its requester reading `message` (plan §6, the courteous
 * pause) — one RPC, so the two cannot half-happen.
 */
export async function startServiceTicket(id: string, pause?: StartServiceInput): Promise<Result<unknown>> {
  const p = startServiceSchema.safeParse(pause ?? {});
  if (!p.success) return fail(firstIssue(p.error));
  if (p.data.pause_ticket_id && p.data.pause_ticket_id === id) return fail("A ticket cannot be paused for itself");
  const res = await transition("rh_sd_start", id, {
    p_pause_ticket_id: p.data.pause_ticket_id,
    p_pause_message: p.data.pause_ticket_id ? (p.data.pause_message ?? null) : null,
  });
  if (res.ok && p.data.pause_ticket_id) drain(p.data.pause_ticket_id);
  return res;
}

export async function holdServiceTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("what it is waiting for").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_sd_hold", id, { p_reason: r.data });
}

export async function resumeServiceTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_sd_resume", id, {});
}

export async function resolveServiceTicket(id: string, v: ResolveServiceInput): Promise<Result<unknown>> {
  const p = resolveServiceSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_sd_resolve", id, {
    p_root_cause: p.data.root_cause,
    p_resolution: p.data.resolution,
    p_kb_article_id: p.data.kb_article_id,
  });
}

/** The requester: "yes, it is fixed" → Closed. */
export async function confirmServiceTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_sd_confirm", id, {});
}

/** The requester: "it is not fixed" → back to In Progress, fresh clock. */
export async function reopenServiceTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("what is still wrong").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_sd_reopen", id, { p_reason: r.data });
}

/** The Urgent override — triage only, with its reason (spec §3.2). */
export async function overrideServiceTicket(id: string, v: OverrideInput): Promise<Result<unknown>> {
  const p = overrideSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_sd_override", id, { p_kind: p.data.kind, p_note: p.data.note }, "triage");
}

export async function reclassifyServiceTicket(id: string, v: ReclassifyServiceInput): Promise<Result<unknown>> {
  const p = reclassifyServiceSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  return transition("rh_sd_reclassify", id, {
    p_category_id: p.data.category_id,
    p_ticket_type: p.data.ticket_type,
    p_priority: p.data.priority,
  });
}

export async function cancelServiceTicket(id: string, reason: string): Promise<Result<unknown>> {
  const r = reasonSchema("why it is cancelled").safeParse(reason);
  if (!r.success) return fail(firstIssue(r.error));
  return transition("rh_sd_cancel", id, { p_reason: r.data }, "triage");
}

export async function withdrawServiceTicket(id: string): Promise<Result<unknown>> {
  return transition("rh_sd_withdraw", id, {});
}

// ---- knowledge base ----------------------------------------------------------

/** Create (as a draft, `KB-…` ref) or edit an article. */
export async function saveKbArticle(v: KbArticleInput): Promise<Result<{ id: string }>> {
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("work"))) return fail(NO_ACCESS);
  const p = kbArticleSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  const { data, error } = await s.rpc("rh_kb_save", {
    p_id: p.data.id ?? null,
    p_title: p.data.title,
    p_problem: p.data.problem,
    p_steps: p.data.steps,
    p_tags: p.data.tags,
    p_category_code: p.data.category_code,
    p_source_ticket_id: p.data.source_ticket_id,
  });
  if (error) return fail(dbError(error));
  const row = Array.isArray(data) ? data[0] : data;
  const id = typeof row === "string" ? row : (row as { id?: string } | null)?.id;
  if (!id) return fail("The article was not saved. Try again.");
  revalidatePath("/resolve", "layout");
  return ok({ id });
}

async function kbStep(rpc: string, id: string): Promise<Result> {
  if (!ticketIdSchema.safeParse(id).success) return fail("That article could not be found");
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("work"))) return fail(NO_ACCESS);
  const s = await createClient();
  const { error } = await s.rpc(rpc, { p_id: id });
  if (error) return fail(dbError(error));
  revalidatePath("/resolve", "layout");
  return ok();
}

export async function publishKbArticle(id: string): Promise<Result> {
  return kbStep("rh_kb_publish", id);
}

export async function retireKbArticle(id: string): Promise<Result> {
  return kbStep("rh_kb_retire", id);
}

/** "This solved it" / "Still need help" — one answer per person per article;
 *  answering again changes it. `ticketId` when given on a ticket. */
export async function kbFeedback(id: string, helpful: boolean, ticketId: string | null = null): Promise<Result> {
  const p = kbFeedbackSchema.safeParse({ id, helpful, ticket_id: ticketId });
  if (!p.success) return fail(firstIssue(p.error));
  if (!(await signedIn())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const s = await createClient();
  const { error } = await s.rpc("rh_kb_feedback", {
    p_id: p.data.id,
    p_helpful: p.data.helpful,
    p_ticket_id: p.data.ticket_id,
  });
  if (error) return fail(dbError(error));
  revalidatePath("/resolve", "layout");
  return ok();
}

// ---- administration (configuration tables, RLS resolve:create) -------------

async function adminGate(): Promise<string | null> {
  if (!(await signedIn())) return "Sign in to continue";
  if (!(await canRh("admin"))) return NO_ACCESS;
  return null;
}

export async function saveServiceCategory(v: ServiceCategoryInput): Promise<Result<{ id: string }>> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = serviceCategorySchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const s = await createClient();
  // RLS scopes rh_sd_categories to the current unit, so the checks are per unit.
  for (const [col, label] of [
    ["name", "name"],
    ["code", "code"],
  ] as const) {
    const dup = await checkDuplicateName(s, "rh_sd_categories", p.data[col], {
      nameColumn: col,
      excludeId: p.data.id,
      label,
    });
    if (!dup.ok) return fail(dup.error);
  }
  const { id, ...row } = p.data;
  const res = id
    ? await s.from("rh_sd_categories").update(row).eq("id", id).select("id").single()
    : await s.from("rh_sd_categories").insert(row).select("id").single();
  if (res.error) return fail(dbError(res.error));
  revalidatePath("/resolve", "layout");
  return ok({ id: (res.data as { id: string }).id });
}

export async function setServiceCategoryInactive(id: string, inactive: boolean): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  if (!ticketIdSchema.safeParse(id).success) return fail("That category could not be found");
  const s = await createClient();
  const { error } = await s.from("rh_sd_categories").update({ inactive }).eq("id", id);
  if (error) return fail(dbError(error));
  revalidatePath("/resolve", "layout");
  return ok();
}

/** The current unit's four SLA rows, saved together. A new matrix applies to
 *  tickets raised (or re-cut) after the save; open tickets keep their dues. */
export async function saveServiceSla(v: ServiceSlaInput): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = serviceSlaSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const loc = await resolveWriteLocation();
  if (!loc.ok) return fail(loc.error);
  const s = await createClient();
  const { error } = await s
    .from("rh_sd_sla")
    .upsert(
      p.data.map((r) => ({ location_id: loc.locationId, ...r })),
      { onConflict: "location_id,priority" },
    );
  if (error) return fail(dbError(error));
  revalidatePath("/resolve", "layout");
  return ok();
}

/**
 * The desk's half of Unit Settings. Written apart from `saveUnitSettings`
 * (whose schema strips these keys) so neither save can blank the other's
 * columns.
 */
export async function saveDeskUnitSettings(v: DeskUnitSettingsInput): Promise<Result> {
  const gate = await adminGate();
  if (gate) return fail(gate);
  const p = deskUnitSettingsSchema.safeParse(v);
  if (!p.success) return fail(firstIssue(p.error));
  const loc = await resolveWriteLocation();
  if (!loc.ok) return fail(loc.error);
  const s = await createClient();
  const { error } = await s
    .from("rh_unit_settings")
    .upsert(
      { location_id: loc.locationId, ...p.data, updated_at: new Date().toISOString() },
      { onConflict: "location_id" },
    );
  if (error) return fail(dbError(error));
  revalidatePath("/resolve", "layout");
  return ok();
}
