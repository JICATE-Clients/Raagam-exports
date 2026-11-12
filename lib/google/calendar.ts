import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Google Calendar, spoken to over plain REST (no SDK dependency).
 *
 * Each HR login connects ITS OWN Google account once ("Connect Google
 * Calendar" on HR ▸ Events). Events are created in that account's primary
 * calendar with `sendUpdates=all`, so Google itself emails every guest a real
 * invitation, and an edit or cancel emails them again.
 *
 * Tokens live in `hr_google_connections` (0823), which only the service role
 * can read. Nothing in this file is ever imported by a client component.
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

/** Every event is entered and shown in factory time. */
export const EVENT_TIME_ZONE = "Asia/Kolkata";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type GoogleEnv = { clientId: string; clientSecret: string; redirectUri: string };

/** The three settings from `.env.local`; null when any is missing. */
export function googleEnv(): GoogleEnv | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function googleAuthUrl(state: string): string {
  const env = googleEnv();
  if (!env) throw new Error("Google Calendar is not set up — GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI are missing");
  const q = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // offline + consent: Google returns a refresh token, so the connection
    // keeps working after the one-hour access token expires.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

type TokenAnswer = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Google refused the sign-in (${res.status})`);
  }
  return json;
}

/** The callback's half: swap the one-time code for tokens and save them. */
export async function completeGoogleConnection(userId: string, code: string): Promise<string> {
  const env = googleEnv();
  if (!env) throw new Error("Google Calendar is not set up");
  const t = await tokenRequest({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: "authorization_code",
  });
  const who = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" });
  const info = (await who.json().catch(() => ({}))) as { email?: string };
  if (!info.email) throw new Error("Google did not say which account was connected");
  if (!t.scope?.includes("calendar.events")) {
    throw new Error("Calendar access was not ticked on Google's screen — connect again and allow it");
  }

  const admin = createAdminClient();
  const { data: prev } = await admin.from("hr_google_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
  // Google only sends a refresh token on the first consent; keep the old one otherwise.
  const refresh = t.refresh_token ?? (prev as { refresh_token: string } | null)?.refresh_token;
  if (!refresh) throw new Error("Google did not return a refresh token — disconnect and connect again");
  const { error } = await admin.from("hr_google_connections").upsert(
    {
      user_id: userId,
      google_email: info.email.toLowerCase(),
      refresh_token: refresh,
      access_token: t.access_token,
      expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
      scope: t.scope ?? null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Could not save the Google connection: ${error.message}`);
  return info.email;
}

export type GoogleConnection = { googleEmail: string } | null;

export async function getGoogleConnection(userId: string): Promise<GoogleConnection> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("hr_google_connections").select("google_email").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  return data ? { googleEmail: (data as { google_email: string }).google_email } : null;
}

export async function removeGoogleConnection(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("hr_google_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
  const token = (data as { refresh_token: string } | null)?.refresh_token;
  if (token) {
    // Best effort: tell Google too, so the app disappears from the account's
    // "third-party access" list. The row goes either way.
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
  }
  const { error } = await admin.from("hr_google_connections").delete().eq("user_id", userId);
  if (error) throw new Error(`Could not disconnect: ${error.message}`);
}

/** A valid access token for this login, refreshing it when it has expired. */
async function accessTokenFor(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hr_google_connections")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  const row = data as { refresh_token: string; access_token: string | null; expires_at: string | null } | null;
  if (!row) throw new GoogleNotConnected();
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now()) return row.access_token;

  const env = googleEnv();
  if (!env) throw new Error("Google Calendar is not set up");
  let t: TokenAnswer;
  try {
    t = await tokenRequest({
      refresh_token: row.refresh_token,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
    });
  } catch (e) {
    // invalid_grant = the person revoked access, or (testing mode) 7 days passed.
    throw new Error(`The Google connection has expired — press Reconnect Google Calendar. (${(e as Error).message})`);
  }
  await admin
    .from("hr_google_connections")
    .update({ access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString() })
    .eq("user_id", userId);
  return t.access_token;
}

