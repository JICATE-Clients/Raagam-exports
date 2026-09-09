"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  DISABILITY_TYPES,
  GUARDIAN_RELATIONS,
  PAY_MODES,
  BLOOD_GROUPS,
  MARITAL_STATUSES,
  SALARY_PAID,
  SEXES,
  STATUTORY_STATUSES,
  STAFF_TYPES,
  WEEK_DAYS,
  type StaffInput,
} from "@/lib/hr/types";
import type { StaffRow, LocationOption } from "@/lib/hr/masters-service";
import { createStaff, updateStaff } from "@/lib/hr/masters-actions";
import { getStaffChildren } from "./staff-children";
import { fmtMoney } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
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
import { STAFF_SECTIONS } from "./staff-sections";

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

type InternalRefRow = { key: string; department_id: string; referee_id: string };
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
 * An external referee and an emergency contact (0538).
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
  key, name: "", designation: "", address1: "", address2: "", phone: "", mobile: "",
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
  key, name: "", relation: "", address1: "", address2: "", phone: "", mobile: "",
});

type NominationRow = { key: string; nomination_for: string };
const blankNomination = (key: string): NominationRow => ({ key, nomination_for: "" });

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
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
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
const DEFAULTS: StaffInput = {
  name: "",
  designation: null,
  location_id: null,
  monthly_salary: 0,
  joined_date: null,
  is_active: true,

  guardian_relation: "S/O",
  guardian_name: null,
  mother_name: null,
  category_id: null,
  department_id: null,
  division_id: null,

  staff_type: "Permanent",
  card_no: null,
  salary_paid: "Monthly",
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

  loan_balance: 0,
  advance_balance: 0,
  expected_salary: 0,
  cl_balance: 0,
  el_credit_days: 0,
  el_carry_days: 0,

  blocked: false,

  // General (0535)
  perm_address1: null,
  perm_address2: null,
  perm_address3: null,
  perm_city: null,
  perm_pin: null,
  perm_phone: null,
  perm_mobile: null,

  corr_same_as_permanent: false,
  corr_address1: null,
  corr_address2: null,
  corr_address3: null,
  corr_city: null,
  corr_pin: null,
  corr_phone: null,
  corr_mobile: null,

  email: null,
  qualification: null,
  blood_group: null,
  identification_mark_1: null,
  identification_mark_2: null,
  sex: null,
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
};

