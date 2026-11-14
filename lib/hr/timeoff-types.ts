import { z } from "zod";
import type { StatusTone } from "@/lib/ui/status-tone";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * HR ▸ Time Off (0770) — the MyJKKN Time Off port. Shared shapes and words.
 * Every rule here is also a rule in SQL; these only let the screen say it first.
 */

export const REQUEST_CATEGORIES = ["leave", "short_time_off", "compensatory_off"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<RequestCategory, string> = {
  leave: "Leave",
  short_time_off: "Permission (hours)",
  compensatory_off: "Compensatory Off",
};

export const DAY_PARTS = ["full", "first_half", "second_half", "hourly"] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export const DAY_PART_LABELS: Record<DayPart, string> = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
  hourly: "Hours",
};

export const REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn", "cancelled", "revoked"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const CREDIT_STATUSES = ["pending", "approved", "rejected", "withdrawn", "consumed"] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const ENCASH_STATUSES = ["pending", "approved", "rejected", "withdrawn", "paid"] as const;
export type EncashStatus = (typeof ENCASH_STATUSES)[number];

/** "Pending" here is waiting on an approver (the table's own meaning); a
 *  consumed credit is spent, which is done, not a failure. */
const TIMEOFF_OVERRIDES = { consumed: "neutral" } as const;
export function timeoffTone(status: string): StatusTone {
  return statusTone(status, TIMEOFF_OVERRIDES);
}
export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export type PersonKind = "staff" | "worker";

/** A person an operator may apply for — staff or worker, in one shape. */
export type PersonOption = {
  key: string; // "staff:<id>" | "worker:<id>"
  kind: PersonKind;
  id: string;
  name: string;
  code: string | null;
  gender: string | null;
};
export function personKey(kind: PersonKind, id: string): string {
  return `${kind}:${id}`;
}
export function splitPersonKey(key: string): { staff_id: string | null; worker_id: string | null } {
  const [kind, id] = key.split(":");
  return kind === "worker" ? { staff_id: null, worker_id: id ?? null } : { staff_id: id ?? null, worker_id: null };
}

export type LeaveType = {
  id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  request_category: RequestCategory;
  applies_to: "staff" | "workers" | "both";
  applicable_gender: "any" | "Male" | "Female";
  is_paid: boolean;
  allow_half_day: boolean;
  skip_weekends: boolean;
  skip_holidays: boolean;
  track_balance: boolean;
  default_entitled_days: number;
  accrual_type: "annual" | "monthly";
  accrual_rate: number | null;
  min_advance_notice_days: number;
  max_continuous_days: number | null;
  limit_period: "none" | "month" | "year";
  max_days_per_period: number | null;
  allow_carry_forward: boolean;
  max_carry_forward_days: number | null;
  is_encashable: boolean;
  max_encashable_days: number | null;
  sto_limit_mode: "none" | "count" | "minutes";
  sto_limit_period: "month" | "year";
  sto_max_requests: number | null;
  sto_total_minutes: number | null;
  sto_min_minutes: number | null;
  sto_max_minutes: number | null;
  created_by: string | null;
  created_at: string;
};

export type LeaveYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  created_by: string | null;
  created_at: string;
};

export type Blackout = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  leave_type_id: string | null;
  location_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * ON DUTY is a leave type, not a category (0798 seeds code OD, "ON DUTY"): away
 * on company work, not absent. Read through this one test — the dashboard's
 * `timeOffToday` already uses the same code-or-name rule — so Leave Requests
 * and On Duty Requests split the same rows the same way.
 */
export function isOnDuty(code: string | null | undefined, name: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === "OD" || (name ?? "").toUpperCase().includes("ON DUTY");
}

export type TimeoffRequest = {
  id: string;
  /** While pending: how far through HOD → HR Manager → ED it is (0817). */
  stage?: string | null;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  leave_type_id: string;
  leave_code: string;
  leave_name: string;
  leave_color: string;
  year_id: string;
  request_category: RequestCategory;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  start_time: string | null;
  end_time: string | null;
  total_days: number;
  duration_minutes: number | null;
  reason: string;
  status: RequestStatus;
  decision_remark: string | null;
  decided_at: string | null;
  close_reason: string | null;
  closed_at: string | null;
  /** A file the person attached — the letter or order behind an On Duty (0843). */
  attachment_path: string | null;
  attachment_name: string | null;
  created_by: string | null;
  created_at: string;
};

