import { z } from "zod";
import type { StatusTone } from "@/lib/ui/status-tone";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * HR ▸ Performance & Growth (0773) — the MyJKKN appraisal, promotion and
 * training port. Shared shapes and words. Every rule here is also a rule in
 * SQL (pf_* functions and triggers); these only let the screen say it first.
 */

/** A round "open" is taking ratings (info); "locked" has closed self-rating
 *  (warning); an appraisal "self" / "supervisor" is waiting on a person
 *  (neutral — not started by them yet); a training "in progress" is info. */
const PERFORMANCE_OVERRIDES = {
  open: "info",
  locked: "warning",
  self: "neutral",
  supervisor: "info",
  in_progress: "info",
  registered: "neutral",
  attended: "info",
  dropped: "neutral",
  withdrawn: "neutral",
} as const;

export function performanceTone(status: string): StatusTone {
  return statusTone(status, PERFORMANCE_OVERRIDES);
}
export function performanceLabel(status: string): string {
  if (status === "pending_approval") return "Awaiting approval";
  if (status === "self") return "Self-rating";
  if (status === "supervisor") return "With supervisor";
  if (status === "locked") return "Self-rating closed";
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

// ─── Rounds ────────────────────────────────────────────────────────────────

export type RoundStatus = "draft" | "open" | "locked" | "closed";

export type Round = {
  id: string;
  code: string | null;
  location_id: string;
  name: string;
  period_from: string;
  period_to: string;
  self_due: string | null;
  review_due: string | null;
  status: RoundStatus;
  note: string | null;
  opened_at: string | null;
  closed_at: string | null;
  counts: { total: number; self: number; supervisor: number; pending: number; approved: number };
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const roundInput = z
  .object({
    name: z.string().trim().min(1, "Name the round").transform((s) => s.toUpperCase()),
    period_from: z.string().min(1, "Enter the period"),
    period_to: z.string().min(1, "Enter the period"),
    self_due: z.string().nullable().transform((s) => s || null),
    review_due: z.string().nullable().transform((s) => s || null),
    note: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
  })
  .refine((v) => v.period_to >= v.period_from, { message: "The period ends before it starts" });
export type RoundInput = z.input<typeof roundInput>;

/** The SQL map of pf_round_guard, word for word. */
export function roundMoves(s: RoundStatus): RoundStatus[] {
  if (s === "draft") return ["open"];
  if (s === "open") return ["locked"];
  if (s === "locked") return ["open", "closed"];
  return [];
}

// ─── Appraisals ────────────────────────────────────────────────────────────

export type ReviewStatus = "self" | "supervisor" | "pending_approval" | "approved";
export type Rating = "exceeds" | "meets" | "below";
export const RATINGS: { value: Rating; label: string }[] = [
  { value: "below", label: "Below" },
  { value: "meets", label: "Meets" },
  { value: "exceeds", label: "Exceeds" },
];
export const AREAS = [
  { key: "quality", label: "Quality of work" },
  { key: "output", label: "Output / productivity" },
  { key: "discipline", label: "Attendance & discipline" },
  { key: "teamwork", label: "Teamwork & attitude" },
] as const;
export type AreaKey = (typeof AREAS)[number]["key"];
export type Ratings = Record<AreaKey, Rating | null>;

/** pf_score, word for word: Below 0 · Meets 12.5 · Exceeds 25 — all "meets" is 50. */
export function scoreOf(r: Ratings): number | null {
  const v = AREAS.map((a) => r[a.key]);
  if (v.some((x) => x == null)) return null;
  return v.reduce((s, x) => s + (x === "exceeds" ? 25 : x === "meets" ? 12.5 : 0), 0);
}
export function scoreWord(score: number): string {
  if (score >= 75) return "Excellent";
  if (score >= 50) return "Good";
  if (score >= 25) return "Needs improvement";
  return "Poor";
}

export type Review = {
  id: string;
  round_id: string;
  round_code: string | null;
  round_name: string;
  round_status: RoundStatus;
  location_id: string;
  staff_id: string | null;
  worker_id: string | null;
  person_kind: "staff" | "worker";
  person_name: string;
  person_code: string | null;
  designation_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  self_rating: boolean;
  status: ReviewStatus;
  self: Ratings;
  self_comment: string | null;
  self_at: string | null;
  sup: Ratings;
  sup_comment: string | null;
  strengths: string | null;
  improvements: string | null;
  sup_at: string | null;
  final_score: number | null;
  returned_note: string | null;
  approved_at: string | null;
  decision_remark: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type ReviewDraft = Ratings & { comment: string; strengths: string; improvements: string };

// ─── Promotions ────────────────────────────────────────────────────────────

export type PromotionStatus = "pending_approval" | "approved" | "rejected" | "withdrawn";

export type Promotion = {
  id: string;
  code: string | null;
  location_id: string;
  staff_id: string | null;
  worker_id: string | null;
  person_kind: "staff" | "worker";
  person_name: string;
  person_code: string | null;
  from_designation: string | null;
  to_designation: string;
  current_salary: number | null;
  salary_basis: "monthly" | "daily" | null;
  proposed_salary: number | null;
  effective_date: string;
  reason: string;
  review_id: string | null;
  review_label: string | null;
  status: PromotionStatus;
  approved_at: string | null;
  decision_remark: string | null;
  designation_applied: boolean;
  withdrawn_reason: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type PromotionDraft = {
  person: string;
  to_designation_id: string;
  proposed_salary: string;
  effective_date: string;
  reason: string;
  review_id: string;
};

/** A person's designation today, keyed by `personKey`. */
export type PersonRole = { designation_id: string | null; designation_name: string | null };

// ─── Training ──────────────────────────────────────────────────────────────

export const TRAINING_CATEGORIES = [
  "safety",
  "quality",
  "machine",
  "skill",
  "compliance",
  "soft_skills",
  "induction",
  "other",
] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<TrainingCategory, string> = {
  safety: "Safety",
  quality: "Quality",
  machine: "Machine operation",
  skill: "Skill / trade",
  compliance: "Compliance",
  soft_skills: "Soft skills",
  induction: "Induction",
  other: "Other",
};

export type TrainingStatus = "draft" | "open" | "in_progress" | "completed" | "cancelled";

/** The SQL map of pf_training_guard, word for word. */
export function trainingMoves(s: TrainingStatus): TrainingStatus[] {
  if (s === "draft") return ["open", "cancelled"];
  if (s === "open") return ["draft", "in_progress", "cancelled"];
  if (s === "in_progress") return ["completed", "cancelled"];
  return [];
}

export type Training = {
  id: string;
  code: string | null;
  location_id: string;
  title: string;
  category: TrainingCategory;
  trainer: string | null;
  venue: string | null;
  starts_on: string;
  ends_on: string;
  hours: number | null;
  seats: number | null;
  description: string | null;
  status: TrainingStatus;
  cancel_reason: string | null;
  counts: { taken: number; completed: number };
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const trainingInput = z
  .object({
    title: z.string().trim().min(1, "Name the training").transform((s) => s.toUpperCase()),
    category: z.enum(TRAINING_CATEGORIES),
    trainer: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    venue: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    starts_on: z.string().min(1, "Enter the dates"),
    ends_on: z.string().min(1, "Enter the dates"),
    hours: z.coerce.number().positive().nullable().default(null),
    seats: z.coerce.number().int().min(1).max(1000).nullable().default(null),
    description: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    status: z.enum(["draft", "open"]).optional(),
  })
  .refine((v) => v.ends_on >= v.starts_on, { message: "It ends before it starts" });
export type TrainingInput = z.input<typeof trainingInput>;

export type EnrolmentStatus = "registered" | "attended" | "completed" | "dropped";

export type Enrolment = {
  id: string;
  training_id: string;
  training_code: string | null;
  training_title: string;
  training_status: TrainingStatus;
  starts_on: string;
  ends_on: string;
  hours: number | null;
  category: TrainingCategory;
  staff_id: string | null;
  worker_id: string | null;
  person_kind: "staff" | "worker";
  person_name: string;
  person_code: string | null;
  status: EnrolmentStatus;
  remark: string | null;
  completed_on: string | null;
  certificate_path: string | null;
  certificate_name: string | null;
};

export const CERT_BUCKET = "hr-training-certs";
export const CERT_MAX_BYTES = 5 * 1024 * 1024;
export const CERT_ACCEPT = "application/pdf,image/jpeg,image/png";

export type DesignationOption = { id: string; name: string; for_type: "staff" | "worker" | "staff_worker"; inactive?: boolean };
export function designationFitsKind(d: DesignationOption, kind: "staff" | "worker"): boolean {
  return d.for_type === "staff_worker" || (d.for_type === "staff") === (kind === "staff");
}
