"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

export async function sendEvent(input: z.input<typeof eventInput>): Promise<{ ok: true; id: string } | Fail> {
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
  return { ok: true, id: data as string };
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