export type CompOffCredit = {
  id: string;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  worked_date: string;
  credit_days: number;
  reason: string;
  had_punch: boolean;
  status: CreditStatus;
  /** Derived: an approved credit past its date. */
  expired: boolean;
  expires_on: string;
  consumed_by: string | null;
  decision_remark: string | null;
  created_by: string | null;
  created_at: string;
};

export type Encashment = {
  id: string;
  /** While pending: how far through HOD → HR Manager → ED it is (0817). */
  stage?: string | null;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  leave_type_id: string;
  leave_name: string;
  days: number;
  rate_per_day: number;
  amount: number;
  reason: string;
  status: EncashStatus;
  decision_remark: string | null;
  paid_at: string | null;
  paid_ref: string | null;
  created_by: string | null;
  created_at: string;
};

export type BalanceRow = {
  person_kind: PersonKind;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  leave_type_id: string;
  leave_code: string;
  leave_name: string;
  entitled: number;
  accrued: number;
  carried: number;
  used: number;
  pending: number;
  encashed: number;
  available: number;
  has_override: boolean;
};

export type Entitlement = {
  id: string;
  year_id: string;
  leave_type_id: string;
  staff_id: string | null;
  worker_id: string | null;
  entitled_days: number | null;
  carried_forward: number;
  opening_used: number;
  reason: string;
};

/** One item waiting in the Time Off approvals queue. */
export type QueueItem = {
  kind: "request" | "encashment" | "claim";
  id: string;
  code: string | null;
  person_name: string;
  what: string;
  when: string;
  amount: string;
  reason: string;
  created_at: string;
  /** For a request/encashment: whether the signed-in user is on its current step. */
  can_act: boolean;
  /** Which step it waits on — "HR Manager · 2 of 3" (0817). Null for a claim. */
  stage: string | null;
  /** pending · approved · rejected · paid · consumed — the row's own status. */
  status: string;
  /** A request's attached file (0843). */
  attachment_path?: string | null;
  attachment_name?: string | null;
  /** Who it is for — the photo beside the name (PersonAvatar). */
  staff_id: string | null;
  worker_id: string | null;
  /** A decided row: who decided it and when — "TEST ED · 06/11/2026". */
  decided?: string | null;
};

/** One department and its HOD — step 1 of every HR request (0817). */
export type DepartmentHead = {
  department_id: string;
  department_name: string;
  hod_staff_id: string | null;
};

/** A staff member named on the HR Manager or ED stage (0847). */
export type StageApprover = {
  id: string;
  name: string;
  designation: string | null;
  /** Their staff email matches an active login — without one they cannot approve. */
  login: boolean;
  /** Switched off on People ▸ Staff since being named — the stage skips them. */
  inactive: boolean;
};

/** Who answers the HR Manager and ED stages: staff named by hand, any number (0847). */
export type StagePeople = { hr: StageApprover[]; ed: StageApprover[] };

/** A staff member who can be named HOD. */
export type HodOption = { id: string; name: string; code: string | null; department_id: string | null };

// ─── Inputs ────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

export const applyInput = z.object({
  person: z.string().min(1, "Pick the person"),
  leave_type_id: z.string().uuid("Pick the leave type"),
  start_date: isoDate,
  end_date: isoDate,
  day_part: z.enum(DAY_PARTS),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  reason: z.string().trim().min(1, "The reason is mandatory"),
});
export type ApplyInput = z.infer<typeof applyInput>;