export class GoogleNotConnected extends Error {
  constructor() {
    super("Connect your Google Calendar first (button at the top of HR ▸ Events)");
  }
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type GoogleEventInput = {
  title: string;
  description: string | null;
  venue: string | null;
  /** Local factory time, `YYYY-MM-DDTHH:mm` — or, when `allDay`, `YYYY-MM-DD` (end = the day AFTER, as Google wants). */
  start: string;
  end: string;
  allDay?: boolean;
  addMeet: boolean;
  guests: string[];
  /** Our row id — used as the Meet request id so a retry never makes two links. */
  requestId: string;
};

export type GoogleEventResult = {
  id: string;
  htmlLink: string | null;
  meetLink: string | null;
  attendees: { email: string; responseStatus: string }[];
};

type GoogleEventJson = {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  attendees?: { email: string; responseStatus?: string }[];
  error?: { message?: string };
};

function eventBody(e: GoogleEventInput) {
  return {
    summary: e.title,
    description: e.description ?? undefined,
    location: e.venue ?? undefined,
    start: e.allDay ? { date: e.start } : { dateTime: `${e.start}:00`, timeZone: EVENT_TIME_ZONE },
    end: e.allDay ? { date: e.end } : { dateTime: `${e.end}:00`, timeZone: EVENT_TIME_ZONE },
    attendees: e.guests.map((email) => ({ email })),
    guestsCanModify: false,
    reminders: { useDefault: true },
    ...(e.addMeet
      ? { conferenceData: { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
}

async function call(userId: string, url: string, init: RequestInit): Promise<Response> {
  const token = await accessTokenFor(userId);
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

async function readEvent(res: Response, doing: string): Promise<GoogleEventResult> {
  const json = (await res.json().catch(() => ({}))) as GoogleEventJson;
  if (!res.ok || !json.id) throw new Error(`Google Calendar could not ${doing}: ${json.error?.message ?? res.status}`);
  return {
    id: json.id,
    htmlLink: json.htmlLink ?? null,
    meetLink: json.hangoutLink ?? null,
    attendees: (json.attendees ?? []).map((a) => ({ email: a.email.toLowerCase(), responseStatus: a.responseStatus ?? "needsAction" })),
  };
}

/** Create the event; Google emails every guest an invitation. */
export async function createGoogleEvent(userId: string, e: GoogleEventInput): Promise<GoogleEventResult> {
  const res = await call(userId, `${EVENTS_URL}?sendUpdates=all&conferenceDataVersion=1`, {
    method: "POST",
    body: JSON.stringify(eventBody(e)),
  });
  return readEvent(res, "create the event");
}

/** Change the event; Google emails every guest the update (new guests get an invite). */
export async function updateGoogleEvent(userId: string, eventId: string, e: GoogleEventInput): Promise<GoogleEventResult> {
  const res = await call(userId, `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=all&conferenceDataVersion=1`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(e)),
  });
  return readEvent(res, "update the event");
}

/** Cancel the event; Google emails every guest a cancellation. */
export async function cancelGoogleEvent(userId: string, eventId: string): Promise<void> {
  const res = await call(userId, `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  // 410 = already deleted in Google Calendar by hand; the outcome is the same.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const json = (await res.json().catch(() => ({}))) as GoogleEventJson;
    throw new Error(`Google Calendar could not cancel the event: ${json.error?.message ?? res.status}`);
  }
}

/** Read the event back — for the guests' Yes / No / Maybe. */
export async function getGoogleEvent(userId: string, eventId: string): Promise<GoogleEventResult> {
  const res = await call(userId, `${EVENTS_URL}/${encodeURIComponent(eventId)}`, { method: "GET" });
  return readEvent(res, "read the event");
}

// ─── Pulse chat events: one company calendar (user 2026-11-12, option A) ────

/**
 * The Google account every Pulse chat event is sent from — `PULSE_CALENDAR_ACCOUNT`
 * in the environment, a Google email such as the office account. Someone signs
 * in to the ERP once, presses Connect Google Calendar (HR ▸ Events) and picks
 * that account; its `hr_google_connections` row is then the organiser of every
 * chat event, and each member gets it as an invite with no click of their own.
 *
 * Null when unset or not connected yet — the caller then falls back to the
 * sender's own connection, and failing that sends nothing to Google.
 */
export async function pulseCalendarOrganizer(): Promise<{ userId: string; googleEmail: string } | null> {
  const account = process.env.PULSE_CALENDAR_ACCOUNT?.trim().toLowerCase();
  if (!account || !googleEnv()) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hr_google_connections")
    .select("user_id, google_email")
    .eq("google_email", account)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { user_id: string; google_email: string };
  return { userId: row.user_id, googleEmail: row.google_email };
}
