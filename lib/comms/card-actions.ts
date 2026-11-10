"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";
import { createGoogleEvent, getGoogleConnection, googleEnv } from "@/lib/google/calendar";
import { getMessagesByIds } from "./service";
import { commErrorText, type CommMessage } from "./types";
import { POLL_MAX_OPTIONS, type RsvpAnswer } from "./cards";

/**
 * Writes for Pulse's 📎 Poll and Event (0776). The RPCs take the actor from
 * auth.uid() and check membership, the archive and — through 0775's trigger —
 * the Announcements rule; this file adds Zod at the door and a sentence.
 * A missing 0776 answers in words, not a stack trace.
 */

type Fail = { ok: false; error: string };
const uuid = z.string().uuid();
const NOT_INSTALLED = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);
const notInstalled = (code?: string | null) => !!code && NOT_INSTALLED.has(code);
const INSTALL_TEXT = "Polls and events are not set up in this database yet. Ask your administrator to apply migration 0776.";

const pollInput = z.object({
  conversation_id: uuid,
  client_id: uuid,
  question: z.string().trim().min(1, "Type the question.").max(200, "Keep the question to 200 characters."),
  options: z
    .array(z.string().trim().max(100, "Keep each option to 100 characters."))
    .transform((o) => o.filter(Boolean))
    .refine((o) => o.length >= 2, "Give at least two options.")
    .refine((o) => o.length <= POLL_MAX_OPTIONS, `A poll can have at most ${POLL_MAX_OPTIONS} options.`)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, "Two options say the same thing."),
  multi: z.boolean(),
});

const eventInput = z.object({
  conversation_id: uuid,
  client_id: uuid,
  name: z.string().trim().min(1, "Give the event a name.").max(100, "Keep the event name to 100 characters."),
  description: z.string().trim().max(500, "Keep the description to 500 characters.").nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  location: z.string().trim().max(120, "Keep the location to 120 characters.").nullable(),
  /** Also invite every member of the chat from the sender's Google Calendar (0823). */
  google: z.boolean().optional(),
});

export async function sendPoll(input: z.input<typeof pollInput>): Promise<{ ok: true; id: string } | Fail> {
  const parsed = pollInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the poll." };
  const d = parsed.data;
  const s = await createClient();
  const { data, error } = await s.rpc("comm_send_poll", {
    p_conv: d.conversation_id,
    p_client_id: d.client_id,
    p_question: d.question,
    p_options: d.options,
    p_multi: d.multi,
  });
  if (error || !data) return { ok: false, error: notInstalled(error?.code) ? INSTALL_TEXT : commErrorText(error, "The poll could not be sent.") };
  return { ok: true, id: data as string };
}

type GoogleOutcome = { sent: number } | { error: string };

export async function sendEvent(
  input: z.input<typeof eventInput>,
): Promise<{ ok: true; id: string; google?: GoogleOutcome } | Fail> {
  const parsed = eventInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the event." };
  const d = parsed.data;
  const s = await createClient();
  const { data, error } = await s.rpc("comm_send_event", {
    p_conv: d.conversation_id,
    p_client_id: d.client_id,
    p_name: d.name,
    p_description: d.description || null,
    p_date: d.date,
    p_time: d.time,
    p_location: d.location || null,
  });
  if (error || !data) return { ok: false, error: notInstalled(error?.code) ? INSTALL_TEXT : commErrorText(error, "The event could not be sent.") };
  const id = data as string;
  if (!d.google) return { ok: true, id };
  // The chat message is posted whatever Google says; a Google failure comes
  // back as `google.error` so the sheet can say so and offer a retry. The
  // RPC is idempotent on client_id, so a retry never posts the event twice.
  return { ok: true, id, google: await inviteChatToGoogle(id, d) };
}

