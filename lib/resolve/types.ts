// Resolve Hub — shared row shapes and vocabulary. The contract is
// doc/resolve/resolve-hub-plan.md; this file is its TypeScript half, so a
// column renamed there is renamed here in the same change.

export const TICKET_KINDS = ["broken", "complaint", "requirement", "service"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const BROKEN_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "fixed",
  "closed",
  "cancelled",
  "withdrawn",
] as const;
export type BrokenStatus = (typeof BROKEN_STATUSES)[number];

/** Statuses that still owe work — "open" in every count on screen. */
export const ACTIVE_STATUSES: readonly BrokenStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "fixed",
];

/** Complaint statuses (plan §10). `open`, `in_progress` and `withdrawn` are
 *  shared words with Broken; the other three are complaint-only. */
export const COMPLAINT_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "escalated",
  "resolved",
  "withdrawn",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Service Desk statuses (doc/resolve/service-desk-plan.md §1.1). `open` is
 *  shown as "New" on a service ticket — SERVICE_STATUS_LABEL, never STATUS_LABEL. */
export const SERVICE_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "resolved",
  "closed",
  "cancelled",
  "withdrawn",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Service statuses that still owe the desk work. Resolved is not one: it
 *  waits on the requester to confirm or reopen. */
export const ACTIVE_SERVICE_STATUSES: readonly ServiceStatus[] = ["open", "assigned", "in_progress", "on_hold"];

/** Requirement (Buy) statuses (0751). `open` reads "Pending" — RQ_STATUS_LABEL
 *  in assist-types.ts, never STATUS_LABEL's "Open". */
export const REQUIREMENT_STATUSES = ["open", "approved", "rejected", "fulfilled", "withdrawn"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** Any ticket's status — a row's `kind` says which list it comes from. */
export type TicketStatus = BrokenStatus | ComplaintStatus | ServiceStatus | RequirementStatus;

/** Complaint statuses that still owe a response or a resolution. */
export const ACTIVE_COMPLAINT_STATUSES: readonly ComplaintStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "escalated",
];

/** Every status word, both kinds (widened for Stage 2 — keys only added). */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  fixed: "Fixed",
  closed: "Closed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  assigned: "Assigned",
  escalated: "Escalated",
  resolved: "Resolved",
  on_hold: "On Hold",
  approved: "Approved",
  rejected: "Rejected",
  fulfilled: "Given",
};

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In Progress",
  escalated: "Escalated",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
};

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  open: "New",
  assigned: "Assigned",
  in_progress: "In Progress",
  on_hold: "On Hold",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

export type Severity = "critical" | "high" | "medium" | "low";
export type Priority = "urgent" | "high" | "medium" | "low";
export type TicketSource = "form" | "qr" | "ai";
/** Where a service ticket came in (`form` = the portal). Kept apart from
 *  TicketSource so Broken's per-source maps stay exhaustive; phone / email /
 *  chat / WhatsApp are recorded words only — no provider exists in this app. */
export type ServiceSource = "form" | "phone" | "email" | "chat" | "whatsapp";
export type ClosureKind =
  | "auto_photo"
  | "spot_checked"
  | "owner_confirmed"
  | "requester_confirmed"
  | "auto_timeout";
export type PlaceKind = "building" | "floor" | "room" | "area" | "machine" | "asset";
export type NoteVisibility = "internal" | "reporter";

/** Every action `rh_ticket_actions` can return — the next-action panel
 *  renders exactly this list and never re-derives permissions itself. */
