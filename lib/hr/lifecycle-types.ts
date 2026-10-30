import { z } from "zod";
import type { StatusTone } from "@/lib/ui/status-tone";
import { statusTone } from "@/lib/ui/status-tone";
import type { PersonKind } from "./timeoff-types";

/**
 * HR ▸ Team Lifecycle (0766) — the MyJKKN lifecycle port. Shared shapes and
 * words. Every rule here is also a rule in SQL; these only let the screen say
 * it first.
 */

/** An exit that is "open" is under way (info), not unclaimed; an asset
 *  "returned" is back with the company, which is done; a verified document is
 *  accepted; a damaged asset needs recovering. */
const LIFECYCLE_OVERRIDES = {
  open: "info",
  returned: "success",
  verified: "success",
  damaged: "danger",
} as const;

export function lifecycleTone(status: string): StatusTone {
  return statusTone(status, LIFECYCLE_OVERRIDES);
}
export function lifecycleLabel(status: string): string {
  if (status === "pending_approval") return "Awaiting approval";
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export const APPLIES_TO = ["both", "staff", "workers"] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];
export const APPLIES_TO_LABELS: Record<AppliesTo, string> = {
  both: "Staff & workers",
  staff: "Staff only",
  workers: "Workers only",
};
export function appliesToPerson(a: AppliesTo, kind: PersonKind): boolean {
  return a === "both" || (a === "staff") === (kind === "staff");
}

// ─── Joining checklists ────────────────────────────────────────────────────

export type TemplateStep = { title: string; due_day: number; owner: string };

export type ChecklistTemplate = {
  id: string;
  name: string;
  applies_to: AppliesTo;
  steps: TemplateStep[];
  is_active: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type Onboarding = {
  id: string;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  template_name: string;
  start_date: string;
  status: "in_progress" | "completed" | "cancelled";
  completed_at: string | null;
  cancel_reason: string | null;
  steps_total: number;
  steps_done: number;
  steps_overdue: number;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type OnboardingStep = {
  id: string;
  onboarding_id: string;
  sort_order: number;
  title: string;
  owner: string | null;
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  note: string | null;
};

export const templateInput = z.object({
  name: z.string().trim().min(1, "The name is mandatory").transform((s) => s.toUpperCase()),
  applies_to: z.enum(APPLIES_TO),
  is_active: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Every step needs a title").transform((s) => s.toUpperCase()),
        due_day: z.coerce.number().int().min(0).max(365).default(0),
        owner: z.string().trim().transform((s) => s.toUpperCase()).default(""),
      }),
    )
    .min(1, "Add at least one step"),
});
export type TemplateInput = z.input<typeof templateInput>;

// ─── Documents ─────────────────────────────────────────────────────────────

