"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAppUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { canRh } from "./auth";
import { drainOutbox } from "./outbox";
import { readPhoto, removePhoto, uploadPhoto } from "./photo-upload";
import { fail, ok, type Result } from "./result";
import { firstIssue, ticketIdSchema } from "./schemas";
import { ASSIST_LANES, NEEDED_BY, RQ_REASONS, type AssistReceipt } from "./assist-types";

/*
 * Raagam Assist writes (doc/resolve/assist-catalog-plan.md). ONE submit for
 * every lane: the chat posts what was tapped, this composes the subject and
 * "what happened", and the matching 0751 wrapper (rh_assist_broken /
 * _service / _complaint / _requirement) routes it from the catalog item.
 *
 * Types are imported, never re-exported: a type re-exported from a
 * "use server" file is a runtime ReferenceError that tsc does not see.
 */

const NO_ACCESS = "You do not have access to do this in Help & Repairs";

type PgError = { code?: string; message: string } | null;
function dbError(e: NonNullable<PgError>): string {
  if (e.code === "P0001") return e.message;
  if (e.code === "42501") return NO_ACCESS;
  return `Could not save: ${e.message}`;
}

function touch(ticketId: string | null) {
  revalidatePath("/resolve", "layout");
  after(async () => {
    try {
      await drainOutbox({ ticketId: ticketId ?? undefined, source: "action" });
    } catch {
      // the resolve-outbox job picks it up
    }
  });
}

const upper = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
/** Empty or absent → null; anything else must be what it says. A blank form
 *  field must never become 0 (a GPS of 0,0) or skip its own check. */
const blank = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v ?? null));
const optUuid = z.preprocess(blank, z.string().uuid("That choice is not valid — pick it again").nullable());
const optNum = (min: number, max: number) =>
  z.preprocess((v) => (blank(v) === null ? null : Number(v)), z.number().min(min).max(max).nullable());
const bool = z.preprocess((v) => v === "true" || v === true, z.boolean());

const assistSchema = z
  .object({
    lane: z.enum(ASSIST_LANES, "Pick what you need help with"),
    item_id: optUuid,
    /** "Something else": typed by the person; otherwise the item's label is the subject. */
    title: z.string().trim().max(120, "Keep it under 120 characters").default(""),
    detail: z.string().trim().max(200).default(""),
    note: z.string().trim().max(2000, "Keep the note under 2000 characters").default(""),
    // fix
    place_id: optUuid,
    place_text: z.string().trim().max(120).default(""),
    dangerous: bool,
    gps_lat: optNum(-90, 90).catch(null),
    gps_lng: optNum(-180, 180).catch(null),
    // it
    impact: z.preprocess(blank, z.enum(["cannot_work", "degraded", "request"]).nullable()),
    // buy
    qty: optNum(0.01, 1_000_000),
    needed_by: z.preprocess(blank, z.enum(NEEDED_BY).nullable()),
    reason: z.preprocess(blank, z.enum(RQ_REASONS).nullable()),
    // concern
    anonymous: bool,
    about_superior: bool,
  })
  .refine((v) => v.item_id || v.title, { message: "Pick the problem, or say it in a few words", path: ["title"] })
  .refine((v) => v.lane !== "it" || v.impact, { message: "Say how it affects your work", path: ["impact"] })
  .refine((v) => v.lane !== "buy" || (v.qty && v.needed_by && v.reason), {
    message: "Say how many, by when and why",
    path: ["qty"],
  })
  .refine((v) => v.lane !== "fix" || v.place_id || v.place_text, { message: "Say where it is", path: ["place_id"] });

/**
 * Send what was tapped. FormData (the photo travels as a file): lane,
 * item_id, title (Something else only), detail (the chip), note, and the
 * lane's own fields. The description is the chip, then the note, then — for a
 * typed place — "PLACE: …", so whoever reads it sees all three.
 */
