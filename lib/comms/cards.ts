/**
 * PULSE'S 📎 CARDS (user 2026-10-31, the Pulse Attach Menu mockup — WhatsApp's
 * attach menu, screenshot 152017): a poll, an event, a shared contact and a
 * sticker are ordinary messages whose body STARTS with a token.
 *
 *   <poll>Question          + a comm_polls row and comm_poll_votes   (0776)
 *   <event>Name             + a comm_events row and comm_event_rsvps (0776)
 *   <card:uuid|Full Name>   a colleague, shared as a card (no table)
 *   <sticker>               one image attachment, drawn without a bubble
 *
 * WHY A TOKEN AND NOT A COLUMN. Every reader of a message — the chat, a
 * thread, pins, saved, search, the list preview, notifications — already
 * reads `body`. A token keeps all of them working with no change: a database
 * without 0776 shows "<poll>Question" as text rather than failing, and the
 * service only looks for poll / event rows when a body starts with the token,
 * so an ordinary page of messages costs nothing extra.
 *
 * A token is only a hint. A typed "<poll>" with no comm_polls row draws as
 * text; a card's name is display text the sender's screen wrote, and the
 * Message button opens a DM through comm_open_direct, which checks the id.
 */

export const POLL_TOKEN = "<poll>";
export const EVENT_TOKEN = "<event>";
export const STICKER_TOKEN = "<sticker>";
const CARD_RE = /^<card:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^<>|]{1,120})>$/i;

export const POLL_MAX_OPTIONS = 12;

export interface PollOption {
  text: string;
  votes: number;
  mine: boolean;
  /**
   * Who picked it and when, oldest first — the faces on the card and "View votes".
   * Optional: a message the browser already held before this field existed
   * (an open tab across a deploy or a hot reload) arrives without it.
   */
  voters?: { id: string; at: string }[];
}
export interface PollData {
  question: string;
  multi: boolean;
  options: PollOption[];
  /** People who voted at all. */
  voters: number;
}
export type RsvpAnswer = "going" | "maybe" | "no";
export interface EventData {
  name: string;
  description: string | null;
  /** ISO date (yyyy-mm-dd). */
  event_date: string;
  /** hh:mm, or null for an all-day event. */
  event_time: string | null;
  location: string | null;
  /** 0824: the sender called it off — the card stays, struck through, answers frozen. */
  cancelled: boolean;
  going: number;
  /** Who answered Going, oldest first — the faces beside "N going". Optional: see PollOption.voters. */
  going_ids?: string[];
  maybe: number;
  no: number;
  mine: RsvpAnswer | null;
}

export type CardKind = "poll" | "event" | "contact" | "sticker";

export function cardKind(body: string | null | undefined): CardKind | null {
  if (!body) return null;
  if (body.startsWith(POLL_TOKEN)) return "poll";
  if (body.startsWith(EVENT_TOKEN)) return "event";
  if (body === STICKER_TOKEN) return "sticker";
  if (CARD_RE.test(body)) return "contact";
  return null;
}

/** A shared contact's id and name, or null when the body is not one. */
export function contactOf(body: string | null | undefined): { id: string; name: string } | null {
  const m = body ? CARD_RE.exec(body) : null;
  return m ? { id: m[1].toLowerCase(), name: m[2].trim() } : null;
}

export function contactBody(id: string, name: string): string {
  return `<card:${id}|${name.replace(/[<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Someone"}>`;
}

/** What a card says in a one-line preview, a search snippet or the clipboard. */
export function cardText(body: string | null | undefined): string | null {
  switch (cardKind(body)) {
    case "poll":
      return `📊 Poll: ${body!.slice(POLL_TOKEN.length).trim()}`;
    case "event":
      return `📅 Event: ${body!.slice(EVENT_TOKEN.length).trim()}`;
    case "contact":
      return `👤 Contact: ${contactOf(body)!.name}`;
    case "sticker":
      return "Sticker";
    default:
      return null;
  }
}

/**
 * "Add to Google Calendar" on an event card (user 2026-11-12, screenshots
 * 091644 → 091709). A Google Calendar TEMPLATE link, not the Calendar API: it
 * needs no Google sign-in kept by the ERP and no Cloud project, and the event
 * lands in whichever Google account the operator's browser is signed into —
 * one click on Save there. A timed event runs one hour (the card has no end
 * time) and is pinned to IST with `ctz`, because the card's date and time were
 * typed in IST; an all-day event spans its one date (Google's end is exclusive).
 */
export function googleCalendarUrl(e: Pick<EventData, "name" | "description" | "event_date" | "event_time" | "location">): string {
  const ymd = e.event_date.replace(/-/g, "");
  let dates: string;
  if (e.event_time) {
    const [hh, mm] = e.event_time.split(":").map(Number);
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), hh, mm));
    const end = new Date(start.getTime() + 3_600_000);
    const stamp = (d: Date) =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
    dates = `${stamp(start)}/${stamp(end)}`;
  } else {
    const next = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + 1));
    dates = `${ymd}/${next.toISOString().slice(0, 10).replace(/-/g, "")}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.name, dates, ctz: "Asia/Kolkata" });
  if (e.description) q.set("details", e.description);
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
