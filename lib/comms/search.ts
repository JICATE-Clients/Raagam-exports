import { z } from "zod";
import type { ConversationKind } from "./types";

// ============================================================================
// Communication Hub — message search (0762): the query language, the cursor
// and the snippet. Pure, so the search page, the server action and
// scripts/check-comms-search.mts read one definition.
//
// OPERATORS (a Slack-like subset), anywhere in the box, combinable:
//
//   from:bala         from:"anbu selvan"     messages by that person
//   in:cutting-room   in:#cutting-room       messages in that channel
//   after:2026-01-01                         after that day   (from 2 Jan, IST)
//   before:2026-12-31                        before that day  (to 30 Dec, IST)
//   on:2026-03-15                            that day only
//   has:file  has:attachment                 messages with files
//   is:thread                                thread replies only
//
// Slack's meaning of after/before is kept — the day itself is NOT included —
// and translated here into the inclusive From / To days the filter bar and
// the database use, so the two never disagree about a boundary.
//
// Anything not recognised stays SEARCH TEXT ("ratio:2" is two words), and a
// recognised operator with a bad value is reported, never silently dropped.
// Names are resolved later, on the server, through what the caller may see —
// an operator can only ever NARROW a search, never reach past RLS.
// ============================================================================

export const SEARCH_KINDS = ["channel", "direct", "group", "thread"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_SORTS = ["relevance", "newest"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const SEARCH_PAGE = 20;

export const KIND_LABEL: Record<SearchKind, string> = {
  channel: "Channels",
  direct: "Direct messages",
  group: "Groups",
  thread: "Thread replies",
};

export interface ParsedQuery {
  /** The words left after operators are taken out. */
  text: string;
  from: string[];
  in: string[];
  /** Inclusive calendar days, YYYY-MM-DD. */
  fromDay: string | null;
  toDay: string | null;
  hasFile: boolean;
  thread: boolean;
  problems: string[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day (2026-02-30 is not), as YYYY-MM-DD. */
export function isDay(v: string): boolean {
  if (!DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Shift a YYYY-MM-DD by whole days (calendar arithmetic, no time zone). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const later = (a: string | null, b: string) => (a && a > b ? a : b);
const earlier = (a: string | null, b: string) => (a && a < b ? a : b);

/** `op:value` or `op:"two words"`, the value unquoted. */
// The value is optional in the pattern so an operator left empty ("from:") is
// caught and reported rather than slipping through as a search word.
const TOKEN_RE = /(\b(?:from|in|after|before|on|has|is):)(?:"([^"]*)"|(\S+))?/gi;

export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: "", from: [], in: [], fromDay: null, toDay: null, hasFile: false, thread: false, problems: [] };
  const text = (raw ?? "").replace(TOKEN_RE, (whole, op: string, quoted?: string, bare?: string) => {
    const key = op.slice(0, -1).toLowerCase();
    const value = (quoted ?? bare ?? "").trim();
    if (!value) {
      out.problems.push(`${key}: needs a value.`);
      return " ";
    }
    switch (key) {
      case "from":
        out.from.push(value.replace(/^@/, ""));
        return " ";
      case "in":
        out.in.push(value.replace(/^#/, ""));
        return " ";
      case "after":
      case "before":
      case "on":
        if (!isDay(value)) {
          out.problems.push(`${key}:${value} is not a date — use YYYY-MM-DD, e.g. ${key}:2026-01-31.`);
          return " ";
        }
        if (key === "after") out.fromDay = later(out.fromDay, addDays(value, 1));
        if (key === "before") out.toDay = earlier(out.toDay, addDays(value, -1));
        if (key === "on") {
          out.fromDay = later(out.fromDay, value);
          out.toDay = earlier(out.toDay, value);
        }
        return " ";
      case "has":
        if (["file", "files", "attachment", "attachments"].includes(value.toLowerCase())) {
          out.hasFile = true;
          return " ";
        }
        out.problems.push(`has:${value} is not supported — use has:file.`);
        return " ";
      case "is":
        if (value.toLowerCase() === "thread") {
          out.thread = true;
          return " ";
        }
        out.problems.push(`is:${value} is not supported — use is:thread.`);
        return " ";
      default:
        return whole;
    }
  });
  out.text = text.replace(/\s+/g, " ").trim();
  if (out.fromDay && out.toDay && out.fromDay > out.toDay) out.problems.push("The dates leave no days to search.");
  return out;
}

/** The words a result is highlighted by — what the database matched as prefixes. */
export function searchTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[\s\p{P}\p{S}]+/u)
        .filter((w) => w.length > 0),
    ),
  ).slice(0, 12);
}

// ---------------------------------------------------------------------------
// The cursor: the last row's sort key, opaque to the browser, re-validated.
// ---------------------------------------------------------------------------

const cursorShape = z.object({
  r: z.number().finite().nullable(),
  t: z.string().datetime({ offset: true }),
  i: z.string().uuid(),
});
export type SearchCursor = z.infer<typeof cursorShape>;

export function encodeSearchCursor(c: SearchCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
export function decodeSearchCursor(s: string | null | undefined): SearchCursor | null {
  if (!s || s.length > 300) return null;
  try {
    const parsed = cursorShape.safeParse(JSON.parse(Buffer.from(s, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What the page sends, validated on the server
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const day = z.string().refine(isDay, "Use a real date, YYYY-MM-DD.");

export const searchInput = z.object({
  q: z.string().max(200, "Keep the search to 200 characters.").default(""),
  author: uuid.nullable().default(null),
  conversation: uuid.nullable().default(null),
  fromDay: day.nullable().default(null),
  toDay: day.nullable().default(null),
  hasFile: z.boolean().default(false),
  kind: z.enum(SEARCH_KINDS).nullable().default(null),
  sort: z.enum(SEARCH_SORTS).default("relevance"),
  cursor: z.string().max(300).nullable().default(null),
});
export type SearchInput = z.input<typeof searchInput>;

// ---------------------------------------------------------------------------
// Snippet + highlight, as PIECES — rendered as React text, never as HTML
// ---------------------------------------------------------------------------

export type SnippetPiece = { text: string; hit: boolean };

/**
 * A window of `plain` around the first match, with every word that STARTS
 * with a search term marked — the same prefix rule the database used, so what
 * lights up is what matched. Returned as pieces; the screen renders them as
 * text inside <mark>, so a message containing markup shows as typed.
 */
export function snippet(plain: string, terms: string[], width = 220): SnippetPiece[] {
  const src = plain.replace(/\s+/g, " ").trim();
  const lower = src.toLowerCase();
  const starts = (i: number) => i === 0 || /[\s\p{P}\p{S}]/u.test(src[i - 1]);
  let first = -1;
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i >= 0 && !starts(i)) i = lower.indexOf(t, i + 1);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  let from = 0;
  let to = src.length;
  if (src.length > width) {
    from = first < 0 ? 0 : Math.max(0, first - Math.floor(width / 3));
    to = Math.min(src.length, from + width);
    if (to - from < width) from = Math.max(0, to - width);
  }
  const win = src.slice(from, to);
  const winLower = win.toLowerCase();
  const marks: [number, number][] = [];
  for (const t of terms) {
    let i = winLower.indexOf(t);
    while (i >= 0) {
      const abs = from + i;
      if (starts(abs)) {
        let end = i + t.length;
        while (end < win.length && !/[\s\p{P}\p{S}]/u.test(win[end])) end++;
        marks.push([i, end]);
      }
      i = winLower.indexOf(t, i + 1);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const pieces: SnippetPiece[] = [];
  if (from > 0) pieces.push({ text: "… ", hit: false });
  let at = 0;
  for (const [s, e] of marks) {
    if (s < at) continue;
    if (s > at) pieces.push({ text: win.slice(at, s), hit: false });
    pieces.push({ text: win.slice(s, e), hit: true });
    at = e;
  }
  if (at < win.length) pieces.push({ text: win.slice(at), hit: false });
  if (to < src.length) pieces.push({ text: " …", hit: false });
  return pieces;
}

/** The URL that opens a result: the conversation, scrolled to the message, its thread open for a reply. */
export function messageHref(m: { conversation_id: string; id: string; parent_id: string | null }): string {
  const q = new URLSearchParams({ m: m.id });
  if (m.parent_id) q.set("t", m.parent_id);
  return `/comms/c/${m.conversation_id}?${q.toString()}`;
}

export interface SearchHitMeta {
  conversation_kind: ConversationKind;
}
