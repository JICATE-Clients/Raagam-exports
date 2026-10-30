import { z } from "zod";
import type { StatusTone } from "@/lib/ui/status-tone";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * HR ▸ Recruitment (0772) — the MyJKKN recruitment port. Shared shapes and
 * words. Every rule here is also a rule in SQL (rc_* functions); these only
 * let the screen say it first.
 */

/** A job that is "open" is taking candidates (info, not unclaimed); "filled"
 *  is the job done; a candidate "offered" waits on their answer; "joined" is
 *  the end of the road; a declined offer or a no-show is a loss. */
const RECRUITMENT_OVERRIDES = {
  open: "info",
  filled: "success",
  on_hold: "warning",
  new: "info",
  shortlisted: "info",
  interview: "info",
  offered: "warning",
  joined: "success",
  offer_declined: "danger",
  no_show: "danger",
} as const;

export function recruitmentTone(status: string): StatusTone {
  return statusTone(status, RECRUITMENT_OVERRIDES);
}
export function recruitmentLabel(status: string): string {
  if (status === "pending_approval") return "Awaiting approval";
  if (status === "on_hold") return "On hold";
  if (status === "no_show") return "No show";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export const JOB_STATUSES = ["draft", "open", "on_hold", "closed", "filled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type HiresAs = "staff" | "workers";
export type SalaryBasis = "monthly" | "daily";

export type Job = {
  id: string;
  code: string | null;
  location_id: string;
  title: string;
  department_id: string | null;
  department_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  hires_as: HiresAs;
  openings: number;
  salary_basis: SalaryBasis;
  salary_min: number | null;
  salary_max: number | null;
  experience_min: number | null;
  experience_max: number | null;
  qualification: string | null;
  description: string | null;
  needed_by: string | null;
  status: JobStatus;
  opened_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  /** Candidates by stage, for the pipeline counts on the list. */
  counts: { total: number; active: number; interview: number; selected: number; joined: number };
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const jobInput = z
  .object({
    title: z.string().trim().min(1, "The job title is mandatory").transform((s) => s.toUpperCase()),
    department_id: z.string().nullable().transform((s) => s || null),
    designation_id: z.string().nullable().transform((s) => s || null),
    hires_as: z.enum(["staff", "workers"]),
    openings: z.coerce.number().int().min(1, "At least one opening").max(500),
    salary_basis: z.enum(["monthly", "daily"]),
    salary_min: z.coerce.number().nonnegative().nullable().default(null),
    salary_max: z.coerce.number().nonnegative().nullable().default(null),
    experience_min: z.coerce.number().nonnegative().nullable().default(null),
    experience_max: z.coerce.number().nonnegative().nullable().default(null),
    qualification: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    description: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    needed_by: z.string().nullable().transform((s) => s || null),
    status: z.enum(JOB_STATUSES),
    close_reason: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
  })
  .refine((v) => v.salary_min == null || v.salary_max == null || v.salary_max >= v.salary_min, {
    message: "The top of the salary range is below the bottom",
  })
  .refine((v) => v.experience_min == null || v.experience_max == null || v.experience_max >= v.experience_min, {
    message: "The most experience is below the least",
  });
export type JobInput = z.input<typeof jobInput>;

// ─── Candidates ────────────────────────────────────────────────────────────

export const CANDIDATE_STATUSES = [
  "new",
  "shortlisted",
  "interview",
  "pending_approval",
  "approved",
  "offered",
  "joined",
  "rejected",
  "withdrawn",
  "offer_declined",
  "no_show",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
/** Still moving through the pipeline. */
export const LIVE_STATUSES: CandidateStatus[] = ["new", "shortlisted", "interview", "pending_approval", "approved", "offered"];

export type MoveTo = "shortlisted" | "rejected" | "withdrawn" | "offered" | "offer_declined" | "no_show";

/** The SQL transition map of rc_move_candidates, word for word. */
export function canMove(from: CandidateStatus, to: MoveTo): boolean {
  if (from === to) return false;
  if (from === "new" || from === "shortlisted" || from === "interview") return to === "shortlisted" || to === "rejected" || to === "withdrawn";
  if (from === "approved") return to === "offered" || to === "rejected" || to === "withdrawn";
  if (from === "offered") return to === "offer_declined" || to === "no_show" || to === "withdrawn";
  if (from === "rejected") return to === "shortlisted";
  return false;
}
/** A move that must say why. Reconsidering a rejected candidate does too. */
export function moveNeedsNote(from: CandidateStatus, to: MoveTo): boolean {
  return to === "rejected" || to === "withdrawn" || to === "offer_declined" || to === "no_show" || from === "rejected";
}
export const SELECTABLE: CandidateStatus[] = ["shortlisted", "interview", "approved", "offered", "offer_declined"];

export const SOURCES = ["walk_in", "referral", "consultant", "job_portal", "advertisement", "campus", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  walk_in: "Walk-in",
  referral: "Employee referral",
  consultant: "Consultant / agency",
  job_portal: "Job portal",
  advertisement: "Advertisement",
  campus: "Campus / ITI",
  other: "Other",
};

export type Candidate = {
  id: string;
  code: string | null;
  job_id: string;
  job_code: string | null;
  job_title: string;
  hires_as: HiresAs;
  name: string;
  phone: string;
  email: string | null;
  gender: "male" | "female" | "other" | null;
  date_of_birth: string | null;
  town: string | null;
  qualification: string | null;
  experience_years: number | null;
  current_employer: string | null;
  current_salary: number | null;
  expected_salary: number | null;
  notice_days: number | null;
  source: Source;
  referred_by_staff_id: string | null;
  referred_by_name: string | null;
  source_note: string | null;
  notes: string | null;
  resume_path: string | null;
  resume_name: string | null;
  status: CandidateStatus;
  offer_designation_id: string | null;
  offer_designation: string | null;
  offer_salary: number | null;
  offer_basis: SalaryBasis | null;
  offer_joining_date: string | null;
  offer_note: string | null;
  approved_designation: string | null;
  approved_salary: number | null;
  approved_basis: SalaryBasis | null;
  approved_joining_date: string | null;
  approved_at: string | null;
  decision_remark: string | null;
  offered_at: string | null;
  joined_on: string | null;
  hired_name: string | null;
  hired_code: string | null;
  closed_reason: string | null;
  /** Interviews: rounds done, and the average mark (1–5) across scorecards. */
  rounds_done: number;
  next_interview_at: string | null;
  avg_score: number | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

/** What the add / edit sheet holds — every field as typed. */
export type CandidateDraft = {
  job_id: string;
  name: string;
  phone: string;
  email: string;
  gender: string;
  date_of_birth: string;
  town: string;
  qualification: string;
  experience_years: string;
  current_employer: string;
  current_salary: string;
  expected_salary: string;
  notice_days: string;
  source: Source;
  referred_by_staff_id: string;
  source_note: string;
  notes: string;
  resume_path: string;
  resume_name: string;
};

export function candidateProblem(d: CandidateDraft): string | null {
  if (!d.job_id) return "Pick the job";
  if (!d.name.trim()) return "The name is mandatory";
  const digits = d.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "Enter a phone number of 10 digits";
  if (d.source === "referral" && !d.referred_by_staff_id) return "Pick who referred them";
  return null;
}

export type CandidateEvent = {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  data: Record<string, unknown> | null;
  actor_name: string | null;
  created_at: string;
};

export type SelectionDraft = {
  designation_id: string;
  salary: string;
  basis: SalaryBasis;
  joining_date: string;
  note: string;
};

// ─── Interviews ────────────────────────────────────────────────────────────

export const INTERVIEW_MODES = ["in_person", "phone", "video"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export const MODE_LABELS: Record<InterviewMode, string> = { in_person: "In person", phone: "Phone", video: "Video call" };
export const ROUND_SUGGESTIONS = ["HR ROUND", "TRADE TEST", "TECHNICAL", "DEPARTMENT HEAD", "MD"];

export type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";

export type Interview = {
  id: string;
  candidate_id: string;
  candidate_code: string | null;
  candidate_name: string;
  candidate_status: CandidateStatus;
  job_title: string;
  round_no: number;
  round_name: string;
  scheduled_at: string;
  duration_min: number;
  mode: InterviewMode;
  venue: string | null;
  panel: string[];
  panel_names: string[];
  status: InterviewStatus;
  rescheduled_from_id: string | null;
  outcome_note: string | null;
  scorecards: Scorecard[];
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const RECOMMENDATIONS = ["strong_hire", "hire", "neutral", "no_hire", "strong_no_hire"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_hire: "Strong hire",
  hire: "Hire",
  neutral: "Neutral",
  no_hire: "No hire",
  strong_no_hire: "Strong no hire",
};
export const SCORE_FIELDS = [
  { key: "skill", label: "Skill / trade" },
  { key: "communication", label: "Communication" },
  { key: "attitude", label: "Attitude" },
  { key: "experience", label: "Experience" },
] as const;
export type ScoreKey = (typeof SCORE_FIELDS)[number]["key"];

export type Scorecard = {
  id: string;
  interview_id: string;
  interviewer_id: string;
  interviewer_name: string;
  skill: number;
  communication: number;
  attitude: number;
  experience: number;
  recommendation: Recommendation;
  comments: string | null;
  entered_by: string | null;
};
export function scoreOf(c: Pick<Scorecard, ScoreKey>): number {
  return (c.skill + c.communication + c.attitude + c.experience) / 4;
}

// ─── Storage ───────────────────────────────────────────────────────────────

export const RESUME_BUCKET = "hr-resumes";
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_ACCEPT =
  "application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ─── Options ───────────────────────────────────────────────────────────────

export type Option = { id: string; name: string; inactive?: boolean };
export type DesignationOption = Option & { for_type: "staff" | "worker" | "staff_worker" };
export function designationFits(d: DesignationOption, hiresAs: HiresAs): boolean {
  return d.for_type === "staff_worker" || (d.for_type === "staff") === (hiresAs === "staff");
}
