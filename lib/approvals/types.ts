// Types for the dynamic approval engine.
//
// These mirror the SQL in assets/sql/01_core_schema.sql. If you change a step
// field here, change approval_validate_steps() there too — the trigger is the
// real contract; this file is a convenience.

// ─── Criteria DSL ───────────────────────────────────────────────────────────
// A FLAT AND-of-conditions. Deliberately not a nested boolean tree: when you
// need OR, add a second flow at a higher priority. That keeps the matcher
// explainable in the admin UI, which is worth more than expressiveness.

export type CriteriaOperator = 'in' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';

export type CriteriaCondition =
  | string
  | number
  | boolean
  | { in: (string | number | boolean)[] }
  | { ne: string | number | boolean }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number };

/** `{}` matches anything — that is the fallback flow. */
export type ApprovalCriteria = Record<string, CriteriaCondition>;

/** The values a criteria object is matched against at run-start time. */
export type ApprovalContext = Record<string, unknown>;

/** Passed to the RBAC shim for every role lookup on this run. */
export type ApprovalScope = Record<string, string>;

// ─── Steps ──────────────────────────────────────────────────────────────────

export type StepType = 'review' | 'final';
export type StepMode = 'sequential' | 'parallel'; // 'parallel' is Tier 2
export type SlaBreachAction = 'none' | 'notify' | 'escalate'; // Tier 2

export interface ApprovalStep {
  /** 1-based and contiguous. Enforced by a DB trigger, not by convention. */
  step_order: number;
  /** Machine key, e.g. 'hod_review'. Optional but useful in the event log. */
  step_key?: string;
  /** Human label. Required. */
  step_label: string;
  step_type?: StepType;

  // ── Approver sources. At least one is required. ──
  // Precedence when several are set: named users and role holders and resolver
  // results are UNIONed. Named users do not suppress the role — if you want
  // "only these people", leave approver_role_key empty.
  /** A role key resolved through approval_rbac_users_with_role. */
  approver_role_key?: string | null;
  /** Explicit users. OR logic — first to act wins. */
  approver_user_ids?: string[];
  /** Host-specific resolver, e.g. 'reporting_manager'. Must be implemented in 00_rbac_shim.sql. */
  approver_resolver?: string | null;

  /** Additionally demand a permission key from whoever acts. */
  required_permission?: string | null;
  /** Default false. Blocking self-approval in the DB is the point. */
  allow_self_approve?: boolean;

  /** Where a 'return' sends the run. Must be strictly earlier; enforced by trigger. */
  on_return_restart_from_step?: number;

  // ── Tier 2 ──
  mode?: StepMode;
  min_approvals?: number;

  /**
   * HOW LONG THIS STEP HAS, IN MINUTES (0601).
   *
   * MINUTES, AND THE SKILL SHIPS HOURS. `doc/order/newfeature.md` §3 states the
   * SLA as "configurable (e.g. 30–120 mins)", so minutes is the unit the
   * business speaks. Hours could carry it as `0.5`, but then the admin field
   * would say one thing and the stored declaration another, and something in
   * between would convert — two vocabularies for one fact.
   *
   * `sla_hours` USED TO BE HERE AND WAS READ BY NOTHING, which is the state the
   * skill warns about by name: "a column no code reads is worse than a missing
   * one: it lies to the admin who set it". It was removed in the same change
   * that made this one real rather than left beside it, because two fields
   * competing to be the one that works is that same lie with a second door.
   *
   * Enforced by `approval_validate_steps` (0601): a positive NUMBER, never a
   * string, refused at flow-save time where the admin is looking.
   */
  sla_minutes?: number;
  /**
   * What happens when the deadline passes. Default `notify`.
   *
   * `escalate` is REFUSED on the last step — there is nowhere above it to go,
   * so the setting would be a policy that never fires. `approval_sweep_sla`
   * additionally declines to escalate into a step whose role has no holders:
   * escalating into a void is the stranding bug wearing a different hat.
   */
  on_sla_breach?: SlaBreachAction;
  /**
   * TELL THE APPROVER WHO MISSED THIS STEP THAT IT HAS MOVED ON (0603).
   *
   * DEFAULT FALSE, and absent means false. The user chose that default
   * explicitly after reviewing the alternative: "If managers feel penalized or
   * nagged by SLA breach notifications, they tend to blindly hit Approve just
   * to clear the notification clock — defeating the purpose of budget
   * oversight." The escalation already unblocks the factory, and the missed
   * approver's own queue updates itself, so they cannot act on a stale item.
   *
   * ## A STEP PROPERTY, NOT AN APP SETTING
   *
   * It sits here with `sla_minutes` and `on_sla_breach` because a run FREEZES
   * its steps: a policy on the step travels with the request, so a budget
   * escalating tonight behaves the way the flow said when it was submitted. A
   * global switch read at sweep time would change the rules under every request
   * already in flight — the precise failure `steps_snapshot` exists to prevent.
   *
   * ## ONLY MEANINGFUL BESIDE `escalate`
   *
   * `approval_validate_steps` (0603) REFUSES `true` on any other breach action.
   * On a reminder those same people are already the ones being told, and on
   * `none` the admin has said chase nobody — either way the flag would be a
   * policy that never fires.
   */
  notify_missed_approver?: boolean;
}

