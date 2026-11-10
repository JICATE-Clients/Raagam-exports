"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import {
  cancelGoogleEvent,
  createGoogleEvent,
  getGoogleConnection,
  getGoogleEvent,
  removeGoogleConnection,
  updateGoogleEvent,
  type GoogleEventInput,
} from "@/lib/google/calendar";
import { eventInput, istTimestamp, type EventInput, type GuestReply } from "./events-types";

/**
 * HR ▸ Events (0823) — the write half.
 *
 * ORDER MATTERS. A new event is written to our tables FIRST (so RLS has
 * judged the unit and the permission), then sent to Google; if Google
 * refuses, our row is deleted again, so there is never an event here that
 * nobody was invited to. An edit or cancel goes to Google FIRST and is only
 * recorded once Google has told the guests.
 *
 * The event lives in the calendar of the HR login that CREATED it
 * (`organizer_user_id`), so an edit by a colleague still reaches the same
 * Google event through the creator's connection.
 */

type R = { ok: true; id?: string; count?: number } | { ok: false; error: string };
const bad = (error: string): R => ({ ok: false, error });
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const VALID_REPLIES = new Set<GuestReply>(["needsAction", "accepted", "declined", "tentative"]);
const reply = (s: string | undefined): GuestReply => (s && VALID_REPLIES.has(s as GuestReply) ? (s as GuestReply) : "needsAction");

function revalidateEvents() {
  revalidatePath("/hr/events");
}

type Invitee = { staff_id: string | null; worker_id: string | null; email: string };