export async function submitAssist(fd: FormData): Promise<Result<AssistReceipt>> {
  if (!(await getAppUser())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));
  const p = assistSchema.safeParse(raw);
  if (!p.success) return fail(firstIssue(p.error));
  const v = p.data;

  const title = upper(v.title) || null;
  const description =
    [upper(v.detail), upper(v.note), v.lane === "fix" && !v.place_id && v.place_text ? `PLACE: ${upper(v.place_text)}` : ""]
      .filter(Boolean)
      .join("\n\n") || null;

  let path: string | null = null;
  if (v.lane === "fix" || v.lane === "it") {
    const photo = await readPhoto(fd);
    if (!photo.ok) return photo;
    if (photo.data) {
      const up = await uploadPhoto(photo.data);
      if (!up.ok) return up;
      path = up.data;
    }
  }

  const s = await createClient();
  const call =
    v.lane === "fix"
      ? s.rpc("rh_assist_broken", {
          p_catalog_item_id: v.item_id,
          p_place_id: v.place_id,
          p_title: title,
          p_description: description,
          p_is_dangerous: v.dangerous,
          p_photo_path: path,
          p_gps_lat: v.gps_lat,
          p_gps_lng: v.gps_lng,
        })
      : v.lane === "it"
        ? s.rpc("rh_assist_service", {
            p_catalog_item_id: v.item_id,
            p_title: title,
            // rh_sd_submit asks for a description; the chip is always one.
            p_description: description ?? upper(v.detail || title || "SEE SUBJECT"),
            p_impact: v.impact,
            p_photo_path: path,
          })
        : v.lane === "concern"
          ? s.rpc("rh_assist_complaint", {
              p_catalog_item_id: v.item_id,
              p_subject: title,
              p_description: description,
              p_is_anonymous: v.anonymous,
              p_about_superior: v.about_superior,
            })
          : s.rpc("rh_assist_requirement", {
              p_catalog_item_id: v.item_id,
              p_title: title,
              p_description: description,
              p_qty: v.qty,
              p_needed_by: v.needed_by,
              p_reason: v.reason,
            });
  const { data, error } = await call;
  if (error) {
    await removePhoto(path);
    return fail(dbError(error));
  }
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r?.ref_no) {
    await removePhoto(path);
    return fail("It was not recorded. Try again.");
  }
  const ticketId = typeof r.ticket_id === "string" ? r.ticket_id : null;
  // Drain even for an anonymous concern (no id to name): the handler's alert starts their clock.
  touch(ticketId);
  return ok({
    lane: v.lane,
    ticket_id: ticketId,
    ref_no: String(r.ref_no),
    owner_name: (r.owner_name as string | null) ?? (r.handler_name as string | null) ?? (r.team_name as string | null) ?? null,
    due_at: (r.due_at as string | null) ?? null,
    response_due_at: (r.response_due_at as string | null) ?? null,
    tracking_token: (r.tracking_token as string | null) ?? null,
    needs_sorting: !!r.needs_sorting,
  });
}

// ---- requirements (Stores / department head) ----------------------------------

async function rqStep(rpc: string, id: unknown, args: Record<string, unknown>): Promise<Result<unknown>> {
  const pid = ticketIdSchema.safeParse(id);
  if (!pid.success) return fail("That request could not be found");
  if (!(await getAppUser())) return fail("Sign in to continue");
  if (!(await canRh("view"))) return fail(NO_ACCESS);
  const s = await createClient();
  const { data, error } = await s.rpc(rpc, { p_ticket_id: pid.data, ...args });
  if (error) return fail(dbError(error));
  touch(pid.data);
  return ok(data);
}

/** Approve, or reject with the reason the person who asked will read. */
export async function decideRequirement(id: string, approve: boolean, note: string | null): Promise<Result<unknown>> {
  if (!approve && !(note ?? "").trim()) return fail("Say why it is rejected");
  return rqStep("rh_rq_decide", id, { p_approve: approve, p_note: upper(note) || null });
}

/** Mark an approved request as given / bought. */
export async function fulfilRequirement(id: string, note: string | null): Promise<Result<unknown>> {
  return rqStep("rh_rq_fulfil", id, { p_note: upper(note) || null });
}

/** The person who asked takes it back while it is still pending. */
export async function withdrawRequirement(id: string): Promise<Result<unknown>> {
  return rqStep("rh_rq_withdraw", id, {});
}