// ─── Flows ──────────────────────────────────────────────────────────────────

export interface ApprovalFlow {
  id: string;
  workflow_key: string;
  flow_name: string;
  description: string | null;
  tenant_id: string | null;
  /**
   * THE ONE SCOPE DIMENSION IN RAAGAM: the unit (0501).
   *
   * The skill ships `scope_a_id / scope_b_id / scope_c_id` here to be renamed
   * with the schema's, and renaming them in only one of the two places is the
   * bug this comment exists to stop: PostgREST rejects an unknown column, so a
   * `scope_a_id` left in the save payload makes EVERY flow save fail with a
   * message about a column nobody has heard of. `service.ts`'s `saveFlow` was
   * carrying exactly that until this rename went through both files.
   *
   * NULL is the wildcard and the normal case — "this is how the business
   * approves, everywhere". Set it only to give one unit a different chain.
   */
  location_id: string | null;
  criteria: ApprovalCriteria;
  steps: ApprovalStep[];
  /** Lower wins. One ordering, on purpose. */
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type ApprovalFlowDraft = Omit<
  ApprovalFlow,
  'id' | 'created_at' | 'updated_at' | 'created_by'
> & { id?: string };

// ─── Runs ───────────────────────────────────────────────────────────────────

export type RunStatus = 'in_progress' | 'completed' | 'rejected' | 'cancelled';
export type RunAction = 'approve' | 'reject' | 'return';

export interface ApprovalRun {
  id: string;
  workflow_key: string;
  subject_table: string;
  subject_id: string;
  flow_id: string;
  /** FROZEN at start. Never re-read the flow to "keep this current". */
  steps_snapshot: ApprovalStep[];
  context: ApprovalContext;
  scope: ApprovalScope;
  tenant_id: string | null;
  /** 1-based, always. */
  current_step: number;
  status: RunStatus;
  /** Send this back with every act() call. */
  lock_version: number;
  requested_by: string;
  started_at: string;
  completed_at: string | null;
  final_actor_id: string | null;
}

// ─── can_act verdict ────────────────────────────────────────────────────────

export type CanActReason =
  | 'assigned'
  | 'super_admin_override'
  | 'not_an_approver'
  | 'missing_permission'
  | 'no_user'
  | 'run_not_found'
  | 'run_completed'
  | 'run_rejected'
  | 'run_cancelled';

export interface CanActVerdict {
  can_act: boolean;
  reason: CanActReason;
  is_override?: boolean;
  step_order?: number;
  step_label?: string;
  required_permission?: string;
  lock_version?: number;
  status?: RunStatus;
}

// ─── Queue and timeline ─────────────────────────────────────────────────────

export interface QueueItem {
  run_id: string;
  workflow_key: string;
  subject_table: string;
  subject_id: string;
  step_order: number;
  step_label: string;
  requested_by: string;
  started_at: string;
  waiting_hours: number;
  lock_version: number;
  /**
   * When the CURRENT step is due (0601). NULL = this step declares no SLA, which
   * is the normal case and is not "on time" — it is "no deadline was set".
   *
   * Carried on the queue row rather than fetched beside it: a second read of
   * `approval_runs` for the same rows would be a second predicate to keep in
   * step with the queue's, and the engine's whole shape is ONE predicate with
   * two readers.
   */
  sla_due_at: string | null;
  /** Set once the sweeper has seen it pass. Clears again on the next step. */
  sla_breached_at: string | null;
  /**
   * PAST ITS DEADLINE, ANSWERED IN SQL.
   *
   * Not derived on the client from `sla_due_at`: `Date.now()` during a React
   * render is impure (the React Compiler refuses it), and it is the wrong clock
   * besides — a phone whose time is days out would paint half the queue red.
   * This is the same `now()` `approval_sweep_sla` breaches by, so the colour on
   * a card and the escalation that follows it cannot disagree.
   *
   * FALSE also covers "no deadline was set", which is NOT "on time".
   */
  is_overdue: boolean;
  /** Same on every row — the RPC returns the total rather than shipping a
   *  second count RPC whose predicate could drift from this one. */
  total_count: number;
}

export type EventAction =
  | 'submit' | 'approve' | 'reject' | 'return'
  | 'cancel' | 'delegate' | 'sla_breach';

export interface TimelineRow {
  step_order: number;
  step_label: string;
  step_key: string | null;
  /** Role key, resolver name, 'named approver(s)' or 'unassigned'. */
  approver_hint: string;
  is_current: boolean;
  action: EventAction | null;
  actor_id: string | null;
  is_override: boolean;
  comment: string | null;
  acted_at: string | null;
}

export interface StrandedRun {
  run_id: string;
  workflow_key: string;
  subject_table: string;
  subject_id: string;
  current_step: number;
  step_label: string | null;
  started_at: string;
  age: string;
}