export const TICKET_ACTIONS = [
  "claim",
  "assign",
  "start",
  "block",
  "unblock",
  "fix",
  "spot_check",
  "owner_confirm",
  "dispute",
  "cancel",
  "withdraw",
  "edit_report",
  "reclassify",
  "note_internal",
  "note_reporter",
  "rate",
  "join",
  // complaints (plan §10.5)
  "c_assign",
  "c_start",
  "c_resolve",
  "c_withdraw",
  // service desk (service-desk-plan §3)
  "sd_claim",
  "sd_assign",
  "sd_start",
  "sd_hold",
  "sd_resume",
  "sd_resolve",
  "sd_confirm",
  "sd_reopen",
  "sd_override",
  "sd_reclassify",
  "sd_cancel",
  "sd_withdraw",
  "kb_draft",
  // requirements (0751)
  "rq_approve",
  "rq_reject",
  "rq_fulfil",
  "rq_withdraw",
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export type Ticket = {
  id: string;
  location_id: string;
  kind: TicketKind;
  ref_no: string;
  status: TicketStatus;
  reporter_id: string | null;
  place_id: string | null;
  trade_id: string | null;
  title: string;
  description: string | null;
  is_dangerous: boolean;
  severity: Severity;
  priority: Priority;
  is_routine: boolean;
  source: TicketSource | ServiceSource;
  gps_lat: number | null;
  gps_lng: number | null;
  owner_id: string | null;
  owner_reason: string | null;
  team_id: string | null;
  assignee_id: string | null;
  due_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  blocked_reason: string | null;
  fix_round: number;
  dispute_count: number;
  reopen_count: number;
  fixed_at: string | null;
  closed_at: string | null;
  closure_kind: ClosureKind | null;
  spot_check_pending: boolean;
  cancel_reason: string | null;
  needs_sorting: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // complaint + service clocks (0745); optional because a Broken row's
  // callers never read them
  response_due_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  withdrawn_at?: string | null;
  // service desk (service-desk-plan §2) — null on every other kind
  ticket_type?: "incident" | "service" | "change" | null;
  impact?: "cannot_work" | "degraded" | "request" | null;
  sd_category_id?: string | null;
  root_cause?: string | null;
  kb_article_id?: string | null;
  override_kind?: "financial_risk" | "executive_directive" | null;
  override_note?: string | null;
  overridden_at?: string | null;
  overridden_by?: string | null;
  /** This ticket was put on hold for that (urgent) one. */
  preempted_by?: string | null;
  last_activity_at?: string | null;
  stale_reminded_at?: string | null;
  stale_escalated_at?: string | null;
  sla_warned_at?: string | null;
  response_breached_at?: string | null;
  resolution_breached_at?: string | null;
  // Raagam Assist (0751) — the catalog problem; the rq_* fields only on a requirement
  catalog_item_id?: string | null;
  rq_qty?: number | null;
  rq_needed_by?: "today" | "week" | "month" | null;
  rq_reason?: "ran_out" | "broken" | "new_joiner" | "new_work" | "other" | null;
  rq_decided_note?: string | null;
};

/** A ticket as listings show it: names resolved, never a bare uuid. */
export type TicketListRow = Ticket & {
  place_name: string | null;
  trade_name: string | null;
  owner_name: string | null;
  assignee_name: string | null;
  reporter_name: string | null;
  team_name: string | null;
  is_late: boolean;
  joiners: number;
  // complaints (null / false on a Broken ticket)
  category_name: string | null;
  is_anonymous: boolean;
  about_superior: boolean;
  is_sensitive: boolean;
  resolution_message: string | null;
  response_due_at: string | null;
};

export type TicketPhoto = {
  id: string;
  ticket_id: string;
  kind: "report" | "fix";
  fix_round: number;
  path: string;
  /** Signed URL, minted server-side after the ticket read passed RLS. */
  url: string | null;
  created_at: string;
};

export type TicketActivity = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  note: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type TicketNote = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  visibility: NoteVisibility;
  created_at: string;
};

export type TicketDetail = {
  ticket: TicketListRow;
  photos: TicketPhoto[];
  activity: TicketActivity[];
  notes: TicketNote[];
  actions: TicketAction[];
  /** False when the viewer is only the reporter/joiner — hides internal data. */
  isStaff: boolean;
  myRating: { stars: number; comment: string | null } | null;
};

export type SubmitReceipt = {
  ticket_id: string;
  ref_no: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_reason: string | null;
  due_at: string | null;
  needs_sorting: boolean;
};

export type SimilarTicket = {
  id: string;
  ref_no: string;
  title: string;
  status: BrokenStatus;
  is_dangerous: boolean;
  created_at: string;
  joiners: number;
};

export type PlaceByToken = {
  place_id: string;
  name: string;
  location_id: string;
  location_name: string;
  caretaker_name: string | null;
  recent_90d: number;
};

