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
  /** The resolution deadline — a service ticket's second clock. */
  due_at?: string | null;
  /** The activity row's action. One service event carries several (held ·
   *  resumed · cancelled all go out as `resolve.sd_update`), so the words
   *  follow the action, not only the key. */
  action?: string | null;
  /** A requirement's quantity and "needed by" word (today · week · month). */
  rq_qty?: number | null;
  rq_needed_by?: string | null;
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

// ---- Service Desk (service-desk-plan §4) -------------------------------------
//
// An IT request has no place and no sensitive subject, so its line is the ref
// and the title. Its clocks run in minutes, so the time that matters — respond
// by, resolve by — goes in the alert itself: the technician should not have
// to open the ticket to learn how long they have.

function isService(c: ResolveMessageContext): boolean {
  return c.kind === "service";
}

/** "SD-2026-000123 · PRINTER NOT WORKING" */
function sdWhat(c: ResolveMessageContext): string {
  // The outbox words a ticket it could not read as a sensitive complaint;
  // the desk's words must not undo that safe guess.
  if (hidesSubject(c)) return c.ref_no || "A request";
  return [c.ref_no, c.title].filter(Boolean).join(" · ") || "An IT request";
}

/** `IT request SD-… <rest>` — the ref is what people quote on the phone. */
function sdTitle(rest: string, c: ResolveMessageContext): string {
  return c.ref_no ? `IT request ${c.ref_no} ${rest}` : `An IT request ${rest}`;
}

/** The ticket line, then sentences; a sentence whose time is unknown is dropped. */
function sdBody(c: ResolveMessageContext, ...sentences: (string | null)[]): string {
  return [`${sdWhat(c)}.`, ...sentences.filter((x): x is string => !!x)].join(" ");
}

/** "Respond by 26/10/2026, 10:30 am." — null when the time is unknown. */
function by(label: string, iso: string | null | undefined): string | null {
  const t = istDateTime(iso);
  return t ? `${label} ${t}.` : null;
}