/** The chosen people → their emails. Refuses anyone without one, by code. */
async function resolveGuests(keys: string[]): Promise<{ ok: true; guests: Invitee[] } | { ok: false; error: string }> {
  const staffIds = keys.filter((k) => k.startsWith("staff:")).map((k) => k.slice(6));
  const workerIds = keys.filter((k) => k.startsWith("worker:")).map((k) => k.slice(7));
  const s = await createClient();
  const [st, wk] = await Promise.all([
    staffIds.length ? s.from("staff").select("id, code, name, email").in("id", staffIds) : Promise.resolve({ data: [], error: null }),
    workerIds.length ? s.from("workers").select("id, code, name, email").in("id", workerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (st.error) return { ok: false, error: st.error.message };
  if (wk.error) return { ok: false, error: wk.error.message };
  type P = { id: string; code: string | null; name: string; email: string | null };
  const people = [
    ...((st.data ?? []) as P[]).map((p) => ({ ...p, kind: "staff" as const })),
    ...((wk.data ?? []) as P[]).map((p) => ({ ...p, kind: "worker" as const })),
  ];
  if (people.length !== keys.length) return { ok: false, error: "Some of the people picked could not be found — reload and pick again" };
  const noEmail = people.filter((p) => !p.email?.trim());
  if (noEmail.length) {
    const names = noEmail.map((p) => `${p.code ?? ""} ${p.name}`.trim()).join(", ");
    return { ok: false, error: `No email on file for: ${names}. Add it on their Staff / Worker record, or remove them.` };
  }
  const bad = people.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email!.trim()));
  if (bad.length) {
    return { ok: false, error: `The email on file is not valid for: ${bad.map((p) => `${p.code ?? ""} ${p.name}`.trim()).join(", ")}` };
  }
  return {
    ok: true,
    guests: people.map((p) => ({
      staff_id: p.kind === "staff" ? p.id : null,
      worker_id: p.kind === "worker" ? p.id : null,
      email: p.email!.trim().toLowerCase(),
    })),
  };
}

export async function saveEvent(id: string | null, payload: EventInput): Promise<R> {
  if (!(await can("hr_payroll", id ? "edit" : "create"))) return bad("Forbidden");
  const user = await getAppUser();
  if (!user) return bad("Sign in again");
  const p = eventInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const v = p.data;
  const g = await resolveGuests(v.guests);
  if (!g.ok) return bad(g.error);
  const emails = [...new Set(g.guests.map((x) => x.email))];

  const fields = {
    title: v.title,
    description: v.description,
    venue: v.venue,
    starts_at: istTimestamp(v.date, v.from),
    ends_at: istTimestamp(v.date, v.to),
    add_meet: v.add_meet,
  };
  const googleInput = (requestId: string): GoogleEventInput => ({
    title: v.title,
    description: v.description,
    venue: v.venue,
    start: `${v.date}T${v.from}`,
    end: `${v.date}T${v.to}`,
    addMeet: v.add_meet,
    guests: emails,
    requestId,
  });

  const s = await createClient();
  const admin = createAdminClient();

  // ── New event ──
  if (!id) {
    const conn = await getGoogleConnection(user.id);
    if (!conn) return bad("Connect your Google Calendar first (button at the top of this page)");

    const ins = await s
      .from("hr_calendar_events")
      .insert({ ...fields, organizer_user_id: user.id, organizer_email: conn.googleEmail })
      .select("id, location_id")
      .single();
    if (ins.error || !ins.data) return bad(ins.error?.message ?? "Could not save the event");
    const row = ins.data as { id: string; location_id: string };

    const gi = await s
      .from("hr_calendar_event_guests")
      .insert(g.guests.map((x) => ({ ...x, event_id: row.id, location_id: row.location_id })));
    if (gi.error) {
      await s.from("hr_calendar_events").delete().eq("id", row.id);
      return bad(`Could not save the guest list: ${gi.error.message}`);
    }

    let made;
    try {
      made = await createGoogleEvent(user.id, googleInput(row.id));
    } catch (e) {
      await s.from("hr_calendar_events").delete().eq("id", row.id);
      return bad(errText(e, "Google Calendar refused the event"));
    }
    // Stamped with the service role: an HR login with "create" but not
    // "edit" must still be able to record what Google answered.
    const st = await admin
      .from("hr_calendar_events")
      .update({ google_event_id: made.id, google_html_link: made.htmlLink, google_meet_link: made.meetLink })
      .eq("id", row.id);
    if (st.error) return bad(`The invitations were sent, but saving Google's reference failed: ${st.error.message}`);
    revalidateEvents();
    return { ok: true, id: row.id, count: emails.length };
  }

  // ── Edit ──
  const cur = await s
    .from("hr_calendar_events")
    .select("id, location_id, status, google_event_id, organizer_user_id, organizer_email")
    .eq("id", id)
    .maybeSingle();
  if (cur.error) return bad(cur.error.message);
  const ev = cur.data as {
    id: string;
    location_id: string;
    status: string;
    google_event_id: string | null;
    organizer_user_id: string | null;
    organizer_email: string | null;
  } | null;
  if (!ev) return bad("The event was not found");
  if (ev.status === "cancelled") return bad("A cancelled event cannot be changed");
  if (!ev.google_event_id || !ev.organizer_user_id) return bad("This event never reached Google Calendar");

  let made;
  try {
    made = await updateGoogleEvent(ev.organizer_user_id, ev.google_event_id, googleInput(ev.id));
  } catch (e) {
    const m = errText(e, "Google Calendar refused the change");
    return bad(ev.organizer_user_id !== user.id && /connect/i.test(m) ? `${m} — the event belongs to ${ev.organizer_email ?? "another login"}'s calendar` : m);
  }
  const replies = new Map(made.attendees.map((a) => [a.email, reply(a.responseStatus)]));

  const up = await s
    .from("hr_calendar_events")
    .update({ ...fields, google_html_link: made.htmlLink, google_meet_link: made.meetLink })
    .eq("id", id);
  if (up.error) return bad(`Google was updated, but saving here failed: ${up.error.message}`);
  const del = await s.from("hr_calendar_event_guests").delete().eq("event_id", id);
  if (del.error) return bad(`Google was updated, but the guest list here was not: ${del.error.message}`);
  const gi = await s.from("hr_calendar_event_guests").insert(
    g.guests.map((x) => ({ ...x, event_id: id, location_id: ev.location_id, response_status: replies.get(x.email) ?? "needsAction" })),
  );
  if (gi.error) return bad(`Google was updated, but the guest list here was not: ${gi.error.message}`);
  revalidateEvents();
  return { ok: true, id, count: emails.length };
}

export async function cancelEvent(id: string, reason: string): Promise<R> {
  if (!(await can("hr_payroll", "edit"))) return bad("Forbidden");
  if (!reason.trim()) return bad("Say why");
  const s = await createClient();
  const { data, error } = await s
    .from("hr_calendar_events")
    .select("status, google_event_id, organizer_user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return bad(error.message);
  const ev = data as { status: string; google_event_id: string | null; organizer_user_id: string | null } | null;
  if (!ev) return bad("The event was not found");
  if (ev.status === "cancelled") return { ok: true };
  if (ev.google_event_id && ev.organizer_user_id) {
    try {
      await cancelGoogleEvent(ev.organizer_user_id, ev.google_event_id);
    } catch (e) {
      return bad(errText(e, "Google Calendar refused the cancellation"));
    }
  }
  const up = await s.from("hr_calendar_events").update({ status: "cancelled", cancel_reason: reason.trim().toUpperCase() }).eq("id", id);
  if (up.error) return bad(`Google cancelled it, but saving here failed: ${up.error.message}`);
  revalidateEvents();
  return { ok: true };
}

/** Ask Google who said Yes / No / Maybe, and store it. */
export async function refreshReplies(id: string): Promise<R> {
  if (!(await can("hr_payroll", "view"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s
    .from("hr_calendar_events")
    .select("google_event_id, organizer_user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return bad(error.message);
  const ev = data as { google_event_id: string | null; organizer_user_id: string | null } | null;
  if (!ev?.google_event_id || !ev.organizer_user_id) return bad("This event is not in Google Calendar");
  let got;
  try {
    got = await getGoogleEvent(ev.organizer_user_id, ev.google_event_id);
  } catch (e) {
    return bad(errText(e, "Could not read the replies"));
  }
  // Replies are Google's facts, not an HR edit — written with the service role
  // so a view-only HR login can refresh them too. Scoped to this one event.
  const admin = createAdminClient();
  let n = 0;
  for (const a of got.attendees) {
    const { error: e2, count } = await admin
      .from("hr_calendar_event_guests")
      .update({ response_status: reply(a.responseStatus) }, { count: "exact" })
      .eq("event_id", id)
      .eq("email", a.email);
    if (e2) return bad(e2.message);
    n += count ?? 0;
  }
  revalidateEvents();
  return { ok: true, count: n };
}

export async function disconnectGoogle(): Promise<R> {
  const user = await getAppUser();
  if (!user) return bad("Sign in again");
  try {
    await removeGoogleConnection(user.id);
  } catch (e) {
    return bad(errText(e, "Could not disconnect"));
  }
  revalidateEvents();
  return { ok: true };
}
