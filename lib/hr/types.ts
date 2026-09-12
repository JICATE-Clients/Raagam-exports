import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

export const WORKER_TYPES = [
  "shift",
  "contractor_piece",
  "company_piece",
] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  shift: "Shift (Company)",
  contractor_piece: "Piece-rate (Contractor)",
  company_piece: "Piece-rate (Company)",
};

export const RUN_KINDS = ["worker", "staff"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const PERIOD_TYPES = ["weekly", "monthly"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const PAYROLL_STATUSES = [
  "draft",
  "calculated",
  "approved",
  "locked",
  "paid",
] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

// ---------- interfaces ----------
export interface Contractor {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  location_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  code: string | null;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  location_id: string | null;
  biometric_id: string | null;
  shift_wage_per_day: number;
  hourly_wage: number;
  piece_rate: number;
  esi_applicable: boolean;
  pf_applicable: boolean;
  joined_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A staff member — legacy EDP2 Staff's identity block plus its Detail tab
 * (migration 0534). The other legacy tabs (General, Family Details, Work
 * Experience, Reference, Nomination) are each a LIST of rows against this
 * record and will be their own tables; nothing about them belongs here.
 *
 * NO `photo` COLUMN, deliberately (0534): an image is a storage object with a
 * bucket and a policy, not a column on a row.
 *
 * AND NO `age`, ONLY `stated_age`. An age computed from `date_of_birth` is
 * right forever; a stored one is wrong the day after it is written. `stated_age`
 * (0537) is the narrow exception — what an operator TYPED for a record that has
 * no date at all — and it is never read when the date is present.
 */
export interface Staff {
  id: string;
  code: string | null;
  name: string;
  /**
   * FROM THE MASTER (0548). It was free text until then, which meant MANAGER,
   * Manager and MGR were three answers to one question and none of them linked
   * to Master Data ▸ HR ▸ Designation.
   *
   * `staff_work_experience.designation` stays TEXT on purpose: that is a title
   * held at ANOTHER company, not ours to keep a master row for.
   */
  designation_id: string | null;
  /** What `designation` said before 0548, where it matched no master row. */
  designation_legacy: string | null;
  location_id: string | null;
  monthly_salary: number;
  esi_applicable: boolean;
  pf_applicable: boolean;
  joined_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // identity — the block above the legacy tabs
  guardian_relation: GuardianRelation | null;
  guardian_name: string | null;
  mother_name: string | null;
  category_id: string | null;
  department_id: string | null;
  division_id: string | null;

  // employment
  employment_type: EmploymentType;
  card_no: string | null;
  pay_frequency: PayFrequency;
  week_off: WeekDay | null;
  hostel_category_id: string | null;
  vehicle_no: string | null;
  manager_id: string | null;

  // pay — statutory vs actual, four heads each
  stat_gross: number;
  stat_basic: number;
  stat_da: number;
  stat_hra: number;
  act_gross: number;
  act_basic: number;
  act_da: number;
  act_hra: number;

  // statutory status
  migrant_worker: boolean;
  international_worker: boolean;
  disability_type: DisabilityType | null;
  disability_pct: number;

  // dates — DOJ is `joined_date` above, deliberately not duplicated
  date_of_birth: string | null;
  /**
   * AN AGE SOMEBODY TYPED, for a record with no `date_of_birth` — never read
   * when the date is present, because the computed value wins there. Named for
   * what it is so nothing mistakes it for the authoritative answer (0537).
   */
  stated_age: number | null;
  place_of_birth: string | null;
  date_of_probation: string | null;
  date_of_confirmation: string | null;
  date_of_leaving: string | null;

  // pay mode, tax, identifiers
  pay_mode: PayMode;
  tds_applicable: boolean;
  police_station: string | null;
  pan_no: string | null;

  /**
   * A bar on a CURRENT employee, which is a different question from
   * `is_active` ("does this person still work here"). Collapsing the two would
   * make un-blocking someone indistinguishable from re-hiring them.
   */
  blocked: boolean;

  // ---- General (0535) ----
  // Two addresses, seven fields each. Columns rather than a child table:
  // there are exactly two, they are named, and nobody has three of either.
  perm_address1: string | null;
  perm_address2: string | null;
  perm_address3: string | null;
  perm_city: string | null;
  perm_pin: string | null;
  /** One number per address — `perm_mobile` went in 0549. */
  perm_phone: string | null;

  /**
   * STORED, NOT DERIVED. It records the operator's INTENT to keep the two
   * addresses in step — copying the values across and dropping the flag would
   * lose that the moment the permanent address changed.
   */
  corr_same_as_permanent: boolean;
  corr_address1: string | null;
  corr_address2: string | null;
  corr_address3: string | null;
  corr_city: string | null;
  corr_pin: string | null;
  corr_phone: string | null;

  email: string | null;
  qualification: string | null;
  blood_group: BloodGroup | null;
  identification_mark_1: string | null;
  identification_mark_2: string | null;
  gender: Gender | null;
  marital_status: MaritalStatus | null;
  nationality: string | null;
  religion: string | null;
  driving_licence_no: string | null;
  driving_licence_valid_upto: string | null;
  aadhaar_no: string | null;
  general_flag: boolean;

  // ---- Reference ----
  // The referees and emergency contacts USED to be twenty-four columns here.
  // 0547 made them lists (`StaffExternalReference` / `StaffEmergencyContact`)
  // because two was what the legacy screen could hold, not what the business
  // has. The two ADDRESSES stay columns: they are two named, different things,
  // not the first two of a list.

  // ---- Nomination (0536) ----
  // `esi_applicable` / `pf_applicable` above are DERIVED from these by a
  // database trigger; never write the boolean directly.
  esi_status: StatutoryStatus;
  esi_no: string | null;
  esi_date_of_joining: string | null;
  esi_date_of_leaving: string | null;
  esi_dispensary: string | null;
  pf_status: StatutoryStatus;
  pf_no: string | null;
  pf_date_of_joining: string | null;
  pf_date_of_leaving: string | null;
}

/**
 * One row of a staff member's Family Details grid (0536).
 *
 * Age follows the same rule as the staff member's own: computed from
 * `date_of_birth` when there is one, and read from `stated_age` (0537) when
 * there is not.
 */
export interface StaffFamilyMember {
  id: string;
  staff_id: string;
  sno: number;
  name: string | null;
  date_of_birth: string | null;
  /** As `Staff.stated_age` — the typed fallback (0537). */
  stated_age: number | null;
  alive: boolean;
  relation: string | null;
  other_information: string | null;
  residing_with_employee: boolean;
}

/**
 * One previous employer (0536). `duration` is free text and stays even though
 * the dates are here — a candidate often gives "about 3 years" for a job whose
 * exact dates they no longer have.
 */
export interface StaffWorkExperience {
  id: string;
  staff_id: string;
  sno: number;
  company_name: string | null;
  address: string | null;
  designation: string | null;
  exp_from: string | null;
  exp_to: string | null;
  duration: string | null;
  last_salary_drawn: number | null;
  reason_for_leaving: string | null;
  details: string | null;
}

/** One internal referee — a department and a colleague in it (0536). */
export interface StaffInternalReference {
  id: string;
  staff_id: string;
  sno: number;
  department_id: string | null;
  referee_id: string | null;
}

/**
 * One of a staff member's bank accounts (0535) — the legacy General tab's
 * Banks grid, which lives on the Bank Account tab here.
 *
 * A TABLE, NOT COLUMNS, because the legacy grid takes rows: a staff member can
 * hold a salary account and a savings account at once.
 */
export interface StaffBankAccountRow {
  id: string;
  staff_id: string;
  sno: number;
  bank_type: string | null;
  bank_id: string | null;
  ac_type: string | null;
  ac_no: string | null;
  ifsc_code: string | null;
  branch: string | null;
}

/**
 * One external referee (0547). A LIST, not a numbered pair: two was the legacy
 * screen's limit rather than the business's.
 */
export interface StaffExternalReference {
  id: string;
  staff_id: string;
  sno: number;
  name: string | null;
  designation: string | null;
  address1: string | null;
  address2: string | null;
  phone: string | null;
  mobile: string | null;
}

/**
 * One emergency contact (0547). Same shape as a referee but for `relation` in
 * place of `designation` — which is why they are two tables rather than one
 * with a `kind` column.
 */
export interface StaffEmergencyContact {
  id: string;
  staff_id: string;
  sno: number;
  name: string | null;
  relation: string | null;
  address1: string | null;
  address2: string | null;
  phone: string | null;
  mobile: string | null;
}

/**
 * One spell on a shift (0554). A row per spell rather than a column on the
 * person, because attendance and OT ask "which shift on THAT DAY" — a single
 * column only ever knows today, and would recompute an old payslip against a
 * shift the person was not on.
 *
 * `effective_to` null means the assignment is current. Overlapping spells are
 * refused by the database, so the question always has exactly one answer.
 */
export interface HrShiftAssignment {
  id: string;
  staff_id: string | null;
  worker_id: string | null;
  sno: number;
  shift_category_id: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

/** One nomination line — what the nomination is FOR (0536). */
export interface StaffNomination {
  id: string;
  staff_id: string;
  sno: number;
  nomination_for: string | null;
}

/** One row of the legacy General tab's Banks grid (0535). */
export interface StaffBankAccount {
  id: string;
  staff_id: string;
  sno: number;
  bank_type: string | null;
  bank_id: string | null;
  ac_type: string | null;
  ac_no: string | null;
  ifsc_code: string | null;
  branch: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollSettings {
  id: string;
  ot_multiplier: number;
  max_ot_hours_per_day: number;
  max_ot_hours_per_month: number;
  esi_rate: number;
  pf_rate: number;
  currency: string;
  updated_at: string;
}

export interface WorkerAttendance {
  id: string;
  worker_id: string;
  work_date: string;
  present: boolean;
  normal_hours: number;
  ot_hours: number;
  extra_hours: number;
  source: "biometric" | "manual";
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerPieceRecord {
  id: string;
  worker_id: string;
  work_date: string;
  pieces: number;
  sales_order_id: string | null;
  is_locked: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollRun {
  id: string;
  code: string | null;
  run_kind: RunKind;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  location_id: string | null;
  status: PayrollStatus;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollLine {
  id: string;
  payroll_run_id: string;
  worker_id: string | null;
  staff_id: string | null;
  worker_type: WorkerType | null;
  days_worked: number;
  ot_hours: number;
  ot_wage: number;
  actual_gross: number;
  esi: number;
  pf: number;
  actual_net: number;
  pieces: number;
  extra_wage: number;
  total_net: number;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ContractorPayrollRow {
  id: string;
  payroll_run_id: string;
  contractor_id: string;
  total_pieces: number;
  piece_amount: number;
  sum_actual_wages: number;
  extra_wage: number;
  created_at: string;
}

// ---------- input schemas ----------
export const contractorInput = z.object({
  name: capsName(),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ContractorInput = z.infer<typeof contractorInput>;


/**
 * THE VOCABULARIES ARE DECLARED ONCE AND MIRROR 0534's CHECK CONSTRAINTS.
 *
 * Each list is exactly the set its column accepts, so a screen's dropdown, the
 * Zod parse and the database agree by construction. Widening the set is a
 * MIGRATION, not an edit here — add a value to this array alone and Postgres
 * rejects every row that uses it.
 */
export const EMPLOYMENT_TYPES = ["Permanent", "Temporary", "Contract", "Probation", "Trainee"] as const;
export const PAY_FREQUENCIES = ["Monthly", "Weekly", "Daily", "Piece Rate"] as const;
export const WEEK_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
export const GUARDIAN_RELATIONS = ["S/O", "D/O", "W/O", "C/O"] as const;
export const PAY_MODES = ["Cash", "Bank"] as const;
/** Legacy offers L / H / V / No — "No" is the ABSENCE of a type, i.e. null. */
export const DISABILITY_TYPES = ["L", "H", "V"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const GENDERS = ["Male", "Female", "Trans Gender"] as const;
export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widow"] as const;
/**
 * ESI / PF, and EXEMPTED IS NOT "NO". An exempted employee is outside the
 * scheme by entitlement; a "No" is simply not enrolled. Both deduct nothing —
 * `staff.esi_applicable` is false for either, kept in step by a trigger (0536)
 * — and the distinction survives here for the statutory return.
 */
export const STATUTORY_STATUSES = ["Yes", "No", "Exempted"] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export type WeekDay = (typeof WEEK_DAYS)[number];
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];
export type PayMode = (typeof PAY_MODES)[number];
export type DisabilityType = (typeof DISABILITY_TYPES)[number];
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type Gender = (typeof GENDERS)[number];
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type StatutoryStatus = (typeof STATUTORY_STATUSES)[number];

/** Never negative, defaults to zero — matches the `numeric` columns' defaults. */
const money = z.coerce.number().nonnegative().default(0);

/**
 * A BLANK CONTROL SENDS "", NEVER null, and these three turn it back into null.
 *
 * An empty `<input type="date">` and an unselected `<select>` both read as the
 * empty string. Sent as-is, "" fails a `date` column's type and — worse for the
 * uuid columns — fails the FK rather than meaning "not set". Every optional
 * field below therefore goes through one of these rather than being typed
 * `.optional().nullable()` and trusted.
 */
const optText = z.string().optional().nullable().transform((v) => v || null);
/**
 * A WHOLE NUMBER THAT MAY GENUINELY BE ABSENT — a count, not a quantity.
 *
 * `money` defaults to 0, which is right for an amount and wrong for "how many
 * children": nought and unanswered are different facts, and the column is
 * nullable so the difference survives. An empty box stays null rather than
 * arriving as a confident zero.
 */
const optCount = z
  .union([z.coerce.number().int().nonnegative(), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === undefined ? null : v));
/** Same, for a measurement that carries decimals (height, weight). */
const optDecimal = z
  .union([z.coerce.number().nonnegative(), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === undefined ? null : v));
const optDate = z.string().optional().nullable().transform((v) => v || null);
const optUuid = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .nullable()
  .transform((v) => v || null);
/** Same, for an enum whose "none" is the blank option. */
const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v || null) as T[number] | null);

/**
 * THE SHARED PERSON RECORD — every field `staff` and `workers` both carry
 * (0553). Neither table's own columns are here: staff has `monthly_salary`
 * (derived), workers have their wage basis, rate type and contractor.
 *
 * One schema because the client asked for a worker's record to be the staff
 * record ("all other things are exactly same from staff"). Two copies would
 * have drifted on the first change to either.
 */
/**
 * WHICH PERSON TABLE A RECORD LIVES IN. `staff` and `workers` carry the same
 * record (0553) and share every child table, so the code that reads or writes
 * a child row needs to be told which parent column to use — this is that one
 * word, rather than a boolean nobody can read at a call site.
 */
export const PERSON_KINDS = ["staff", "worker"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/** The child tables' parent column, for a kind. */
export const PARENT_COLUMN: Record<PersonKind, "staff_id" | "worker_id"> = {
  staff: "staff_id",
  worker: "worker_id",
};

export const personInput = z.object({
  name: capsName(),
  designation_id: optUuid,
  location_id: z.string().uuid().optional().nullable(),
  /**
   * NOT IN THIS SCHEMA ANY MORE — `monthly_salary` is DERIVED from `act_gross`
   * by a trigger (0551), the way `esi_applicable` is derived from `esi_status`.
   * Sending it would be a second opinion the database overwrites on the same
   * statement. Payroll still reads the column and always will.
   */
  /**
   * `esi_applicable` / `pf_applicable` ARE NOT IN THIS SCHEMA, deliberately.
   *
   * They used to be, as booleans the Detail tab set directly. 0536 made them
   * DERIVED — a trigger sets each from `esi_status` / `pf_status` below — so a
   * value sent from here would be a second opinion the database overwrites on
   * the same statement. Leaving them in would make the form appear to control
   * something it does not, which is worse than not offering it.
   *
   * Payroll still reads the booleans and always will; the status is what an
   * operator sets, on the Nomination tab where legacy puts it.
   */
  joined_date: z.string().optional().nullable(),
  is_active: z.boolean().default(true),

  // identity — the block above the legacy tabs
  guardian_relation: optEnum(GUARDIAN_RELATIONS),
  guardian_name: optText,
  mother_name: optText,
  category_id: optUuid,
  department_id: optUuid,
  division_id: optUuid,

  // employment
  employment_type: z.enum(EMPLOYMENT_TYPES).default("Permanent"),
  card_no: optText,
  pay_frequency: z.enum(PAY_FREQUENCIES).default("Monthly"),
  week_off: optEnum(WEEK_DAYS),
  hostel_category_id: optUuid,
  vehicle_no: optText,
  manager_id: optUuid,

  // pay — statutory and actual. OTHERS is absent from both: legacy computes it
  // (gross less the named heads), and storing it invites the stored copy and
  // the arithmetic to disagree.
  stat_gross: money,
  stat_basic: money,
  stat_da: money,
  stat_hra: money,
  act_gross: money,
  act_basic: money,
  act_da: money,
  act_hra: money,

  // statutory status
  migrant_worker: z.boolean().default(false),
  international_worker: z.boolean().default(false),
  disability_type: optEnum(DISABILITY_TYPES),
  disability_pct: z.coerce.number().min(0).max(100).default(0),

  // dates — DOJ is `joined_date` above, deliberately not duplicated
  date_of_birth: optDate,
  /**
   * Blank is null, not 0 — "nobody stated an age" and "this person is a
   * newborn" are different answers and the column can hold both.
   */
  stated_age: z
    .union([z.coerce.number().int().min(0).max(120), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  place_of_birth: optText,
  date_of_probation: optDate,
  date_of_confirmation: optDate,
  date_of_leaving: optDate,

  // pay mode, tax, identifiers
  pay_mode: z.enum(PAY_MODES).default("Cash"),
  tds_applicable: z.boolean().default(false),
  police_station: optText,
  /**
   * India's PAN — uppercased, then shape-checked, and the ORDER matters: a
   * lower-case pan would fail the check before the transform could fix it.
   * The same rule is on the column (0534), because `lib/data-io` imports write
   * straight to Postgres and never reach this schema.
   */
  pan_no: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), {
      message: "PAN must be 5 letters, then 4 digits, then a letter",
    }),

  blocked: z.boolean().default(false),

  // ---- General (0535) ----
  perm_address1: optText,
  perm_address2: optText,
  perm_address3: optText,
  perm_city: optText,
  perm_pin: optText,
  perm_phone: optText,

  corr_same_as_permanent: z.boolean().default(false),
  corr_address1: optText,
  corr_address2: optText,
  corr_address3: optText,
  corr_city: optText,
  corr_pin: optText,
  corr_phone: optText,

  /**
   * NOT `capsName()` and never uppercased — a URL path and a mailbox name can
   * both be case-sensitive, which is the same carve-out AGENTS.md ▸ CAPITALS
   * makes for an email field.
   */
  email: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Enter a valid e-mail address",
    }),
  qualification: optText,
  blood_group: optEnum(BLOOD_GROUPS),
  identification_mark_1: optText,
  identification_mark_2: optText,
  gender: optEnum(GENDERS),
  marital_status: optEnum(MARITAL_STATUSES),
  nationality: optText,
  religion: optText,
  driving_licence_no: optText,
  driving_licence_valid_upto: optDate,
  /**
   * Twelve digits. The Verhoeff checksum is deliberately NOT enforced — the
   * column checks the shape (0535) and the arithmetic belongs somewhere it can
   * be reported on, not in a constraint that fails with a Postgres error.
   */
  aadhaar_no: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s/g, "") : null))
    .refine((v) => v === null || /^[0-9]{12}$/.test(v), {
      message: "Aadhaar must be 12 digits",
    }),
  general_flag: z.boolean().default(false),

  // ---- Nomination (0536) ----
  // `esi_applicable` / `pf_applicable` are NOT in this schema: a trigger
  // derives them from these two, so sending the boolean would be a second
  // opinion the database would overwrite anyway.
  esi_status: z.enum(STATUTORY_STATUSES).default("No"),
  esi_no: optText,
  esi_date_of_joining: optDate,
  esi_date_of_leaving: optDate,
  esi_dispensary: optText,
  pf_status: z.enum(STATUTORY_STATUSES).default("No"),
  pf_no: optText,
  pf_date_of_joining: optDate,
  pf_date_of_leaving: optDate,

  /* ---- Enclosure (0556) — the documents a joiner hands in ---------------- */
  passbook_no: optText,
  ration_card_no: optText,
  insurance_policy_no: optText,
  passport_no: optText,
  passport_valid_upto: optDate,
  election_card_no: optText,
  uan_no: optText,
  interview_date: optDate,

  /* ---- "Details" (0556) — how they reached us, and their household ------- */
  through_advertisement: z.boolean().default(false),
  through_voluntarily: z.boolean().default(false),
  through_knowledge: z.boolean().default(false),
  bus_no: optText,
  physique_illness: optText,
  occupation: optText,
  // A COUNT, SO IT IS BLANK RATHER THAN ZERO WHEN UNANSWERED. `money`'s
  // `.default(0)` is wrong here: "no children" and "not asked" are different
  // answers, and the column is nullable so the distinction survives.
  no_of_children: optCount,
  dependants: optCount,
  earning_members: optCount,
  properties_owned: optText,
  professional_membership: optText,
  extra_curricular: optText,
  achievement_details: optText,
  disciplinary_actions: optText,

  /* ---- "Other Details" (0556) — physical particulars, IDs, grade --------- */
  mother_tongue: optText,
  height_cm: optDecimal,
  weight_kg: optDecimal,
  eye_sight: optText,
  house_type: optText,
  id_submitted_dl: z.boolean().default(false),
  id_submitted_vote_id: z.boolean().default(false),
  id_submitted_ration: z.boolean().default(false),
  id_submitted_passport: z.boolean().default(false),
  id_submitted_tc: z.boolean().default(false),
  id_submitted_mark_sheet: z.boolean().default(false),
  id_submitted_aadhaar: z.boolean().default(false),
  id_submitted_pan: z.boolean().default(false),
  id_submitted_others: z.boolean().default(false),
  id_submitted_specify: optText,
  prior_experience: optText,
  handicap_details: optText,
  has_passport: z.boolean().default(false),
  two_wheeler_licence: z.boolean().default(false),
  four_wheeler_licence: z.boolean().default(false),
  major_operation: z.boolean().default(false),
  operation_details: optText,
  only_earning_member: z.boolean().default(false),
  willing_donate_blood: z.boolean().default(false),
  grade: optText,
  employee_classification: optText,
});

/** A child row as the form holds it — `key` is React's, never persisted. */
export const staffFamilyInput = z.object({
  name: optText,
  date_of_birth: optDate,
  stated_age: z
    .union([z.coerce.number().int().min(0).max(120), z.literal("")])
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  alive: z.boolean().default(true),
  relation: optText,
  other_information: optText,
  residing_with_employee: z.boolean().default(false),
});
export type StaffFamilyInput = z.infer<typeof staffFamilyInput>;

export const staffExperienceInput = z.object({
  company_name: optText,
  address: optText,
  designation: optText,
  exp_from: optDate,
  exp_to: optDate,
  duration: optText,
  last_salary_drawn: z.coerce.number().nonnegative().nullable().default(null),
  reason_for_leaving: optText,
  details: optText,
});
export type StaffExperienceInput = z.infer<typeof staffExperienceInput>;

export const staffInternalRefInput = z.object({
  department_id: optUuid,
  referee_id: optUuid,
});
export type StaffInternalRefInput = z.infer<typeof staffInternalRefInput>;

export const staffBankAccountInput = z.object({
  bank_type: optText,
  bank_id: optUuid,
  ac_type: optText,
  ac_no: optText,
  /**
   * India's IFSC: four letters, a zero, then six alphanumerics. Uppercased
   * before the check, and the column carries the same regex (0535) because
   * `lib/data-io` imports never reach this schema.
   */
  ifsc_code: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase().replace(/\s/g, "") : null))
    .refine((v) => v === null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), {
      message: "IFSC must be 4 letters, a zero, then 6 characters",
    }),
  branch: optText,
});
export type StaffBankAccountInput = z.infer<typeof staffBankAccountInput>;

export const staffNominationInput = z.object({
  nomination_for: optText,
});
export type StaffNominationInput = z.infer<typeof staffNominationInput>;

/* ---- the three grids behind General's popups (0556) --------------------- */

/** Education Details — schooling, one row per qualification. */
export const staffEducationInput = z.object({
  type_of_training: optText,
  institution: optText,
  month_year_passed: optText,
  class_marks: optText,
  special_subjects: optText,
});
export type StaffEducationInput = z.infer<typeof staffEducationInput>;

/** Technical Details — trade training, beside Education on the same popup. */
export const staffTechnicalInput = z.object({
  qualification: optText,
  institution: optText,
  major_subject: optText,
  class_pct: optText,
  duration: optText,
});
export type StaffTechnicalInput = z.infer<typeof staffTechnicalInput>;

/**
 * Language Details. Legacy's grid is Speak / Read / Write with no column naming
 * the LANGUAGE — the row is typed into the "Speak" cell. A row that cannot say
 * which tongue it is about is not a record, so `language` is a column of its
 * own and the three abilities become what they are: ticks.
 */
export const staffLanguageInput = z.object({
  language: optText,
  can_speak: z.boolean().default(false),
  can_read: z.boolean().default(false),
  can_write: z.boolean().default(false),
});
export type StaffLanguageInput = z.infer<typeof staffLanguageInput>;
export type PersonInput = z.infer<typeof personInput>;

/** Staff add nothing of their own — `monthly_salary` is derived (0551). */
export const staffInput = personInput;
export type StaffInput = PersonInput;

// `workerInput` MUST FOLLOW `personInput`: it extends it, and a `const` is
// not hoisted — declared above, it read as used-before-assigned.

/**
 * A WORKER IS THE PERSON RECORD PLUS A WAGE BASIS.
 *
 * `worker_type` is legacy's "Type" (Shift Rate / piece), `contractor_id` its
 * "Under Contractor", and the three wage columns are what
 * `computeActualWage` (lib/hr/calc.ts) actually pays from — which is why a
 * worker has no `monthly_salary`.
 *
 * `esi_applicable` / `pf_applicable` are ABSENT for the same reason they are
 * absent from `personInput`: a trigger derives them from `esi_status` /
 * `pf_status` (0553 extends 0536's to this table), so a value sent here would
 * be overwritten on the same statement.
 */
export const workerInput = personInput.extend({
  worker_type: z.enum(WORKER_TYPES),
  contractor_id: optUuid,
  biometric_id: optText,
  shift_wage_per_day: money,
  hourly_wage: money,
  piece_rate: money,
  /** The production department the worker is on — legacy's "Prod. Dept". */
  prod_dept_id: optUuid,
  /** Legacy's "CTC / Shift". */
  ctc_per_shift: money,
});
export type WorkerInput = z.infer<typeof workerInput>;

export const payrollSettingsInput = z.object({
  ot_multiplier: z.coerce.number().min(1).default(2),
  max_ot_hours_per_day: z.coerce.number().min(0).default(4),
  max_ot_hours_per_month: z.coerce.number().min(0).default(50),
  esi_rate: z.coerce.number().min(0).max(1).default(0.0075),
  pf_rate: z.coerce.number().min(0).max(1).default(0.12),
  currency: z.string().default("INR"),
});
export type PayrollSettingsInput = z.infer<typeof payrollSettingsInput>;

export const attendanceInput = z.object({
  worker_id: z.string().uuid(),
  work_date: z.string(),
  present: z.boolean().default(true),
  normal_hours: z.coerce.number().min(0).default(0),
  ot_hours: z.coerce.number().min(0).default(0),
  extra_hours: z.coerce.number().min(0).default(0),
  source: z.enum(["biometric", "manual"]).default("manual"),
  note: z.string().optional().nullable(),
});
export type AttendanceInput = z.infer<typeof attendanceInput>;

export const pieceRecordInput = z.object({
  worker_id: z.string().uuid(),
  work_date: z.string(),
  pieces: z.coerce.number().int().nonnegative().default(0),
  sales_order_id: z.string().uuid().optional().nullable(),
});
export type PieceRecordInput = z.infer<typeof pieceRecordInput>;

export const payrollRunInput = z.object({
  run_kind: z.enum(RUN_KINDS).default("worker"),
  period_type: z.enum(PERIOD_TYPES).default("weekly"),
  period_start: z.string(),
  period_end: z.string(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PayrollRunInput = z.infer<typeof payrollRunInput>;
