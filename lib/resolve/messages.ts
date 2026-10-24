import type { NotificationEventKey } from "@/lib/notifications/events";

/*
 * What each Resolve Hub alert SAYS — pure, so check:resolve can read every one.
 * The outbox drain looks a row's `event_key` up here; a key the database
 * writes that is not in this map is marked failed rather than sent with a
 * made-up title.
 *
 * Wording rules: the ref number first (it is what people quote on the phone),
 * the place second, never a uuid, and a disputed notice NEVER names who
 * disputed — the reporter must be able to say "this is not fixed" without
 * the fixer learning who said it.
 */

export type ResolveMessageContext = {
  ref_no: string | null;
  title: string | null;
  place_name: string | null;
  /** The activity row's note (a block reason, a dispute reason, a fix note). */
  note: string | null;
  /** The activity / outbox meta — `days_late`, `stars`, `tickets` for a digest. */
  meta: Record<string, unknown>;
  /** "complaint" switches on the complaint wording rules below. */
  kind?: string | null;
  /** The complaint's category is sensitive. UNKNOWN (undefined/null) on a
   *  complaint is treated as sensitive — the safe guess. */
  is_sensitive?: boolean | null;
  response_due_at?: string | null;
};

export type ResolveMessage = {
  title: string;
  body: string;
  type: "info" | "success" | "warning" | "danger";
};

/** A complaint whose subject may not be printed: sensitive, or not known. */
export function hidesSubject(c: Pick<ResolveMessageContext, "kind" | "is_sensitive">): boolean {
  return c.kind === "complaint" && c.is_sensitive !== false;
}

/**
 * A deadline in the business's clock. Written here rather than through
 * fmtDateTime because this runs on the SERVER, whose clock is UTC on Vercel —
 * fmtDateTime would print "respond by 4:30 am" for a 10:00 am deadline.
 * Same DD/MM/YYYY, h:mm am shape.
 */
export function istDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
}

function what(c: ResolveMessageContext): string {
  // Never a complaint's reporter (the context does not even carry one), and
  // never a sensitive complaint's subject — the ref number alone.
  if (hidesSubject(c)) return c.ref_no || "A complaint";
  const head = [c.ref_no, c.title].filter(Boolean).join(" · ");
  return c.place_name ? `${head} — ${c.place_name}` : head || "A reported problem";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const RESOLVE_MESSAGES = {
  "resolve.complaint_new": (c) => {
    const due = istDateTime(c.response_due_at);
    const by = due ? `, respond by ${due}` : "";
    return hidesSubject(c)
      ? { title: `New sensitive complaint ${c.ref_no ?? ""}${by}`.trim(), body: "Open it in Resolve Hub ▸ Complaints.", type: "warning" }
      : { title: `New complaint ${c.ref_no ?? ""}${by}`.trim(), body: what(c), type: "warning" };
  },
  "resolve.complaint_escalated": (c) => ({
    title: `Complaint ${c.ref_no ?? ""} was not answered in time`.replace("  ", " "),
    body: hidesSubject(c) ? "It has been escalated to you. Open it in Resolve Hub ▸ Complaints." : `${what(c)}. It has been escalated to you.`,
    type: "danger",
  }),
  "resolve.complaint_resolved": (c) => ({
    title: `Your complaint ${c.ref_no ?? ""} was resolved`.replace("  ", " "),
    body: "Open it to read the response.",
    type: "success",
  }),
  "resolve.ticket_routed": (c) => ({
    title: "A problem was reported to you",
    body: what(c),
    type: "info",
  }),
  "resolve.dangerous": (c) => ({
    title: "DANGEROUS problem reported",
    body: `${what(c)}. Make it safe today.`,
    type: "danger",
  }),
  "resolve.assigned": (c) => ({
    // Sent to the assignee AND the owner (a claim tells the owner), so neutral.
    title: "A job was assigned",
    body: what(c),
    type: "info",
  }),
  "resolve.joined": (c) => ({
    title: "Someone else reported the same problem",
    body: what(c),
    type: "info",
  }),
  "resolve.fixed": (c) => ({
    title: "The problem you reported was fixed",
    body: `${what(c)}. If it is not fixed, open it and say so.`,
    type: "success",
  }),
  "resolve.closed": (c) => ({
    title: "The problem you reported is closed",
    body: what(c),
    type: "success",
  }),
  "resolve.disputed": (c) => ({
    title: "A fix was disputed — the job is open again",
    body: c.note ? `${what(c)}. Reason: ${c.note}` : what(c),
    type: "warning",
  }),
  "resolve.rated": (c) => {
    const stars = num(c.meta.stars);
    return {
      title: stars ? `Your fix was rated ${stars} of 5` : "Your fix was rated",
      body: what(c),
      type: "success",
    };
  },
  "resolve.overdue": (c) => {
    const days = num(c.meta.days_late) ?? num(c.meta.level);
    return {
      title: days ? `A job is ${days} day${days === 1 ? "" : "s"} overdue` : "A job is overdue",
      body: what(c),
      type: "warning",
    };
  },
  "resolve.digest": (c) => {
    const n = num(c.meta.count) ?? (Array.isArray(c.meta.tickets) ? c.meta.tickets.length : null);
    return {
      title: n ? `${n} job${n === 1 ? " is" : "s are"} a week or more overdue` : "Jobs a week or more overdue",
      body: "Open Resolve Hub ▸ All Jobs, filtered to overdue, to see them.",
      type: "warning",
    };
  },
} as const satisfies Partial<Record<NotificationEventKey, (c: ResolveMessageContext) => ResolveMessage>>;

export type ResolveEventKey = keyof typeof RESOLVE_MESSAGES;

export function isResolveEvent(key: string): key is ResolveEventKey {
  return Object.prototype.hasOwnProperty.call(RESOLVE_MESSAGES, key);
}

/** Where the alert opens: the ticket, or All Jobs (overdue) for a digest. */
export function resolveHref(key: ResolveEventKey, ticketId: string | null): string {
  if (key === "resolve.digest" || !ticketId) return "/resolve/jobs?overdue=1";
  return `/resolve/tickets/${ticketId}`;
}