export default function StaffClient({
  staff,
  locations,
  departments,
  divisions,
  categories,
  hostelCategories,
  banks,
  canCreate = false,
  canExport = false,
  canDelete = false,
}: {
  staff: StaffRow[];
  locations: LocationOption[];
  departments: MasterOption[];
  divisions: MasterOption[];
  categories: MasterOption[];
  hostelCategories: MasterOption[];
  banks: MasterOption[];
  canCreate?: boolean;
  canExport?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
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
  const [form, setForm] = useState<StaffInput>(DEFAULTS);
  const [saved, setSaved] = useState<StaffInput>(DEFAULTS);
  const sel = useRowSelection();
  const shellRef = useRef<MasterFullScreenHandle>(null);

  const set = (patch: Partial<StaffInput>) => setForm((f) => ({ ...f, ...patch }));

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
    setEditId(null);
    setEditCode(null);
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
  function openEdit(s: StaffRow) {
    const row = s as unknown as Record<string, unknown>;
    const next = Object.fromEntries(
      (Object.keys(DEFAULTS) as (keyof StaffInput)[]).map((k) => [
        k,
        row[k] ?? DEFAULTS[k],
      ]),
    ) as StaffInput;
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
    getStaffChildren(s.id)
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
            last_salary_drawn: r.last_salary_drawn == null ? "" : String(r.last_salary_drawn),
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
          c.nominations.map((r) => ({ key: newKey(), nomination_for: r.nomination_for ?? "" })),
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
      })
      .catch((e: unknown) => toastError(e instanceof Error ? e.message : "Could not load details."))
      .finally(() => setChildrenLoading(false));
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  /**
   * A ROW IS DROPPED IF IT IS BLANK. `seedRow` opens every grid with one empty
   * line so the first entry costs no click — and an operator who never touches
   * Family Details would otherwise save an empty family member.
   */
  function childPayload() {
    return {
      family: family
        .filter((r) => r.name.trim() || r.relation.trim() || r.other_information.trim())
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
          last_salary_drawn: r.last_salary_drawn === "" ? null : Number(r.last_salary_drawn),
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
    };
  }

  function submit() {
    const children = childPayload();
    startTransition(async () => {
      const result = editId
        ? await updateStaff(editId, form, children)
        : await createStaff(form, children);
      if (result.ok) {
        success(editId ? "Staff updated." : "Staff created.");
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
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyRow[]>([]);
  /** True while `getStaffChildren` is in flight — the grids are empty until then. */
  const [childrenLoading, setChildrenLoading] = useState(false);
  const keySeq = useRef(0);
  const newKey = () => `r${keySeq.current++}`;

  const setFamilyAt = (key: string, patch: Partial<FamilyRow>) =>
    setFamily((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setExperienceAt = (key: string, patch: Partial<ExperienceRow>) =>
    setExperience((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setInternalRefAt = (key: string, patch: Partial<InternalRefRow>) =>
    setInternalRefs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setNominationAt = (key: string, patch: Partial<NominationRow>) =>
    setNominations((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setExternalRefAt = (key: string, patch: Partial<ExternalRefRow>) =>
    setExternalRefs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setEmergencyAt = (key: string, patch: Partial<EmergencyRow>) =>
    setEmergencyContacts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
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
      xs.length ? xs.map((x, i) => (i === 0 ? { ...x, ...patch } : x)) : [{ ...account, ...patch }],
    );

  /**
   * ONE DECLARATION PER GRID — `ChildGrid` renders the header and every cell
   * from these, so a column cannot be added to one and forgotten in the other.
   *
   * `ariaLabel` on every switch is required, not optional: the column header
   * names it on screen but is not associated with the control
   * programmatically, so omitting it ships an unnamed checkbox.
   */
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
          onChange={(e) => setFamilyAt(r.key, { date_of_birth: e.target.value })}
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
      width: "auto",
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
          onChange={(e) => setFamilyAt(r.key, { other_information: e.target.value })}
          aria-label="Other information"
        />
      ),
    },
    {
      header: "Residing With Employee",
      width: "auto",
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
          onChange={(e) => setExperienceAt(r.key, { company_name: e.target.value })}
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
          onChange={(e) => setExperienceAt(r.key, { designation: e.target.value })}
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
            onChange={(e) => setExperienceAt(r.key, { duration: e.target.value })}
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
          onChange={(e) => setExperienceAt(r.key, { last_salary_drawn: e.target.value })}
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
          onChange={(e) => setExperienceAt(r.key, { reason_for_leaving: e.target.value })}
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
          onChange={(e) => setInternalRefAt(r.key, { referee_id: e.target.value })}
          aria-label="Internal referee"
        >
          <option value=""></option>
          {staff
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
        onChange={(e) => setExternalRefAt(r.key, { designation: e.target.value })}
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

  const nominationColumns: ChildGridColumn<NominationRow>[] = [
    {
      // Legacy's single unlabelled column, headed "For".
      header: "For",
      cell: (r) => (
        <Input
          uppercase
          value={r.nomination_for}
          onChange={(e) => setNominationAt(r.key, { nomination_for: e.target.value })}
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
  const validity = sectionValidity({
    sections: STAFF_SECTIONS.map((s) => ({ key: s.key })),
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
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
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
  const sections: FullScreenSection[] = STAFF_SECTIONS.map((s) => {
    const base = { key: s.key, label: s.label, icon: s.icon };
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

                Every field is `md` (4 of 12) so the row holds exactly three and
                closes — at `sm` a fourth would flow up from the next line and
                the grouping would break. That is what was wrong before: mixed
                widths gave 3, then 4, then a lone Division.
              */}
              <FieldGrid>
                {/* Row 1 — who this person is */}
                <Field label="ID No" size="md" htmlFor="st-code" skipTab>
                  {/*
                    Blank until the row exists: `staff.code` is assigned by a
                    trigger on insert, so a new record genuinely has no ID yet
                    and an "(auto)" placeholder would describe the box rather
                    than the record.
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
                <Field label="Guardian" size="md" htmlFor="st-guardian-name">
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label="Guardian relation"
                      className="w-24 shrink-0"
                      value={form.guardian_relation ?? ""}
                      onChange={(e) =>
                        set({
                          guardian_relation:
                            (e.target.value as StaffInput["guardian_relation"]) || null,
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
                      onChange={(e) => set({ guardian_name: e.target.value || null })}
                    />
                  </div>
                </Field>

                {/* Row 2 — parentage and role */}
                <Field label="Mother Name" size="md" htmlFor="st-mother">
                  <Input
                    id="st-mother"
                    uppercase
                    value={form.mother_name ?? ""}
                    onChange={(e) => set({ mother_name: e.target.value || null })}
                  />
                </Field>

                {/*
                  Free text today. There is a real Designation master at
                  /masters/hr/designation, so this should become a picker over
                  it — but that turns a text column into a foreign key and has
                  to migrate the values already stored, which is a separate
                  decision with a data-repair step (0534 says the same).
                */}
                <Field label="Designation" size="md" htmlFor="st-designation">
                  <Input
                    id="st-designation"
                    uppercase
                    value={form.designation ?? ""}
                    onChange={(e) => set({ designation: e.target.value || null })}
                  />
                </Field>

                <Field label="Category" size="md" htmlFor="st-category">
                  <MasterSelect
                    id="st-category"
                    options={categories}
                    value={form.category_id}
                    onChange={(v) => set({ category_id: v })}
                  />
                </Field>

                {/* Row 3 — where they are posted */}
                <Field label="Department" size="md" htmlFor="st-department">
                  <MasterSelect
                    id="st-department"
                    options={departments}
                    value={form.department_id}
                    onChange={(v) => set({ department_id: v })}
                  />
                </Field>

                <Field label="Location" size="md" htmlFor="st-location">
                  <Select
                    id="st-location"
                    value={form.location_id ?? ""}
                    onChange={(e) => set({ location_id: e.target.value || null })}
                  >
                    <option value=""></option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Division" size="md" htmlFor="st-division">
                  <MasterSelect
                    id="st-division"
                    options={divisions}
                    value={form.division_id}
                    onChange={(v) => set({ division_id: v })}
                  />
                </Field>
              </FieldGrid>

              {/* ── employment ─────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Employment</GroupHeading>
                <FieldGrid>
                  <Field label="Type" size="sm" htmlFor="st-type">
                    <Select
                      id="st-type"
                      value={form.staff_type}
                      onChange={(e) =>
                        set({ staff_type: e.target.value as StaffInput["staff_type"] })
                      }
                    >
                      {STAFF_TYPES.map((t) => (
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

                  <Field label="Salary Paid" size="sm" htmlFor="st-salary-paid">
                    <Select
                      id="st-salary-paid"
                      value={form.salary_paid}
                      onChange={(e) =>
                        set({ salary_paid: e.target.value as StaffInput["salary_paid"] })
                      }
                    >
                      {SALARY_PAID.map((t) => (
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
                        set({ week_off: (e.target.value as StaffInput["week_off"]) || null })
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
                      onChange={(e) => set({ manager_id: e.target.value || null })}
                    >
                      <option value=""></option>
                      {staff
                        .filter((m) => m.id !== editId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </Select>
                  </Field>

                  <Field label="Vehicle No" size="sm" htmlFor="st-vehicle">
                    <Input
                      id="st-vehicle"
                      uppercase
                      value={form.vehicle_no ?? ""}
                      onChange={(e) => set({ vehicle_no: e.target.value || null })}
                    />
                  </Field>
                </FieldGrid>
              </div>


              {/* ── dates ──────────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Dates</GroupHeading>
                <FieldGrid>
                  <DateField id="st-dob" label="Date of Birth" value={form.date_of_birth} onChange={(v) => set({ date_of_birth: v })} />

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
                    size="sm"
                    htmlFor="st-age"
                    skipTab={!!form.date_of_birth}
                    hint={form.date_of_birth ? "From date of birth" : undefined}
                  >
                    {form.date_of_birth ? (
                      <Input id="st-age" readOnly value={ageFrom(form.date_of_birth) ?? "—"} />
                    ) : (
                      <Input
                        id="st-age"
                        type="number"
                        min={0}
                        max={120}
                        value={form.stated_age ?? ""}
                        onChange={(e) =>
                          set({ stated_age: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    )}
                  </Field>

                  <Field label="Place of Birth" size="sm" htmlFor="st-pob">
                    <Input
                      id="st-pob"
                      uppercase
                      value={form.place_of_birth ?? ""}
                      onChange={(e) => set({ place_of_birth: e.target.value || null })}
                    />
                  </Field>
                  {/* DOJ is `joined_date` — 0534 deliberately did NOT add a
                      second column meaning the same thing. */}
                  <DateField id="st-joined" label="Date of Joining" value={form.joined_date ?? null} onChange={(v) => set({ joined_date: v })} />
                  <DateField id="st-dop" label="Date of Probation" value={form.date_of_probation} onChange={(v) => set({ date_of_probation: v })} />
                  <DateField id="st-doc" label="Date of Confirmation" value={form.date_of_confirmation} onChange={(v) => set({ date_of_confirmation: v })} />
                  <DateField id="st-dol" label="Date of Leaving" value={form.date_of_leaving} onChange={(v) => set({ date_of_leaving: v })} />
                </FieldGrid>
              </div>

              {/* ── statutory status ───────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Statutory</GroupHeading>
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
                      <Toggle checked={form.migrant_worker} onChange={(v) => set({ migrant_worker: v })} label="Yes" />
                    </div>
                  </Field>

                  <Field label="International Worker" size="sm">
                    <div className="flex h-8 items-center">
                      <Toggle checked={form.international_worker} onChange={(v) => set({ international_worker: v })} label="Yes" />
                    </div>
                  </Field>

                  {/*
                    Legacy offers L / H / V / No as four radios. Blank IS "No" —
                    the absence of a category — so it is the empty option rather
                    than a fifth stored value (0534 models it the same way).
                  */}
                  <Field label="Physically Challenged" size="sm" htmlFor="st-disability">
                    <Select
                      id="st-disability"
                      value={form.disability_type ?? ""}
                      onChange={(e) =>
                        set({
                          disability_type:
                            (e.target.value as StaffInput["disability_type"]) || null,
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
                    id="st-disability-pct"
                    label="Disability %"
                    max={100}
                    disabled={!form.disability_type}
                    value={form.disability_pct}
                    onChange={(v) => set({ disability_pct: v })}
                  />
                </FieldGrid>
              </div>


              {/* ── status ─────────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Status</GroupHeading>
                <FieldGrid>
                  {/* Reads INACTIVE like every other master in HR; the column
                      is `is_active`, so the switch inverts it. */}
                  <Field label="Status" size="sm">
                    <div className="flex h-8 items-center">
                      <Toggle checked={!form.is_active} onChange={(v) => set({ is_active: !v })} label="Inactive" />
                    </div>
                  </Field>

                  {/*
                    A BAR ON A CURRENT EMPLOYEE, which is not the same question
                    as Status. 0534 keeps them separate so that un-blocking
                    someone is not indistinguishable from re-hiring them.
                  */}
                  <Field label="Blocked" size="sm">
                    <div className="flex h-8 items-center">
                      <Toggle checked={form.blocked} onChange={(v) => set({ blocked: v })} label="Blocked" />
                    </div>
                  </Field>
                </FieldGrid>
              </div>
            </div>
          ),
        };

      case "salary-registry":
        return {
          ...base,
          done:
            form.stat_gross > 0 ||
            form.act_gross > 0 ||
            form.monthly_salary > 0 ||
            form.expected_salary > 0 ||
            // ESI and PF live here now, so their answers light this dot.
            form.esi_status !== "No" ||
            form.pf_status !== "No",
          content: (
            <div className="space-y-6">
              {/*
                THE PAY HEADS MOVED HERE FROM DETAIL (client 2026-09-09: "this
                slary pay things hsould goes in the slaary registry tab"). They
                are the same fields on the same columns — only the section they
                live in changed, so nothing about the payload moves with them.

                The two headings STAY. Both panels hold the same four names, so
                "Pay — Statutory" and "Pay — Actual" are the only thing saying
                which set a figure belongs to — the same reason PF/ESI Control's
                captions became part of its labels instead of being deleted.
              */}
              {/* ── pay ────────────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Pay — Statutory</GroupHeading>
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
                  <MoneyField id="st-stat-gross" label="Gross Salary" value={form.stat_gross} onChange={(v) => set({ stat_gross: v })} />
                  <MoneyField id="st-stat-basic" label="Basic" value={form.stat_basic} onChange={(v) => set({ stat_basic: v })} />
                  <MoneyField id="st-stat-da" label="DA" value={form.stat_da} onChange={(v) => set({ stat_da: v })} />
                  <MoneyField id="st-stat-hra" label="HRA" value={form.stat_hra} onChange={(v) => set({ stat_hra: v })} />
                </FieldGrid>
              </div>

              <div className="space-y-2">
                <GroupHeading>Pay — Actual</GroupHeading>
                <FieldGrid>
                  <MoneyField id="st-act-gross" label="Gross Salary" value={form.act_gross} onChange={(v) => set({ act_gross: v })} />
                  <MoneyField id="st-act-basic" label="Basic" value={form.act_basic} onChange={(v) => set({ act_basic: v })} />
                  <MoneyField id="st-act-da" label="DA" value={form.act_da} onChange={(v) => set({ act_da: v })} />
                  <MoneyField id="st-act-hra" label="HRA" value={form.act_hra} onChange={(v) => set({ act_hra: v })} />
                  <MoneyField id="st-monthly" label="Monthly Salary" value={form.monthly_salary} onChange={(v) => set({ monthly_salary: v })} />
                  <MoneyField id="st-expected" label="Exp. Salary" value={form.expected_salary} onChange={(v) => set({ expected_salary: v })} />
                </FieldGrid>
              </div>

              {/*
                THE BALANCES MOVED HERE FROM THE BANK TAB (client 2026-09-09).
                A loan balance and a leave balance are payroll figures — they
                belong on the tab about pay, not on the one saying which account
                the pay goes to.

                They are OPENING figures typed by a human, not a ledger (0534).
                When advances and leave get their own transactions these become
                the derived answer, and this heading is where that will show.
              */}
              <div className="space-y-2">
                <GroupHeading>Balances</GroupHeading>
                <FieldGrid>
                  <MoneyField id="st-loan" label="Loan Bal." value={form.loan_balance} onChange={(v) => set({ loan_balance: v })} />
                  <MoneyField id="st-advance" label="Advance Bal." value={form.advance_balance} onChange={(v) => set({ advance_balance: v })} />
                  <MoneyField id="st-cl" label="CL Bal." value={form.cl_balance} onChange={(v) => set({ cl_balance: v })} />
                  <MoneyField id="st-el-cr" label="EL Cr. Days" value={form.el_credit_days} onChange={(v) => set({ el_credit_days: v })} />
                  <MoneyField id="st-el-carry" label="EL Carry Days" value={form.el_carry_days} onChange={(v) => set({ el_carry_days: v })} />
                </FieldGrid>
              </div>

              {/*
                ESI AND PF SIT WITH PAY, not with the nominations.

                Legacy draws them on its Nomination tab and this screen followed
                that at first — but they are payroll DEDUCTIONS, and the client
                put them where the money is (2026-09-09: "this esi and pf
                details can comes under salary registry right"). Nomination is
                left holding the one thing it is actually about: who the
                nominees are.

                They are also not on Detail, where this screen originally drew
                them as two plain booleans.

                EXEMPTED IS NOT "NO". An exempted employee is outside the scheme
                by entitlement; a "No" is simply not enrolled. Both deduct
                nothing — a database trigger sets `esi_applicable` /
                `pf_applicable` from these, and payroll keeps reading those — and
                the distinction survives here for the statutory return (0536).
              */}
              <div className="space-y-2">
                <GroupHeading>ESI Details</GroupHeading>
                <FieldGrid>
                  <Field label="ESI" size="sm" htmlFor="st-esi-status">
                    <Select
                      id="st-esi-status"
                      value={form.esi_status}
                      onChange={(e) =>
                        set({ esi_status: e.target.value as StaffInput["esi_status"] })
                      }
                    >
                      {STATUTORY_STATUSES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <TextField id="st-esi-no" label="ESI No." value={form.esi_no} onChange={(v) => set({ esi_no: v })} />
                  <DateField id="st-esi-doj" label="Date of Joining" value={form.esi_date_of_joining} onChange={(v) => set({ esi_date_of_joining: v })} />
                  <DateField id="st-esi-dol" label="Date of Leaving" value={form.esi_date_of_leaving} onChange={(v) => set({ esi_date_of_leaving: v })} />
                  <TextField id="st-esi-disp" label="Dispensary" value={form.esi_dispensary} onChange={(v) => set({ esi_dispensary: v })} />
                </FieldGrid>
              </div>

              <div className="space-y-2">
                <GroupHeading>PF Details</GroupHeading>
                <FieldGrid>
                  <Field label="PF" size="sm" htmlFor="st-pf-status">
                    <Select
                      id="st-pf-status"
                      value={form.pf_status}
                      onChange={(e) =>
                        set({ pf_status: e.target.value as StaffInput["pf_status"] })
                      }
                    >
                      {STATUTORY_STATUSES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <TextField id="st-pf-no" label="PF No." value={form.pf_no} onChange={(v) => set({ pf_no: v })} />
                  <DateField id="st-pf-doj" label="Date of Joining" value={form.pf_date_of_joining} onChange={(v) => set({ pf_date_of_joining: v })} />
                  <DateField id="st-pf-dol" label="Date of Leaving" value={form.pf_date_of_leaving} onChange={(v) => set({ pf_date_of_leaving: v })} />
                </FieldGrid>
              </div>
            </div>
          ),
        };

      case "bank":
        return {
          ...base,
          done: !!account.ac_no || !!account.bank_id || form.pay_mode === "Bank",
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
                    onChange={(e) => set({ pay_mode: e.target.value as StaffInput["pay_mode"] })}
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
                    <Field label="Bank" size="sm" htmlFor="st-bank">
                      <MasterSelect
                        id="st-bank"
                        options={banks}
                        value={account.bank_id || null}
                        onChange={(v) => setAccount({ bank_id: v ?? "" })}
                      />
                    </Field>

                    <Field label="Branch" size="sm" htmlFor="st-bank-branch">
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
                    <Field label="Bank Type" size="sm" htmlFor="st-bank-type">
                      <Input
                        id="st-bank-type"
                        uppercase
                        value={account.bank_type}
                        onChange={(e) => setAccount({ bank_type: e.target.value })}
                      />
                    </Field>

                    <Field label="A/c Type" size="sm" htmlFor="st-ac-type">
                      <Input
                        id="st-ac-type"
                        uppercase
                        value={account.ac_type}
                        onChange={(e) => setAccount({ ac_type: e.target.value })}
                      />
                    </Field>

                    <Field label="A/c No" size="sm" htmlFor="st-ac-no">
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
                        onChange={(e) => setAccount({ ifsc_code: e.target.value })}
                      />
                    </Field>
                  </FieldGrid>
                )}
              </div>
            </div>
          ),
        };

      case "general":
        return {
          ...base,
          done: !!form.perm_address1 || !!form.email || !!form.aadhaar_no,
          content: (
            <div className="space-y-6">
              {/* ── permanent address ──────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Permanent Address</GroupHeading>
                <FieldGrid>
                  {/*
                    THREE UNLABELLED LINES, and the blank labels are deliberate.
                    `label=""` keeps the label ROW while drawing no text, so the
                    three boxes line up with City and Pin beside them — passing
                    no label at all would pull them 18px up and leave the row
                    ragged (see `Field`'s own note on the two spellings).

                    Legacy stacks them; here they take a row of their own at
                    `md` (4 of 12), which is the widest a free address line gets
                    without stretching past the fields underneath.
                  */}
                  <Field label="Address" size="md" htmlFor="st-perm-1">
                    <Input
                      id="st-perm-1"
                      uppercase
                      value={form.perm_address1 ?? ""}
                      onChange={(e) => set({ perm_address1: e.target.value || null })}
                    />
                  </Field>
                  <Field label="" size="md" htmlFor="st-perm-2">
                    <Input
                      id="st-perm-2"
                      uppercase
                      value={form.perm_address2 ?? ""}
                      onChange={(e) => set({ perm_address2: e.target.value || null })}
                    />
                  </Field>
                  <Field label="" size="md" htmlFor="st-perm-3">
                    <Input
                      id="st-perm-3"
                      uppercase
                      value={form.perm_address3 ?? ""}
                      onChange={(e) => set({ perm_address3: e.target.value || null })}
                    />
                  </Field>

                  <Field label="City" size="sm" htmlFor="st-perm-city">
                    <Input
                      id="st-perm-city"
                      uppercase
                      value={form.perm_city ?? ""}
                      onChange={(e) => set({ perm_city: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Pin" size="sm" htmlFor="st-perm-pin">
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
                      onChange={(e) => set({ perm_phone: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Mobile" size="sm" htmlFor="st-perm-mob">
                    <Input
                      id="st-perm-mob"
                      value={form.perm_mobile ?? ""}
                      onChange={(e) => set({ perm_mobile: e.target.value || null })}
                    />
                  </Field>
                </FieldGrid>
              </div>

              {/* ── correspondence address ─────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Correspondence Address</GroupHeading>
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
                                  corr_mobile: form.perm_mobile,
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
                  <Field label="Address" size="md" htmlFor="st-corr-1">
                    <Input
                      id="st-corr-1"
                      uppercase
                      readOnly={form.corr_same_as_permanent}
                      value={form.corr_address1 ?? ""}
                      onChange={(e) => set({ corr_address1: e.target.value || null })}
                    />
                  </Field>
                  <Field label="" size="md" htmlFor="st-corr-2">
                    <Input
                      id="st-corr-2"
                      uppercase
                      readOnly={form.corr_same_as_permanent}
                      value={form.corr_address2 ?? ""}
                      onChange={(e) => set({ corr_address2: e.target.value || null })}
                    />
                  </Field>
                  <Field label="" size="md" htmlFor="st-corr-3">
                    <Input
                      id="st-corr-3"
                      uppercase
                      readOnly={form.corr_same_as_permanent}
                      value={form.corr_address3 ?? ""}
                      onChange={(e) => set({ corr_address3: e.target.value || null })}
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
                  <Field label="Pin" size="sm" htmlFor="st-corr-pin">
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
                      onChange={(e) => set({ corr_phone: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Mobile" size="sm" htmlFor="st-corr-mob">
                    <Input
                      id="st-corr-mob"
                      readOnly={form.corr_same_as_permanent}
                      value={form.corr_mobile ?? ""}
                      onChange={(e) => set({ corr_mobile: e.target.value || null })}
                    />
                  </Field>
                </FieldGrid>
              </div>

              {/* ── personal ───────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Personal</GroupHeading>
                <FieldGrid>
                  {/*
                    `type="email"` — which also opts the field OUT of CAPITALS
                    by construction (`Input` exempts by type), because a mailbox
                    name and a URL path can both be case-sensitive. Same
                    carve-out AGENTS.md ▸ CAPITALS makes.
                  */}
                  <Field label="E-Mail" size="sm" htmlFor="st-email">
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
                      onChange={(e) => set({ qualification: e.target.value || null })}
                    />
                  </Field>

                  {/*
                    A LIST, NOT A TEXT BOX. "O+", "O positive" and "o +ve" are
                    one fact typed three ways, and a statutory form needs one of
                    them — 0535 constrains the column to the same eight.
                  */}
                  <Field label="Blood Group" size="sm" htmlFor="st-blood">
                    <Select
                      id="st-blood"
                      value={form.blood_group ?? ""}
                      onChange={(e) =>
                        set({ blood_group: (e.target.value as StaffInput["blood_group"]) || null })
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

                  <Field label="Sex" size="sm" htmlFor="st-sex">
                    <Select
                      id="st-sex"
                      value={form.sex ?? ""}
                      onChange={(e) => set({ sex: (e.target.value as StaffInput["sex"]) || null })}
                    >
                      <option value=""></option>
                      {SEXES.map((x) => (
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
                          marital_status: (e.target.value as StaffInput["marital_status"]) || null,
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
                      onChange={(e) => set({ nationality: e.target.value || null })}
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

                  <Field label="Identification Mark 1" size="sm" htmlFor="st-mark-1">
                    <Input
                      id="st-mark-1"
                      uppercase
                      value={form.identification_mark_1 ?? ""}
                      onChange={(e) => set({ identification_mark_1: e.target.value || null })}
                    />
                  </Field>

                  <Field label="Identification Mark 2" size="sm" htmlFor="st-mark-2">
                    <Input
                      id="st-mark-2"
                      uppercase
                      value={form.identification_mark_2 ?? ""}
                      onChange={(e) => set({ identification_mark_2: e.target.value || null })}
                    />
                  </Field>
                </FieldGrid>
              </div>

              {/* ── identifiers ────────────────────────────────────── */}
              <div className="space-y-2">
                <GroupHeading>Identifiers</GroupHeading>
                <FieldGrid>
                  <Field label="Driving Lic. No" size="sm" htmlFor="st-dl">
                    <Input
                      id="st-dl"
                      uppercase
                      value={form.driving_licence_no ?? ""}
                      onChange={(e) => set({ driving_licence_no: e.target.value || null })}
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
                      onChange={(e) => set({ aadhaar_no: e.target.value || null })}
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
                      onChange={(e) => set({ police_station: e.target.value || null })}
                    />
                  </Field>

                  {/*
                    Legacy labels this tick "Flag" and says nothing more about
                    it, so it is stored and shown as exactly that rather than
                    renamed to a guess about what it means (0535).
                  */}
                  <Field label="Flag" size="sm">
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
            </div>
          ),
        };

      case "family":
        return {
          ...base,
          done: family.length > 0,
          content: childrenLoading ? (
            <LoadingRows />
          ) : (
            <ChildGrid<FamilyRow>
              columns={familyColumns}
              rows={family}
              onAdd={() => setFamily((xs) => [...xs, blankFamily(newKey())])}
              onRemove={(r) => setFamily((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add family member"
              seedRow
            />
          ),
        };

      case "experience":
        return {
          ...base,
          done: experience.length > 0,
          content: childrenLoading ? (
            <LoadingRows />
          ) : (
            <ChildGrid<ExperienceRow>
              columns={experienceColumns}
              rows={experience}
              onAdd={() => setExperience((xs) => [...xs, blankExperience(newKey())])}
              onRemove={(r) => setExperience((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add experience"
              seedRow
            />
          ),
        };

      case "reference":
        return {
          ...base,
          done:
            externalRefs.length > 0 ||
            emergencyContacts.length > 0 ||
            internalRefs.length > 0,
          content: (
            <div className="space-y-6">
              {/*
                THREE GRIDS. The referees and emergency contacts were two fixed
                blocks of fields each — eight headings down one tab — until the
                client asked for lists (2026-09-09). Two was what the legacy
                screen could hold, not what the business has, and four fixed
                blocks beside Family Details and Work Experience read as an
                arbitrary exception rather than a rule.
              */}
              <div className="space-y-2">
                <GroupHeading>External References</GroupHeading>
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                  <ChildGrid<ExternalRefRow>
                    columns={externalRefColumns}
                    rows={externalRefs}
                    onAdd={() => setExternalRefs((xs) => [...xs, blankExternalRef(newKey())])}
                    onRemove={(r) => setExternalRefs((xs) => xs.filter((x) => x.key !== r.key))}
                    addLabel="+ Add external reference"
                    seedRow
                  />
                )}
              </div>

              <div className="space-y-2">
                <GroupHeading>Emergency Contacts</GroupHeading>
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                  <ChildGrid<EmergencyRow>
                    columns={emergencyColumns}
                    rows={emergencyContacts}
                    onAdd={() => setEmergencyContacts((xs) => [...xs, blankEmergency(newKey())])}
                    onRemove={(r) => setEmergencyContacts((xs) => xs.filter((x) => x.key !== r.key))}
                    addLabel="+ Add emergency contact"
                    seedRow
                  />
                )}
              </div>

              <div className="space-y-2">
                <GroupHeading>Internal Reference</GroupHeading>
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                  <ChildGrid<InternalRefRow>
                    columns={internalRefColumns}
                    rows={internalRefs}
                    onAdd={() => setInternalRefs((xs) => [...xs, blankInternalRef(newKey())])}
                    onRemove={(r) => setInternalRefs((xs) => xs.filter((x) => x.key !== r.key))}
                    addLabel="+ Add internal reference"
                    seedRow
                  />
                )}
              </div>
            </div>
          ),
        };

      case "nomination":
        return {
          ...base,
          // The ESI/PF terms moved to Salary Registry, so this dot no longer
          // reads them — a section's "has data" light must answer for what is
          // actually in it.
          done: nominations.length > 0,
          content: (
            <div className="space-y-6">
              <div className="space-y-2">
                <GroupHeading>Nominations</GroupHeading>
                {childrenLoading ? (
                  <LoadingRows />
                ) : (
                <ChildGrid<NominationRow>
                  columns={nominationColumns}
                  rows={nominations}
                  onAdd={() => setNominations((xs) => [...xs, blankNomination(newKey())])}
                  onRemove={(r) => setNominations((xs) => xs.filter((x) => x.key !== r.key))}
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

  const columns: Column<StaffRow>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Designation", cell: (r) => r.designation ?? "—" },
    { header: "Location", cell: (r) => r.location_name ?? "—" },
    {
      header: "Monthly Salary",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtMoney(r.monthly_salary)}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    rowActionsColumn((r) => <RowActions label={r.name} onEdit={() => openEdit(r)} />),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DataIoToolbar
          entityKey="staff"
          rows={staff}
          canImport={canCreate}
          canExport={canExport}
        />
        <div className="ml-auto">
          {canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Staff
            </Button>
          )}
        </div>
      </div>

      {canDelete && (
        <BulkDeleteBar
          entityKey="staff"
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          label="staff"
        />
      )}

      <DataTable
        columns={withCreatedColumns(columns, staff)}
        rows={staff}
        getKey={(r) => r.id}
        empty="No staff yet."
        selectable={canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(staff.map((s) => s.id))}
      />

      {/*
        AN OVERLAY, NOT A PANEL ABOVE THE TABLE. Staff is reference data edited
        as a mode of its list route, which is the case the layout contract gives
        `mount="overlay"` — and the overlay covers the app chrome, so the record
        gets the width its rail plus fields need instead of sharing it with the
        module sidebar. The panel this replaces expanded in place and pushed the
        list down the page.
      */}
      <MasterFullScreen
        ref={shellRef}
        open={showForm}
        onClose={cancel}
        modeLabel={editId ? <>Editing staff</> : <>New staff</>}
        header={{
          initials: "ST",
          title: editId ? form.name || "Staff" : "New Staff",
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New staff",
          onCancel: cancel,
          onSave: submit,
          // Names the ENTITY — a bare "Save" could belong to any record.
          saveLabel: "Save staff",
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
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
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

/** A money cell — same shape everywhere, so twenty of them cannot drift. */
function MoneyField({
  id,
  label,
  value,
  onChange,
  max,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  /** Upper bound, for a percentage. Omit for money. */
  max?: number;
  disabled?: boolean;
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
    <Field label={label} size="sm" htmlFor={id}>
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
  size?: "sm" | "md";
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
