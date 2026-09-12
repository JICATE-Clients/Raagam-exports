"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { usePathname, useRouter } from "next/navigation";
import {
  DISABILITY_TYPES,
  GUARDIAN_RELATIONS,
  PAY_MODES,
  BLOOD_GROUPS,
  MARITAL_STATUSES,
  PAY_FREQUENCIES,
  GENDERS,
  STATUTORY_STATUSES,
  EMPLOYMENT_TYPES,
  WEEK_DAYS,
  WORKER_TYPES,
  WORKER_TYPE_LABELS,
  type PersonInput,
  type PersonKind,
  type WorkerInput,
} from "@/lib/hr/types";
import type {
  StaffRow,
  WorkerRow,
  LocationOption,
} from "@/lib/hr/masters-service";
import {
  createStaff,
  updateStaff,
  createWorker,
  updateWorker,
} from "@/lib/hr/masters-actions";
import { getPersonChildren } from "./person-children";
import { fmtMoney } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import {
  ChildGrid,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkDeleteBar } from "@/components/data-io/bulk-delete-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import { withCreatedColumns } from "@/components/ui/created-columns";
import {
  MasterFullScreen,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { sectionValidity } from "@/lib/screens/validity";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRegisterWorkspaceTab } from "@/lib/workspace-tabs";
import { personSections } from "./person-sections";

/**
 * THE CHILD ROWS THE THREE GRID TABS HOLD.
 *
 * `key` is React's, never persisted — `ChildGrid` requires `{ key: string }`
 * and rows are re-keyed on every load, so it cannot be the database id.
 *
 * No `age` on a family member and no computed duration on an experience line:
 * both are arithmetic on dates already in the row, and a stored copy is wrong
 * the day after it is written (0536 states the same).
 */
type FamilyRow = {
  key: string;
  name: string;
  date_of_birth: string;
  stated_age: string;
  alive: boolean;
  relation: string;
  other_information: string;
  residing_with_employee: boolean;
};
/* ---- the three grids behind General's popups (0556) --------------------- */

type EducationRow = {
  key: string;
  type_of_training: string;
  institution: string;
  month_year_passed: string;
  class_marks: string;
  special_subjects: string;
};
const blankEducation = (key: string): EducationRow => ({
  key,
  type_of_training: "",
  institution: "",
  month_year_passed: "",
  class_marks: "",
  special_subjects: "",
});

type TechnicalRow = {
  key: string;
  qualification: string;
  institution: string;
  major_subject: string;
  class_pct: string;
  duration: string;
};
const blankTechnical = (key: string): TechnicalRow => ({
  key,
  qualification: "",
  institution: "",
  major_subject: "",
  class_pct: "",
  duration: "",
});

type LanguageRow = {
  key: string;
  language: string;
  can_speak: boolean;
  can_read: boolean;
  can_write: boolean;
};
/**
 * EVERY TICK STARTS FALSE. A seeded row is saved unless the save side drops it,
 * so a default of `true` here would turn its clause in the blank-row filter
 * into the constant `true` wearing the shape of evidence — the Material BOM
 * phantom-line bug AGENTS.md records.
 */
const blankLanguage = (key: string): LanguageRow => ({
  key,
  language: "",
  can_speak: false,
  can_read: false,
  can_write: false,
});

const blankFamily = (key: string): FamilyRow => ({
  key,
  name: "",
  date_of_birth: "",
  stated_age: "",
  // Presumed living: an unticked box on a new row would state the opposite by
  // accident, which is why the column defaults true as well.
  alive: true,
  relation: "",
  other_information: "",
  residing_with_employee: false,
});

type ExperienceRow = {
  key: string;
  company_name: string;
  address: string;
  designation: string;
  exp_from: string;
  exp_to: string;
  duration: string;
  last_salary_drawn: string;
  reason_for_leaving: string;
  details: string;
};
const blankExperience = (key: string): ExperienceRow => ({
  key,
  company_name: "",
  address: "",
  designation: "",
  exp_from: "",
  exp_to: "",
  duration: "",
  last_salary_drawn: "",
  reason_for_leaving: "",
  details: "",
});

type InternalRefRow = {
  key: string;
  department_id: string;
  referee_id: string;
};
const blankInternalRef = (key: string): InternalRefRow => ({
  key,
  department_id: "",
  referee_id: "",
});

/**
 * One bank account (0535). A ROW, not columns: legacy's Banks grid takes
 * several, and a staff member can genuinely hold a salary account and a
 * savings account at once.
 */
type BankAccountRow = {
  key: string;
  bank_type: string;
  bank_id: string;
  ac_type: string;
  ac_no: string;
  ifsc_code: string;
  branch: string;
};
const blankBankAccount = (key: string): BankAccountRow => ({
  key,
  bank_type: "",
  bank_id: "",
  ac_type: "",
  ac_no: "",
  ifsc_code: "",
  branch: "",
});

/**
 * An external referee and an emergency contact (0547).
 *
 * These were TWO NUMBERED BLOCKS of fields until the client asked for lists
 * ("we cna add it for add external ref and add emergency contact like before").
 * Two was the legacy screen's limit, not the business's.
 *
 * The shapes differ by one field — `designation` against `relation` — which is
 * why they are two tables and two types rather than one with a `kind`
 * discriminator: an emergency contact is reached as a person, not in a
 * professional capacity.
 */
type ExternalRefRow = {
  key: string;
  name: string;
  designation: string;
  address1: string;
  address2: string;
  phone: string;
  mobile: string;
};
const blankExternalRef = (key: string): ExternalRefRow => ({
  key,
  name: "",
  designation: "",
  address1: "",
  address2: "",
  phone: "",
  mobile: "",
});

type EmergencyRow = {
  key: string;
  name: string;
  relation: string;
  address1: string;
  address2: string;
  phone: string;
  mobile: string;
};
const blankEmergency = (key: string): EmergencyRow => ({
  key,
  name: "",
  relation: "",
  address1: "",
  address2: "",
  phone: "",
  mobile: "",
});

/**
 * One spell on a shift (0554). Dated, because attendance and OT ask which
 * shift a person was on THAT DAY — a single field on Detail would only ever
 * know today.
 */
type ShiftRow = {
  key: string;
  shift_category_id: string;
  effective_from: string;
  effective_to: string;
  notes: string;
};
const blankShift = (key: string): ShiftRow => ({
  key,
  shift_category_id: "",
  // Today, because a new assignment almost always starts now — and the column
  // is NOT NULL, so a blank would be refused rather than defaulted.
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  notes: "",
});

type NominationRow = { key: string; nomination_for: string };
const blankNomination = (key: string): NominationRow => ({
  key,
  nomination_for: "",
});

/**
 * COMPLETED YEARS SINCE A DATE OF BIRTH, or null if there is none to work from.
 *
 * NOT STORED, ANYWHERE — 0534 and 0536 both leave `age` out on purpose: it is
 * arithmetic on a date already in the row, and a stored copy is wrong from the
 * day after it is written. Legacy shows Age beside DOB on both the staff member
 * and each family member, so this is used twice; one function rather than two
 * copies that could disagree about whether a birthday has passed.
 */
function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(+d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  // The birthday has not come round yet this year.
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age < 0 ? null : age;
}

/**
 * WHOLE MONTHS BETWEEN TWO DATES, as "3y 4m" — the legacy Duration column,
 * computed rather than stored.
 *
 * Returns null unless BOTH dates are present and ordered, which is why the
 * `duration` column survives: a candidate often gives "about 3 years" for a job
 * whose exact dates they no longer have, and the typed text is shown then.
 */
function monthsBetween(from: string, to: string): string | null {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(+a) || Number.isNaN(+b) || b < a) return null;
  let months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  if (months < 0) return null;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? `${y}y ${m}m` : `${m}m`;
}

/** An option row from a master, carrying its disabled flag — see page.tsx. */
type MasterOption = { id: string; name: string; inactive: boolean };

/**
 * A BLANK STAFF RECORD, and every default matches the column default in 0534 —
 * so an untouched form saves the row Postgres would have created anyway.
 */
const PERSON_DEFAULTS: PersonInput = {
  name: "",
  designation_id: null,
  location_id: null,
  joined_date: null,
  is_active: true,

  guardian_relation: "S/O",
  guardian_name: null,
  mother_name: null,
  category_id: null,
  department_id: null,
  division_id: null,

  employment_type: "Permanent",
  card_no: null,
  pay_frequency: "Monthly",
  week_off: "Sunday",
  hostel_category_id: null,
  vehicle_no: null,
  manager_id: null,

  stat_gross: 0,
  stat_basic: 0,
  stat_da: 0,
  stat_hra: 0,
  act_gross: 0,
  act_basic: 0,
  act_da: 0,
  act_hra: 0,

  migrant_worker: false,
  international_worker: false,
  disability_type: null,
  disability_pct: 0,

  date_of_birth: null,
  stated_age: null,
  place_of_birth: null,
  date_of_probation: null,
  date_of_confirmation: null,
  date_of_leaving: null,

  pay_mode: "Cash",
  tds_applicable: false,
  police_station: null,
  pan_no: null,

  blocked: false,

  // General (0535)
  perm_address1: null,
  perm_address2: null,
  perm_address3: null,
  perm_city: null,
  perm_pin: null,
  perm_phone: null,

  corr_same_as_permanent: false,
  corr_address1: null,
  corr_address2: null,
  corr_address3: null,
  corr_city: null,
  corr_pin: null,
  corr_phone: null,

  email: null,
  qualification: null,
  blood_group: null,
  identification_mark_1: null,
  identification_mark_2: null,
  gender: null,
  marital_status: null,
  nationality: null,
  religion: null,
  driving_licence_no: null,
  driving_licence_valid_upto: null,
  aadhaar_no: null,
  general_flag: false,

  // Nomination (0536). `esi_applicable` / `pf_applicable` are absent because a
  // trigger derives them from these — see the note in `staffInput`.
  esi_status: "No",
  esi_no: null,
  esi_date_of_joining: null,
  esi_date_of_leaving: null,
  esi_dispensary: null,
  pf_status: "No",
  pf_no: null,
  pf_date_of_joining: null,
  pf_date_of_leaving: null,

  /* Enclosure (0556) */
  passbook_no: null,
  ration_card_no: null,
  insurance_policy_no: null,
  passport_no: null,
  passport_valid_upto: null,
  election_card_no: null,
  uan_no: null,
  interview_date: null,

  /* "Details" (0556) — the three radios open on No, as legacy's do. */
  through_advertisement: false,
  through_voluntarily: false,
  through_knowledge: false,
  bus_no: null,
  physique_illness: null,
  occupation: null,
  no_of_children: null,
  dependants: null,
  earning_members: null,
  properties_owned: null,
  professional_membership: null,
  extra_curricular: null,
  achievement_details: null,
  disciplinary_actions: null,

  /* "Other Details" (0556) */
  mother_tongue: null,
  height_cm: null,
  weight_kg: null,
  eye_sight: null,
  house_type: null,
  id_submitted_dl: false,
  id_submitted_vote_id: false,
  id_submitted_ration: false,
  id_submitted_passport: false,
  id_submitted_tc: false,
  id_submitted_mark_sheet: false,
  id_submitted_aadhaar: false,
  id_submitted_pan: false,
  id_submitted_others: false,
  id_submitted_specify: null,
  prior_experience: null,
  handicap_details: null,
  has_passport: false,
  two_wheeler_licence: false,
  four_wheeler_licence: false,
  major_operation: false,
  operation_details: null,
  only_earning_member: false,
  willing_donate_blood: false,
  grade: null,
  employee_classification: null,
};

/**
 * A WORKER'S OWN FIELDS, on top of the shared record. Legacy's Worker Detail
 * adds four boxes to the ones Staff has: the rate Type, the contractor worked
 * under, the production department and a CTC per shift (0553).
 */
const WORKER_DEFAULTS: WorkerInput = {
  ...PERSON_DEFAULTS,
  worker_type: "shift",
  contractor_id: null,
  biometric_id: null,
  shift_wage_per_day: 0,
  hourly_wage: 0,
  piece_rate: 0,
  prod_dept_id: null,
  ctc_per_shift: 0,
};

/**
 * THE ID NO A NEW RECORD IS ABOUT TO GET — 01, 02, 03 (client 2026-09-11:
 * "the ID NO should be automatically fill like 01 02 like that for now").
 *
 * ## THE TRIGGER IS STILL THE AUTHORITY; THIS IS A PREVIEW
 *
 * `code` is assigned by `hr_assign_person_code` on insert (0555) and the form
 * never sends it, which is what keeps two operators saving at the same moment
 * from both claiming 03 — a sequence settles that, and `code` is `text unique`
 * besides. So this computes what the box should SHOW, not what gets stored.
 *
 * ## IT READS THE ROWS, NOT THE SEQUENCE, AND CAN THEREFORE DRIFT
 *
 * Deleting the last staff member leaves the sequence where it was, so the next
 * record previews 03 and saves as 04. That is the same trade Order Entry makes
 * with `previewNo`, and it is worth making: the rows are already on the client,
 * so this answers in the render that opens the editor rather than after a round
 * trip. The saved value replaces the preview, so the divergence lasts until
 * Save and never reaches the stored record.
 *
 * Codes that are not plain numbers are ignored rather than parsed — the two
 * tables carry `STF-0001` / `WRK-0001` rows from before 0555, and an import may
 * bring its own ID No, both of which `Number()` reads as NaN.
 */