export const leaveTypeInput = z.object({
  code: z.string().trim().min(1, "Enter the code").max(10).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Enter the name").transform((v) => v.toUpperCase()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  sort_order: z.coerce.number().int().min(0),
  is_active: z.boolean(),
  request_category: z.enum(REQUEST_CATEGORIES),
  applies_to: z.enum(["staff", "workers", "both"]),
  applicable_gender: z.enum(["any", "Male", "Female"]),
  is_paid: z.boolean(),
  allow_half_day: z.boolean(),
  skip_weekends: z.boolean(),
  skip_holidays: z.boolean(),
  track_balance: z.boolean(),
  default_entitled_days: z.coerce.number().min(0),
  accrual_type: z.enum(["annual", "monthly"]),
  accrual_rate: z.coerce.number().positive().nullable(),
  min_advance_notice_days: z.coerce.number().int().min(0),
  max_continuous_days: z.coerce.number().positive().nullable(),
  limit_period: z.enum(["none", "month", "year"]),
  max_days_per_period: z.coerce.number().positive().nullable(),
  allow_carry_forward: z.boolean(),
  max_carry_forward_days: z.coerce.number().min(0).nullable(),
  is_encashable: z.boolean(),
  max_encashable_days: z.coerce.number().positive().nullable(),
  sto_limit_mode: z.enum(["none", "count", "minutes"]),
  sto_limit_period: z.enum(["month", "year"]),
  sto_max_requests: z.coerce.number().int().positive().nullable(),
  sto_total_minutes: z.coerce.number().int().positive().nullable(),
  sto_min_minutes: z.coerce.number().int().positive().nullable(),
  sto_max_minutes: z.coerce.number().int().positive().nullable(),
})
  .refine((v) => v.accrual_type !== "monthly" || v.accrual_rate != null, {
    message: "Monthly accrual needs the days earned per month",
    path: ["accrual_rate"],
  })
  .refine((v) => v.limit_period === "none" || v.max_days_per_period != null, {
    message: "Enter the most days allowed in the period",
    path: ["max_days_per_period"],
  })
  .refine((v) => v.sto_limit_mode !== "count" || v.sto_max_requests != null, {
    message: "Enter how many permissions are allowed",
    path: ["sto_max_requests"],
  })
  .refine((v) => v.sto_limit_mode !== "minutes" || v.sto_total_minutes != null, {
    message: "Enter the total minutes allowed",
    path: ["sto_total_minutes"],
  });
export type LeaveTypeInput = z.input<typeof leaveTypeInput>;

export const yearInput = z
  .object({
    name: z.string().trim().min(1, "Enter the year's name"),
    start_date: isoDate,
    end_date: isoDate,
    is_closed: z.boolean(),
  })
  .refine((v) => v.end_date > v.start_date, { message: "The end must be after the start", path: ["end_date"] });
export type YearInput = z.infer<typeof yearInput>;

export const blackoutInput = z
  .object({
    name: z.string().trim().min(1, "Enter a name").transform((v) => v.toUpperCase()),
    start_date: isoDate,
    end_date: isoDate,
    leave_type_id: z.string().uuid().nullable(),
    location_id: z.string().uuid().nullable(),
    reason: z.string().trim().transform((v) => (v ? v.toUpperCase() : null)).nullable(),
  })
  .refine((v) => v.end_date >= v.start_date, { message: "The end cannot be before the start", path: ["end_date"] });
export type BlackoutInput = z.input<typeof blackoutInput>;

export const entitlementInput = z.object({
  year_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  person: z.string().min(1),
  entitled_days: z.coerce.number().min(0).nullable(),
  carried_forward: z.coerce.number().min(0),
  opening_used: z.coerce.number().min(0),
  reason: z.string().trim().min(1, "Say why the balance is being changed").transform((v) => v.toUpperCase()),
});
export type EntitlementInput = z.input<typeof entitlementInput>;

// ─── Small helpers the screens share ───────────────────────────────────────

export function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
export function fmtMinutes(m: number | null): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}
/** "09:30:00" → "09:30". */
export function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

/** A file attached to a request (0843) — private bucket, one file, 5 MB. */
export const TIMEOFF_FILE_BUCKET = "hr-timeoff-files";
export const TIMEOFF_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOFF_FILE_ACCEPT = "application/pdf,image/jpeg,image/png";

/**
 * The working day each person keeps (0769 timing groups): a category belongs
 * to Staff / Security / Production Staff, and the group's dated hours say In
 * and Out. Permission's From / To are offered inside them.
 */
export type WorkHours = {
  /** person key → timing group; a person whose category has no group is absent. */
  groupOf: Record<string, string>;
  /** Every dated row of hours, oldest first. */
  timings: { group: string; in_time: string; out_time: string; effective_from: string }[];
};

/** The hours in force for this person on this date, or null (no group / no hours / a night shift). */
export function workHoursOn(w: WorkHours | undefined, person: string, date: string): { in: string; out: string } | null {
  const g = w?.groupOf[person];
  if (!w || !g) return null;
  const t = w.timings.filter((x) => x.group === g && x.effective_from <= date).at(-1);
  if (!t) return null;
  const inT = t.in_time.slice(0, 5);
  const outT = t.out_time.slice(0, 5);
  // Out before In is a night shift (Security 20:00 → 08:00) — it crosses midnight,
  // which a one-day list cannot show, so it keeps the full list.
  return outT > inT ? { in: inT, out: outT } : null;
}