export const DOC_CATEGORIES = [
  "identity",
  "address",
  "education",
  "employment",
  "statutory",
  "bank",
  "medical",
  "other",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type RequiredDocument = {
  id: string;
  code: string;
  name: string;
  category: DocCategory;
  applies_to: AppliesTo;
  is_mandatory: boolean;
  has_expiry: boolean;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const requiredDocInput = z.object({
  code: z.string().trim().min(1, "The code is mandatory").max(12).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "The name is mandatory").transform((s) => s.toUpperCase()),
  category: z.enum(DOC_CATEGORIES),
  applies_to: z.enum(APPLIES_TO),
  is_mandatory: z.boolean(),
  has_expiry: z.boolean(),
  sort_order: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});
export type RequiredDocInput = z.input<typeof requiredDocInput>;

/** "expired" is derived — verified and past its expiry date. */
export type DocStatus = "pending" | "verified" | "rejected" | "expired";

export type PersonDocument = {
  id: string;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  required_doc_id: string | null;
  doc_name: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  document_no: string | null;
  issued_on: string | null;
  expires_on: string | null;
  status: DocStatus;
  review_note: string | null;
  reviewed_at: string | null;
  /** Days until expiry (negative = past), when it has one. */
  expires_in: number | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const DOC_ACCEPT = ["application/pdf", "image/jpeg", "image/png"] as const;
export const DOC_MAX_BYTES = 5 * 1024 * 1024;
export const DOC_BUCKET = "hr-people-docs";

// ─── Assets ────────────────────────────────────────────────────────────────

export const ASSET_CATEGORIES = ["id_card", "uniform", "laptop", "mobile", "sim", "tools", "key", "vehicle", "other"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  id_card: "ID card",
  uniform: "Uniform",
  laptop: "Laptop / computer",
  mobile: "Mobile phone",
  sim: "SIM card",
  tools: "Tools",
  key: "Keys",
  vehicle: "Vehicle",
  other: "Other",
};
export const ASSET_STATUSES = ["issued", "returned", "lost", "damaged"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export type Asset = {
  id: string;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  asset_name: string;
  category: AssetCategory;
  serial_no: string | null;
  issued_on: string;
  issue_condition: string | null;
  value: number | null;
  status: AssetStatus;
  returned_on: string | null;
  return_condition: string | null;
  recovery_amount: number | null;
  note: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const assetInput = z.object({
  person: z.string().min(1, "Pick the person"),
  asset_name: z.string().trim().min(1, "Name the asset").transform((s) => s.toUpperCase()),
  category: z.enum(ASSET_CATEGORIES),
  serial_no: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
  issued_on: z.string().min(1, "The issue date is mandatory"),
  issue_condition: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
  value: z.coerce.number().nonnegative().nullable().default(null),
  note: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
});
export type AssetInput = z.input<typeof assetInput>;

export const assetReturnInput = z
  .object({
    status: z.enum(["returned", "lost", "damaged"]),
    returned_on: z.string().min(1, "The date is mandatory"),
    return_condition: z.string().trim().transform((s) => s.toUpperCase() || null).nullable().default(null),
    recovery_amount: z.coerce.number().nonnegative().nullable().default(null),
  });
export type AssetReturnInput = z.input<typeof assetReturnInput>;

// ─── Exits ─────────────────────────────────────────────────────────────────

export const SEPARATION_TYPES = ["resignation", "retirement", "termination", "death", "absconding"] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];
export const SEPARATION_LABELS: Record<SeparationType, string> = {
  resignation: "Resignation",
  retirement: "Retirement",
  termination: "Termination",
  death: "Death",
  absconding: "Absconding",
};

export type ExitStatus = "pending_approval" | "open" | "completed" | "withdrawn";

export type ExitCase = {
  id: string;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  person_name: string;
  person_code: string | null;
  separation_type: SeparationType;
  notice_date: string;
  last_working_day: string;
  reason: string;
  grounds: string | null;
  notice_waived: boolean;
  status: ExitStatus;
  decision_remark: string | null;
  closed_at: string | null;
  close_reason: string | null;
  marked_left: boolean;
  steps_total: number;
  steps_done: number;
  /** Status of the live settlement, if any. */
  settlement_status: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type ExitStep = {
  id: string;
  exit_id: string;
  step_key: string;
  label: string;
  sort_order: number;
  done: boolean;
  done_at: string | null;
  note: string | null;
};

export type ExitStepCatalog = {
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export const exitInput = z
  .object({
    person: z.string().min(1, "Pick the person"),
    separation_type: z.enum(SEPARATION_TYPES),
    notice_date: z.string().min(1, "The notice date is mandatory"),
    last_working_day: z.string().min(1, "The last working day is mandatory"),
    reason: z.string().trim().min(1, "The reason is mandatory"),
    grounds: z.string().trim().default(""),
    notice_waived: z.boolean().default(false),
  })
  .refine((v) => v.last_working_day >= v.notice_date, {
    message: "The last working day cannot be before the notice date",
    path: ["last_working_day"],
  })
  .refine((v) => v.separation_type !== "termination" || v.grounds.length >= 20, {
    message: "State the grounds for termination in at least 20 characters",
    path: ["grounds"],
  });
export type ExitInput = z.input<typeof exitInput>;

export type RetirementDue = {
  person_kind: PersonKind;
  staff_id: string | null;
  worker_id: string | null;
  name: string;
  code: string | null;
  date_of_birth: string;
  retires_on: string;
  age_now: number;
  has_exit: boolean;
};

// ─── Full & final ──────────────────────────────────────────────────────────

export type Settlement = {
  id: string;
  code: string | null;
  exit_id: string;
  exit_code: string | null;
  person_name: string;
  person_code: string | null;
  separation_type: SeparationType;
  last_working_day: string;
  version: number;
  rated: "monthly" | "daily";
  basic_da: number;
  daily_wage: number;
  joined_on: string | null;
  service_years: number;
  completed_years: number;
  gratuity: number;
  leave_days: number;
  leave_amount: number;
  salary_due: number;
  bonus_due: number;
  other_earnings: number;
  notice_short_days: number;
  notice_recovery: number;
  advance_recovery: number;
  asset_recovery: number;
  other_deductions: number;
  net_payable: number;
  note: string | null;
  status: "draft" | "pending" | "approved" | "rejected" | "paid" | "superseded";
  decision_remark: string | null;
  paid_at: string | null;
  paid_ref: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
};

export type SettlementPrefill = {
  rated: "monthly" | "daily";
  basic_da: number;
  daily_wage: number;
  joined_on: string | null;
  last_working_day: string;
  separation_type: SeparationType;
  leave_days: number;
  advance_recovery: number;
  asset_recovery: number;
  notice_required: number;
  notice_short_days: number;
  gratuity_min_years: number;
  gratuity_cap: number;
};

/** What the form holds — numbers as typed strings. */
export type SettlementDraft = {
  rated: "monthly" | "daily";
  basic_da: string;
  daily_wage: string;
  joined_on: string;
  leave_days: string;
  salary_due: string;
  bonus_due: string;
  other_earnings: string;
  notice_short_days: string;
  advance_recovery: string;
  asset_recovery: string;
  other_deductions: string;
  note: string;
};

export type LcSettings = {
  retirement_age: number;
  retirement_lookahead: number;
  notice_days_staff: number;
  notice_days_workers: number;
  gratuity_min_years: number;
  gratuity_cap: number;
};

export const settingsInput = z.object({
  retirement_age: z.coerce.number().int().min(40).max(80),
  retirement_lookahead: z.coerce.number().int().min(1).max(24),
  notice_days_staff: z.coerce.number().int().min(0).max(180),
  notice_days_workers: z.coerce.number().int().min(0).max(180),
  gratuity_min_years: z.coerce.number().int().min(0).max(10),
  gratuity_cap: z.coerce.number().min(0),
});
export type SettingsInput = z.input<typeof settingsInput>;

/**
 * The same arithmetic `lc_save_settlement` does — the PREVIEW. What is stored
 * is always the database's own figure, so a drift here shows as a changed
 * number after Save, never as a wrong stored one.
 */
export function previewSettlement(
  d: SettlementDraft,
  ctx: { last_working_day: string; separation_type: SeparationType; notice_waived: boolean; gratuity_min_years: number; gratuity_cap: number },
) {
  const n = (s: string) => (s.trim() === "" ? 0 : Math.max(0, Number(s) || 0));
  const bda = n(d.basic_da);
  const daily = n(d.daily_wage);
  const rate = d.rated === "monthly" ? bda / 30 : daily;
  let years = 0;
  let months = 0;
  if (d.joined_on && d.joined_on <= ctx.last_working_day) {
    const [y1, m1, d1] = d.joined_on.split("-").map(Number);
    const [y2, m2, d2] = ctx.last_working_day.split("-").map(Number);
    let total = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) total -= 1;
    years = Math.floor(total / 12);
    months = total % 12;
  }
  const completed = years + (months >= 6 ? 1 : 0);
  const eligible = years >= ctx.gratuity_min_years || ctx.separation_type === "death";
  const gratuity = eligible
    ? Math.min(ctx.gratuity_cap, Math.round((d.rated === "monthly" ? (bda * 15) / 26 : daily * 15) * completed))
    : 0;
  const leave = Math.round(rate * n(d.leave_days));
  const notice = ctx.notice_waived ? 0 : Math.round(rate * n(d.notice_short_days));
  const earnings = gratuity + leave + n(d.salary_due) + n(d.bonus_due) + n(d.other_earnings);
  const recoveries = notice + n(d.advance_recovery) + n(d.asset_recovery) + n(d.other_deductions);
  return {
    years,
    months,
    completed,
    eligible,
    gratuity,
    leave,
    notice,
    earnings,
    recoveries,
    net: Math.round((earnings - recoveries) * 100) / 100,
  };
}