function nextCodePreview(rows: PersonRow[]): string {
  const highest = rows.reduce((max, r) => {
    const n = Number((r.code ?? "").trim());
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  // `padStart(2, "0")` only PADS — 99 is followed by 100, not by a wrap.
  return String(highest + 1).padStart(2, "0");
}

/** A row from either table, as the list renders it. */
export type PersonRow = StaffRow | WorkerRow;

/**
 * The handful of words that differ between the two screens. Everything else —
 * every section, every field, every grid — is shared, which is the whole point
 * of this component.
 */
const COPY = {
  staff: {
    entity: "Staff",
    // The workspace tab and the page header say the same thing, and "Staff" is
    // already plural — `${entity}s` would put "Staffs" on the tab.
    tab: "Staff",
    // The list branch draws its own PageHeader (the edit branch replaces it with
    // an identity band), so the wording lives here beside the rest of the copy
    // rather than in each route's `page.tsx`.
    pageTitle: "Staff",
    pageDescription: "Manage salaried staff members.",
    lower: "staff",
    ioKey: "staff",
    empty: "No staff yet.",
    payFrequency: "Salary Paid",
    gross: "Gross Salary",
  },
  worker: {
    entity: "Worker",
    tab: "Workers",
    pageTitle: "Workers",
    pageDescription: "Manage shift workers and piece-rate workers.",
    lower: "worker",
    ioKey: "workers",
    empty: "No workers yet.",
    // Legacy calls the same column "Wages Paid" and "Gross Wages" on this
    // screen. The COLUMNS are `pay_frequency` and `act_gross` either way —
    // 0553 renamed them precisely so one schema could carry both labels.
    payFrequency: "Wages Paid",
    gross: "Gross Wages",
  },
} as const;

/**
 * THE PERSON RECORD EDITOR — staff and workers, one component.
 *
 * The client asked for a worker's record to be the staff record ("all other
 * things are exactly same from staff", 2026-09-09). A second copy of this file
 * would have been ~2,600 lines that drift apart on the first change to either —
 * and every change asked for over the last two days would have needed doing
 * twice.
 *
 * `kind` picks the four things that genuinely differ: the labels in `COPY`, the
 * extra Detail fields a worker carries, which list columns show, and which pair
 * of server actions the save calls.
 */
export default function PersonClient({
  kind,
  rows,
  locations,
  departments,
  divisions,
  categories,
  hostelCategories,
  banks,
  designations,
  contractors = [],
  shiftCategories = [],
  canCreate = false,
  canExport = false,
  canDelete = false,
}: {
  kind: PersonKind;
  rows: PersonRow[];
  locations: LocationOption[];
  departments: MasterOption[];
  divisions: MasterOption[];
  categories: MasterOption[];
  hostelCategories: MasterOption[];
  banks: MasterOption[];
  designations: MasterOption[];
  /** Workers only — legacy's "Under Contractor". Empty for staff. */
  contractors?: MasterOption[];
  /** `config_lookups` kind 'shift_category' — the shifts a person may be on. */
  shiftCategories?: MasterOption[];
  canCreate?: boolean;
  canExport?: boolean;
  canDelete?: boolean;
}) {
  const isWorker = kind === "worker";
  const copy = COPY[kind];
  const DEFAULTS = (
    isWorker ? WORKER_DEFAULTS : PERSON_DEFAULTS
  ) as PersonInput;
  const router = useRouter();
  const pathname = usePathname();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  useCreateIntent(() => setShowForm(true));
  const [editId, setEditId] = useState<string | null>(null);
  /**
   * The record's ID No. Not part of `form`: `staff.code` is assigned by a
   * database trigger on insert (`trg_staff_code`, 0013), so the form never
   * sends it and there is nothing for the operator to edit. Held separately for
   * the same reason the descriptor engine keeps `autoId` off its `fields`.
   */
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState<PersonInput>(DEFAULTS);
  const [saved, setSaved] = useState<PersonInput>(DEFAULTS);
  const sel = useRowSelection();
  const shellRef = useRef<MasterFullScreenHandle>(null);

  const set = (patch: Partial<PersonInput>) =>
    setForm((f) => ({ ...f, ...patch }));

  /**
   * A REAL DIRTY FLAG, not "does the form hold values".
   *
   * On an existing record every field holds something, so a guess derived from
   * the values would read as dirty the moment the editor opened — which would
   * both mislabel the footer and, through `useUnsavedGuard` below, pin the
   * silent PWA auto-update off for as long as anyone sat on the screen.
   */
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved],
  );

  /**
   * THE SCREEN DECLARES THIS ITSELF, and an overlay mount is exactly when it
   * must. `MasterFullScreen` calls `useModalGuard(open)` for an overlay, and
   * `confirmDiscard()` deliberately does not read that one — "an open overlay is
   * not the same thing as edited data" (`lib/reload-guard.ts`). Without this,
   * Escape discards a half-entered staff record silently.
   */
  useUnsavedGuard(showForm && (dirty || isPending));

  /**
   * THE WORKSPACE TAB, WITH THE SAME DIRTY FLAG THE RELOAD GUARD READS.
   *
   * The bar already gives every non-hub route a tab, titled from the pathname
   * — so this is not what makes HR appear there. What it adds is the two things
   * only the screen knows: its real name ("Staff", not a guess derived from
   * "/hr/staff"), and whether it is holding unsaved work.
   *
   * `dirty` is deliberately the SAME value passed to `useUnsavedGuard` above,
   * not a second flag: the tab's dot and the reload guard are two views onto
   * one fact, and computing them separately is how they come to disagree.
   */
  useRegisterWorkspaceTab({
    href: pathname,
    title: copy.tab,
    dirty: showForm && (dirty || isPending),
  });

  function openAdd() {
    setForm(DEFAULTS);
    setSaved(DEFAULTS);
    // The child lists are state of their own, so they have to be cleared here
    // as well — otherwise a new record opens holding the last one's family.
    setFamily([]);
    setExperience([]);
    setInternalRefs([]);
    setNominations([]);
    setBankAccounts([]);
    setExternalRefs([]);
    setEmergencyContacts([]);
    setShifts([]);
    setEducation([]);
    setTechnical([]);
    setLanguages([]);
    setEditId(null);
    // Not `null`: the box shows the number this record is about to be given.
    setEditCode(nextCodePreview(rows));
    setShowForm(true);
  }

  /**
   * BUILT BY WALKING `DEFAULTS`, NOT BY LISTING THE FIELDS.
   *
   * The hand-written version named eight; 0534 added forty-one more, and every
   * one would have silently reverted to its default the moment anyone edited a
   * record — a save that quietly blanks fields nobody touched. Reading the keys
   * off `DEFAULTS` means a new field is carried the moment it has a default,
   * which it must have anyway.
   *
   * The default is also the fallback for a column that is null on an OLD row:
   * the migration is additive, so rows created before it hold null where the
   * form expects a value.
   */
  function openEdit(s: PersonRow) {
    const row = s as unknown as Record<string, unknown>;
    const next = Object.fromEntries(
      (Object.keys(DEFAULTS) as (keyof PersonInput)[]).map((k) => [
        k,
        row[k] ?? DEFAULTS[k],
      ]),
    ) as PersonInput;
    setForm(next);
    setSaved(next);
    setEditId(s.id);
    setEditCode(s.code);
    setShowForm(true);

    /**
     * THE CHILD LISTS ARE FETCHED WHEN THE RECORD OPENS, not carried on the
     * list query. `listStaff` returns every staff member; joining four
     * one-to-many relations onto it would make the list page load every family
     * member of every employee to render a table that shows none of them.
     *
     * The editor opens immediately and the grids fill a moment later — which is
     * right for a rail whose first section is Detail, not Family.
     */
    setChildrenLoading(true);
    getPersonChildren(kind, s.id)
      .then((c) => {
        setFamily(
          c.family.map((r) => ({
            key: newKey(),
            name: r.name ?? "",
            date_of_birth: r.date_of_birth ?? "",
            stated_age: r.stated_age == null ? "" : String(r.stated_age),
            alive: r.alive,
            relation: r.relation ?? "",
            other_information: r.other_information ?? "",
            residing_with_employee: r.residing_with_employee,
          })),
        );
        setExperience(
          c.experience.map((r) => ({
            key: newKey(),
            company_name: r.company_name ?? "",
            address: r.address ?? "",
            designation: r.designation ?? "",
            exp_from: r.exp_from ?? "",
            exp_to: r.exp_to ?? "",
            duration: r.duration ?? "",
            last_salary_drawn:
              r.last_salary_drawn == null ? "" : String(r.last_salary_drawn),
            reason_for_leaving: r.reason_for_leaving ?? "",
            details: r.details ?? "",
          })),
        );
        setInternalRefs(
          c.internalRefs.map((r) => ({
            key: newKey(),
            department_id: r.department_id ?? "",
            referee_id: r.referee_id ?? "",
          })),
        );
        setNominations(
          c.nominations.map((r) => ({
            key: newKey(),
            nomination_for: r.nomination_for ?? "",
          })),
        );
        setBankAccounts(
          c.bankAccounts.map((r) => ({
            key: newKey(),
            bank_type: r.bank_type ?? "",
            bank_id: r.bank_id ?? "",
            ac_type: r.ac_type ?? "",
            ac_no: r.ac_no ?? "",
            ifsc_code: r.ifsc_code ?? "",
            branch: r.branch ?? "",
          })),
        );
        setExternalRefs(
          c.externalRefs.map((r) => ({
            key: newKey(),
            name: r.name ?? "",
            designation: r.designation ?? "",
            address1: r.address1 ?? "",
            address2: r.address2 ?? "",
            phone: r.phone ?? "",
            mobile: r.mobile ?? "",
          })),
        );
        setEmergencyContacts(
          c.emergencyContacts.map((r) => ({
            key: newKey(),
            name: r.name ?? "",
            relation: r.relation ?? "",
            address1: r.address1 ?? "",
            address2: r.address2 ?? "",
            phone: r.phone ?? "",
            mobile: r.mobile ?? "",
          })),
        );
        setShifts(
          c.shifts.map((r) => ({
            key: newKey(),
            shift_category_id: r.shift_category_id,
            effective_from: r.effective_from,
            effective_to: r.effective_to ?? "",
            notes: r.notes ?? "",
          })),
        );
        setEducation(
          c.education.map((r) => ({
            key: newKey(),
            type_of_training: (r.type_of_training as string) ?? "",
            institution: (r.institution as string) ?? "",
            month_year_passed: (r.month_year_passed as string) ?? "",
            class_marks: (r.class_marks as string) ?? "",
            special_subjects: (r.special_subjects as string) ?? "",
          })),
        );
        setTechnical(
          c.technical.map((r) => ({
            key: newKey(),
            qualification: (r.qualification as string) ?? "",
            institution: (r.institution as string) ?? "",
            major_subject: (r.major_subject as string) ?? "",
            class_pct: (r.class_pct as string) ?? "",
            duration: (r.duration as string) ?? "",
          })),
        );
        setLanguages(
          c.languages.map((r) => ({
            key: newKey(),
            language: (r.language as string) ?? "",
            can_speak: !!r.can_speak,
            can_read: !!r.can_read,
            can_write: !!r.can_write,
          })),
        );
      })
      .catch((e: unknown) =>
        toastError(e instanceof Error ? e.message : "Could not load details."),
      )
      .finally(() => setChildrenLoading(false));
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function submit() {
    const children = childPayload;
    startTransition(async () => {
      /**
       * THE ONE PLACE THE TWO TABLES PART. `personInput` is the shared shape;
       * a worker's payload carries four more keys and goes to a different pair
       * of actions, each with its own Zod schema and its own permission check.
       */
      const result = isWorker
        ? editId
          ? await updateWorker(editId, form as WorkerInput, children)
          : await createWorker(form as WorkerInput, children)
        : editId
          ? await updateStaff(editId, form, children)
          : await createStaff(form, children);
      if (result.ok) {
        success(`${copy.entity} ${editId ? "updated" : "created"}.`);
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  /**
   * THE CHILD ROWS. Held beside `form` rather than inside it because they are
   * separate tables — `staffInput` describes the `staff` row and nothing else,
   * and folding arrays into it would put them in the same payload the column
   * schema parses.
   *
   * `keySeq` is a monotonic counter for React keys only. It is a ref, not
   * state: bumping it must not re-render, and two rows added in one tick must
   * not collide on the same key.
   */
  const [family, setFamily] = useState<FamilyRow[]>([]);
  const [experience, setExperience] = useState<ExperienceRow[]>([]);
  const [internalRefs, setInternalRefs] = useState<InternalRefRow[]>([]);
  const [nominations, setNominations] = useState<NominationRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [externalRefs, setExternalRefs] = useState<ExternalRefRow[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyRow[]>(
    [],
  );
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [technical, setTechnical] = useState<TechnicalRow[]>([]);
  const [languages, setLanguages] = useState<LanguageRow[]>([]);
  /** True while `getStaffChildren` is in flight — the grids are empty until then. */
  const [childrenLoading, setChildrenLoading] = useState(false);

  /**
   * WHAT WILL ACTUALLY BE SAVED, and the ONE answer both the save and the rail
   * dots read.
   *
   * A ROW IS DROPPED IF IT IS BLANK. `seedRow` opens every grid with one empty
   * line so the first entry costs no click — and an operator who never touches
   * Family Details would otherwise save an empty family member.
   *
   * A PLAIN CONST, NOT `useMemo`. It filters a handful of short arrays, and
   * the React Compiler memoizes it — a hand-written `useMemo` here made the
   * compiler skip optimising the whole component ("existing memoization could
   * not be preserved"), which costs more than it saved.
   *
   * THE DOTS READ IT TOO. `seedRow` calls the grid's
   * `onAdd` the moment a section mounts, so `family.length > 0` becomes true by
   * merely LOOKING at the tab — and the blank it counted is then filtered out
   * here and never saved. The dot claimed data the record did not have, on all
   * six grids. Deriving both from this list makes "the dot is on" and "a row
   * will be written" the same statement.
   */
  const childPayload = {
    family: family
      .filter(
        (r) => r.name.trim() || r.relation.trim() || r.other_information.trim(),
      )
      .map((r) => ({
        name: r.name.trim() || null,
        date_of_birth: r.date_of_birth || null,
        stated_age: r.stated_age === "" ? null : Number(r.stated_age),
        alive: r.alive,
        relation: r.relation.trim() || null,
        other_information: r.other_information.trim() || null,
        residing_with_employee: r.residing_with_employee,
      })),
    experience: experience
      .filter((r) => r.company_name.trim() || r.designation.trim())
      .map((r) => ({
        company_name: r.company_name.trim() || null,
        address: r.address.trim() || null,
        designation: r.designation.trim() || null,
        exp_from: r.exp_from || null,
        exp_to: r.exp_to || null,
        duration: r.duration.trim() || null,
        last_salary_drawn:
          r.last_salary_drawn === "" ? null : Number(r.last_salary_drawn),
        reason_for_leaving: r.reason_for_leaving.trim() || null,
        details: r.details.trim() || null,
      })),
    internalRefs: internalRefs
      .filter((r) => r.department_id || r.referee_id)
      .map((r) => ({
        department_id: r.department_id || null,
        referee_id: r.referee_id || null,
      })),
    nominations: nominations
      .filter((r) => r.nomination_for.trim())
      .map((r) => ({ nomination_for: r.nomination_for.trim() })),
    bankAccounts: bankAccounts
      .filter((r) => r.ac_no.trim() || r.bank_id || r.ifsc_code.trim())
      .map((r) => ({
        bank_type: r.bank_type.trim() || null,
        bank_id: r.bank_id || null,
        ac_type: r.ac_type.trim() || null,
        ac_no: r.ac_no.trim() || null,
        // Uppercased here as well as in Zod: the column's own regex is
        // case-sensitive and `lib/data-io` never reaches the schema.
        ifsc_code: r.ifsc_code.trim().toUpperCase() || null,
        branch: r.branch.trim() || null,
      })),
    externalRefs: externalRefs
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        designation: r.designation.trim() || null,
        address1: r.address1.trim() || null,
        address2: r.address2.trim() || null,
        phone: r.phone.trim() || null,
        mobile: r.mobile.trim() || null,
      })),
    emergencyContacts: emergencyContacts
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        relation: r.relation.trim() || null,
        address1: r.address1.trim() || null,
        address2: r.address2.trim() || null,
        phone: r.phone.trim() || null,
        mobile: r.mobile.trim() || null,
      })),
    // A spell with no shift chosen is not a spell — `shift_category_id` is
    // NOT NULL, so an unfilled seed row would be refused by the database
    // rather than dropped here.
    // Staff never renders the Shifts section, so this is always empty for them
    // anyway — stated rather than relied on, because `shifts` state outlives a
    // switch from a worker to a staff record and this payload also feeds the
    // rail's done-dots. What actually protects a stored staff spell is
    // `replacePersonChildren`, which skips the table entirely for staff.
    // A row with no subject is not a record — the blank-row filter tests only
    // what the operator has to type, never a default. `can_speak` and friends
    // are deliberately NOT in these tests: they start false, so including one
    // would make the clause constant.
    education: education
      .filter((r) => r.type_of_training.trim() || r.institution.trim())
      .map((r) => ({
        type_of_training: r.type_of_training.trim() || null,
        institution: r.institution.trim() || null,
        month_year_passed: r.month_year_passed.trim() || null,
        class_marks: r.class_marks.trim() || null,
        special_subjects: r.special_subjects.trim() || null,
      })),
    technical: technical
      .filter((r) => r.qualification.trim() || r.institution.trim())
      .map((r) => ({
        qualification: r.qualification.trim() || null,
        institution: r.institution.trim() || null,
        major_subject: r.major_subject.trim() || null,
        class_pct: r.class_pct.trim() || null,
        duration: r.duration.trim() || null,
      })),
    languages: languages
      .filter((r) => r.language.trim())
      .map((r) => ({
        language: r.language.trim(),
        can_speak: r.can_speak,
        can_read: r.can_read,
        can_write: r.can_write,
      })),
    shifts: (isWorker ? shifts : [])
      .filter((r) => r.shift_category_id && r.effective_from)
      .map((r) => ({
        shift_category_id: r.shift_category_id,
        effective_from: r.effective_from,
        effective_to: r.effective_to || null,
        notes: r.notes.trim() || null,
      })),
  };

  const keySeq = useRef(0);
  const newKey = () => `r${keySeq.current++}`;

  const setFamilyAt = (key: string, patch: Partial<FamilyRow>) =>
    setFamily((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setExperienceAt = (key: string, patch: Partial<ExperienceRow>) =>
    setExperience((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setInternalRefAt = (key: string, patch: Partial<InternalRefRow>) =>
    setInternalRefs((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setNominationAt = (key: string, patch: Partial<NominationRow>) =>
    setNominations((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setExternalRefAt = (key: string, patch: Partial<ExternalRefRow>) =>
    setExternalRefs((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setEmergencyAt = (key: string, patch: Partial<EmergencyRow>) =>
    setEmergencyContacts((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setShiftAt = (key: string, patch: Partial<ShiftRow>) =>
    setShifts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  /**
   * THE ONE ACCOUNT, or a blank standing in for it.
   *
   * `staff_bank_accounts` is a table and the state is an array, because that is
   * the shape 0535 created and the shape that survives the client changing
   * their mind. The screen shows the FIRST row: a record with no account yet
   * has an empty array, `account` falls back to a blank, and `childPayload`
   * drops it unless something was actually typed.
   */
  const account = bankAccounts[0] ?? blankBankAccount("bank-0");
  const setAccount = (patch: Partial<BankAccountRow>) =>
    setBankAccounts((xs) =>
      xs.length
        ? xs.map((x, i) => (i === 0 ? { ...x, ...patch } : x))
        : [{ ...account, ...patch }],
    );

  /**
   * ONE DECLARATION PER GRID — `ChildGrid` renders the header and every cell
   * from these, so a column cannot be added to one and forgotten in the other.
   *
   * `ariaLabel` on every switch is required, not optional: the column header
   * names it on screen but is not associated with the control
   * programmatically, so omitting it ships an unnamed checkbox.
   */
  /* ---- the three grids behind General's popups (0556) ------------------- */

  const setEducationAt = (key: string, patch: Partial<EducationRow>) =>
    setEducation((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setTechnicalAt = (key: string, patch: Partial<TechnicalRow>) =>
    setTechnical((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );
  const setLanguageAt = (key: string, patch: Partial<LanguageRow>) =>
    setLanguages((xs) =>
      xs.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    );

  const educationColumns: ChildGridColumn<EducationRow>[] = [
    {
      header: "Type of Training",
      cell: (r) => (
        <Input
          uppercase
          value={r.type_of_training}
          onChange={(e) =>
            setEducationAt(r.key, { type_of_training: e.target.value })
          }
          aria-label="Type of training"
        />
      ),
    },
    {
      header: "Name of Institution",
      cell: (r) => (
        <Input
          uppercase
          value={r.institution}
          onChange={(e) =>
            setEducationAt(r.key, { institution: e.target.value })
          }
          aria-label="Name of institution"
        />
      ),
    },
    {
      header: "Month & Year of Passing",
      width: "11rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.month_year_passed}
          onChange={(e) =>
            setEducationAt(r.key, { month_year_passed: e.target.value })
          }
          aria-label="Month and year of passing"
        />
      ),
    },
    {
      header: "Class / Marks",
      width: "9rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.class_marks}
          onChange={(e) =>
            setEducationAt(r.key, { class_marks: e.target.value })
          }
          aria-label="Class or marks"
        />
      ),
    },
    {
      header: "Special Subjects",
      cell: (r) => (
        <Input
          uppercase
          value={r.special_subjects}
          onChange={(e) =>
            setEducationAt(r.key, { special_subjects: e.target.value })
          }
          aria-label="Special subjects"
        />
      ),
    },
  ];

  const technicalColumns: ChildGridColumn<TechnicalRow>[] = [
    {
      header: "Qualification",
      cell: (r) => (
        <Input
          uppercase
          value={r.qualification}
          onChange={(e) =>
            setTechnicalAt(r.key, { qualification: e.target.value })
          }
          aria-label="Technical qualification"
        />
      ),
    },
    {
      header: "Institution",
      cell: (r) => (
        <Input
          uppercase
          value={r.institution}
          onChange={(e) =>
            setTechnicalAt(r.key, { institution: e.target.value })
          }
          aria-label="Institution"
        />
      ),
    },
    {
      header: "Major Subject",
      cell: (r) => (
        <Input
          uppercase
          value={r.major_subject}
          onChange={(e) =>
            setTechnicalAt(r.key, { major_subject: e.target.value })
          }
          aria-label="Major subject"
        />
      ),
    },
    {
      header: "Class %",
      width: "7rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.class_pct}
          onChange={(e) => setTechnicalAt(r.key, { class_pct: e.target.value })}
          aria-label="Class percentage"
        />
      ),
    },
    {
      header: "Duration",
      width: "9rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.duration}
          onChange={(e) => setTechnicalAt(r.key, { duration: e.target.value })}
          aria-label="Duration"
        />
      ),
    },
  ];

  /**
   * LANGUAGE IS A COLUMN OF ITS OWN, which legacy does not have — its grid is
   * Speak / Read / Write with the tongue typed into the "Speak" cell. A row
   * that cannot say WHICH language it describes is not a record, so the name
   * is its own column and the three abilities are what they always were: ticks.
   */
  const languageColumns: ChildGridColumn<LanguageRow>[] = [
    {
      header: "Language",
      cell: (r) => (
        <Input
          uppercase
          value={r.language}
          onChange={(e) => setLanguageAt(r.key, { language: e.target.value })}
          aria-label="Language"
        />
      ),
    },
    {
      header: "Speak",
      width: "6rem",
      align: "center",
      cell: (r) => (
        <Toggle
          checked={r.can_speak}
          onChange={(v) => setLanguageAt(r.key, { can_speak: v })}
          ariaLabel="Can speak this language"
        />
      ),
    },
    {
      header: "Read",
      width: "6rem",
      align: "center",
      cell: (r) => (
        <Toggle
          checked={r.can_read}
          onChange={(v) => setLanguageAt(r.key, { can_read: v })}
          ariaLabel="Can read this language"
        />
      ),
    },
    {
      header: "Write",
      width: "6rem",
      align: "center",
      cell: (r) => (
        <Toggle
          checked={r.can_write}
          onChange={(v) => setLanguageAt(r.key, { can_write: v })}
          ariaLabel="Can write this language"
        />
      ),
    },
  ];

  const familyColumns: ChildGridColumn<FamilyRow>[] = [
    {
      header: "Name",
      cell: (r) => (
        <Input
          uppercase
          value={r.name}
          onChange={(e) => setFamilyAt(r.key, { name: e.target.value })}
          aria-label="Family member name"
        />
      ),
    },
    {
      header: "DOB",
      width: "10rem",
      cell: (r) => (
        <Input
          type="date"
          value={r.date_of_birth}
          onChange={(e) =>
            setFamilyAt(r.key, { date_of_birth: e.target.value })
          }
          aria-label="Date of birth"
        />
      ),
    },
    {
      // COMPUTED, NEVER STORED — see the note on `monthsBetween`. Read-only
      // text rather than a control, so it stays off the Tab path.
      header: "Age",
      width: "6rem",
      align: "right",
      // Same rule as the staff member's own Age: computed from DOB when there
      // is one, typed into `stated_age` when there is not.
      cell: (r) => {
        const age = ageFrom(r.date_of_birth);
        return age === null ? (
          <Input
            type="number"
            min={0}
            max={120}
            value={r.stated_age}
            onChange={(e) => setFamilyAt(r.key, { stated_age: e.target.value })}
            aria-label="Age"
          />
        ) : (
          <span className="tabular-nums text-sm">{age}</span>
        );
      },
    },
    {
      header: "Alive",
      // A FIXED WIDTH, NOT `auto`. `auto` is this prop's CARD-mode
      // spelling for "hug"; in the TABLE branch it lands on
      // `<th style={{width:"auto"}}>`, which is the CSS default — so the
      // column absorbed the table's leftover width and left a band of
      // empty space beside a 40px switch (client 2026-09-09).
      width: "5rem",
      align: "center",
      cell: (r) => (
        <Toggle
          checked={r.alive}
          onChange={(v) => setFamilyAt(r.key, { alive: v })}
          ariaLabel="Is this family member living"
        />
      ),
    },
    {
      header: "Relation",
      width: "10rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.relation}
          onChange={(e) => setFamilyAt(r.key, { relation: e.target.value })}
          aria-label="Relation"
        />
      ),
    },
    {
      header: "Other Information",
      cell: (r) => (
        <Input
          uppercase
          value={r.other_information}
          onChange={(e) =>
            setFamilyAt(r.key, { other_information: e.target.value })
          }
          aria-label="Other information"
        />
      ),
    },
    {
      header: "Residing With Employee",
      // A FIXED WIDTH, NOT `auto`. `auto` is this prop's CARD-mode
      // spelling for "hug"; in the TABLE branch it lands on
      // `<th style={{width:"auto"}}>`, which is the CSS default — so the
      // column absorbed the table's leftover width and left a band of
      // empty space beside a 40px switch (client 2026-09-09).
      width: "8rem",
      align: "center",
      cell: (r) => (
        <Toggle
          checked={r.residing_with_employee}
          onChange={(v) => setFamilyAt(r.key, { residing_with_employee: v })}
          ariaLabel="Resides with the employee"
        />
      ),
    },
  ];

  const experienceColumns: ChildGridColumn<ExperienceRow>[] = [
    {
      header: "Company Name",
      cell: (r) => (
        <Input
          uppercase
          value={r.company_name}
          onChange={(e) =>
            setExperienceAt(r.key, { company_name: e.target.value })
          }
          aria-label="Company name"
        />
      ),
    },
    {
      header: "Address",
      cell: (r) => (
        <Input
          uppercase
          value={r.address}
          onChange={(e) => setExperienceAt(r.key, { address: e.target.value })}
          aria-label="Company address"
        />
      ),
    },
    {
      header: "Designation",
      width: "10rem",
      cell: (r) => (
        <Input
          uppercase
          value={r.designation}
          onChange={(e) =>
            setExperienceAt(r.key, { designation: e.target.value })
          }
          aria-label="Designation held"
        />
      ),
    },
    {
      header: "From",
      width: "9.5rem",
      cell: (r) => (
        <Input
          type="date"
          value={r.exp_from}
          onChange={(e) => setExperienceAt(r.key, { exp_from: e.target.value })}
          aria-label="Experience from"
        />
      ),
    },
    {
      header: "To",
      width: "9.5rem",
      cell: (r) => (
        <Input
          type="date"
          value={r.exp_to}
          onChange={(e) => setExperienceAt(r.key, { exp_to: e.target.value })}
          aria-label="Experience to"
        />
      ),
    },
    {
      /**
       * TYPED, UNLESS BOTH DATES ARE THERE — then the arithmetic wins and the
       * cell goes read-only. That is why the column survives at all: a
       * candidate often gives "about 3 years" for a job whose exact dates they
       * no longer have, and this is where that goes.
       */
      header: "Duration",
      width: "8rem",
      cell: (r) => {
        const computed = monthsBetween(r.exp_from, r.exp_to);
        return computed ? (
          <span className="text-sm text-muted-foreground">{computed}</span>
        ) : (
          <Input
            uppercase
            value={r.duration}
            onChange={(e) =>
              setExperienceAt(r.key, { duration: e.target.value })
            }
            aria-label="Duration"
          />
        );
      },
    },
    {
      header: "Last Salary Drawn",
      width: "9rem",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          min={0}
          step={0.01}
          value={r.last_salary_drawn}
          onChange={(e) =>
            setExperienceAt(r.key, { last_salary_drawn: e.target.value })
          }
          aria-label="Last salary drawn"
        />
      ),
    },
    {
      header: "Reason For Leaving",
      cell: (r) => (
        <Input
          uppercase
          value={r.reason_for_leaving}
          onChange={(e) =>
            setExperienceAt(r.key, { reason_for_leaving: e.target.value })
          }
          aria-label="Reason for leaving"
        />
      ),
    },
    {
      header: "Details",
      cell: (r) => (
        <Input
          uppercase
          value={r.details}
          onChange={(e) => setExperienceAt(r.key, { details: e.target.value })}
          aria-label="Details"
        />
      ),
    },
  ];

  const internalRefColumns: ChildGridColumn<InternalRefRow>[] = [
    {
      header: "Department",
      cell: (r) => (
        <MasterSelect
          id={`st-iref-dep-${r.key}`}
          options={departments}
          value={r.department_id || null}
          onChange={(v) => setInternalRefAt(r.key, { department_id: v ?? "" })}
        />
      ),
    },
    {
      header: "Name",
      cell: (r) => (
        // A colleague — the same staff list the Manager field uses, minus the
        // record being edited: a person cannot be their own internal referee.
        <Select
          value={r.referee_id}
          onChange={(e) =>
            setInternalRefAt(r.key, { referee_id: e.target.value })
          }
          aria-label="Internal referee"
        >
          <option value=""></option>
          {rows
            .filter((m) => m.id !== editId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </Select>
      ),
    },
  ];

  /**
   * The two contact grids share every column but one, so the shape is written
   * once and the differing cell passed in — a copy-paste pair would be six
   * columns that could drift on the next edit.
   */
  function contactColumns<T extends { key: string }>(
    secondHeader: string,
    second: (r: T) => React.ReactNode,
    setAt: (key: string, patch: Record<string, string>) => void,
    get: (r: T, k: string) => string,
  ): ChildGridColumn<T>[] {
    const text = (k: string, label: string, caps = true) => ({
      header: label,
      cell: (r: T) => (
        <Input
          uppercase={caps}
          value={get(r, k)}
          onChange={(e) => setAt(r.key, { [k]: e.target.value })}
          aria-label={label}
        />
      ),
    });
    return [
      text("name", "Name"),
      { header: secondHeader, cell: second },
      text("address1", "Address"),
      text("address2", "Address 2"),
      // caps-input: exempt -- a phone number is digits, so uppercasing is a
      // no-op that still reads as if the field rewrote what was typed.
      { ...text("phone", "Phone No.", false), width: "9rem" },
      { ...text("mobile", "Mobile", false), width: "9rem" },
    ];
  }

  const externalRefColumns = contactColumns<ExternalRefRow>(
    "Designation",
    (r) => (
      <Input
        uppercase
        value={r.designation}
        onChange={(e) =>
          setExternalRefAt(r.key, { designation: e.target.value })
        }
        aria-label="Designation"
      />
    ),
    (key, patch) => setExternalRefAt(key, patch as Partial<ExternalRefRow>),
    (r, k) => (r as unknown as Record<string, string>)[k] ?? "",
  );

  const emergencyColumns = contactColumns<EmergencyRow>(
    "Relation",
    (r) => (
      <Input
        uppercase
        value={r.relation}
        onChange={(e) => setEmergencyAt(r.key, { relation: e.target.value })}
        aria-label="Relation"
      />
    ),
    (key, patch) => setEmergencyAt(key, patch as Partial<EmergencyRow>),
    (r, k) => (r as unknown as Record<string, string>)[k] ?? "",
  );

  const shiftColumns: ChildGridColumn<ShiftRow>[] = [
    {
      header: "Shift",
      cell: (r) => (
        <MasterSelect
          id={`sh-cat-${r.key}`}
          options={shiftCategories}
          value={r.shift_category_id || null}
          onChange={(v) => setShiftAt(r.key, { shift_category_id: v ?? "" })}
        />
      ),
    },
    {
      header: "From",
      width: "10rem",
      cell: (r) => (
        <Input
          type="date"
          value={r.effective_from}
          onChange={(e) =>
            setShiftAt(r.key, { effective_from: e.target.value })
          }
          aria-label="Effective from"
        />
      ),
    },
    {
      /**
       * BLANK MEANS STILL ON IT — not a far-future date. "Unknown end" and
       * "ends in 2099" are different facts and only one is true, which is why
       * the column is nullable (0554).
       */
      header: "To",
      width: "10rem",
      cell: (r) => (
        <Input
          type="date"
          min={r.effective_from || undefined}
          value={r.effective_to}
          onChange={(e) => setShiftAt(r.key, { effective_to: e.target.value })}
          aria-label="Effective to — blank while current"
        />
      ),
    },
    {
      header: "Notes",
      cell: (r) => (
        <Input
          uppercase
          value={r.notes}
          onChange={(e) => setShiftAt(r.key, { notes: e.target.value })}
          aria-label="Notes"
        />
      ),
    },
  ];

  const nominationColumns: ChildGridColumn<NominationRow>[] = [
    {
      // Legacy's single unlabelled column, headed "For".
      header: "For",
      cell: (r) => (
        <Input
          uppercase
          value={r.nomination_for}
          onChange={(e) =>
            setNominationAt(r.key, { nomination_for: e.target.value })
          }
          aria-label="What this nomination is for"
        />
      ),
    },
  ];

  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT. `canSave` is DERIVED —
   * never a hand-assembled `!!name.trim() && …`, which is a list a screen can
   * forget to extend. `fields` mirrors the `required` props below, so the red
   * `*`, the cursor hold and this list cannot disagree.
   */
  // Shifts is a worker row only; `personSections` is where that is decided.
  const railSections = personSections(kind);

  const validity = sectionValidity({
    sections: railSections.map((s) => ({ key: s.key })),
    values: form,
    fields: [
      {
        section: "detail",
        id: "st-name",
        label: "Name",
        required: true,
        empty: (f) => !String(f.name ?? "").trim(),
      },
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(
      p.section,
      p.fieldId ? { fieldId: p.fieldId } : "problem",
    );
  };

  /**
   * THE RAIL. Row order and labels come from `staff-sections.tsx`, which is also
   * where the reasoning lives — including why "Staff" is a row of its own rather
   * than a header band, and why Internal Verification and Increment are absent.
   *
   * SIX SECTIONS ARE EMPTY ON PURPOSE, for now. The client asked for the rail
   * first and the fields after ("first build the left side bar how i want, then
   * we can work on inside"), and the client is naming each section's fields one
   * at a time. Family Details, Work Experience, Reference and Nomination are
   * each a LIST of rows against a staff member — child tables that do not
   * exist in this database yet; Salary Registry and Bank Account are
   * new to this screen entirely. Building the shell first is what
   * makes that a separate, visible decision rather than a schema change smuggled
   * in behind a layout change.
   *
   * `done` is the quiet "has data" dot. No `problems` badge: the operator's rule
   * 2 drops it, and `footer.onBlockedSave` is what names a blocked Save instead.
   */
  /**
   * A SUB-SECTION'S RAIL DOT: has anyone PUT something here?
   *
   * Not "does any field hold a value" — `employment_type` opens as "Permanent",
   * `pay_frequency` as "Monthly" and `is_active` as true, so a plain
   * truthiness test would light Employment and Status on a record nobody has
   * touched, and a dot that is always on says nothing. Compared against
   * `DEFAULTS` instead, which is the same judgement `MoneyField` already makes
   * about a zero: a column default rendered as data reads as a figure somebody
   * entered.
   *
   * `DEFAULTS` is the kind-aware object this screen already opens new records
   * with, so a worker's extra Employment fields are covered without a second
   * list.
   */
  const touched = (keys: string[]) =>
    keys.some((k) => {
      const f = (form as Record<string, unknown>)[k];
      const d = (DEFAULTS as Record<string, unknown>)[k];
      return f !== d && !(f === "" && d == null) && !(f == null && d === "");
    });

  const sections: FullScreenSection[] = railSections.map((s) => {
    // `sub` and `groupOnly` must both reach the shell. `groupOnly` was dropped
    // here once, so the shell never learned Salary Registry was a category and
    // opened its empty pane.
    const base = {
      key: s.key,
      label: s.label,
      icon: s.icon,
      sub: s.sub,
      groupOnly: s.groupOnly,
    };
    switch (s.key) {
      case "detail":
        return {
          ...base,
          done: !!form.name.trim(),
          content: (
            <div className="space-y-6">
              {/*
                THE LEGACY DETAIL TAB, IN FIVE NAMED GROUPS.

                Legacy draws this as one dense screen of bordered panels —
                Pay(Statutory), Pay(Actual), Migrant Worker, the date column, a
                pay-mode block. The panels go, per the de-clutter rule; the
                GROUPING stays, because it is the only thing telling a statutory
                gross from an actual one, or an employee's PF rate from an
                employer's. A heading above a row of fields carries that at no
                cost in frames.

                EVERY FIELD IS `sm` — 3 of 12, FOUR to a row — and the track
                is NOT capped. That is the house default (LAYOUT.md §3), and
                this screen had neither.

                It was `lg` in a `max-w-3xl` track, which is the rule the twelve
                HR master SHEETS were given: those are small dialogs of four to
                eight fields, where two-per-line reads better and an uncapped
                six-of-twelve would stretch each box to half a dialog. Carrying
                that here was the mistake — this is a full-screen overlay with
                ~40 fields, so the cap left the right half of the screen empty
                and turned ten rows into twenty (client 2026-09-09: "why right
                side this much space is wasted use that also").

                The exception is Guardian, at `md`: it is one field holding TWO
                controls (the relation and the name), so at `sm` the name box
                would be narrower than any other on the screen.
              */}

              {/*
                THE IDENTITY BLOCK — NINE FIELDS, THREE TO A ROW, in legacy's
                own three groups (client 2026-09-09).

                Legacy draws them as three COLUMNS read downwards:

                  ID No        Mother Name    Department
                  Name         Designation    Location
                  S/O […]      Category       Division

                A CSS grid flows ACROSS, so reproducing that picture literally
                would put Tab through ID No → Mother Name → Department → Name,
                which is a poor order to type in. The three groups are what
                carry the meaning, so each legacy COLUMN becomes a ROW here:
                identity, then the parent/role pair, then the posting. Same
                nine fields, same three groupings, and Tab runs along a row the
                way it does everywhere else in this app.

                ## WIDTHS ARE SIZED TO THE DATA AGAIN (client 2026-09-11)

                This block was nine identical `md` boxes, and the whole screen
                was one repeated rectangle — which is precisely what the client
                called out: "it looks like an excel sheet ... every box has same
                size, but maybe address need a bigger one, id no like small
                number needs small ones right".

                THIS REVERSES `doc/ui/LAYOUT.md` §3 FOR THIS EDITOR, and the
                reversal is the point rather than an oversight. §3's "ONE WIDTH,
                EVERY FIELD" is itself a client decision (2026-07-29) taken on
                the Applicant sheet, where size-to-data had produced "ragged
                whitespace". Both calls are the same client looking at the same
                trade-off from opposite sides, and the later one wins — see §3,
                which now records both.

                What keeps this from becoming the raggedness §3 warned about is
                that EVERY ROW STILL SUMS TO EXACTLY 12. Ragged is a row of 11
                with a 1-unit hole, not a row of unequal boxes. Here:

                  ID No 2 + Name 4 + Guardian 3 + Mother Name 3 = 12
                  Designation 3 + Category 3 + Department 3 + Location 3 = 12
                  Division 3

                AND THE WHOLE SCALE STEPPED DOWN ON 2026-09-12. The first cut
                answered "size to the data" with `lg` (6 of 12) for a name, which
                put THREE boxes on a row spanning the full pane — the client
                compared it to Order Entry, where six fields share a row, and
                asked for "small small boxes according to the need, for example
                for name only medium box is enough, for number small boxes".

                So the range is now xs (2) · sm (3) · md (4) and nothing wider:
                `lg` is what made a row hold three. Order Entry reaches six per
                row with the same 12-column track and `xs` boxes — the track was
                never the difference, the sizes were.

                Nothing in the build can catch a row that overflows (§3 says so
                explicitly), so the arithmetic is written down here and checked
                by hand against every group in this file.
              */}
              <FieldGrid>
                {/* Row 1 — who this person is */}
                <Field label="ID No" size="xs" htmlFor="st-code" skipTab>
                  {/*
                    ON A NEW RECORD THIS IS A PREVIEW, not the stored value —
                    see `nextCodePreview`. It used to sit blank, on the argument
                    that a record with no row has no ID yet; the client asked for
                    the number to be there while typing (2026-09-11), and a
                    preview is how that is honest. Still `readOnly`: the trigger
                    assigns the real one, so an editable box here would invite a
                    value the save throws away.
                  */}
                  <Input id="st-code" value={editCode ?? ""} readOnly />
                </Field>

                <Field label="Name" size="md" required htmlFor="st-name">
                  <Input
                    id="st-name"
                    uppercase
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    required
                  />
                </Field>

                {/*
                  THE LEGACY "S/O" PAIR IS ONE FIELD WITH TWO CONTROLS — a
                  relationship word and the name it points at. Two columns in
                  0534, because a record that loses which is which cannot print
                  either; one `Field` here, because "S/O RAMASAMY" is a single
                  answer to a single question.
                */}
                <Field label="Guardian" size="sm" htmlFor="st-guardian-name">
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label="Guardian relation"
                      className="w-24 shrink-0"
                      value={form.guardian_relation ?? ""}
                      onChange={(e) =>
                        set({
                          guardian_relation:
                            (e.target
                              .value as PersonInput["guardian_relation"]) ||
                            null,
                        })
                      }
                    >
                      {GUARDIAN_RELATIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Input
                      id="st-guardian-name"
                      uppercase
                      value={form.guardian_name ?? ""}
                      onChange={(e) =>
                        set({ guardian_name: e.target.value || null })
                      }
                    />
                  </div>
                </Field>

                {/* Row 2 — parentage and role */}
                <Field label="Mother Name" size="sm" htmlFor="st-mother">
                  <Input
                    id="st-mother"
                    uppercase
                    value={form.mother_name ?? ""}
                    onChange={(e) =>
                      set({ mother_name: e.target.value || null })
                    }
                  />
                </Field>

                {/*
                  FROM THE MASTER (0548). It was a free-text box until then —
                  the note here used to say so and defer the change, because
                  turning a text column into a foreign key has to migrate what
                  is already stored. That repair is now in the migration, and it
                  was free to do: `staff` held no rows.
                */}
                <Field label="Designation" size="sm" htmlFor="st-designation">
                  <MasterSelect
                    id="st-designation"
                    options={designations}
                    value={form.designation_id}
                    onChange={(v) => set({ designation_id: v })}
                  />
                </Field>

                <Field label="Category" size="sm" htmlFor="st-category">
                  <MasterSelect
                    id="st-category"
                    options={categories}
                    value={form.category_id}
                    onChange={(v) => set({ category_id: v })}
                  />
                </Field>

                {/* Row 3 — where they are posted */}
                <Field label="Department" size="sm" htmlFor="st-department">
                  <MasterSelect
                    id="st-department"
                    options={departments}
                    value={form.department_id}
                    onChange={(v) => set({ department_id: v })}
                  />
                </Field>

                <Field label="Location" size="sm" htmlFor="st-location">
                  <Select
                    id="st-location"
                    value={form.location_id ?? ""}
                    onChange={(e) =>
                      set({ location_id: e.target.value || null })
                    }
                  >
                    <option value=""></option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Division" size="sm" htmlFor="st-division">
                  <MasterSelect
                    id="st-division"
                    options={divisions}
                    value={form.division_id}
                    onChange={(v) => set({ division_id: v })}
                  />
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "employment":
        return {
          ...base,
          done: touched([
            "biometric_id",
            "card_no",
            "contractor_id",
            "ctc_per_shift",
            "employment_type",
            "hostel_category_id",
            "hourly_wage",
            "manager_id",
            "pay_frequency",
            "piece_rate",
            "prod_dept_id",
            "shift_wage_per_day",
            "vehicle_no",
            "week_off",
            "worker_type",
          ]),
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <Field label="Type" size="sm" htmlFor="st-type">
                  <Select
                    id="st-type"
                    value={form.employment_type}
                    onChange={(e) =>
                      set({
                        employment_type: e.target
                          .value as PersonInput["employment_type"],
                      })
                    }
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Card No" size="sm" htmlFor="st-card">
                  <Input
                    id="st-card"
                    uppercase
                    value={form.card_no ?? ""}
                    onChange={(e) => set({ card_no: e.target.value || null })}
                  />
                </Field>

                <Field
                  label={copy.payFrequency}
                  size="sm"
                  htmlFor="st-salary-paid"
                >
                  <Select
                    id="st-salary-paid"
                    value={form.pay_frequency}
                    onChange={(e) =>
                      set({
                        pay_frequency: e.target
                          .value as PersonInput["pay_frequency"],
                      })
                    }
                  >
                    {PAY_FREQUENCIES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Week Off" size="sm" htmlFor="st-week-off">
                  <Select
                    id="st-week-off"
                    value={form.week_off ?? ""}
                    onChange={(e) =>
                      set({
                        week_off:
                          (e.target.value as PersonInput["week_off"]) || null,
                      })
                    }
                  >
                    {/* Blank is a real answer: no fixed weekly off. */}
                    <option value=""></option>
                    {WEEK_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Hostel Category" size="sm" htmlFor="st-hostel">
                  <MasterSelect
                    id="st-hostel"
                    options={hostelCategories}
                    value={form.hostel_category_id}
                    onChange={(v) => set({ hostel_category_id: v })}
                  />
                </Field>

                <Field label="Manager" size="sm" htmlFor="st-manager">
                  {/*
                    A manager is another staff member, so the options are this
                    screen's own rows — minus the record being edited, because
                    a person cannot report to themselves and the FK would
                    happily store it.
                  */}
                  <Select
                    id="st-manager"
                    value={form.manager_id ?? ""}
                    onChange={(e) =>
                      set({ manager_id: e.target.value || null })
                    }
                  >
                    <option value=""></option>
                    {rows
                      .filter((m) => m.id !== editId)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </Select>
                </Field>

                {/*
                  THE FOUR BOXES LEGACY ADDS FOR A WORKER, and nothing else
                  on this screen differs (client 2026-09-09). They sit in
                  Employment because that is what they describe: how this
                  person is engaged and paid.
                */}
                {isWorker && (
                  <>
                    {/* Legacy's "Type" — the wage BASIS, which is what
                        `computeActualWage` branches on (lib/hr/calc.ts). Not
                        the same question as Employment Type above, which is
                        Permanent / Temporary / Contract. */}
                    <Field label="Rate Type" size="sm" htmlFor="wk-type">
                      <Select
                        id="wk-type"
                        value={(form as WorkerInput).worker_type}
                        onChange={(e) =>
                          set({
                            worker_type: e.target
                              .value as WorkerInput["worker_type"],
                          } as Partial<PersonInput>)
                        }
                      >
                        {WORKER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {WORKER_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label="Under Contractor"
                      size="sm"
                      htmlFor="wk-contractor"
                    >
                      <MasterSelect
                        id="wk-contractor"
                        options={contractors}
                        value={(form as WorkerInput).contractor_id}
                        onChange={(v) =>
                          set({ contractor_id: v } as Partial<PersonInput>)
                        }
                      />
                    </Field>

                    {/* The production department the worker is ON, which is a
                        different question from the Department they belong to
                        — 0553 keeps them as two columns for that reason. */}
                    <Field label="Prod. Dept" size="sm" htmlFor="wk-prod-dept">
                      <MasterSelect
                        id="wk-prod-dept"
                        options={departments}
                        value={(form as WorkerInput).prod_dept_id}
                        onChange={(v) =>
                          set({ prod_dept_id: v } as Partial<PersonInput>)
                        }
                      />
                    </Field>

                    <MoneyField
                      size="sm"
                      id="wk-ctc"
                      label="CTC / Shift"
                      value={(form as WorkerInput).ctc_per_shift}
                      onChange={(v) =>
                        set({ ctc_per_shift: v } as Partial<PersonInput>)
                      }
                    />

                    {/* The wage basis itself. Legacy puts these on its own
                        rate panel; here they follow Rate Type, which is what
                        decides which of the three is read. */}
                    <MoneyField
                      id="wk-shift-wage"
                      label="Shift Wage / Day"
                      value={(form as WorkerInput).shift_wage_per_day}
                      onChange={(v) =>
                        set({ shift_wage_per_day: v } as Partial<PersonInput>)
                      }
                    />
                    <MoneyField
                      id="wk-hourly"
                      label="Hourly Wage"
                      value={(form as WorkerInput).hourly_wage}
                      onChange={(v) =>
                        set({ hourly_wage: v } as Partial<PersonInput>)
                      }
                    />
                    <MoneyField
                      id="wk-piece"
                      label="Piece Rate"
                      value={(form as WorkerInput).piece_rate}
                      onChange={(v) =>
                        set({ piece_rate: v } as Partial<PersonInput>)
                      }
                    />

                    <Field
                      label="Biometric ID"
                      size="sm"
                      htmlFor="wk-biometric"
                    >
                      <Input
                        id="wk-biometric"
                        uppercase
                        value={(form as WorkerInput).biometric_id ?? ""}
                        onChange={(e) =>
                          set({
                            biometric_id: e.target.value || null,
                          } as Partial<PersonInput>)
                        }
                      />
                    </Field>
                  </>
                )}

                <Field label="Vehicle No" size="sm" htmlFor="st-vehicle">
                  <Input
                    id="st-vehicle"
                    uppercase
                    value={form.vehicle_no ?? ""}
                    onChange={(e) =>
                      set({ vehicle_no: e.target.value || null })
                    }
                  />
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "dates":
        return {
          ...base,
          done: touched([
            "date_of_birth",
            "date_of_confirmation",
            "date_of_leaving",
            "date_of_probation",
            "joined_date",
            "place_of_birth",
            "stated_age",
          ]),
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <DateField
                  id="st-dob"
                  label="Date of Birth"
                  value={form.date_of_birth}
                  onChange={(v) => set({ date_of_birth: v })}
                />

                {/*
                  TYPED UNLESS THERE IS A DATE OF BIRTH — then the arithmetic
                  wins and the box goes read-only.

                  It was read-only always, which was wrong for the case the
                  legacy box exists for: an operator entering an older
                  worker's record often has "about 45" and no date at all, and
                  had nowhere to put it (client 2026-09-09). `stated_age`
                  (0537) is where that goes; it is never read when
                  `date_of_birth` is present.

                  Same rule as Work Experience's Duration, and `skipTab` only
                  applies while it is derived — a field the operator must be
                  able to type in cannot be off the typing path.
                */}
                <Field
                  label="Age"
                  size="xs"
                  htmlFor="st-age"
                  skipTab={!!form.date_of_birth}
                  hint={form.date_of_birth ? "From date of birth" : undefined}
                >
                  {form.date_of_birth ? (
                    <Input
                      id="st-age"
                      readOnly
                      value={ageFrom(form.date_of_birth) ?? "—"}
                    />
                  ) : (
                    <Input
                      id="st-age"
                      type="number"
                      min={0}
                      max={120}
                      value={form.stated_age ?? ""}
                      onChange={(e) =>
                        set({
                          stated_age:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  )}
                </Field>

                <Field label="Place of Birth" size="md" htmlFor="st-pob">
                  <Input
                    id="st-pob"
                    uppercase
                    value={form.place_of_birth ?? ""}
                    onChange={(e) =>
                      set({ place_of_birth: e.target.value || null })
                    }
                  />
                </Field>
                {/* DOJ is `joined_date` — 0534 deliberately did NOT add a
                    second column meaning the same thing. */}
                <DateField
                  id="st-joined"
                  label="Date of Joining"
                  value={form.joined_date ?? null}
                  onChange={(v) => set({ joined_date: v })}
                />
                <DateField
                  id="st-dop"
                  label="Date of Probation"
                  value={form.date_of_probation}
                  onChange={(v) => set({ date_of_probation: v })}
                />
                <DateField
                  id="st-doc"
                  label="Date of Confirmation"
                  value={form.date_of_confirmation}
                  onChange={(v) => set({ date_of_confirmation: v })}
                />
                <DateField
                  id="st-dol"
                  label="Date of Leaving"
                  value={form.date_of_leaving}
                  onChange={(v) => set({ date_of_leaving: v })}
                />
              </FieldGrid>
            </div>
          ),
        };

      case "statutory":
        return {
          ...base,
          done: touched([
            "disability_pct",
            "disability_type",
            "international_worker",
            "migrant_worker",
            "pan_no",
            "tds_applicable",
          ]),
          content: (
            <div className="space-y-6">
              <FieldGrid>
                {/*
                  ESI AND PF ARE NOT HERE ANY MORE. They were two booleans on
                  this tab; legacy puts them on NOMINATION as a three-state
                  (Yes / No / Exempted) with a number and two dates, and 0536
                  made the booleans derived from that status by a trigger. A
                  toggle here would have looked like it controlled something
                  the database overwrites on the same statement.
                */}

                {/*
                  PAN AND TDS MOVED HERE FROM THE BANK TAB (client
                  2026-09-09). They were sitting with the account details
                  because legacy's Detail tab draws them near Pay Mode — but a
                  PAN is a tax identifier and TDS is a deduction rule, so they
                  belong with the other statutory facts, not with where the
                  salary is sent.
                */}
                <Field label="PAN No" size="sm" htmlFor="st-pan">
                  {/* Typing lowercase is fine: the Zod schema uppercases and
                      shape-checks it, and the column carries the same regex. */}
                  <Input
                    id="st-pan"
                    uppercase
                    maxLength={10}
                    value={form.pan_no ?? ""}
                    onChange={(e) => set({ pan_no: e.target.value || null })}
                  />
                </Field>

                <Field label="TDS" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.tds_applicable}
                      onChange={(v) => set({ tds_applicable: v })}
                      label="Applicable"
                    />
                  </div>
                </Field>

                <Field label="Migrant Worker" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.migrant_worker}
                      onChange={(v) => set({ migrant_worker: v })}
                      ariaLabel="Migrant Worker"
                    />
                  </div>
                </Field>

                <Field label="International Worker" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.international_worker}
                      onChange={(v) => set({ international_worker: v })}
                      ariaLabel="International Worker"
                    />
                  </div>
                </Field>

                {/*
                  Legacy offers L / H / V / No as four radios. Blank IS "No" —
                  the absence of a category — so it is the empty option rather
                  than a fifth stored value (0534 models it the same way).
                */}
                <Field
                  label="Physically Challenged"
                  size="sm"
                  htmlFor="st-disability"
                >
                  <Select
                    id="st-disability"
                    value={form.disability_type ?? ""}
                    onChange={(e) =>
                      set({
                        disability_type:
                          (e.target.value as PersonInput["disability_type"]) ||
                          null,
                      })
                    }
                  >
                    <option value="">No</option>
                    {DISABILITY_TYPES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>

                {/* Only meaningful once a category is chosen — disabled
                    rather than hidden, so the row does not reflow as the
                    operator changes the answer above it. */}
                <MoneyField
                  size="xs"
                  id="st-disability-pct"
                  label="Disability %"
                  max={100}
                  disabled={!form.disability_type}
                  value={form.disability_pct}
                  onChange={(v) => set({ disability_pct: v })}
                />
              </FieldGrid>
            </div>
          ),
        };

      case "status":
        return {
          ...base,
          done: touched(["blocked", "is_active"]),
          content: (
            <div className="space-y-6">
              <FieldGrid>
                {/* Reads INACTIVE like every other master in HR; the column
                    is `is_active`, so the switch inverts it. */}
                <Field label="Status" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={!form.is_active}
                      onChange={(v) => set({ is_active: !v })}
                      label="Inactive"
                    />
                  </div>
                </Field>

                {/*
                  A BAR ON A CURRENT EMPLOYEE, which is not the same question
                  as Status. 0534 keeps them separate so that un-blocking
                  someone is not indistinguishable from re-hiring them.
                */}
                <Field label="Blocked" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.blocked}
                      onChange={(v) => set({ blocked: v })}
                      label="Blocked"
                    />
                  </div>
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "shifts":
        return {
          ...base,
          done: childPayload.shifts.length > 0,
          content: (
            <div className="space-y-2">
              {/*
                A LIST OF SPELLS, not a field on Detail. `workers` carries
                `shift_wage_per_day` and `ctc_per_shift` — those are RATES;
                this says which shift, and for which dates (0554).

                The database refuses overlapping spells, so a save that would
                put someone on two shifts on one day comes back as an error
                rather than quietly making "which shift that day"
                unanswerable.
              */}
              {childrenLoading ? (
                <LoadingRows />
              ) : (
                <ChildGrid<ShiftRow>
                  columns={shiftColumns}
                  rows={shifts}
                  onAdd={() => setShifts((xs) => [...xs, blankShift(newKey())])}
                  onRemove={(r) =>
                    setShifts((xs) => xs.filter((x) => x.key !== r.key))
                  }
                  addLabel="+ Add shift"
                  seedRow
                />
              )}
            </div>
          ),
        };

      case "salary-registry":
        /* A CATEGORY ROW: everything it used to hold is now a child of its
           own below, so it owns no pane. `goToSection` resolves it to the
           first child, which is why `content` is never rendered. */
        return { ...base, content: null };

      case "pay-statutory":
        return {
          ...base,
          done: form.stat_gross > 0,
          content: (
            <div className="space-y-6">
              {/*
                FOUR HEADS, TWICE. The two panels hold the same four names, so
                the heading is the only thing saying which set a figure belongs
                to — the same reason PF/ESI Control's captions moved into its
                labels rather than being deleted.

                OTHERS is absent from both, as in 0534: legacy greys it and
                computes it (gross less the named heads), and a stored copy
                would drift from the arithmetic.
              */}
              <FieldGrid>
                <MoneyField
                  id="st-stat-gross"
                  label={copy.gross}
                  value={form.stat_gross}
                  onChange={(v) => set({ stat_gross: v })}
                />
                <MoneyField
                  id="st-stat-basic"
                  label="Basic"
                  value={form.stat_basic}
                  onChange={(v) => set({ stat_basic: v })}
                />
                <MoneyField
                  id="st-stat-da"
                  label="DA"
                  value={form.stat_da}
                  onChange={(v) => set({ stat_da: v })}
                />
                <MoneyField
                  id="st-stat-hra"
                  label="HRA"
                  value={form.stat_hra}
                  onChange={(v) => set({ stat_hra: v })}
                />
                <DerivedMoney
                  size="xs"
                  label="Others"
                  value={
                    form.stat_gross -
                    form.stat_basic -
                    form.stat_da -
                    form.stat_hra
                  }
                />
              </FieldGrid>
            </div>
          ),
        };

      case "pay-actual":
        return {
          ...base,
          done: form.act_gross > 0,
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <MoneyField
                  id="st-act-gross"
                  label={copy.gross}
                  value={form.act_gross}
                  onChange={(v) => set({ act_gross: v })}
                />
                <MoneyField
                  id="st-act-basic"
                  label="Basic"
                  value={form.act_basic}
                  onChange={(v) => set({ act_basic: v })}
                />
                <MoneyField
                  id="st-act-da"
                  label="DA"
                  value={form.act_da}
                  onChange={(v) => set({ act_da: v })}
                />
                <MoneyField
                  id="st-act-hra"
                  label="HRA"
                  value={form.act_hra}
                  onChange={(v) => set({ act_hra: v })}
                />
                <DerivedMoney
                  size="xs"
                  label="Others"
                  value={
                    form.act_gross - form.act_basic - form.act_da - form.act_hra
                  }
                />
              </FieldGrid>
            </div>
          ),
        };

      case "esi":
        return {
          ...base,
          done: form.esi_status !== "No",
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <Field label="ESI" size="xs" htmlFor="st-esi-status">
                  <Select
                    id="st-esi-status"
                    value={form.esi_status}
                    onChange={(e) =>
                      set({
                        esi_status: e.target.value as PersonInput["esi_status"],
                      })
                    }
                  >
                    {STATUTORY_STATUSES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <TextField
                  size="md"
                  id="st-esi-no"
                  label="ESI No."
                  value={form.esi_no}
                  onChange={(v) => set({ esi_no: v })}
                />
                <DateField
                  id="st-esi-doj"
                  label="Date of Joining"
                  value={form.esi_date_of_joining}
                  onChange={(v) => set({ esi_date_of_joining: v })}
                />
                <DateField
                  id="st-esi-dol"
                  label="Date of Leaving"
                  value={form.esi_date_of_leaving}
                  onChange={(v) => set({ esi_date_of_leaving: v })}
                />
                <TextField
                  id="st-esi-disp"
                  label="Dispensary"
                  value={form.esi_dispensary}
                  onChange={(v) => set({ esi_dispensary: v })}
                />
              </FieldGrid>
            </div>
          ),
        };

      case "pf":
        return {
          ...base,
          done: form.pf_status !== "No",
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <Field label="PF" size="xs" htmlFor="st-pf-status">
                  <Select
                    id="st-pf-status"
                    value={form.pf_status}
                    onChange={(e) =>
                      set({
                        pf_status: e.target.value as PersonInput["pf_status"],
                      })
                    }
                  >
                    {STATUTORY_STATUSES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <TextField
                  size="md"
                  id="st-pf-no"
                  label="PF No."
                  value={form.pf_no}
                  onChange={(v) => set({ pf_no: v })}
                />
                <DateField
                  id="st-pf-doj"
                  label="Date of Joining"
                  value={form.pf_date_of_joining}
                  onChange={(v) => set({ pf_date_of_joining: v })}
                />
                <DateField
                  id="st-pf-dol"
                  label="Date of Leaving"
                  value={form.pf_date_of_leaving}
                  onChange={(v) => set({ pf_date_of_leaving: v })}
                />
              </FieldGrid>
            </div>
          ),
        };

      case "bank":
        return {
          ...base,
          done:
            childPayload.bankAccounts.length > 0 || form.pay_mode === "Bank",
          content: (
            <div className="space-y-6">
              {/*
                ONLY PAY MODE AND THE ACCOUNT LIVE HERE.

                This tab used to hold PAN, TDS, Police Station and five payroll
                balances as well — everything legacy draws near Pay Mode on its
                Detail tab. None of them is a banking fact (client 2026-09-09),
                so each went where it belongs: PAN and TDS to Detail ▸
                Statutory, Police Station to General ▸ Identifiers, and the
                balances to Salary Registry.
              */}
              <FieldGrid>
                <Field label="Pay Mode" size="sm" htmlFor="st-pay-mode">
                  <Select
                    id="st-pay-mode"
                    value={form.pay_mode}
                    onChange={(e) =>
                      set({
                        pay_mode: e.target.value as PersonInput["pay_mode"],
                      })
                    }
                  >
                    {PAY_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FieldGrid>

              <div className="space-y-2">
                <GroupHeading>Account</GroupHeading>
                {/*
                  ONE ACCOUNT, AS FIELDS — not a grid with an "+ Add account"
                  button (client 2026-09-09: "why we need to add more account
                  only one account needed right").

                  Legacy draws this as a Banks GRID, which is why 0535 made
                  `staff_bank_accounts` a table; a staff member CAN hold a
                  salary account and a savings account. The client says one is
                  what this business records, and that is the decision.

                  THE TABLE STAYS, and the fields below are its first row. The
                  alternative — moving six columns onto `staff` — would be the
                  tidier model for a strict 1:1, but it throws away the shape
                  that supports the answer changing back. Rendering one row
                  costs nothing and means "actually some staff have two" is a UI
                  change rather than another migration and a data move.

                  A record with no account yet has no row at all: `account`
                  falls back to a blank, and `childPayload` drops it unless
                  something was typed.
                */}
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                  <FieldGrid>
                    <Field label="Bank" size="md" htmlFor="st-bank">
                      <MasterSelect
                        id="st-bank"
                        options={banks}
                        value={account.bank_id || null}
                        onChange={(v) => setAccount({ bank_id: v ?? "" })}
                      />
                    </Field>

                    <Field label="Branch" size="md" htmlFor="st-bank-branch">
                      <Input
                        id="st-bank-branch"
                        uppercase
                        value={account.branch}
                        onChange={(e) => setAccount({ branch: e.target.value })}
                      />
                    </Field>

                    {/*
                      The LINE's own word for how this account is held (SALARY,
                      SAVINGS…), which is not `banks.bank_type` on the master —
                      that says what kind of institution it is. 0535 keeps them
                      apart for that reason.
                    */}
                    <Field label="Bank Type" size="xs" htmlFor="st-bank-type">
                      <Input
                        id="st-bank-type"
                        uppercase
                        value={account.bank_type}
                        onChange={(e) =>
                          setAccount({ bank_type: e.target.value })
                        }
                      />
                    </Field>

                    <Field label="A/c Type" size="xs" htmlFor="st-ac-type">
                      <Input
                        id="st-ac-type"
                        uppercase
                        value={account.ac_type}
                        onChange={(e) =>
                          setAccount({ ac_type: e.target.value })
                        }
                      />
                    </Field>

                    <Field label="A/c No" size="md" htmlFor="st-ac-no">
                      {/* caps-input: exempt -- an account number is digits, so
                          uppercasing is a no-op that still reads as if the field
                          rewrote what was typed. */}
                      <Input
                        id="st-ac-no"
                        uppercase={false}
                        value={account.ac_no}
                        onChange={(e) => setAccount({ ac_no: e.target.value })}
                      />
                    </Field>

                    {/*
                      Four letters, a zero, then six characters. Typing
                      lowercase is fine: the Zod schema uppercases before it
                      checks, and the column carries the same regex (0535).
                    */}
                    <Field label="IFSC Code" size="sm" htmlFor="st-ifsc">
                      <Input
                        id="st-ifsc"
                        uppercase
                        maxLength={11}
                        value={account.ifsc_code}
                        onChange={(e) =>
                          setAccount({ ifsc_code: e.target.value })
                        }
                      />
                    </Field>
                  </FieldGrid>
                )}
              </div>
            </div>
          ),
        };

      case "general":
        /* A CATEGORY ROW: everything it used to hold is now a child of its
           own below, so it owns no pane. `goToSection` resolves it to the
           first child, which is why `content` is never rendered. */
        return { ...base, content: null };

      case "perm-address":
        return {
          ...base,
          done: !!form.perm_address1,
          content: (
            <div className="space-y-6">
              <FieldGrid>
                {/*
                  EACH LINE IS NAMED (client 2026-09-09). They were one
                  "Address" label over three boxes, the second and third
                  carrying `label=""` — which keeps the label ROW while
                  drawing no text, so the boxes still lined up. That solved the
                  alignment and left the operator guessing what went in the
                  second box.

                  "No." is the door or building number and the two lines under
                  it are the rest, which is how an address is dictated here.
                  The columns are unchanged: `perm_address1..3` (0535) are
                  three free-text lines and always were.
                */}
                <Field label="No." size="xs" htmlFor="st-perm-1">
                  <Input
                    id="st-perm-1"
                    uppercase
                    value={form.perm_address1 ?? ""}
                    onChange={(e) =>
                      set({ perm_address1: e.target.value || null })
                    }
                  />
                </Field>
                <Field label="Address Line 1" size="md" htmlFor="st-perm-2">
                  <Input
                    id="st-perm-2"
                    uppercase
                    value={form.perm_address2 ?? ""}
                    onChange={(e) =>
                      set({ perm_address2: e.target.value || null })
                    }
                  />
                </Field>
                <Field label="Address Line 2" size="sm" htmlFor="st-perm-3">
                  <Input
                    id="st-perm-3"
                    uppercase
                    value={form.perm_address3 ?? ""}
                    onChange={(e) =>
                      set({ perm_address3: e.target.value || null })
                    }
                  />
                </Field>

                {/*
                  `md`, NOT `sm`. With Mobile gone (0549) the row was
                  City + Pin + Phone = 9 of 12, so it no longer closed and its
                  columns stopped lining up with the three address lines above
                  it. At `md` the row is 4 + 4 + 4 and both rows are three
                  columns wide.
                */}
                <Field label="City" size="sm" htmlFor="st-perm-city">
                  <Input
                    id="st-perm-city"
                    uppercase
                    value={form.perm_city ?? ""}
                    onChange={(e) => set({ perm_city: e.target.value || null })}
                  />
                </Field>
                <Field label="Pin" size="xs" htmlFor="st-perm-pin">
                  <Input
                    id="st-perm-pin"
                    value={form.perm_pin ?? ""}
                    onChange={(e) => set({ perm_pin: e.target.value || null })}
                  />
                </Field>
                <Field label="Phone" size="sm" htmlFor="st-perm-ph">
                  <Input
                    id="st-perm-ph"
                    value={form.perm_phone ?? ""}
                    onChange={(e) =>
                      set({ perm_phone: e.target.value || null })
                    }
                  />
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "corr-address":
        return {
          ...base,
          done: !!form.corr_address1,
          content: (
            <div className="space-y-6">
              {/*
                THE TOGGLE SITS ON ITS OWN ROW, and that is arithmetic, not
                taste. `FieldGrid` is a 12-column track and a row only closes
                when its spans fill it — with the switch (3) sharing a row
                with two address lines (4 + 4) the row summed to 11, so the
                THIRD address line wrapped and every field below it started at
                a different column from its opposite number in the permanent
                block. That is the "scattered" the client saw
                (2026-09-09); the permanent block was already 4+4+4 and 3+3+3+3
                and looked right for exactly that reason.
              */}
              <FieldGrid>
                {/*
                  "SAME AS PERMANENT" COPIES ONCE AND KEEPS THE FLAG.
                  Ticking it fills the correspondence fields from the
                  permanent ones so the operator can see what will be saved —
                  the flag is stored as well (0535), because it records the
                  INTENT to keep them in step, which the copied values alone
                  cannot express.
                */}
                <Field label="Same as Permanent" size="sm">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.corr_same_as_permanent}
                      onChange={(v) =>
                        set(
                          v
                            ? {
                                corr_same_as_permanent: true,
                                corr_address1: form.perm_address1,
                                corr_address2: form.perm_address2,
                                corr_address3: form.perm_address3,
                                corr_city: form.perm_city,
                                corr_pin: form.perm_pin,
                                corr_phone: form.perm_phone,
                              }
                            : { corr_same_as_permanent: false },
                        )
                      }
                      label="Copy from permanent"
                    />
                  </div>
                </Field>
              </FieldGrid>

              <FieldGrid>
                {/*
                  Read-only while the tick is on, not hidden: an operator who
                  ticked it needs to SEE what will be saved, and a row that
                  disappears makes the form jump under the cursor.
                */}
                <Field label="No." size="xs" htmlFor="st-corr-1">
                  <Input
                    id="st-corr-1"
                    uppercase
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_address1 ?? ""}
                    onChange={(e) =>
                      set({ corr_address1: e.target.value || null })
                    }
                  />
                </Field>
                <Field label="Address Line 1" size="md" htmlFor="st-corr-2">
                  <Input
                    id="st-corr-2"
                    uppercase
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_address2 ?? ""}
                    onChange={(e) =>
                      set({ corr_address2: e.target.value || null })
                    }
                  />
                </Field>
                <Field label="Address Line 2" size="sm" htmlFor="st-corr-3">
                  <Input
                    id="st-corr-3"
                    uppercase
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_address3 ?? ""}
                    onChange={(e) =>
                      set({ corr_address3: e.target.value || null })
                    }
                  />
                </Field>

                <Field label="City" size="sm" htmlFor="st-corr-city">
                  <Input
                    id="st-corr-city"
                    uppercase
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_city ?? ""}
                    onChange={(e) => set({ corr_city: e.target.value || null })}
                  />
                </Field>
                <Field label="Pin" size="xs" htmlFor="st-corr-pin">
                  <Input
                    id="st-corr-pin"
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_pin ?? ""}
                    onChange={(e) => set({ corr_pin: e.target.value || null })}
                  />
                </Field>
                <Field label="Phone" size="sm" htmlFor="st-corr-ph">
                  <Input
                    id="st-corr-ph"
                    readOnly={form.corr_same_as_permanent}
                    value={form.corr_phone ?? ""}
                    onChange={(e) =>
                      set({ corr_phone: e.target.value || null })
                    }
                  />
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "personal":
        return {
          ...base,
          done: !!form.email || !!form.qualification || !!form.gender,
          content: (
            <div className="space-y-6">
              <FieldGrid>
                {/*
                  `type="email"` — which also opts the field OUT of CAPITALS
                  by construction (`Input` exempts by type), because a mailbox
                  name and a URL path can both be case-sensitive. Same
                  carve-out AGENTS.md ▸ CAPITALS makes.
                */}
                <Field label="E-Mail" size="md" htmlFor="st-email">
                  <Input
                    id="st-email"
                    type="email"
                    value={form.email ?? ""}
                    onChange={(e) => set({ email: e.target.value || null })}
                  />
                </Field>

                <Field label="Qualification" size="sm" htmlFor="st-qual">
                  <Input
                    id="st-qual"
                    uppercase
                    value={form.qualification ?? ""}
                    onChange={(e) =>
                      set({ qualification: e.target.value || null })
                    }
                  />
                </Field>

                {/*
                  A LIST, NOT A TEXT BOX. "O+", "O positive" and "o +ve" are
                  one fact typed three ways, and a statutory form needs one of
                  them — 0535 constrains the column to the same eight.
                */}
                <Field label="Blood Group" size="xs" htmlFor="st-blood">
                  <Select
                    id="st-blood"
                    value={form.blood_group ?? ""}
                    onChange={(e) =>
                      set({
                        blood_group:
                          (e.target.value as PersonInput["blood_group"]) ||
                          null,
                      })
                    }
                  >
                    <option value=""></option>
                    {BLOOD_GROUPS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                </Field>

                {/*
                  GENDER, not "Sex" (client 2026-09-09). The column followed
                  the label in 0550 rather than staying behind: the list's
                  third value is "Trans Gender", so `sex` was describing the
                  wrong thing from the day it was written.
                */}
                <Field label="Gender" size="sm" htmlFor="st-gender">
                  <Select
                    id="st-gender"
                    value={form.gender ?? ""}
                    onChange={(e) =>
                      set({
                        gender:
                          (e.target.value as PersonInput["gender"]) || null,
                      })
                    }
                  >
                    <option value=""></option>
                    {GENDERS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Marital Status" size="sm" htmlFor="st-marital">
                  <Select
                    id="st-marital"
                    value={form.marital_status ?? ""}
                    onChange={(e) =>
                      set({
                        marital_status:
                          (e.target.value as PersonInput["marital_status"]) ||
                          null,
                      })
                    }
                  >
                    <option value=""></option>
                    {MARITAL_STATUSES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Nationality" size="sm" htmlFor="st-nationality">
                  <Input
                    id="st-nationality"
                    uppercase
                    value={form.nationality ?? ""}
                    onChange={(e) =>
                      set({ nationality: e.target.value || null })
                    }
                  />
                </Field>

                <Field label="Religion" size="sm" htmlFor="st-religion">
                  <Input
                    id="st-religion"
                    uppercase
                    value={form.religion ?? ""}
                    onChange={(e) => set({ religion: e.target.value || null })}
                  />
                </Field>

                <Field
                  label="Identification Mark 1"
                  size="sm"
                  htmlFor="st-mark-1"
                >
                  <Input
                    id="st-mark-1"
                    uppercase
                    value={form.identification_mark_1 ?? ""}
                    onChange={(e) =>
                      set({ identification_mark_1: e.target.value || null })
                    }
                  />
                </Field>

                <Field
                  label="Identification Mark 2"
                  size="sm"
                  htmlFor="st-mark-2"
                >
                  <Input
                    id="st-mark-2"
                    uppercase
                    value={form.identification_mark_2 ?? ""}
                    onChange={(e) =>
                      set({ identification_mark_2: e.target.value || null })
                    }
                  />
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "identifiers":
        return {
          ...base,
          done: !!form.aadhaar_no || !!form.driving_licence_no,
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <Field label="Driving Lic. No" size="sm" htmlFor="st-dl">
                  <Input
                    id="st-dl"
                    uppercase
                    value={form.driving_licence_no ?? ""}
                    onChange={(e) =>
                      set({ driving_licence_no: e.target.value || null })
                    }
                  />
                </Field>

                <DateField
                  id="st-dl-valid"
                  label="Valid Upto"
                  value={form.driving_licence_valid_upto}
                  onChange={(v) => set({ driving_licence_valid_upto: v })}
                />

                {/*
                  Twelve digits. The Zod schema strips spaces and checks the
                  shape; the column carries the same regex (0535). The Verhoeff
                  CHECKSUM is deliberately not enforced — see the note there.
                */}
                <Field label="Aadhaar" size="sm" htmlFor="st-aadhaar">
                  <Input
                    id="st-aadhaar"
                    inputMode="numeric"
                    maxLength={12}
                    value={form.aadhaar_no ?? ""}
                    onChange={(e) =>
                      set({ aadhaar_no: e.target.value || null })
                    }
                  />
                </Field>

                {/*
                  MOVED HERE FROM THE BANK TAB (client 2026-09-09). A police
                  station is where a person is verified from — it sits with
                  the driving licence and the Aadhaar, not with their account
                  number.
                */}
                <Field label="Police Station" size="sm" htmlFor="st-police">
                  <Input
                    id="st-police"
                    uppercase
                    value={form.police_station ?? ""}
                    onChange={(e) =>
                      set({ police_station: e.target.value || null })
                    }
                  />
                </Field>

                {/*
                  Legacy labels this tick "Flag" and says nothing more about
                  it, so it is stored and shown as exactly that rather than
                  renamed to a guess about what it means (0535).
                */}
                <Field label="Flag" size="xs">
                  <div className="flex h-8 items-center">
                    <Toggle
                      checked={form.general_flag}
                      onChange={(v) => set({ general_flag: v })}
                      label="Set"
                    />
                  </div>
                </Field>
              </FieldGrid>
            </div>
          ),
        };

      case "enclosure":
        return {
          ...base,
          done: touched([
            "passbook_no",
            "ration_card_no",
            "insurance_policy_no",
            "passport_no",
            "election_card_no",
            "uan_no",
            "interview_date",
          ]),
          content: (
            <div className="space-y-6">
              <FieldGrid>
                <TextField
                  label="Passbook No"
                  value={form.passbook_no}
                  onChange={(v) => set({ passbook_no: v })}
                  id="en-passbook"
                />
                <TextField
                  label="Ration Card No"
                  value={form.ration_card_no}
                  onChange={(v) => set({ ration_card_no: v })}
                  id="en-ration"
                />
                <TextField
                  label="Insurance Policy No"
                  value={form.insurance_policy_no}
                  onChange={(v) => set({ insurance_policy_no: v })}
                  id="en-ins"
                />
                <TextField
                  label="Election Card No"
                  value={form.election_card_no}
                  onChange={(v) => set({ election_card_no: v })}
                  id="en-election"
                />
                <TextField
                  label="Passport No"
                  value={form.passport_no}
                  onChange={(v) => set({ passport_no: v })}
                  id="en-passport"
                />
                <DateField
                  label="Valid Upto"
                  value={form.passport_valid_upto}
                  onChange={(v) => set({ passport_valid_upto: v })}
                  id="en-passport-upto"
                />
                {/* The Universal Account Number — the PF identity that follows a
                    person between employers, so it belongs with the documents
                    they bring rather than in PF Details, which is about THIS job. */}
                <TextField
                  label="UAN No."
                  value={form.uan_no}
                  onChange={(v) => set({ uan_no: v })}
                  id="en-uan"
                />
                <DateField
                  label="Interview Dt"
                  value={form.interview_date}
                  onChange={(v) => set({ interview_date: v })}
                  id="en-interview"
                />
              </FieldGrid>
            </div>
          ),
        };

      case "education":
        return {
          ...base,
          done:
            childPayload.education.length > 0 ||
            childPayload.technical.length > 0,
          content: (
            <div className="space-y-6">
              {/* TWO GRIDS ON ONE PANE, as legacy draws them: schooling above,
                  trade training below. Each names itself because the rail row
                  names the PAIR — the one place a group heading still earns
                  its place now that the pane carries the section name. */}
              <div className="space-y-2">
                <GroupHeading>Education Details</GroupHeading>
                <ChildGrid<EducationRow>
                  columns={educationColumns}
                  rows={education}
                  onAdd={() =>
                    setEducation((xs) => [...xs, blankEducation(newKey())])
                  }
                  onRemove={(r) =>
                    setEducation((xs) => xs.filter((x) => x.key !== r.key))
                  }
                  addLabel="+ Add education"
                  seedRow
                />
              </div>
              <div className="space-y-2">
                <GroupHeading>Technical Details</GroupHeading>
                <ChildGrid<TechnicalRow>
                  columns={technicalColumns}
                  rows={technical}
                  onAdd={() =>
                    setTechnical((xs) => [...xs, blankTechnical(newKey())])
                  }
                  onRemove={(r) =>
                    setTechnical((xs) => xs.filter((x) => x.key !== r.key))
                  }
                  addLabel="+ Add technical detail"
                  seedRow
                />
              </div>
            </div>
          ),
        };

      case "languages":
        return {
          ...base,
          done: childPayload.languages.length > 0,
          content: (
            <div className="space-y-6">
              <ChildGrid<LanguageRow>
                columns={languageColumns}
                rows={languages}
                onAdd={() =>
                  setLanguages((xs) => [...xs, blankLanguage(newKey())])
                }
                onRemove={(r) =>
                  setLanguages((xs) => xs.filter((x) => x.key !== r.key))
                }
                addLabel="+ Add language"
                seedRow
              />
            </div>
          ),
        };

      case "background":
        return {
          ...base,
          done: touched([
            "through_advertisement",
            "through_voluntarily",
            "through_knowledge",
            "bus_no",
            "physique_illness",
            "occupation",
            "no_of_children",
            "dependants",
            "earning_members",
            "properties_owned",
            "professional_membership",
            "extra_curricular",
            "achievement_details",
            "disciplinary_actions",
          ]),
          content: (
            <div className="space-y-6">
              <div className="space-y-2">
                <GroupHeading>How they reached us</GroupHeading>
                <FieldGrid>
                  <Field label="Through Our Advertisement" size="sm">
                    <Toggle
                      checked={form.through_advertisement}
                      onChange={(v) => set({ through_advertisement: v })}
                      ariaLabel="Through Our Advertisement"
                    />
                  </Field>
                  <Field label="Through Voluntarily" size="sm">
                    <Toggle
                      checked={form.through_voluntarily}
                      onChange={(v) => set({ through_voluntarily: v })}
                      ariaLabel="Through Voluntarily"
                    />
                  </Field>
                  <Field label="Through Knowledge" size="sm">
                    <Toggle
                      checked={form.through_knowledge}
                      onChange={(v) => set({ through_knowledge: v })}
                      ariaLabel="Through Knowledge"
                    />
                  </Field>
                  <TextField
                    label="Bus No"
                    value={form.bus_no}
                    onChange={(v) => set({ bus_no: v })}
                    id="bg-bus"
                  />
                </FieldGrid>
              </div>
              <div className="space-y-2">
                <GroupHeading>Household</GroupHeading>
                <FieldGrid>
                  <TextField
                    label="Occupation"
                    value={form.occupation}
                    onChange={(v) => set({ occupation: v })}
                    id="bg-occupation"
                  />
                  <CountField
                    label="No Of Children"
                    value={form.no_of_children}
                    onChange={(v) => set({ no_of_children: v })}
                    id="bg-children"
                  />
                  <CountField
                    label="Dependants"
                    value={form.dependants}
                    onChange={(v) => set({ dependants: v })}
                    id="bg-dependants"
                  />
                  <CountField
                    label="Earning Members"
                    value={form.earning_members}
                    onChange={(v) => set({ earning_members: v })}
                    id="bg-earning"
                  />
                  <TextField
                    label="Physique / Illness"
                    value={form.physique_illness}
                    onChange={(v) => set({ physique_illness: v })}
                    id="bg-physique"
                    size="md"
                  />
                  <TextField
                    label="Properties Owned"
                    value={form.properties_owned}
                    onChange={(v) => set({ properties_owned: v })}
                    id="bg-properties"
                    size="md"
                  />
                  <TextField
                    label="Professional Membership"
                    value={form.professional_membership}
                    onChange={(v) => set({ professional_membership: v })}
                    id="bg-membership"
                    size="md"
                  />
                  <TextField
                    label="Extra Curricular Activities"
                    value={form.extra_curricular}
                    onChange={(v) => set({ extra_curricular: v })}
                    id="bg-extra"
                    size="md"
                  />
                  <TextField
                    label="Achievement Details"
                    value={form.achievement_details}
                    onChange={(v) => set({ achievement_details: v })}
                    id="bg-achievement"
                    size="md"
                  />
                  <TextField
                    label="Disciplinary Actions"
                    value={form.disciplinary_actions}
                    onChange={(v) => set({ disciplinary_actions: v })}
                    id="bg-disciplinary"
                    size="md"
                  />
                </FieldGrid>
              </div>
            </div>
          ),
        };

      case "other-details":
        return {
          ...base,
          done: touched([
            "mother_tongue",
            "height_cm",
            "weight_kg",
            "eye_sight",
            "house_type",
            "id_submitted_dl",
            "id_submitted_vote_id",
            "id_submitted_ration",
            "id_submitted_passport",
            "id_submitted_tc",
            "id_submitted_mark_sheet",
            "id_submitted_aadhaar",
            "id_submitted_pan",
            "id_submitted_others",
            "id_submitted_specify",
            "prior_experience",
            "handicap_details",
            "has_passport",
            "two_wheeler_licence",
            "four_wheeler_licence",
            "major_operation",
            "operation_details",
            "only_earning_member",
            "willing_donate_blood",
            "grade",
            "employee_classification",
          ]),
          content: (
            <div className="space-y-6">
              <div className="space-y-2">
                <GroupHeading>Particulars</GroupHeading>
                <FieldGrid>
                  <TextField
                    label="Mother Tongue / Languages"
                    value={form.mother_tongue}
                    onChange={(v) => set({ mother_tongue: v })}
                    id="od-tongue"
                    size="sm"
                  />
                  {/* Height and weight are stored ONCE (0556) — legacy prints
                      the same pair on two of these popups. */}
                  <DecimalField
                    label="Height (cm)"
                    value={form.height_cm}
                    onChange={(v) => set({ height_cm: v })}
                    id="od-height"
                  />
                  <DecimalField
                    label="Weight (kg)"
                    value={form.weight_kg}
                    onChange={(v) => set({ weight_kg: v })}
                    id="od-weight"
                  />
                  <TextField
                    label="Eye Sight"
                    value={form.eye_sight}
                    onChange={(v) => set({ eye_sight: v })}
                    id="od-eyesight"
                  />
                  <TextField
                    label="House"
                    value={form.house_type}
                    onChange={(v) => set({ house_type: v })}
                    id="od-house"
                  />
                  <TextField
                    label="Experience"
                    value={form.prior_experience}
                    onChange={(v) => set({ prior_experience: v })}
                    id="od-experience"
                    size="md"
                  />
                  <TextField
                    label="Handicap Details"
                    value={form.handicap_details}
                    onChange={(v) => set({ handicap_details: v })}
                    id="od-handicap"
                    size="md"
                  />
                </FieldGrid>
              </div>
              <div className="space-y-2">
                <GroupHeading>ID Submitted</GroupHeading>
                <FieldGrid>
                  <Field label="DL" size="sm">
                    <Toggle
                      checked={form.id_submitted_dl}
                      onChange={(v) => set({ id_submitted_dl: v })}
                      ariaLabel="DL"
                    />
                  </Field>
                  <Field label="Vote ID" size="sm">
                    <Toggle
                      checked={form.id_submitted_vote_id}
                      onChange={(v) => set({ id_submitted_vote_id: v })}
                      ariaLabel="Vote ID"
                    />
                  </Field>
                  <Field label="Ration Card" size="sm">
                    <Toggle
                      checked={form.id_submitted_ration}
                      onChange={(v) => set({ id_submitted_ration: v })}
                      ariaLabel="Ration Card"
                    />
                  </Field>
                  <Field label="Passport" size="sm">
                    <Toggle
                      checked={form.id_submitted_passport}
                      onChange={(v) => set({ id_submitted_passport: v })}
                      ariaLabel="Passport"
                    />
                  </Field>
                  <Field label="TC" size="sm">
                    <Toggle
                      checked={form.id_submitted_tc}
                      onChange={(v) => set({ id_submitted_tc: v })}
                      ariaLabel="TC"
                    />
                  </Field>
                  <Field label="Mark Sheet" size="sm">
                    <Toggle
                      checked={form.id_submitted_mark_sheet}
                      onChange={(v) => set({ id_submitted_mark_sheet: v })}
                      ariaLabel="Mark Sheet"
                    />
                  </Field>
                  <Field label="Aadhaar" size="sm">
                    <Toggle
                      checked={form.id_submitted_aadhaar}
                      onChange={(v) => set({ id_submitted_aadhaar: v })}
                      ariaLabel="Aadhaar"
                    />
                  </Field>
                  <Field label="PAN Card" size="sm">
                    <Toggle
                      checked={form.id_submitted_pan}
                      onChange={(v) => set({ id_submitted_pan: v })}
                      ariaLabel="PAN Card"
                    />
                  </Field>
                  <Field label="Others" size="sm">
                    <Toggle
                      checked={form.id_submitted_others}
                      onChange={(v) => set({ id_submitted_others: v })}
                      ariaLabel="Others"
                    />
                  </Field>
                  <TextField
                    label="Others Specify"
                    value={form.id_submitted_specify}
                    onChange={(v) => set({ id_submitted_specify: v })}
                    id="od-specify"
                    size="md"
                  />
                </FieldGrid>
              </div>
              <div className="space-y-2">
                <GroupHeading>Declarations</GroupHeading>
                <FieldGrid>
                  <Field label="Passport Held" size="sm">
                    <Toggle
                      checked={form.has_passport}
                      onChange={(v) => set({ has_passport: v })}
                      ariaLabel="Passport Held"
                    />
                  </Field>
                  <Field label="Two Wheeler Licence" size="sm">
                    <Toggle
                      checked={form.two_wheeler_licence}
                      onChange={(v) => set({ two_wheeler_licence: v })}
                      ariaLabel="Two Wheeler Licence"
                    />
                  </Field>
                  <Field label="Four Wheeler Licence" size="sm">
                    <Toggle
                      checked={form.four_wheeler_licence}
                      onChange={(v) => set({ four_wheeler_licence: v })}
                      ariaLabel="Four Wheeler Licence"
                    />
                  </Field>
                  <Field label="Major Operation" size="sm">
                    <Toggle
                      checked={form.major_operation}
                      onChange={(v) => set({ major_operation: v })}
                      ariaLabel="Major Operation"
                    />
                  </Field>
                  <TextField
                    label="Operation Details"
                    value={form.operation_details}
                    onChange={(v) => set({ operation_details: v })}
                    id="od-operation"
                    size="md"
                  />
                  <Field label="Only Earning Member" size="sm">
                    <Toggle
                      checked={form.only_earning_member}
                      onChange={(v) => set({ only_earning_member: v })}
                      ariaLabel="Only Earning Member"
                    />
                  </Field>
                  <Field label="Willing To Donate Blood" size="sm">
                    <Toggle
                      checked={form.willing_donate_blood}
                      onChange={(v) => set({ willing_donate_blood: v })}
                      ariaLabel="Willing To Donate Blood"
                    />
                  </Field>
                  <TextField
                    label="Grade" size="xs"
                    value={form.grade}
                    onChange={(v) => set({ grade: v })}
                    id="od-grade"
                  />
                  <TextField
                    label="Classification"
                    value={form.employee_classification}
                    onChange={(v) => set({ employee_classification: v })}
                    id="od-class"
                    size="md"
                  />
                </FieldGrid>
              </div>
            </div>
          ),
        };

      case "family":
        return {
          ...base,
          done: childPayload.family.length > 0,
          content: childrenLoading ? (
            <LoadingRows />
          ) : (
            <ChildGrid<FamilyRow>
              columns={familyColumns}
              rows={family}
              onAdd={() => setFamily((xs) => [...xs, blankFamily(newKey())])}
              onRemove={(r) =>
                setFamily((xs) => xs.filter((x) => x.key !== r.key))
              }
              addLabel="+ Add family member"
              seedRow
            />
          ),
        };

      case "experience":
        return {
          ...base,
          done: childPayload.experience.length > 0,
          content: childrenLoading ? (
            <LoadingRows />
          ) : (
            <ChildGrid<ExperienceRow>
              columns={experienceColumns}
              rows={experience}
              onAdd={() =>
                setExperience((xs) => [...xs, blankExperience(newKey())])
              }
              onRemove={(r) =>
                setExperience((xs) => xs.filter((x) => x.key !== r.key))
              }
              addLabel="+ Add experience"
              seedRow
            />
          ),
        };

      case "reference":
        /* A CATEGORY ROW: everything it used to hold is now a child of its
           own below, so it owns no pane. `goToSection` resolves it to the
           first child, which is why `content` is never rendered. */
        return { ...base, content: null };

      case "external-refs":
        return {
          ...base,
          done: childPayload.externalRefs.length > 0,
          content: (
            <div className="space-y-6">
              {childrenLoading ? (
                <LoadingRows />
              ) : (
                <ChildGrid<ExternalRefRow>
                  columns={externalRefColumns}
                  rows={externalRefs}
                  onAdd={() =>
                    setExternalRefs((xs) => [...xs, blankExternalRef(newKey())])
                  }
                  onRemove={(r) =>
                    setExternalRefs((xs) => xs.filter((x) => x.key !== r.key))
                  }
                  addLabel="+ Add external reference"
                  seedRow
                />
              )}
            </div>
          ),
        };

      case "emergency":
        return {
          ...base,
          done: childPayload.emergencyContacts.length > 0,
          content: (
            <div className="space-y-6">
              {childrenLoading ? (
                <LoadingRows />
              ) : (
                <ChildGrid<EmergencyRow>
                  columns={emergencyColumns}
                  rows={emergencyContacts}
                  onAdd={() =>
                    setEmergencyContacts((xs) => [
                      ...xs,
                      blankEmergency(newKey()),
                    ])
                  }
                  onRemove={(r) =>
                    setEmergencyContacts((xs) =>
                      xs.filter((x) => x.key !== r.key),
                    )
                  }
                  addLabel="+ Add emergency contact"
                  seedRow
                />
              )}
            </div>
          ),
        };

      case "internal-ref":
        return {
          ...base,
          done: childPayload.internalRefs.length > 0,
          content: (
            <div className="space-y-6">
              {childrenLoading ? (
                <LoadingRows />
              ) : (
                <ChildGrid<InternalRefRow>
                  columns={internalRefColumns}
                  rows={internalRefs}
                  onAdd={() =>
                    setInternalRefs((xs) => [...xs, blankInternalRef(newKey())])
                  }
                  onRemove={(r) =>
                    setInternalRefs((xs) => xs.filter((x) => x.key !== r.key))
                  }
                  addLabel="+ Add internal reference"
                  seedRow
                />
              )}
            </div>
          ),
        };

      case "nomination":
        return {
          ...base,
          // The ESI/PF terms moved to Salary Registry, so this dot no longer
          // reads them — a section's "has data" light must answer for what is
          // actually in it.
          done: childPayload.nominations.length > 0,
          content: (
            <div className="space-y-6">
              <div className="space-y-2">
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                  <ChildGrid<NominationRow>
                    columns={nominationColumns}
                    rows={nominations}
                    onAdd={() =>
                      setNominations((xs) => [...xs, blankNomination(newKey())])
                    }
                    onRemove={(r) =>
                      setNominations((xs) => xs.filter((x) => x.key !== r.key))
                    }
                    addLabel="+ Add nomination"
                    seedRow
                  />
                )}
              </div>
            </div>
          ),
        };

      default:
        // Awaiting its field list — see the note above `sections`.
        return { ...base, content: null };
    }
  });

  /**
   * THE LIST DIFFERS BY TWO COLUMNS, and only two.
   *
   * Staff show the monthly salary payroll computes from; a worker has none
   * (0553) and shows the wage basis instead — the rate Type and the contractor
   * they work under, which is what an operator scans this list for.
   */
  const columns: Column<PersonRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    {
      header: "Designation",
      // `designation_name` is resolved in the service — the row holds an id.
      cell: (r) => r.designation_name ?? "—",
    },
    { header: "Location", cell: (r) => r.location_name ?? "—" },
    ...(isWorker
      ? ([
          {
            header: "Type",
            cell: (r) =>
              WORKER_TYPE_LABELS[(r as WorkerRow).worker_type] ?? "—",
          },
          {
            header: "Contractor",
            cell: (r) => (r as WorkerRow).contractor_name ?? "—",
          },
        ] as Column<PersonRow>[])
      : ([
          {
            header: "Monthly Salary",
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">
                {fmtMoney((r as StaffRow).monthly_salary)}
              </span>
            ),
          },
        ] as Column<PersonRow>[])),
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions label={r.name} onEdit={() => openEdit(r)} />
    )),
  ];

  /**
   * THE EDITOR IS THE ROUTE'S OWN CONTENT, NOT AN OVERLAY OVER IT
   * (client 2026-09-10: "see the top it is showing the multibar, i want same
   * like this pattern in hr module", pointing at Order Entry).
   *
   * This screen used `mount="overlay"`, the default, and the layout contract
   * does name an overlay for a master edited as a MODE of its list route. What
   * that reasoning did not account for is the WORKSPACE TAB BAR: an overlay is
   * `fixed inset-0`, so it covers the app chrome — the tab strip included — and
   * opening a staff record made every other open screen disappear until the
   * record was closed. The tabs are the operator's way BETWEEN screens, so a
   * surface that hides them is one they cannot leave without first dealing with
   * what is in front of them.
   *
   * `mount="page"` is Order Entry's answer to the same shape — it is a
   * list/editor mode pair too (`if (mode === "list")` there, `showForm` here) —
   * and `garment-order-screen.tsx` carries the rest of the reasoning.
   *
   * ## THE EARLY RETURN IS WHY EVERY HOOK IN THIS COMPONENT IS ABOVE THIS LINE
   *
   * AGENTS.md ▸ "Hooks above every early return", the rule that file has now
   * recorded five times because it keeps recurring. There was no early return
   * here before today, so nothing in this component had to obey it; there is
   * one now, and a hook added below it would run on one render and be skipped
   * on the next. `npm run check:hooks` is the gate.
   */
  if (showForm) {
    return (
      // `flex h-full flex-col` is what a page-mounted MasterFullScreen requires:
      // it takes `flex-1 min-h-0` and needs a definite height to divide. `h-full`
      // resolves against `<main className="flex-1 overflow-y-auto">` in
      // app/(app)/layout.tsx. Leave it `space-y-4` and the editor sizes to its
      // content instead, stranding the footer above a strip of empty page.
      <div className="flex h-full flex-col gap-4">
        {/**
         * A DIVIDER, NOT A PAGE HEADER — the same band Order Entry draws, and
         * every class here is copied from it rather than re-invented, so a
         * reader who knows one recognises the other. It carries exactly what
         * the overlay's `header` block used to: which record, and the way out.
         *
         * `data-focus-region="header"` IS NOT OPTIONAL. Without it `regionOf`
         * (lib/focus.ts) sorts "← Back to list" as a CONTENT field, and Tab off
         * the last field of a section lands on it instead of wrapping to the
         * next section.
         */}
        <div
          data-focus-region="header"
          className="mb-3 flex w-full flex-wrap items-baseline gap-x-6 gap-y-2"
        >
          <div className="flex shrink-0 items-baseline gap-2">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
              {editId ? `Edit ${copy.entity}` : `New ${copy.entity}`}
            </dt>
            <dd className="m-0 text-sm font-semibold text-foreground">
              {(editId && form.name) || "—"}
            </dd>
          </div>
          <div
            aria-hidden
            className="h-px min-w-[2rem] flex-1 self-center bg-border"
          />
          <div className="flex shrink-0 items-center gap-3">
            {dirty && (
              <span className="text-[11px] font-medium text-warning">
                ● Unsaved
              </span>
            )}
            {/* `size="sm"` to match the compact band. AGENTS.md's `md` header-row
               rule is about matching a LIST toolbar's search box, and there is no
               toolbar here — the same call Order Entry's band makes. */}
            <Button variant="outline" size="sm" onClick={cancel}>
              ← Back to list
            </Button>
          </div>
        </div>

        <MasterFullScreen
          ref={shellRef}
          mount="page"
          // The rail truncates at this depth, so the pane names the section in
          // full (client 2026-09-11). See `paneHeading` for why it is opt-in.
          paneHeading
          open
          onClose={cancel}
          // The band above already says "New Staff" / "Edit Staff", so the
          // shell's own mode chip would announce it twice.
          modeLabel={null}
          // On a page mount the SHELL owns the reload guard
          // (`useUnsavedGuard(mount === "page" && ...)`), so it has to be told.
          // This screen still declares its own beside it — the counter in
          // `lib/reload-guard.ts` composes, and `--check unsaved-guard` reads
          // the screen's call, not the shell's.
          dirty={dirty}
          sections={sections}
          footer={{
            status: dirty
              ? "Unsaved changes"
              : editId
                ? "All changes saved"
                : `New ${copy.lower}`,
            onCancel: cancel,
            onSave: submit,
            // Names the ENTITY — a bare "Save" could belong to any record.
            saveLabel: `Save ${copy.lower}`,
            canSave: validity.canSave,
            // Keeps Save clickable when blocked so it explains itself, and so
            // Ctrl+S and Enter-off-the-last-field reach the same handler.
            onBlockedSave: revealFirstProblem,
            isPending,
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* THE HEADER MOVED IN FROM `page.tsx` so this branch can own it: the edit
         branch above replaces it with an identity band, and a server component
         cannot know which mode the client is in. Order Entry keeps its own list
         header inside the screen for the same reason. */}
      <PageHeader title={copy.pageTitle} description={copy.pageDescription} />
      <div className="flex flex-wrap items-center gap-2">
        <DataIoToolbar
          entityKey={copy.ioKey}
          rows={rows}
          canImport={canCreate}
          canExport={canExport}
        />
        <div className="ml-auto">
          {canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add {copy.entity}
            </Button>
          )}
        </div>
      </div>

      {canDelete && (
        <BulkDeleteBar
          entityKey={copy.ioKey}
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          label={copy.lower}
        />
      )}

      <DataTable
        columns={withCreatedColumns(columns, rows)}
        rows={rows}
        getKey={(r) => r.id}
        empty={copy.empty}
        selectable={canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(rows.map((r) => r.id))}
      />
    </div>
  );
}

/**
 * A GROUP HEADING INSIDE A SECTION — the legacy panels' captions, without the
 * panels. Legacy Detail draws bordered boxes around Pay(Statutory), Pay(Actual)
 * and the rest; the de-clutter rule removes a frame that only says "these
 * belong together", but here the caption is the ONLY thing distinguishing a
 * statutory gross from an actual one, so the words stay and the box goes. Same
 * call as PF/ESI Control, one level up.
 *
 * ## IT CARRIES THE WEIGHT THE BOX USED TO
 *
 * `13px / bold / foreground`, not the `text-xs font-semibold text-muted-*` a
 * caption normally takes (client 2026-09-09: "make it lil bit bigger and bold").
 * That default is right for a caption INSIDE a frame, where the border already
 * says where the group starts — `DetailSection` still uses it for exactly that.
 * With the frames gone, this line is the only boundary between one group and
 * the next, so it has to read as a heading rather than as a label.
 *
 * `text-foreground` matters as much as the weight: muted grey at the top of a
 * group of black labels reads as less important than its own contents.
 *
 * ONE COMPONENT, EVERY TAB. Detail, Salary Registry, Bank Account,
 * General, Reference and Nomination all render their groups through this, so
 * the headings cannot drift apart — which is what "keep this for all tabs
 * headings" asks for.
 */
function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-[13px] font-bold uppercase tracking-wide text-foreground">
      {children}
    </div>
  );
}

/**
 * A `<Select>` over a master, which keeps the row a record ALREADY HOLDS even
 * when that row has been switched off.
 *
 * AGENTS.md ▸ "Disabled rows": a disabled master row is not offered anywhere —
 * but dropping the one already stored would show a filled field as empty and
 * blank the FK on the next save. So an inactive option is filtered out UNLESS
 * it is the current value, in which case it stays, tagged, and cannot be
 * re-picked once changed.
 */
function MasterSelect({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: MasterOption[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const shown = options.filter((o) => !o.inactive || o.id === value);
  return (
    <Select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value=""></option>
      {shown.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
          {o.inactive ? " (inactive)" : ""}
        </option>
      ))}
    </Select>
  );
}

/**
 * SAYS THE ROWS ARE COMING, rather than showing an empty grid.
 *
 * The child lists are fetched when a record opens, so for a moment the grids
 * genuinely hold nothing — and `seedRow` would draw a blank line, which reads
 * as "this employee has no family" rather than "still loading". An operator who
 * believed that and typed into it would have their row replaced the instant the
 * fetch landed.
 */
function LoadingRows() {
  return (
    <div className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

/**
 * OTHERS — GROSS LESS THE NAMED HEADS, computed and never stored.
 *
 * Legacy greys this box on both pay panels because it is arithmetic, and 0534
 * left the column out for the same reason: a stored copy and the sum can
 * disagree, and then nobody knows which is the salary.
 *
 * Read-only and `skipTab`, like every other derived value on this screen —
 * reachable with the mouse, off the typing path. A negative answer is shown as
 * typed rather than clamped: it means the heads add up to more than the gross,
 * which is a data-entry error the operator needs to SEE, not one to hide.
 */
function DerivedMoney({
  label,
  value,
  size = "sm",
}: {
  label: string;
  value: number;
  /** Same prop `MoneyField` carries — a derived box is sized like any other. */
  size?: FieldSize;
}) {
  /**
   * BLANK AT ZERO, matching `MoneyField` — an empty panel showed `0.00` in this
   * box while every field feeding it was empty, which reads as a figure
   * somebody entered (client 2026-09-09).
   *
   * Rounded BEFORE the comparison, and that is not fussiness: the value is a
   * subtraction of four floats, so heads that genuinely cancel can land on
   * `-2.8e-14` — truthy, and rendered as `-0.00`. Rounding to paise first makes
   * "they cancel" and "nothing typed" the same answer, which is what an empty
   * box should mean here.
   */
  const paise = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  return (
    <Field label={label} size={size} hint="Gross less the heads" skipTab>
      <Input readOnly value={paise === 0 ? "" : paise.toFixed(2)} />
    </Field>
  );
}

/** A money cell — same shape everywhere, so twenty of them cannot drift. */
function MoneyField({
  id,
  label,
  value,
  onChange,
  max,
  disabled,
  size = "sm",
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  /** Upper bound, for a percentage. Omit for money. */
  max?: number;
  disabled?: boolean;
  /**
   * Defaults to `sm`, the width a column of money wants — a Basic beside a DA
   * beside an HRA is the one place identical boxes are correct (LAYOUT.md §3).
   * Overridden only where the value is NOT money: `Disability %` is two digits.
   */
  size?: FieldSize;
}) {
  /**
   * A ZERO SHOWS AS AN EMPTY BOX, and the local string is what makes that
   * possible without breaking typing.
   *
   * The field used to bind straight to the number, so fifteen money boxes and a
   * percentage all opened reading `0` — the column default rendered as if
   * someone had typed it (client 2026-09-09: "why evrwhere this 0 is showing").
   *
   * Rendering `value === 0 ? "" : value` alone does NOT work: the moment the
   * operator types `0` the parent stores 0 and the digit vanishes under their
   * cursor. So the CONTROL holds the text and the FORM holds the number —
   * "" and 0 stay distinguishable on screen while the payload keeps the
   * not-null default the column wants.
   *
   * It also lets a decimal be typed: `5.` parses to 5, so the value does not
   * change, so the text is left alone and the dot survives long enough for the
   * digits after it.
   *
   * The `value !== prev` block is React's documented way to adjust state when a
   * prop changes — it re-syncs when the whole record is swapped underneath
   * (openAdd / openEdit) and is a no-op during ordinary typing.
   */
  const [text, setText] = useState(value === 0 ? "" : String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value === 0 ? "" : String(value));
  }

  return (
    <Field label={label} size={size} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        max={max}
        step={0.01}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          // Blank means zero to the record — the columns are `not null default
          // 0` — while the box itself stays empty.
          onChange(raw === "" ? 0 : parseFloat(raw) || 0);
        }}
      />
    </Field>
  );
}

/**
 * A text cell whose blank is null. `caps` defaults ON, matching `Input`'s own
 * default; pass false for a value where capitals change meaning rather than
 * presentation — a phone number gains nothing, and AGENTS.md ▸ CAPITALS lists
 * the genuine carve-outs.
 */
function TextField({
  id,
  label,
  value,
  onChange,
  size = "sm",
  caps = true,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  size?: FieldSize;
  caps?: boolean;
}) {
  return (
    <Field label={label} size={size} htmlFor={id}>
      <Input
        id={id}
        uppercase={caps}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </Field>
  );
}

/** A date cell. `""` from a blank input becomes null, never an empty string. */
/**
 * A WHOLE-NUMBER BOX THAT STAYS BLANK WHEN UNANSWERED.
 *
 * "No children" and "not asked" are different facts and the column is nullable,
 * so an empty box sends null rather than a confident 0 — the same judgement
 * `MoneyField` makes about a zero, one step further: here even the ZERO is a
 * real answer worth distinguishing from silence.
 */
function CountField({
  label,
  value,
  onChange,
  id,
  size = "sm",
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  id: string;
  size?: FieldSize;
}) {
  return (
    <Field label={label} size={size} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        step={1}
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </Field>
  );
}

/** The same, for a measurement carrying decimals (height, weight). */
function DecimalField({
  label,
  value,
  onChange,
  id,
  size = "sm",
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  id: string;
  size?: FieldSize;
}) {
  return (
    <Field label={label} size={size} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      />
    </Field>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <Field label={label} size="sm" htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </Field>
  );
}
