// Resolve Hub ▸ Service Desk — row shapes and vocabulary. The contract is
// doc/resolve/service-desk-plan.md (§2 data, §3 functions); this file is its
// TypeScript half, so a column renamed there is renamed here in the same change.
// Client-safe and pure: screens import labels from here, check:resolve the rules.

import type { Priority, ServiceSource, ServiceStatus, TicketListRow } from "./types";

export const TICKET_TYPES = ["incident", "service", "change"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  incident: "Incident",
  service: "Service Request",
  change: "Change",
};

/** What the REQUESTER states — never a priority (plan §1.3). */
export const IMPACTS = ["cannot_work", "degraded", "request"] as const;
export type Impact = (typeof IMPACTS)[number];

export const IMPACT_LABEL: Record<Impact, string> = {
  cannot_work: "I cannot work at all",
  degraded: "Working with difficulty",
  request: "Just a request",
};

/** The priority each impact asks for, before the category's floor. */
export const IMPACT_PRIORITY: Record<Impact, Exclude<Priority, "urgent">> = {
  cannot_work: "high",
  degraded: "medium",
  request: "low",
};

/** Urgent first. The queue's order inside an override band (plan §3). */
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * The priority a new service ticket gets: the impact's, never below the
 * category's default. Urgent is unreachable here — it exists only by
 * override (plan §1.3). Mirrors `rh_sd_submit`; the database is the authority,
 * this is what the form says before it is sent.
 */
export function priorityForImpact(impact: Impact, categoryDefault: Exclude<Priority, "urgent">): Exclude<Priority, "urgent"> {
  const asked = IMPACT_PRIORITY[impact];
  return PRIORITY_RANK[asked] <= PRIORITY_RANK[categoryDefault] ? asked : categoryDefault;
}

/** Channels an agent logs a call from. `form` (the portal) is the requester's own. */
export const DESK_CHANNELS = ["phone", "email", "chat", "whatsapp"] as const;
export type DeskChannel = (typeof DESK_CHANNELS)[number];

export const SOURCE_LABEL: Record<ServiceSource, string> = {
  form: "Portal",
  phone: "Phone",
  email: "Email",
  chat: "Chat",
  whatsapp: "WhatsApp",
};

/** The two reasons an Urgent override may give (spec §3.2). */
export const OVERRIDE_KINDS = ["financial_risk", "executive_directive"] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

export const OVERRIDE_LABEL: Record<OverrideKind, string> = {
  financial_risk: "Financial risk",
  executive_directive: "Executive directive",
};

/** `SD-2026-000123` — one series whatever the type, so a receipt never changes. */
export const SERVICE_REF = /^SD-\d{4}-\d{6}$/;
export const KB_REF = /^KB-\d{6}$/;

export function isServiceRef(v: unknown): v is string {
  return typeof v === "string" && SERVICE_REF.test(v);
}

/** The words the requester's message goes out with when a technician pauses
 *  their ticket for an urgent one (plan §6). Editable in the Start sheet. */
export const PREEMPT_MESSAGE =
  "Hello — I have had to pause your request briefly to deal with an urgent, business-critical issue. " +
  "I will come back to it as soon as that is done. Thank you for your patience.";

// ---- SLA ---------------------------------------------------------------------

export type ResponseState = "met" | "pending" | "breached";
export type ResolutionState = "on_track" | "at_risk" | "breached" | "paused" | "done";

export type ServiceSla = {
  priority: Priority;
  response_minutes: number;
  resolution_minutes: number;
};

/** The seeded matrix (plan §1.4) — what a unit reads before anyone edits it. */
export const DEFAULT_SERVICE_SLA: readonly ServiceSla[] = [
  { priority: "urgent", response_minutes: 10, resolution_minutes: 30 },
  { priority: "high", response_minutes: 20, resolution_minutes: 60 },
  { priority: "medium", response_minutes: 30, resolution_minutes: 120 },
  { priority: "low", response_minutes: 60, resolution_minutes: 240 },
];

// ---- queue + boards (rh_sd_queue, rh_sd_shift_summary, rh_sd_dashboard) -------

export const DESK_QUEUE_TABS = ["unassigned", "mine", "team", "breaching", "all", "done"] as const;
export type DeskQueueTab = (typeof DESK_QUEUE_TABS)[number];

export const DESK_QUEUE_TAB_LABEL: Record<DeskQueueTab, string> = {
  unassigned: "Unassigned",
  mine: "Mine",
  team: "Team",
  breaching: "Breaching",
  all: "All",
  done: "Done",
};

/** One row of `rh_sd_queue` — already in queue order (overridden, priority, FIFO). */
export type DeskQueueRow = {
  id: string;
  ref_no: string;
  status: ServiceStatus;
  ticket_type: TicketType;
  title: string;
  priority: Priority;
  category_name: string | null;
  team_name: string | null;
  reporter_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  owner_name: string | null;
  created_at: string;
  response_due_at: string | null;
  first_response_at: string | null;
  due_at: string | null;
  paused_at: string | null;
  last_activity_at: string | null;
  overridden: boolean;
  override_kind: OverrideKind | null;
  response_state: ResponseState;
  resolution_state: ResolutionState;
  /** Resolution minutes left (negative = over). Null when no clock runs. */
  minutes_left: number | null;
  stale_days: number;
};

