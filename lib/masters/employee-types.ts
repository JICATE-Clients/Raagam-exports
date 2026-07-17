import { z } from "zod";
import {
  nullableFormat,
  PINCODE_IN_RE,
  MOBILE_IN_RE,
  EMAIL_RE,
} from "@/lib/validation/formats";

// ============================================================================
// Employees — Associates master (0243). Legacy EDP2 "Employee" form: a header
// (ID · Name · S/O + guardian · Category ⓘ · Department ⓘ · Location ⓘ ·
// Designation ⓘ · DOB + Age · Team ⓘ · Manager ⓘ · Photo · Inactive) + a single
// "General" panel (Permanent + Correspondence addresses · E-Mail · Qualification
// · Blood Group · Marital Status · Sex · Nationality · Religion).
//
// A flat (single-row) master — no child grid. Picker FKs: category/department/
// designation/team → config_lookups; location → locations; manager → employees.
// ============================================================================

/** Guardian relationship prefix (legacy "S/O" dropdown). */
export const GUARDIAN_RELATIONS = ["S/O", "D/O", "W/O", "C/O"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

/** Spouse relationship prefix (0279). */
export const SPOUSE_TYPES = ["S/O", "D/O", "W/O"] as const;
export type SpouseType = (typeof SPOUSE_TYPES)[number];

/** Employee type: Staff or Temporary (0279, default 'S'). */
export const EMPLOYEE_TYPES = ["S", "T"] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = { S: "Staff", T: "Temporary" };

export const MARITAL_STATUSES = ["Single", "Married", "Divorced"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const SEXES = ["Male", "Female"] as const;
export type Sex = (typeof SEXES)[number];

export const PAY_MODES = ["Bank", "Cash"] as const;
export type PayMode = (typeof PAY_MODES)[number];

/** Lightweight locations row for the Location picker (GST-entity master). */
export interface EmployeeLocation {
  id: string;
  code: string;
  name: string;
}

/** Slim self-reference row for the Manager picker. */
export interface EmployeeRef {
  id: string;
  code: string | null;
  name: string;
}

export interface Employee {
  id: string;
  code: string | null; // "ID"
  name: string;
  guardian_relation: GuardianRelation | string | null;
  guardian_name: string | null;
  category_id: string | null;
  department_id: string | null;
  location_id: string | null;
  designation_id: string | null;
  team_id: string | null;
  manager_id: string | null;
  dob: string | null; // date (YYYY-MM-DD)
  inactive: boolean;
  photo_url: string | null;
  // General — Permanent Address
  perm_addr1: string | null;
  perm_addr2: string | null;
  perm_addr3: string | null;
  perm_pin: string | null;
  perm_phone: string | null;
  perm_mobile: string | null;
  // General — Correspondence Address
  corr_same_as_perm: boolean;
  corr_addr1: string | null;
  corr_addr2: string | null;
  corr_addr3: string | null;
  corr_pin: string | null;
  corr_phone: string | null;
  corr_mobile: string | null;
  // General — personal
  email: string | null;
  qualification: string | null;
  blood_group: string | null;
  marital_status: MaritalStatus | string | null;
  sex: Sex | string | null;
  nationality: string | null;
  religion: string | null;
  // 0277 — employment & statutory
  doj: string | null;
  emp_type: string | null;
  mobile: string | null;
  father_name: string | null;
  mother_name: string | null;
  spouse_name: string | null;
  pf_no: string | null;
  esi_no: string | null;
  uan: string | null;
  pan_no: string | null;
  aadhar_no: string | null;
  pay_mode: PayMode | string | null;
  bank_name: string | null;
  bank_acc_no: string | null;
  // 0279 — enrichment
  spouse_type: SpouseType | string | null;
  date_of_confirmation: string | null;
  date_of_filing: string | null;
  employee_type: EmployeeType | string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const employeeInput = z.object({
  code: nullableText,
  name: z.string().min(1, "Name is required"),
  guardian_relation: z.enum(GUARDIAN_RELATIONS).nullable().default(null),
  guardian_name: nullableText,
  category_id: uuidN,
  department_id: uuidN,
  location_id: uuidN,
  designation_id: uuidN,
  team_id: uuidN,
  manager_id: uuidN,
  dob: nullableText, // date string; DB coerces
  inactive: z.boolean().default(false),
  photo_url: nullableText,
  // Permanent Address
  perm_addr1: nullableText,
  perm_addr2: nullableText,
  perm_addr3: nullableText,
  perm_pin: nullableFormat(PINCODE_IN_RE, "Enter a 6-digit PIN code"),
  perm_phone: nullableText,
  perm_mobile: nullableFormat(MOBILE_IN_RE, "Enter a 10-digit mobile (starting 6–9)"),
  // Correspondence Address
  corr_same_as_perm: z.boolean().default(false),
  corr_addr1: nullableText,
  corr_addr2: nullableText,
  corr_addr3: nullableText,
  corr_pin: nullableFormat(PINCODE_IN_RE, "Enter a 6-digit PIN code"),
  corr_phone: nullableText,
  corr_mobile: nullableFormat(MOBILE_IN_RE, "Enter a 10-digit mobile (starting 6–9)"),
  // personal
  email: nullableFormat(EMAIL_RE, "Enter a valid email address"),
  qualification: nullableText,
  blood_group: nullableText,
  marital_status: z.enum(MARITAL_STATUSES).nullable().default(null),
  sex: z.enum(SEXES).nullable().default(null),
  nationality: nullableText,
  religion: nullableText,
  // 0277 — employment & statutory
  doj: nullableText,
  emp_type: nullableText,
  mobile: nullableFormat(MOBILE_IN_RE, "Enter a 10-digit mobile (starting 6–9)"),
  father_name: nullableText,
  mother_name: nullableText,
  spouse_name: nullableText,
  pf_no: nullableText,
  esi_no: nullableText,
  uan: nullableText,
  pan_no: nullableText,
  aadhar_no: nullableText,
  pay_mode: z.enum(PAY_MODES).nullable().default(null),
  bank_name: nullableText,
  bank_acc_no: nullableText,
  // 0279 — enrichment
  spouse_type: z.enum(SPOUSE_TYPES).nullable().default(null),
  date_of_confirmation: nullableText,
  date_of_filing: nullableText,
  employee_type: z.enum(EMPLOYEE_TYPES).nullable().default("S"),
  is_draft: z.boolean().default(false),
});
export type EmployeeInput = z.infer<typeof employeeInput>;