export type Trade = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type Place = {
  id: string;
  location_id: string;
  code: string;
  name: string;
  kind: PlaceKind;
  parent_id: string | null;
  asset_id: string | null;
  caretaker_id: string | null;
  default_trade_id: string | null;
  qr_token: string | null;
  qr_printed_at: string | null;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type Team = {
  id: string;
  location_id: string;
  trade_id: string;
  name: string;
  lead_id: string | null;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type TeamMember = {
  id: string;
  team_id: string;
  profile_id: string;
  active: boolean;
};

export type RoutingOverride = {
  id: string;
  location_id: string;
  trade_id: string | null;
  place_id: string | null;
  owner_id: string;
  note: string | null;
};

export type TriageWeights = {
  severity: Record<Severity, number>;
  priority: Record<Priority, number>;
  per_day_open: number;
  age_cap: number;
  reopened: number;
  disputed: number;
  repeated: number;
  unassigned: number;
};

export type UnitSettings = {
  location_id: string;
  unit_head_id: string | null;
  estate_owner_id: string | null;
  director_ids: string[];
  timezone: string;
  escalation_hour: number;
  ordinary_days: number;
  routine_days: number;
  purchase_days: number;
  dup_window_days: number;
  dispute_window_days: number;
  report_limit_24h: number;
  spot_check_one_in: number;
  page_cap_per_day: number;
  suppress_notifications: boolean;
  triage_weights: TriageWeights;
  /** The independent handler for "about my superior" complaints (plan §10.4). */
  superior_handler_id: string | null;
  complaint_response_hours: number;
  /** Raagam Assist (0751): who a Buy requirement goes to (else the Unit Head). */
  requirement_owner_id: string | null;
  /** Said by the chat before a gas / fire / shock item: who to call NOW. */
  emergency_contact: string | null;
};

export type TriageRow = TicketListRow & {
  score: number;
  score_parts: { label: string; points: number }[];
};

export type WorkloadRow = {
  team_id: string | null;
  team_name: string | null;
  profile_id: string | null;
  name: string | null;
  open: number;
  in_progress: number;
  blocked: number;
  overdue: number;
};

export type ResolveAnalytics = {
  totals: {
    total: number;
    open: number;
    late: number;
    blocked: number;
    fixed: number;
    closed: number;
    reopened: number;
    disputed: number;
  };
  verified_fix_rate: number | null;
  reopen_rate: number | null;
  median_days_to_fix: number | null;
  avg_resolution_days: number | null;
  weekly: { week_start: string; created: number; fixed: number }[];
  late_by_place: { place_id: string; place_name: string; late: number }[];
  repeats: { place_name: string; trade_name: string; count: number }[];
  top_closers: { profile_id: string; name: string; closed: number }[];
  top_overdue: { profile_id: string; name: string; overdue: number }[];
  by_source: { source: TicketSource; count: number }[];
};

// ---- complaints (plan §10) --------------------------------------------------

export type ComplaintCategory = {
  id: string;
  location_id: string;
  code: string;
  name: string;
  description: string | null;
  is_sensitive: boolean;
  anonymous_allowed: boolean;
  handler_id: string | null;
  response_hours: number;
  inactive: boolean;
  created_by: string | null;
  created_at: string;
};

export type CategoryMemberRole = "committee" | "oversight";

export type CategoryMember = {
  id: string;
  category_id: string;
  profile_id: string;
  role: CategoryMemberRole;
};

/** A category as the complaint FORM sees it (`rh_complaint_categories_open`). */
export type OpenComplaintCategory = {
  id: string;
  name: string;
  description: string | null;
  is_sensitive: boolean;
  anonymous_allowed: boolean;
};

export type ComplaintReceipt = {
  /** NULL when anonymous — nothing ties the complaint to the person. */
  ticket_id: string | null;
  ref_no: string;
  /** Anonymous only, shown ONCE: only its hash is stored. */
  tracking_token: string | null;
  handler_name: string | null;
  response_due_at: string | null;
};

/** Everything the public tracking page may show — exactly these keys. */
export type TrackedComplaint = {
  ref_no: string;
  subject: string;
  status: ComplaintStatus;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  withdrawn_at: string | null;
  resolution_message: string | null;
};