/** Create the chat event in the SENDER's Google Calendar, every member a guest. */
async function inviteChatToGoogle(messageId: string, d: z.output<typeof eventInput>): Promise<GoogleOutcome> {
  try {
    const user = await getAppUser();
    if (!user) return { error: "Sign in again." };
    if (!(await getGoogleConnection(user.id))) return { error: "Connect your Google Calendar first." };

    const admin = createAdminClient();
    const prev = await admin.from("comm_events").select("google_event_id").eq("message_id", messageId).maybeSingle();
    if (prev.error) return { error: notInstalled(prev.error.code) || prev.error.code === "42703" ? "Google invites are not set up in this database yet (migration 0823)." : prev.error.message };
    if ((prev.data as { google_event_id: string | null } | null)?.google_event_id) return { sent: 0 };

    // Everyone still in the chat except the sender (Google adds the organiser).
    // Read with the service role: profiles_read_own hides colleagues' emails,
    // and the RPC above has already proved the sender is a member.
    const mem = await admin.from("comm_members").select("user_id").eq("conversation_id", d.conversation_id).is("removed_at", null);
    if (mem.error) return { error: mem.error.message };
    const ids = ((mem.data ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((u) => u !== user.id);
    if (!ids.length) return { error: "Nobody else is in this chat to invite." };
    const prof = await admin.from("profiles").select("email").in("id", ids);
    if (prof.error) return { error: prof.error.message };
    const emails = [
      ...new Set(
        ((prof.data ?? []) as { email: string | null }[])
          .map((p) => p.email?.trim().toLowerCase() ?? "")
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      ),
    ];
    if (!emails.length) return { error: "Nobody in this chat has an email on their login." };

    const made = await createGoogleEvent(user.id, {
      title: d.name,
      description: d.description || null,
      venue: d.location || null,
      ...(d.time ? { start: `${d.date}T${d.time}`, end: plusOneHour(d.date, d.time) } : { start: d.date, end: nextDay(d.date), allDay: true }),
      addMeet: false,
      guests: emails,
      requestId: messageId,
    });
    await admin
      .from("comm_events")
      .update({ google_event_id: made.id, google_html_link: made.htmlLink, google_sent_by: user.id })
      .eq("message_id", messageId);
    return { sent: emails.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Google Calendar did not answer." };
  }
}

/** `YYYY-MM-DD` + `HH:mm` → one hour later, as `YYYY-MM-DDTHH:mm` (rolls past midnight). */
function plusOneHour(date: string, time: string): string {
  const t = new Date(`${date}T${time}:00Z`);
  t.setUTCHours(t.getUTCHours() + 1);
  return t.toISOString().slice(0, 16);
}
function nextDay(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** For the 📎 Event sheet: can this person send a Google invite right now? */
export async function myGoogleCalendar(): Promise<{ configured: boolean; email: string | null }> {
  const user = await getAppUser();
  if (!user || !googleEnv()) return { configured: !!googleEnv(), email: null };
  try {
    return { configured: true, email: (await getGoogleConnection(user.id))?.googleEmail ?? null };
  } catch {
    // 0823 not applied yet — behave as "not connected" rather than break the sheet.
    return { configured: true, email: null };
  }
}

/**
 * 0824: the sender changes their own event. Same fields and rules as sending
 * (eventInput minus the chat and the retry key); the card changes in place for
 * everyone and a moved date / time also drops a gray note in the chat.
 */
const editInput = eventInput.omit({ conversation_id: true, client_id: true, google: true });
const EDIT_INSTALL_TEXT = "Editing events is not set up in this database yet. Ask your administrator to apply migration 0824.";

export async function editEvent(
  messageId: string,
  input: z.input<typeof editInput>,
): Promise<{ ok: true; message: CommMessage | null } | Fail> {
  if (!uuid.safeParse(messageId).success) return { ok: false, error: "Unknown event." };
  const parsed = editInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the event." };
  const d = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_edit_event", {
    p_message: messageId,
    p_name: d.name,
    p_description: d.description || null,
    p_date: d.date,
    p_time: d.time,
    p_location: d.location || null,
  });
  if (error) return { ok: false, error: notInstalled(error.code) ? EDIT_INSTALL_TEXT : commErrorText(error, "The event could not be saved.") };
  return { ok: true, message: await fresh(messageId) };
}

/** 0824: call the event off. The card stays, struck through; answers stop. */
export async function cancelEvent(messageId: string): Promise<{ ok: true; message: CommMessage | null } | Fail> {
  if (!uuid.safeParse(messageId).success) return { ok: false, error: "Unknown event." };
  const s = await createClient();
  const { error } = await s.rpc("comm_cancel_event", { p_message: messageId });
  if (error) return { ok: false, error: notInstalled(error.code) ? EDIT_INSTALL_TEXT : commErrorText(error, "The event could not be cancelled.") };
  return { ok: true, message: await fresh(messageId) };
}

/** Vote (replacing the caller's earlier vote) and hand back the message with fresh counts. */
export async function votePoll(messageId: string, options: number[]): Promise<{ ok: true; message: CommMessage | null } | Fail> {
  if (!uuid.safeParse(messageId).success || !Array.isArray(options) || !options.every((o) => Number.isInteger(o) && o >= 0 && o < POLL_MAX_OPTIONS))
    return { ok: false, error: "Unknown poll." };
  const s = await createClient();
  const { error } = await s.rpc("comm_vote_poll", { p_message: messageId, p_options: options });
  if (error) return { ok: false, error: notInstalled(error.code) ? INSTALL_TEXT : commErrorText(error, "Your vote could not be saved.") };
  return { ok: true, message: await fresh(messageId) };
}

export async function rsvpEvent(messageId: string, answer: RsvpAnswer | null): Promise<{ ok: true; message: CommMessage | null } | Fail> {
  if (!uuid.safeParse(messageId).success || (answer !== null && !["going", "maybe", "no"].includes(answer)))
    return { ok: false, error: "Unknown event." };
  const s = await createClient();
  const { error } = await s.rpc("comm_rsvp_event", { p_message: messageId, p_answer: answer });
  if (error) return { ok: false, error: notInstalled(error.code) ? INSTALL_TEXT : commErrorText(error, "Your answer could not be saved.") };
  return { ok: true, message: await fresh(messageId) };
}

async function fresh(messageId: string): Promise<CommMessage | null> {
  const s = await createClient();
  const { data } = await s.from("comm_messages").select("conversation_id").eq("id", messageId).maybeSingle();
  if (!data) return null;
  const rows = await getMessagesByIds((data as { conversation_id: string }).conversation_id, [messageId]);
  return rows[0] ?? null;
}