/** The "Start of shift" line on the Mine tab (spec §7.2). */
export type ShiftSummary = {
  carried_over: number;
  stale: number;
  breaching: number;
  new_since_last_shift: number;
};

export type TrendPoint = { d: string; created: number; resolved: number };

/** Why a ticket is on the dashboard's escalation list (`rh_sd_dashboard`). */
export type EscalationReason = "stale" | "resolution" | "response";

export const ESCALATION_REASON_LABEL: Record<EscalationReason, string> = {
  stale: "Untouched for days",
  resolution: "Resolution SLA missed",
  response: "Response SLA missed",
};

/** One of the ten most recent escalations — newest first. */
export type DeskEscalation = {
  id: string;
  ref_no: string;
  title: string;
  priority: Priority;
  reason: EscalationReason;
  at: string | null;
  assignee_name: string | null;
};

export type DeskDashboard = {
  open: number;
  unassigned: number;
  on_hold: number;
  at_risk: number;
  breached_response: number;
  breached_resolution: number;
  resolved_today: number;
  escalations: number;
  by_technician: {
    profile_id: string;
    name: string;
    assigned: number;
    in_progress: number;
    on_hold: number;
    breached: number;
  }[];
  by_priority: { priority: Priority; open: number }[];
  by_type: { ticket_type: TicketType; open: number }[];
  trend: { daily: TrendPoint[]; weekly: TrendPoint[]; monthly: TrendPoint[] };
  escalation_list: DeskEscalation[];
};

/** One technician's numbers, or the desk total (`profile_id` null). */
export type DeskPerformanceRow = {
  profile_id: string | null;
  name: string;
  resolved: number;
  avg_first_response_min: number | null;
  avg_resolution_min: number | null;
  response_met_pct: number | null;
  resolution_met_pct: number | null;
  csat_avg: number | null;
  csat_count: number;
  reopened: number;
  kb_authored: number;
};

// ---- intake ------------------------------------------------------------------

/** A category as the request FORM sees it (`rh_sd_categories_open`). */
export type OpenServiceCategory = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  ticket_type: TicketType;
};

export type ServiceReceipt = {
  ticket_id: string;
  ref_no: string;
  owner_name: string | null;
  team_name: string | null;
  priority: Priority;
  response_due_at: string | null;
  due_at: string | null;
  needs_sorting: boolean;
};

// ---- tickets -----------------------------------------------------------------

/** A service ticket in a listing (My Reports): the shared listing row, so
 *  one table can carry Broken and Service rows, plus the desk's own words. */
export type ServiceTicketRow = TicketListRow & {
  ticket_type: TicketType | null;
  category_code: string | null;
  response_state: ResponseState;
  resolution_state: ResolutionState;
  minutes_left: number | null;
};

/** What the ticket page adds for `kind = 'service'`, beside `getTicketDetail`. */
export type ServiceTicketExtras = {
  category: { id: string; code: string; name: string; ticket_type: TicketType } | null;
  kb_article: { id: string; code: string; title: string } | null;
  overridden_by_name: string | null;
  /** The urgent ticket this one was paused for. */
  preempted_by: { id: string; ref_no: string; title: string } | null;
  /** Tickets still on hold because of THIS one — "Resume it" after resolving. */
  paused_for_this: { id: string; ref_no: string; title: string }[];
  sla: ServiceSla;
  response_state: ResponseState;
  resolution_state: ResolutionState;
  minutes_left: number | null;
  /** Published articles that match the title — for the technician. */
  kb_suggestions: KbSearchHit[];
};

// ---- knowledge base ----------------------------------------------------------

export const KB_STATUSES = ["draft", "published", "retired"] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const KB_STATUS_LABEL: Record<KbStatus, string> = {
  draft: "Draft",
  published: "Published",
  retired: "Retired",
};

export type KbSearchHit = {
  id: string;
  code: string;
  title: string;
  problem: string;
  steps: string[];
  rank: number;
};

export type KbArticle = {
  id: string;
  code: string;
  title: string;
  problem: string;
  steps: string[];
  tags: string[];
  category_code: string | null;
  status: KbStatus;
  source_ticket_id: string | null;
  author_id: string | null;
  author_name: string | null;
  published_at: string | null;
  used_count: number;
  helpful_count: number;
  not_helpful_count: number;
  created_at: string;
  updated_at: string;
  /** The viewer's own feedback, if any. */
  my_feedback?: boolean | null;
};

export type KbListRow = Omit<KbArticle, "steps" | "my_feedback"> & { step_count: number };

// ---- administration ----------------------------------------------------------

export type ServiceCategory = {
  id: string;
  location_id: string;
  code: string;
  name: string;
  description: string | null;
  ticket_type: TicketType;
  team_id: string | null;
  default_priority: Exclude<Priority, "urgent">;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type ServiceCategoryRow = ServiceCategory & { team_name: string | null };

/** The desk's half of `rh_unit_settings` (plan §2). */
export type DeskUnitSettings = {
  desk_manager_id: string | null;
  sd_auto_close_days: number;
  sd_stale_remind_days: number;
  sd_stale_escalate_days: number;
  sd_reopen_days: number;
};

export const DEFAULT_DESK_SETTINGS: DeskUnitSettings = {
  desk_manager_id: null,
  sd_auto_close_days: 3,
  sd_stale_remind_days: 3,
  sd_stale_escalate_days: 4,
  sd_reopen_days: 7,
};
