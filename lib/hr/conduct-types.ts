import type { StatusTone } from "@/lib/ui/status-tone";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * HR ▸ Conduct & Policies (0791) — the MyJKKN memo, disciplinary and policy
 * port. Shared shapes and words. Every rule here is also a rule in SQL (cd_*
 * functions and triggers); these only let the screen say it first.
 */

/** A memo "issued" waits on the person (warning); "disputed" needs HR (danger);
 *  a case "active" is moving (info); a policy version "published" is in force
 *  (success). */
const CONDUCT_OVERRIDES = {
  issued: "warning",
  acknowledged: "info",
  disputed: "danger",
  active: "info",
  published: "success",
  pending_approval: "warning",
} as const;

export function conductTone(status: string): StatusTone {
  return statusTone(status, CONDUCT_OVERRIDES);
}
export function conductLabel(status: string): string {
  if (status === "pending_approval") return "Awaiting approval";
  if (status === "active") return "Open";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export const POLICY_BUCKET = "hr-policy-docs";
export const POLICY_MAX_BYTES = 10 * 1024 * 1024;

type Opt<K extends string> = { value: K; label: string };

// ─── Memos ─────────────────────────────────────────────────────────────────

export type MemoType = "late_coming" | "absence" | "leave_without_approval" | "misconduct" | "performance" | "safety" | "other";
export const MEMO_TYPES: Opt<MemoType>[] = [
  { value: "late_coming", label: "Late coming" },
  { value: "absence", label: "Absence" },
  { value: "leave_without_approval", label: "Leave without approval" },
  { value: "misconduct", label: "Misconduct" },
  { value: "performance", label: "Performance" },
  { value: "safety", label: "Safety" },
  { value: "other", label: "Other" },
];
export type MemoStatus = "issued" | "acknowledged" | "disputed" | "resolved" | "withdrawn";

export type Memo = {
  id: string;
  code: string | null;
  location_id: string;
  staff_id: string | null;
  worker_id: string | null;
  person_kind: "staff" | "worker";
  person_name: string;
  person_code: string | null;
  memo_type: MemoType;
  subject: string;
  body: string;
  incident_date: string | null;
  issued_on: string;
  reply_by: string | null;
  status: MemoStatus;
  ack_at: string | null;
  ack_mode: "self" | "hr" | null;
  ack_note: string | null;
  dispute_reason: string | null;
  disputed_at: string | null;
  resolution_note: string | null;
  counts: boolean;
  resolved_at: string | null;
  withdrawn_reason: string | null;
  case_id: string | null;
  case_code: string | null;
  created_at: string;
  created_by: string | null;
};

export type MemoEvent = { id: string; from_status: string | null; to_status: string; note: string | null; at: string; actor: string | null };

export type MemoDraft = {
  person: string;
  memo_type: MemoType | "";
  subject: string;
  body: string;
  incident_date: string;
  issued_on: string;
  reply_by: string;
};

export function memoTypeLabel(t: string): string {
  return MEMO_TYPES.find((x) => x.value === t)?.label ?? t;
}

// ─── Disciplinary cases ────────────────────────────────────────────────────

export type CaseCategory = "misconduct" | "attendance" | "insubordination" | "harassment" | "theft" | "safety" | "negligence" | "other";
export const CASE_CATEGORIES: Opt<CaseCategory>[] = [
  { value: "misconduct", label: "Misconduct" },
  { value: "attendance", label: "Attendance" },
  { value: "insubordination", label: "Insubordination" },
  { value: "harassment", label: "Harassment" },
  { value: "theft", label: "Theft" },
  { value: "safety", label: "Safety" },
  { value: "negligence", label: "Negligence" },
  { value: "other", label: "Other" },
];
export type CaseStage = "initiated" | "enquiry" | "hearing" | "decision";
export const CASE_STAGES: Opt<CaseStage>[] = [
  { value: "initiated", label: "Initiated" },
  { value: "enquiry", label: "Enquiry" },
  { value: "hearing", label: "Hearing" },
  { value: "decision", label: "Decision" },
];
export type CaseStatus = "active" | "pending_approval" | "closed" | "withdrawn";
export type Outcome = "warning" | "suspension" | "termination" | "exonerated";
export const OUTCOMES: Opt<Outcome>[] = [
  { value: "warning", label: "Warning" },
  { value: "suspension", label: "Suspension" },
  { value: "termination", label: "Termination" },
  { value: "exonerated", label: "Exonerated" },
];

export type DisciplinaryCase = {
  id: string;
  code: string | null;
  location_id: string;
  staff_id: string | null;
  worker_id: string | null;
  person_kind: "staff" | "worker";
  person_name: string;
  person_code: string | null;
  category: CaseCategory;
  allegation: string;
  incident_date: string | null;
  opened_on: string;
  stage: CaseStage;
  status: CaseStatus;
  enquiry_officer: string | null;
  enquiry_officer_name: string | null;
  hearing_date: string | null;
  outcome: Outcome | null;
  decision_note: string | null;
  suspension_from: string | null;
  suspension_to: string | null;
  last_working_day: string | null;
  proposed_at: string | null;
  approved_at: string | null;
  decision_remark: string | null;
  exit_id: string | null;
  exit_code: string | null;
  withdrawn_reason: string | null;
  closed_at: string | null;
  memo_count: number;
  created_at: string;
  created_by: string | null;
};

export type CaseEvent = { id: string; kind: string; note: string | null; at: string; actor: string | null };
export type Witness = {
  id: string;
  name: string;
  kind: "staff" | "worker" | "outside";
  /** "staff:<id>" / "worker:<id>" — the photo; null for someone not on the rolls. */
  person: string | null;
  statement: string;
  given_on: string;
};

export type CaseDraft = {
  person: string;
  category: CaseCategory | "";
  allegation: string;
  incident_date: string;
  enquiry_officer: string;
  hearing_date: string;
  memo_ids: string[];
};

export type DecisionDraft = {
  outcome: Outcome | "";
  decision_note: string;
  suspension_from: string;
  suspension_to: string;
  last_working_day: string;
};

export function caseCategoryLabel(c: string): string {
  return CASE_CATEGORIES.find((x) => x.value === c)?.label ?? c;
}
export function outcomeLabel(o: string | null): string {
  return o ? (OUTCOMES.find((x) => x.value === o)?.label ?? o) : "—";
}
export function stageLabel(s: string): string {
  return CASE_STAGES.find((x) => x.value === s)?.label ?? s;
}
export function nextStage(s: CaseStage): CaseStage | null {
  return s === "initiated" ? "enquiry" : s === "enquiry" ? "hearing" : s === "hearing" ? "decision" : null;
}
/** The screen's half of cd_propose_decision's rules. */
export function decisionProblem(d: DecisionDraft): string | null {
  if (!d.outcome) return "Pick the decision";
  if (d.decision_note.trim().length < 10) return "Give the reasons in at least 10 characters";
  if (d.outcome === "suspension" && (!d.suspension_from || !d.suspension_to)) return "Enter the suspension dates";
  if (d.outcome === "suspension" && d.suspension_to < d.suspension_from) return "The suspension ends before it starts";
  if (d.outcome === "termination" && !d.last_working_day) return "Enter the last working day";
  return null;
}

// ─── Policies ──────────────────────────────────────────────────────────────

export type PolicyCategory = "conduct" | "attendance" | "leave" | "safety" | "it" | "grievance" | "pay" | "other";
export const POLICY_CATEGORIES: Opt<PolicyCategory>[] = [
  { value: "conduct", label: "Conduct" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "safety", label: "Safety" },
  { value: "it", label: "IT & data" },
  { value: "grievance", label: "Grievance" },
  { value: "pay", label: "Pay & benefits" },
  { value: "other", label: "Other" },
];
export type AppliesTo = "all" | "staff" | "worker";
export const APPLIES_TO: Opt<AppliesTo>[] = [
  { value: "all", label: "Everyone" },
  { value: "staff", label: "Staff" },
  { value: "worker", label: "Workers" },
];

export type PolicyVersion = {
  id: string;
  policy_id: string;
  version_no: number;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  effective_from: string;
  change_note: string | null;
  status: "draft" | "published" | "superseded";
  published_at: string | null;
};

export type Policy = {
  id: string;
  code: string | null;
  location_id: string | null;
  unit_name: string | null;
  title: string;
  category: PolicyCategory;
  applies_to: AppliesTo;
  requires_ack: boolean;
  retired: boolean;
  live: PolicyVersion | null;
  draft: PolicyVersion | null;
  versions: PolicyVersion[];
  /** People the live version reaches in the unit in view, and how many have acknowledged it. */
  reach: number;
  acked: number;
  /** For a self-service login: have I acknowledged the live version? */
  mine_acked: boolean;
  created_at: string;
  created_by: string | null;
};

export type PolicyAck = {
  id: string;
  person_key: string;
  name: string;
  code: string | null;
  kind: "staff" | "worker";
  acked_at: string | null;
  mode: "self" | "hr" | null;
};

export type PolicyDraft = {
  title: string;
  category: PolicyCategory;
  applies_to: AppliesTo;
  requires_ack: boolean;
  company_wide: boolean;
  body: string;
  effective_from: string;
  change_note: string;
};

export function policyCategoryLabel(c: string): string {
  return POLICY_CATEGORIES.find((x) => x.value === c)?.label ?? c;
}
export function appliesToLabel(a: string): string {
  return APPLIES_TO.find((x) => x.value === a)?.label ?? a;
}
