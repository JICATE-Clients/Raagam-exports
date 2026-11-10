import { z } from "zod";

/** HR ▸ Events (0823) — shared by the screen, the service and the actions. */

export type EventStatus = "scheduled" | "cancelled";
export type GuestReply = "needsAction" | "accepted" | "declined" | "tentative";

export const REPLY_LABEL: Record<GuestReply, string> = {
  needsAction: "No reply",
  accepted: "Yes",
  declined: "No",
  tentative: "Maybe",
};

export type EventGuest = {
  id: string;
  staff_id: string | null;
  worker_id: string | null;
  email: string;
  response_status: GuestReply;
  person_name: string;
  person_code: string | null;
};

export type HrEvent = {
  id: string;
  code: string | null;
  location_id: string;
  title: string;
  description: string | null;
  venue: string | null;
  starts_at: string;
  ends_at: string;
  add_meet: boolean;
  status: EventStatus;
  cancel_reason: string | null;
  organizer_user_id: string | null;
  organizer_email: string | null;
  google_event_id: string | null;
  google_html_link: string | null;
  google_meet_link: string | null;
  created_at: string;
  created_by: string | null;
  guests: EventGuest[];
};

/** A person HR can invite: staff or worker, with the email Google will use. */
export type InvitablePerson = {
  key: string; // "staff:<id>" | "worker:<id>"
  kind: "staff" | "worker";
  id: string;
  code: string | null;
  name: string;
  email: string | null;
};

const HHMM = /^\d{2}:\d{2}$/;

export const eventInput = z
  .object({
    title: z.string().trim().min(1, "Name the event").transform((s) => s.toUpperCase()),
    description: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    venue: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date"),
    from: z.string().regex(HHMM, "Enter the start time"),
    to: z.string().regex(HHMM, "Enter the end time"),
    add_meet: z.boolean().default(false),
    guests: z.array(z.string().regex(/^(staff|worker):[0-9a-f-]{36}$/)).min(1, "Invite at least one person"),
  })
  .refine((v) => v.to > v.from, { message: "It ends before it starts" });
export type EventInput = z.input<typeof eventInput>;

/** Factory time → a timestamptz literal. India has no daylight saving. */
export const istTimestamp = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;

/** A stored timestamp → its date and HH:mm in factory time, for the editor. */
export function istParts(iso: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  const hour = p("hour") === "24" ? "00" : p("hour");
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${hour}:${p("minute")}` };
}