function minutesWord(m: number): string {
  const a = Math.abs(m);
  if (a < 60) return `${Math.max(1, Math.round(a))} min`;
  const h = Math.round(a / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

// ---- Requirements (Raagam Assist, 0751) --------------------------------------
//
// A Buy request has no place and no sensitive subject: its line is the ref,
// the item and how many — "REQ-2026-000123: MACHINE OIL ×5, needed this week".

const NEEDED_WORDS: Record<string, string> = { today: "today", week: "this week", month: "this month" };

function isRequirement(c: ResolveMessageContext): boolean {
  return c.kind === "requirement";
}

/** "MACHINE OIL ×5" — the qty from the ticket, else the created row's meta. */
function rqItem(c: ResolveMessageContext): string {
  // A ticket the outbox could not read is worded as a sensitive complaint:
  // the ref alone, never the subject.
  if (hidesSubject(c)) return "a request";
  const qty = c.rq_qty ?? num(c.meta.qty);
  const item = c.title || "an item";
  return qty ? `${item} ×${Number.isInteger(qty) ? qty : qty.toFixed(2)}` : item;
}

function rqNeeded(c: ResolveMessageContext): string | null {
  const w = c.rq_needed_by ?? (typeof c.meta.needed_by === "string" ? c.meta.needed_by : null);
  return w && NEEDED_WORDS[w] ? `needed ${NEEDED_WORDS[w]}` : null;
}

function daysWord(d: number | null): string {
  return d ? `${d} day${d === 1 ? "" : "s"}` : "days";
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
  "resolve.ticket_routed": (c) =>
    isRequirement(c)
      ? {
          title: `New request ${c.ref_no ?? ""}`.trim(),
          body: [`${c.ref_no ? `${c.ref_no}: ` : ""}${rqItem(c)}`, rqNeeded(c)].filter(Boolean).join(", "),
          type: "info",
        }
      : {
          title: "A problem was reported to you",
          body: what(c),
          type: "info",
        },
  "resolve.rq_update": (c) => {
    const line = `${c.ref_no ? `${c.ref_no}: ` : ""}${rqItem(c)}`;
    if (c.action === "rejected") {
      return {
        title: `Your request ${c.ref_no ?? ""} was rejected`.replace("  ", " "),
        body: c.note ? `${line}. Reason: ${c.note}` : `${line}.`,
        type: "warning",
      };
    }
    if (c.action === "fulfilled") {
      return {
        title: `Your request ${c.ref_no ?? ""} was given`.replace("  ", " "),
        body: c.note ? `${line}. ${c.note}` : `${line}.`,
        type: "success",
      };
    }
    return {
      title: `Your request ${c.ref_no ?? ""} was approved`.replace("  ", " "),
      body: c.note ? `${line}. ${c.note}` : `${line}. Stores will tell you when it is ready.`,
      type: "success",
    };
  },
  "resolve.dangerous": (c) => ({
    title: "DANGEROUS problem reported",
    body: `${what(c)}. Make it safe today.`,
    type: "danger",
  }),
  "resolve.assigned": (c) =>
    isService(c)
      ? {
          title: sdTitle(c.action === "claimed" ? "was claimed" : "was assigned", c),
          body: sdBody(c, by("Resolve by", c.due_at)),
          type: "info",
        }
      : {
          // Sent to the assignee AND the owner (a claim tells the owner), so neutral.
          title: "A job was assigned",
          body: what(c),
          type: "info",
        },
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
  "resolve.closed": (c) => {
    if (!isService(c)) {
      return { title: "The problem you reported is closed", body: what(c), type: "success" };
    }
    if (c.action === "auto_closed") {
      const days = num(c.meta.days);
      return {
        title: sdTitle("was closed", c),
        body: sdBody(c, `It was resolved and nobody confirmed or reopened it${days ? ` within ${daysWord(days)}` : ""}.`),
        type: "success",
      };
    }
    return {
      title: sdTitle("was confirmed fixed", c),
      body: sdBody(c, "The requester confirmed it, and it is closed."),
      type: "success",
    };
  },
  "resolve.disputed": (c) => ({
    title: "A fix was disputed — the job is open again",
    body: c.note ? `${what(c)}. Reason: ${c.note}` : what(c),
    type: "warning",
  }),
  "resolve.rated": (c) => {
    const stars = num(c.meta.stars);
    if (isService(c)) {
      return { title: sdTitle(stars ? `was rated ${stars} of 5` : "was rated", c), body: sdWhat(c), type: "success" };
    }
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
  // ---- Service Desk ---------------------------------------------------------
  "resolve.sd_new": (c) => ({
    // `created`, or a reclassify that re-routed it to another team.
    title: c.action === "reclassified" ? sdTitle("was moved to your team", c) : `New IT request ${c.ref_no ?? ""}`.trim(),
    body: sdBody(c, by("Respond by", c.response_due_at), by("Resolve by", c.due_at)),
    type: "info",
  }),
  "resolve.sd_reply": (c) => ({
    // The other side of the conversation — the requester, or the technician.
    title: `New reply on ${c.ref_no ?? "an IT request"}`,
    body: c.note ? `${sdWhat(c)}: “${c.note.length > 160 ? `${c.note.slice(0, 157)}…` : c.note}”` : sdWhat(c),
    type: "info",
  }),
  "resolve.sd_update": (c) => {
    if (c.action === "resumed") {
      return {
        title: `Work resumed on ${c.ref_no ?? "your IT request"}`,
        body: sdBody(c, by("Expected by", c.due_at)),
        type: "info",
      };
    }
    if (c.action === "cancelled") {
      return {
        title: `Your IT request ${c.ref_no ?? ""} was cancelled`.replace("  ", " "),
        body: sdBody(c, c.note ? `Reason: ${c.note}` : null),
        type: "warning",
      };
    }
    // held — the reason, or the courteous message when it was paused for an urgent one
    return {
      title: `Your IT request ${c.ref_no ?? ""} is on hold`.replace("  ", " "),
      body: sdBody(c, c.note),
      type: "warning",
    };
  },
  "resolve.sd_resolved": (c) => ({
    title: `Your IT request ${c.ref_no ?? ""} was resolved`.replace("  ", " "),
    body: sdBody(c, "Open it to confirm it is fixed, or reopen it if it is not."),
    type: "success",
  }),
  "resolve.sd_reopened": (c) => ({
    title: sdTitle("was reopened", c),
    body: sdBody(c, c.note ? `Still wrong: ${c.note}` : null, by("Resolve by", c.due_at)),
    type: "warning",
  }),
  "resolve.sd_urgent": (c) => ({
    title: sdTitle("is now URGENT", c),
    body: sdBody(c, c.note, by("Resolve by", c.due_at)),
    type: "danger",
  }),
  "resolve.sd_breach": (c) =>
    c.meta.clock === "response"
      ? {
          title: sdTitle("was not answered in time", c),
          body: sdBody(c, by("A response was due at", c.response_due_at)),
          type: "danger",
        }
      : {
          title: sdTitle("missed its resolution time", c),
          body: sdBody(c, by("It was due at", c.due_at)),
          type: "danger",
        },
  "resolve.sd_warning": (c) => {
    const m = num(c.meta.minutes_left);
    return {
      title: m != null && m >= 0 ? sdTitle(`is due in ${minutesWord(m)}`, c) : sdTitle("is close to its deadline", c),
      body: sdBody(c, by("Resolve by", c.due_at)),
      type: "warning",
    };
  },
  "resolve.sd_stale": (c) => {
    const span = daysWord(num(c.meta.days));
    return c.meta.level === "escalate"
      ? {
          title: sdTitle(`has had no activity for ${span}`, c),
          body: sdBody(c, "Nobody has worked on it, so it has been escalated to you."),
          type: "danger",
        }
      : {
          title: `Reminder: ${sdTitle(`has had no activity for ${span}`, c)}`,
          body: sdBody(c, "Pick it up, or put it on hold with a reason."),
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
