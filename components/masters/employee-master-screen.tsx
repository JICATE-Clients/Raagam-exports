"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, IdCard, Landmark, MapPin, TriangleAlert, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, type FieldSize } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { LocationPicker } from "@/components/masters/location-picker";
import { EmployeePicker } from "@/components/masters/employee-picker";
import { createEmployee, updateEmployee, deleteEmployee } from "@/lib/masters/employee-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { AADHAAR_RE } from "@/lib/validation/formats";
import { isAadhaarChecksumValid } from "@/lib/validation/aadhaar";
import {
  GUARDIAN_RELATIONS,
  SPOUSE_TYPES,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  MARITAL_STATUSES,
  SEXES,
  PAY_MODES,
  type Employee,
  type EmployeeInput,
  type EmployeeLocation,
  type EmployeeRef,
} from "@/lib/masters/employee-types";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { fmtDate } from "@/lib/format";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = {
  code: string;
  name: string;
  guardian_relation: string;
  guardian_name: string;
  category_id: string;
  department_id: string;
  location_id: string;
  designation_id: string;
  team_id: string;
  manager_id: string;
  dob: string;
  inactive: boolean;
  // Permanent Address
  perm_addr1: string;
  perm_addr2: string;
  perm_addr3: string;
  perm_pin: string;
  perm_phone: string;
  perm_mobile: string;
  // Correspondence Address
  corr_same_as_perm: boolean;
  corr_addr1: string;
  corr_addr2: string;
  corr_addr3: string;
  corr_pin: string;
  corr_phone: string;
  corr_mobile: string;
  photo_url: string | null;
  // personal
  email: string;
  qualification: string;
  blood_group: string;
  marital_status: string;
  sex: string;
  nationality: string;
  religion: string;
  // 0277 — employment & statutory
  doj: string;
  emp_type: string;
  mobile: string;
  father_name: string;
  mother_name: string;
  spouse_name: string;
  pf_no: string;
  esi_no: string;
  uan: string;
  pan_no: string;
  aadhar_no: string;
  pay_mode: string;
  bank_name: string;
  bank_acc_no: string;
  // 0279 — enrichment
  spouse_type: string;
  date_of_confirmation: string;
  date_of_filing: string;
  employee_type: string;
};
const BLANK: Form = {
  code: "",
  name: "",
  guardian_relation: "S/O",
  guardian_name: "",
  category_id: "",
  department_id: "",
  location_id: "",
  designation_id: "",
  team_id: "",
  manager_id: "",
  dob: "",
  inactive: false,
  photo_url: null,
  perm_addr1: "",
  perm_addr2: "",
  perm_addr3: "",
  perm_pin: "",
  perm_phone: "",
  perm_mobile: "",
  corr_same_as_perm: false,
  corr_addr1: "",
  corr_addr2: "",
  corr_addr3: "",
  corr_pin: "",
  corr_phone: "",
  corr_mobile: "",
  email: "",
  qualification: "",
  blood_group: "",
  marital_status: "Single",
  sex: "Male",
  nationality: "",
  religion: "",
  doj: "",
  emp_type: "",
  mobile: "",
  father_name: "",
  mother_name: "",
  spouse_name: "",
  pf_no: "",
  esi_no: "",
  uan: "",
  pan_no: "",
  aadhar_no: "",
  pay_mode: "Bank",
  bank_name: "",
  bank_acc_no: "",
  spouse_type: "",
  date_of_confirmation: "",
  date_of_filing: "",
  employee_type: "S",
};

/** Whole-year age from a YYYY-MM-DD DOB string (legacy shows an auto Age box). */
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * One address, written the way an address is written, for the read-only view.
 *
 * The six columns behind it would be six label→value rows — "Address line 2",
 * "Pin Code" — which is a database dump of the one thing on this record every
 * reader can already parse at a glance. The street lines stack, the PIN closes
 * the last of them, and the two numbers sit underneath. Returns null when the
 * block is empty, so the caller can decide whether the section is worth showing.
 */
function AddressBlock({
  title,
  lines,
  pin,
  phone,
  mobile,
}: {
  title: string;
  lines: (string | null)[];
  pin: string | null;
  phone: string | null;
  mobile: string | null;
}) {
  const street = lines.map((l) => l?.trim()).filter((l): l is string => !!l);
  const contact = [
    phone?.trim() ? `Phone ${phone.trim()}` : null,
    mobile?.trim() ? `Mobile ${mobile.trim()}` : null,
  ].filter(Boolean);
  if (street.length === 0 && !pin?.trim() && contact.length === 0) return null;
  return (
    <div className="text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <address className="mt-1 not-italic text-foreground">
        {street.map((l, i) => (
          // Index key: two lines of one address can legitimately read the same
          // ("2ND FLOOR" twice), and nothing here reorders.
          <div key={`${i}-${l}`}>{l}</div>
        ))}
        {pin?.trim() && <div>{pin.trim()}</div>}
      </address>
      {contact.length > 0 && (
        <p className="mt-1 text-muted-foreground">{contact.join(" · ")}</p>
      )}
    </div>
  );
}

/** The six controls each address block repeats, unprefixed. */
type AddrField = "addr1" | "addr2" | "addr3" | "pin" | "phone" | "addr_mobile";
/** The two blocks that repeat them. */
type AddrPrefix = "perm" | "corr";
/** A real key of `Form` — `perm_addr1`, `corr_pin`, … */
type AddrKey = `${AddrPrefix}_${"addr1" | "addr2" | "addr3" | "pin" | "phone" | "mobile"}`;

type SizedField =
  | "code"
  | "category_id"
  | "name"
  | "guardian_relation"
  | "guardian_name"
  | "manager_id"
  | "department_id"
  | "designation_id"
  | "location_id"
  | "team_id"
  | "employee_type"
  | "spouse_type"
  | "spouse_name"
  | "mobile"
  | "father_name"
  | "mother_name"
  | "dob"
  | "age"
  | "doj"
  | "date_of_confirmation"
  | "date_of_filing"
  | "esi_no"
  | "uan"
  | "pan_no"
  | "aadhar_no"
  | "pf_no"
  | "pay_mode"
  | "bank_name"
  | "bank_acc_no"
  | AddrField
  | "email"
  | "qualification"
  | "blood_group"
  | "marital_status"
  | "sex"
  | "nationality"
  | "religion";

/**
 * How wide each field is, on the 12-column track.
 *
 * Sized to the data, not to the grid. This form ran on `DetailSection cols={2}`
 * / `cols={3}` — VIEWPORT breakpoints producing equal cells — so a 3-character
 * Spouse Type (S/O · D/O · W/O) got exactly the same half-row box as a free-text
 * Mother Name (client 2026-07-24 #3). Adjust widths here, never at the call
 * sites; this map is the single source of truth for the whole screen.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12. A child with no span takes one twelfth
 * (~73px), and a row summing past 12 wraps its last field onto a line of its own
 * with the rest of that line left blank. Every row is written out:
 *
 *   header      ID 3 + Category 3 + Name 6                          = 12
 *               Relation 2 + Guardian Name 6 + Manager 4            = 12
 *               Department 3 + Designation 3 + Location 3 + Team 3  = 12
 *               Inactive 12 (edit only)                             = 12
 *   Personal    Employee Type 4 + Spouse Type 2 + Spouse Name 4 + Mobile 2 = 12
 *               Father Name 6 + Mother Name 6                       = 12
 *   Dates       DOB 3 + Age 2 + Joining 3 + Confirmation 4          = 12
 *               Filing 4
 *   Statutory   ESI 3 + UAN 3 + PAN 3 + Aadhaar 3                   = 12
 *               PF 6
 *   Bank        Pay Mode 2 + Bank Name 6 + Account No 4             = 12
 *   Address ×2  line 1 6 + line 2 6                                 = 12
 *               line 3 6 + Pin 2 + Phone 2 + Mobile 2               = 12
 *   Other       E-Mail 6 + Qualification 4 + Blood Group 2          = 12
 *               Marital Status 4 + Sex 3 + Nationality 3 + Religion 2 = 12
 *
 * Widen one entry and something else on its row has to give.
 */
const FIELD_SIZE: Record<SizedField, FieldSize> = {
  // ---- header ----
  code: "sm", // employee number — EMP0142
  category_id: "sm", // picker: STAFF / WORKER
  name: "lg", // free-text person name
  guardian_relation: "xs", // S/O · D/O · W/O · C/O — 3 characters, was a 7rem hard-coded track
  guardian_name: "lg",
  manager_id: "md", // joins the guardian row now that DOB left the header (see Dates)
  department_id: "sm", // four pickers on one row, so `sm` rather than the `md` default;
  designation_id: "sm", // the trigger truncates its placeholder and the value is one word
  location_id: "sm",
  team_id: "sm",
  // ---- Personal ----
  employee_type: "md", // Staff / Temporary — a select, and 4 is what closes this row
  spouse_type: "xs", // S/O · D/O · W/O
  spouse_name: "md", // `md`, not the `lg` its parents get below: it shares a row with
  mobile: "xs", // three others. 10 digits ≈ 80px, so `xs` is generous already.
  father_name: "lg", // a matched pair alone on their own row, so both can take the
  mother_name: "lg", // full half-width a person's name deserves
  // ---- Dates ----
  dob: "sm", // a native <input type="date"> renders ~9-10 characters — `xs` is too tight
  age: "xs", // derived from DOB, renders at most 3 digits
  doj: "sm",
  date_of_confirmation: "md", // the 0279 pair take `md` together: 4 closes the DOB row
  date_of_filing: "md", // exactly, and splitting the pair would be arbitrary
  // ---- Statutory IDs ----
  esi_no: "sm", // 10 digits
  uan: "sm", // 12 digits
  pan_no: "sm", // 10 characters
  aadhar_no: "sm", // 12 digits — the four above are one flush row, 3+3+3+3
  pf_no: "lg", // the odd one out: a slashed establishment string, TN/MAS/12345/000/0001234
  // ---- Bank ----
  pay_mode: "xs", // Bank / Cash
  bank_name: "lg",
  bank_acc_no: "md", // up to 17 digits
  // ---- Address (both blocks) ----
  addr1: "lg",
  addr2: "lg",
  addr3: "lg",
  pin: "xs", // 6 digits
  phone: "xs", // landline, 0422-2345678
  addr_mobile: "xs", // 10 digits
  // ---- Other Details ----
  email: "lg",
  qualification: "md", // B.E (MECH), M.SC (TEXTILES)
  blood_group: "xs", // O+VE
  marital_status: "md", // three radios inline — Single · Married · Divorced
  sex: "sm", // two radios inline. A radio row cannot shrink the way text can, so
  nationality: "sm", // these two hold their width and Religion gives up the twelfth.
  religion: "xs", // HINDU · MUSLIM — text, and it degrades gracefully if it runs long
};

/**
 * CRUD for the legacy "Employee" master (Associates). A flat (single-row)
 * record, edited in a `MasterFullScreen` — the left section rail customer,
 * vendor and applicant already use.
 *
 * At 43 fields this is the biggest form in Associates and the one that most
 * needed the rail: it was ONE scroll, and LAYOUT.md §5 puts anything past ~15
 * fields on a rail. Six entries, one shown at a time:
 *
 *   Identity      the old untitled header block (ID · Name · guardian ·
 *                 Category/Department/Location/Designation/Team ⓘ · Manager ⓘ ·
 *                 Inactive) + Photo
 *   Personal      family & contact + the demographic "Other Details"
 *   Dates         DOB + derived Age · joining · confirmation · filing
 *   Statutory IDs ESI · UAN · PAN · Aadhaar · PF
 *   Bank Details  pay mode · bank · account
 *   Addresses     Permanent + Correspondence
 *
 * Six rather than the eight the sections map to one-for-one: Photo is one
 * control and a face is identity, and "Other Details" is personal by any
 * reading — both would have been rail entries the eye has to rule out.
 *
 * Every ⓘ field lists stored data: Category/Department/Designation/Team via the
 * shared LookupDialogPicker (config_lookups, with Add/Modify); Location via the
 * locations master and Manager via the employees master (both select-only).
 */
export function EmployeeMasterScreen({
  rows,
  categories,
  departments,
  designations,
  teams,
  locations,
  perms,
}: {
  rows: Employee[];
  categories: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  teams: ConfigLookup[];
  locations: EmployeeLocation[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  /** The row being READ. Null = the view sheet is closed. */
  const [viewRow, setViewRow] = useState<Employee | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // The ID, NEVER the name. Two workers legitimately share a name, and a live
  // duplicate error HOLDS THE CURSOR (data-dup-error, see the keyboard contract)
  // -- checking `name` here would cage the operator on a perfectly correct value.
  // The employee ID is the identity the payroll and attendance records key on.
  //
  // spell-suggest: exempt -- follows from the same fact. The suggestion strip
  // attaches to whichever field the duplicate check guards, and that field here
  // is an ID: "did you mean EMP0142?" is not a spelling correction, it is a
  // guess at somebody else's employee. The name field, where a chip WOULD make
  // sense, is deliberately unguarded for the reason above.
  const dupError = useDuplicateName({
    table: "employees",
    name: form.code,
    nameColumn: "code",
    label: "employee ID",
    excludeId: editId ?? undefined,
    enabled: !!form.code.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.code,
  });
  const setAddr = (key: AddrKey, value: string) => set({ [key]: value } as Partial<Form>);

  /**
   * The six controls of ONE address block. Permanent and Correspondence were
   * byte-identical markup differing only in a `perm_`/`corr_` key prefix, so a
   * fix to one (these inputs were placeholder-only, with no <Label> at all)
   * had to be made twice or it silently applied to half the screen.
   *
   * It takes the prefix and nothing else: each block's title and its "Same as
   * Permanent" checkbox belong to the `DetailSection` around it, not in here.
   *
   * IT MUST NOT MIRROR VALUES. `corr_same_as_perm` only hides this block —
   * nothing copies `perm_*` into `corr_*` while typing; `submit()` substitutes
   * at save time and the corr_* state stays as the user last left it. Reading
   * `perm_*` here when the box is ticked would look like the same behaviour and
   * would quietly overwrite a correspondence address the moment it was unticked.
   */
  function addressFields(prefix: AddrPrefix) {
    return (
      <>
        <Field label="Address line 1" size={FIELD_SIZE.addr1} htmlFor={`emp-${prefix}-addr1`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr1`}
            value={form[`${prefix}_addr1`]}
            onChange={(e) => setAddr(`${prefix}_addr1`, e.target.value)}
          />
        </Field>
        <Field label="Address line 2" size={FIELD_SIZE.addr2} htmlFor={`emp-${prefix}-addr2`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr2`}
            value={form[`${prefix}_addr2`]}
            onChange={(e) => setAddr(`${prefix}_addr2`, e.target.value)}
          />
        </Field>
        <Field label="Address line 3" size={FIELD_SIZE.addr3} htmlFor={`emp-${prefix}-addr3`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr3`}
            value={form[`${prefix}_addr3`]}
            onChange={(e) => setAddr(`${prefix}_addr3`, e.target.value)}
          />
        </Field>
        <Field label="Pin Code" size={FIELD_SIZE.pin} htmlFor={`emp-${prefix}-pin`}>
          <ValidatedInput
            id={`emp-${prefix}-pin`}
            format="pincode"
            value={form[`${prefix}_pin`]}
            onChange={(e) => setAddr(`${prefix}_pin`, e.target.value)}
          />
        </Field>
        <Field label="Phone" size={FIELD_SIZE.phone} htmlFor={`emp-${prefix}-phone`}>
          <Input
            uppercase
            id={`emp-${prefix}-phone`}
            value={form[`${prefix}_phone`]}
            onChange={(e) => setAddr(`${prefix}_phone`, e.target.value)}
          />
        </Field>
        <Field label="Mobile" size={FIELD_SIZE.addr_mobile} htmlFor={`emp-${prefix}-mobile`}>
          <ValidatedInput
            id={`emp-${prefix}-mobile`}
            format="mobile"
            value={form[`${prefix}_mobile`]}
            onChange={(e) => setAddr(`${prefix}_mobile`, e.target.value)}
          />
        </Field>
      </>
    );
  }

  const managerPool: EmployeeRef[] = useMemo(
    () => rows.map((r) => ({ id: r.id, code: r.code, name: r.name, inactive: r.inactive })),
    [rows],
  );
  const deptLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) m.set(d.id, d.name);
    return m;
  }, [departments]);
  const desigLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of designations) m.set(d.id, d.name);
    return m;
  }, [designations]);
  // The four the list columns never needed, built for the read-only view from
  // the props this screen is already given — a uuid must never reach the page.
  const catLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const teamLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    return m;
  }, [teams]);
  const locLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name);
    return m;
  }, [locations]);
  /** Managers resolve out of the employee list itself — same pool the picker uses. */
  const empLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of rows) m.set(e.id, e.name);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    // Baseline for `dirty` — see the note beside the `pristine` state below.
    setPristine(JSON.stringify(BLANK));
    setOpen(true);
  }
  function openEdit(r: Employee) {
    setEditId(r.id);
    const nextForm: Form = {
      code: r.code ?? "",
      name: r.name,
      guardian_relation: r.guardian_relation ?? "S/O",
      guardian_name: r.guardian_name ?? "",
      category_id: r.category_id ?? "",
      department_id: r.department_id ?? "",
      location_id: r.location_id ?? "",
      designation_id: r.designation_id ?? "",
      team_id: r.team_id ?? "",
      manager_id: r.manager_id ?? "",
      dob: r.dob ?? "",
      inactive: r.inactive,
      photo_url: r.photo_url ?? null,
      perm_addr1: r.perm_addr1 ?? "",
      perm_addr2: r.perm_addr2 ?? "",
      perm_addr3: r.perm_addr3 ?? "",
      perm_pin: r.perm_pin ?? "",
      perm_phone: r.perm_phone ?? "",
      perm_mobile: r.perm_mobile ?? "",
      corr_same_as_perm: r.corr_same_as_perm,
      corr_addr1: r.corr_addr1 ?? "",
      corr_addr2: r.corr_addr2 ?? "",
      corr_addr3: r.corr_addr3 ?? "",
      corr_pin: r.corr_pin ?? "",
      corr_phone: r.corr_phone ?? "",
      corr_mobile: r.corr_mobile ?? "",
      email: r.email ?? "",
      qualification: r.qualification ?? "",
      blood_group: r.blood_group ?? "",
      marital_status: r.marital_status ?? "Single",
      sex: r.sex ?? "Male",
      nationality: r.nationality ?? "",
      religion: r.religion ?? "",
      doj: r.doj ?? "",
      emp_type: r.emp_type ?? "",
      mobile: r.mobile ?? "",
      father_name: r.father_name ?? "",
      mother_name: r.mother_name ?? "",
      spouse_name: r.spouse_name ?? "",
      pf_no: r.pf_no ?? "",
      esi_no: r.esi_no ?? "",
      uan: r.uan ?? "",
      pan_no: r.pan_no ?? "",
      aadhar_no: r.aadhar_no ?? "",
      pay_mode: r.pay_mode ?? "Bank",
      bank_name: r.bank_name ?? "",
      bank_acc_no: r.bank_acc_no ?? "",
      spouse_type: r.spouse_type ?? "",
      date_of_confirmation: r.date_of_confirmation ?? "",
      date_of_filing: r.date_of_filing ?? "",
      employee_type: r.employee_type ?? "S",
    };
    setForm(nextForm);
    setPristine(JSON.stringify(nextForm));
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const sameCorr = form.corr_same_as_perm;
      const payload: EmployeeInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        guardian_relation: (form.guardian_relation as EmployeeInput["guardian_relation"]) || null,
        guardian_name: form.guardian_name.trim() || null,
        category_id: form.category_id || null,
        department_id: form.department_id || null,
        location_id: form.location_id || null,
        designation_id: form.designation_id || null,
        team_id: form.team_id || null,
        manager_id: form.manager_id || null,
        dob: form.dob || null,
        inactive: form.inactive,
        photo_url: form.photo_url,
        perm_addr1: form.perm_addr1.trim() || null,
        perm_addr2: form.perm_addr2.trim() || null,
        perm_addr3: form.perm_addr3.trim() || null,
        perm_pin: form.perm_pin.trim() || null,
        perm_phone: form.perm_phone.trim() || null,
        perm_mobile: form.perm_mobile.trim() || null,
        corr_same_as_perm: sameCorr,
        corr_addr1: (sameCorr ? form.perm_addr1 : form.corr_addr1).trim() || null,
        corr_addr2: (sameCorr ? form.perm_addr2 : form.corr_addr2).trim() || null,
        corr_addr3: (sameCorr ? form.perm_addr3 : form.corr_addr3).trim() || null,
        corr_pin: (sameCorr ? form.perm_pin : form.corr_pin).trim() || null,
        corr_phone: (sameCorr ? form.perm_phone : form.corr_phone).trim() || null,
        corr_mobile: (sameCorr ? form.perm_mobile : form.corr_mobile).trim() || null,
        email: form.email.trim() || null,
        qualification: form.qualification.trim() || null,
        blood_group: form.blood_group.trim() || null,
        marital_status: (form.marital_status as EmployeeInput["marital_status"]) || null,
        sex: (form.sex as EmployeeInput["sex"]) || null,
        nationality: form.nationality.trim() || null,
        religion: form.religion.trim() || null,
        doj: form.doj || null,
        emp_type: form.emp_type.trim() || null,
        mobile: form.mobile.trim() || null,
        father_name: form.father_name.trim() || null,
        mother_name: form.mother_name.trim() || null,
        spouse_name: form.spouse_name.trim() || null,
        pf_no: form.pf_no.trim() || null,
        esi_no: form.esi_no.trim() || null,
        uan: form.uan.trim() || null,
        pan_no: form.pan_no.trim() || null,
        aadhar_no: form.aadhar_no.trim() || null,
        pay_mode: (form.pay_mode as EmployeeInput["pay_mode"]) || null,
        bank_name: form.bank_name.trim() || null,
        bank_acc_no: form.bank_acc_no.trim() || null,
        spouse_type: (form.spouse_type as EmployeeInput["spouse_type"]) || null,
        date_of_confirmation: form.date_of_confirmation || null,
        date_of_filing: form.date_of_filing || null,
        employee_type: (form.employee_type as EmployeeInput["employee_type"]) || "S",
        is_draft: asDraft,
      };
      const res = editId ? await updateEmployee(editId, payload) : await createEmployee(payload);
      if (res.ok) {
        success(editId ? "Employee updated." : "Employee added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Employee) {
    startTransition(async () => {
      const res = await deleteEmployee(r.id);
      if (res.ok) {
        success(deletedToast("Employee", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /**
   * The record as a reader wants it, for `RecordViewSheet`. The six sections
   * are the six rail entries of the editor above, in the same order and under
   * the same names, so the view and the form tell the same story about where a
   * field lives.
   *
   * Nothing is fetched: `rows` already carries all 43 columns — the list only
   * ever showed 6 of them. Empty values and all-empty sections are dropped by
   * the sheet, so a record is never a wall of "—"; that is also why `fmtDate`
   * is guarded rather than called on a null (it returns "—", which the sheet
   * would read as a value worth printing).
   */
  function viewSections(r: Employee): ViewSection[] {
    const age = ageFromDob(r.dob ?? "");
    const guardian = [r.guardian_relation, r.guardian_name].filter(Boolean).join(" ").trim();
    const spouse = [r.spouse_type, r.spouse_name].filter(Boolean).join(" ").trim();
    const empType = r.employee_type
      ? (EMPLOYEE_TYPE_LABELS[r.employee_type as keyof typeof EMPLOYEE_TYPE_LABELS] ?? r.employee_type)
      : null;

    const perm = (
      <AddressBlock
        title="Permanent"
        lines={[r.perm_addr1, r.perm_addr2, r.perm_addr3]}
        pin={r.perm_pin}
        phone={r.perm_phone}
        mobile={r.perm_mobile}
      />
    );
    // "Same as permanent" is worth saying out loud — a blank block would read
    // as "we never asked", which is the opposite of what the tick means.
    const corr = r.corr_same_as_perm ? (
      <p className="text-sm text-muted-foreground">Correspondence address is the same as permanent.</p>
    ) : (
      <AddressBlock
        title="Correspondence"
        lines={[r.corr_addr1, r.corr_addr2, r.corr_addr3]}
        pin={r.corr_pin}
        phone={r.corr_phone}
        mobile={r.corr_mobile}
      />
    );
    const hasPerm = !!(
      r.perm_addr1 ||
      r.perm_addr2 ||
      r.perm_addr3 ||
      r.perm_pin ||
      r.perm_phone ||
      r.perm_mobile
    );
    const hasCorr =
      r.corr_same_as_perm ||
      !!(r.corr_addr1 || r.corr_addr2 || r.corr_addr3 || r.corr_pin || r.corr_phone || r.corr_mobile);

    return [
      {
        label: "Identity",
        pairs: [
          ["Employee ID", r.code],
          ["Category", r.category_id ? catLabel.get(r.category_id) : null],
          ["Guardian", guardian],
          ["Manager", r.manager_id ? empLabel.get(r.manager_id) : null],
          ["Department", r.department_id ? deptLabel.get(r.department_id) : null],
          ["Designation", r.designation_id ? desigLabel.get(r.designation_id) : null],
          ["Location", r.location_id ? locLabel.get(r.location_id) : null],
          ["Team", r.team_id ? teamLabel.get(r.team_id) : null],
        ],
        // Only when there is one — passing `content` unconditionally would keep
        // this section on screen for a record with nothing in it.
        content: r.photo_url ? (
          <div className="mt-3 h-24 w-24 overflow-hidden rounded-lg border border-border bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase
                storage public URL, same as the editor's PhotoUpload preview. */}
            <img src={r.photo_url} alt={`Photo of ${r.name}`} className="h-full w-full object-cover" />
          </div>
        ) : undefined,
      },
      {
        label: "Personal",
        pairs: [
          ["Employee Type", empType],
          ["Spouse", spouse],
          ["Mobile", r.mobile],
          ["Father Name", r.father_name],
          ["Mother Name", r.mother_name],
          ["E-Mail", r.email],
          ["Qualification", r.qualification],
          ["Blood Group", r.blood_group],
          ["Marital Status", r.marital_status],
          ["Sex", r.sex],
          ["Nationality", r.nationality],
          ["Religion", r.religion],
        ],
      },
      {
        label: "Dates",
        pairs: [
          // Age beside the date it comes from, the way the editor shows it —
          // on its own row it would look like a stored field.
          ["Date of Birth", r.dob ? `${fmtDate(r.dob)}${age != null ? ` · ${age} yrs` : ""}` : null],
          ["Date of Joining", r.doj ? fmtDate(r.doj) : null],
          ["Date of Confirmation", r.date_of_confirmation ? fmtDate(r.date_of_confirmation) : null],
          ["Date of Filing", r.date_of_filing ? fmtDate(r.date_of_filing) : null],
        ],
      },
      {
        label: "Statutory IDs",
        pairs: [
          ["ESI No", r.esi_no],
          ["UAN", r.uan],
          ["PAN No", r.pan_no],
          ["Aadhar No", r.aadhar_no],
          ["PF No", r.pf_no],
        ],
      },
      {
        label: "Bank Details",
        pairs: [
          ["Pay Mode", r.pay_mode],
          ["Bank Name", r.bank_name],
          ["Account No", r.bank_acc_no],
        ],
      },
      {
        label: "Addresses",
        content:
          hasPerm || hasCorr ? (
            <div className="space-y-3">
              {hasPerm && perm}
              {hasCorr && corr}
            </div>
          ) : undefined,
      },
    ];
  }

  const columns: Column<Employee>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Designation",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.designation_id ? (desigLabel.get(r.designation_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Department",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.department_id ? (deptLabel.get(r.department_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.inactive ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active";
        return <StatusPill tone={tone}>{text}</StatusPill>;
      },
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  const age = ageFromDob(form.dob);

  // Aadhaar's 12th digit is a Verhoeff check digit over the other 11 — it catches
  // a mistyped or transposed digit that the 12-digit shape rule never will. Held
  // back until the shape itself is valid so it can't nag mid-typing, and shown as
  // an advisory rather than an error (see the field below for why).
  const aadhaarCheckFails = useMemo(() => {
    const v = form.aadhar_no.trim();
    return AADHAAR_RE.test(v) && !isAadhaarChecksumValid(v);
  }, [form.aadhar_no]);

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed employee — 43 fields,
   * the longest form in Associates — would take it silently.
   *
   * Whole-object compare against the record as loaded, the shape applicant and
   * company-profile use: `set` spreads, so key order is stable and the two
   * strings differ only when a value does. Cheaper than threading a
   * `setDirty(true)` through every one of this form's handlers, and it cannot be
   * forgotten on a new one.
   *
   * `useState`, NOT a ref: the baseline changes on an EVENT (opening the
   * editor), and a value read during render has to be state or React never
   * knows to re-render — the `● Unsaved` badge would go stale.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: with the editor CLOSED, `pristine` is still "" while the
  // blank form stringifies to a real object, so this would read dirty forever
  // and arm the reload guard on a list page with nothing to lose — permanently
  // blocking the silent PWA auto-update (found on consignee, 2026-07-29).
  const dirty = open && JSON.stringify(form) !== pristine;
  useUnsavedGuard(dirty || isPending);

  // NAME first, unlike applicant/customer where `code` is a short name. An
  // employee's code is a sequential ID (EMP0142), so taking it would print the
  // same "EM" block on every record in the master — the one thing an avatar
  // must not do. Code stays as the fallback for a record saved without a name.
  const initials = (form.name || form.code || "?").slice(0, 2).toUpperCase();

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form. Fields that
  // BLANK gives a value (employee_type, marital_status, sex, pay_mode) are left
  // out: they are true from the moment the form opens, so counting them would
  // light a dot that never means anything.
  const done = {
    identity: !!(
      form.name.trim() ||
      form.code.trim() ||
      form.category_id ||
      form.department_id ||
      form.designation_id ||
      form.location_id ||
      form.team_id ||
      form.manager_id ||
      form.guardian_name.trim() ||
      form.photo_url
    ),
    personal: !!(
      form.spouse_type ||
      form.spouse_name.trim() ||
      form.mobile.trim() ||
      form.father_name.trim() ||
      form.mother_name.trim() ||
      form.email.trim() ||
      form.qualification.trim() ||
      form.blood_group.trim() ||
      form.nationality.trim() ||
      form.religion.trim()
    ),
    dates: !!(form.dob || form.doj || form.date_of_confirmation || form.date_of_filing),
    statutory: !!(
      form.esi_no.trim() ||
      form.uan.trim() ||
      form.pan_no.trim() ||
      form.aadhar_no.trim() ||
      form.pf_no.trim()
    ),
    bank: !!(form.bank_name.trim() || form.bank_acc_no.trim()),
    addresses: !!(
      form.perm_addr1.trim() ||
      form.perm_addr2.trim() ||
      form.perm_addr3.trim() ||
      form.perm_pin.trim() ||
      form.perm_phone.trim() ||
      form.perm_mobile.trim() ||
      form.corr_same_as_perm ||
      form.corr_addr1.trim() ||
      form.corr_addr2.trim() ||
      form.corr_addr3.trim() ||
      form.corr_pin.trim() ||
      form.corr_phone.trim() ||
      form.corr_mobile.trim()
    ),
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Employee
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No employees yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No employees yet.
          </div>
        ) : (
          filtered.map((r) => (
            // Tapping a card OPENS THE VIEW, not the editor. A phone has no room
            // for a row of actions beside the name, and a nested <button> inside
            // this one is invalid markup — so the card carries the read, and Edit
            // is one tap further on in the view's footer (gated on `canEdit`
            // there). It also un-breaks the card for a read-only user, for whom
            // this handler previously did nothing at all.
            <button
              key={r.id}
              type="button"
              onClick={() => setViewRow(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.designation_id ? ` · ${desigLabel.get(r.designation_id) ?? ""}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "employee"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled employee",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </>
          ),
          // Employee ID first — it is what a payroll clerk searches by and the
          // only value on the record that is unique to the eye. Then where they
          // sit: designation, then department.
          meta: (
            <>
              <span>
                {form.code ? (
                  <span className="font-mono font-semibold text-foreground">{form.code}</span>
                ) : (
                  "No employee ID"
                )}
              </span>
              {form.designation_id && desigLabel.get(form.designation_id) && (
                <span>· {desigLabel.get(form.designation_id)}</span>
              )}
              {form.department_id && deptLabel.get(form.department_id) && (
                <span>· {deptLabel.get(form.department_id)}</span>
              )}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save employee",
          canSave: !!form.name.trim() && !dupError,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          draftLabel: "Save as Draft",
          isPending,
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
              <SectionBody title="Identity">
                {/* The untitled header block of the old single-scroll form. It
                    was a bare `FieldGrid` — the 12-col track minus the chrome —
                    because it carried the record's identity and a titled card
                    around it would have been noise above the sections. Under the
                    rail the block IS a section, so it takes a `DetailSection
                    cols={12}`: same track (both render `FIELD_TRACK`), so no
                    field moves, and it now sits beside Photo as a peer rather
                    than floating above it.
                    Photo joins it here rather than taking a seventh rail entry
                    of its own for ONE control — a face is identity. The
                    `space-y-4` is the gap the old single-scroll form put between
                    every section; without it two bordered cards meet flush. */}
                <div className="space-y-4">
                <DetailSection label="Details" cols={12}>
            <Field label="ID" size={FIELD_SIZE.code} htmlFor="emp-code">
              <Input
                uppercase
                id="emp-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                {...dupFieldProps(dupError, "emp-code")}
              />
              <DuplicateError error={dupError} id="emp-code" />
            </Field>
            {/* The label is `Field`'s, so it lines up with the inputs beside it;
                `compact` stops the picker rendering a second one of its own.
                The perms are the host screen's, exactly as Team below already
                passed them — without them the picker renders as a plain
                dropdown and Category is the one code list on this form that
                cannot be extended from the form that needs it. */}
            <Field label="Category" size={FIELD_SIZE.category_id}>
              <LookupDialogPicker
                kind="employee_category"
                label="Category"
                options={categories}
                value={form.category_id || null}
                onChange={(id) => set({ category_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                compact
              />
            </Field>
            <Field label="Name" required size={FIELD_SIZE.name} htmlFor="emp-name">
              <Input
                id="emp-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </Field>

            {/* Guardian (S/O …) — was a hard-coded `grid-cols-[7rem_1fr]`, a
                third width system fighting the track. `xs` is the same idea
                expressed in the one the rest of the screen uses. */}
            <Field label="Relation" size={FIELD_SIZE.guardian_relation} htmlFor="emp-grel">
              <Select
                id="emp-grel"
                value={form.guardian_relation}
                onChange={(e) => set({ guardian_relation: e.target.value })}
              >
                {GUARDIAN_RELATIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Guardian Name" size={FIELD_SIZE.guardian_name} htmlFor="emp-gname">
              <Input
                id="emp-gname"
                uppercase
                value={form.guardian_name}
                onChange={(e) => set({ guardian_name: e.target.value })}
              />
            </Field>
            <Field label="Manager" size={FIELD_SIZE.manager_id}>
              <EmployeePicker
                employees={managerPool}
                value={form.manager_id || null}
                onChange={(id) => set({ manager_id: id ?? "" })}
                excludeId={editId}
                compact
              />
            </Field>

            <Field label="Department" size={FIELD_SIZE.department_id}>
              <LookupDialogPicker
                kind="department"
                label="Department"
                options={departments}
                value={form.department_id || null}
                onChange={(id) => set({ department_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                compact
              />
            </Field>
            <Field label="Designation" size={FIELD_SIZE.designation_id}>
              <LookupDialogPicker
                kind="designation"
                label="Designation"
                options={designations}
                value={form.designation_id || null}
                onChange={(id) => set({ designation_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                compact
              />
            </Field>
            <Field label="Location" size={FIELD_SIZE.location_id}>
              <LocationPicker
                locations={locations}
                value={form.location_id || null}
                onChange={(id) => set({ location_id: id ?? "" })}
                compact
              />
            </Field>
            <Field label="Team" size={FIELD_SIZE.team_id}>
              <LookupDialogPicker
                kind="team"
                label="Team"
                options={teams}
                value={form.team_id || null}
                onChange={(id) => set({ team_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                compact
              />
            </Field>

            {editId && (
              // `min-h-9` so the checkbox line sits on the same 36px control
              // baseline as any input that lands beside it on the track.
              <Field size="full">
                <label className="flex min-h-9 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.inactive}
                    onChange={(e) => set({ inactive: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              </Field>
            )}
          </DetailSection>

                <DetailSection label="Photo">
                  <PhotoUpload
                    value={form.photo_url}
                    onChange={(url) => set({ photo_url: url })}
                    disabled={!perms.canEdit}
                  />
                </DetailSection>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "personal",
            label: "Personal",
            icon: Users,
            done: done.personal,
            content: (
              <SectionBody title="Personal">
                {/* Two cards, so the `space-y-4` the old single-scroll form put
                    between every section is kept here rather than letting two
                    bordered cards meet flush. "Other Details" joins Personal
                    instead of taking a rail entry of its own: blood group,
                    religion, nationality and marital status ARE personal, and a
                    rail reading "Personal · Other Details" would make anyone
                    open both to find out which held what. */}
                <div className="space-y-4">
          <DetailSection label="Personal" cols={12}>
            <Field label="Employee Type" size={FIELD_SIZE.employee_type} htmlFor="emp-employee-type">
              <Select
                id="emp-employee-type"
                value={form.employee_type}
                onChange={(e) => set({ employee_type: e.target.value })}
              >
                {EMPLOYEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYEE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Spouse Type" size={FIELD_SIZE.spouse_type} htmlFor="emp-spouse-type">
              <Select
                id="emp-spouse-type"
                value={form.spouse_type}
                onChange={(e) => set({ spouse_type: e.target.value })}
              >
                <option value=""></option>
                {SPOUSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Spouse Name" size={FIELD_SIZE.spouse_name} htmlFor="emp-spouse-name">
              <Input
                id="emp-spouse-name"
                uppercase
                value={form.spouse_name}
                onChange={(e) => set({ spouse_name: e.target.value })}
              />
            </Field>
            <Field label="Mobile" size={FIELD_SIZE.mobile} htmlFor="emp-mobile">
              <ValidatedInput
                id="emp-mobile"
                format="mobile"
                value={form.mobile}
                onChange={(e) => set({ mobile: e.target.value })}
              />
            </Field>
            <Field label="Father Name" size={FIELD_SIZE.father_name} htmlFor="emp-father">
              <Input
                id="emp-father"
                uppercase
                value={form.father_name}
                onChange={(e) => set({ father_name: e.target.value })}
              />
            </Field>
            <Field label="Mother Name" size={FIELD_SIZE.mother_name} htmlFor="emp-mother">
              <Input
                id="emp-mother"
                uppercase
                value={form.mother_name}
                onChange={(e) => set({ mother_name: e.target.value })}
              />
            </Field>
          </DetailSection>

          {/* "Other Details", not "Personal Details" — the section above already
              owns "Personal", and two near-identical titles on one form is worse
              than a plain one. Moved up from the foot of the old scroll to sit
              under the same rail entry as the section it belongs with. */}
          <DetailSection label="Other Details" cols={12}>
            <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="emp-email">
              <ValidatedInput
                id="emp-email"
                format="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
            <Field label="Qualification" size={FIELD_SIZE.qualification} htmlFor="emp-qual">
              <Input
                uppercase
                id="emp-qual"
                value={form.qualification}
                onChange={(e) => set({ qualification: e.target.value })}
              />
            </Field>
            <Field label="Blood Group" size={FIELD_SIZE.blood_group} htmlFor="emp-blood">
              <Input
                uppercase
                id="emp-blood"
                value={form.blood_group}
                onChange={(e) => set({ blood_group: e.target.value })}
              />
            </Field>

            {/* `min-h-9 items-center` on both radio rows so they centre on the
                same 36px control height as the inputs above and beside them —
                otherwise they share a label baseline but not a control one. */}
            <Field label="Marital Status" size={FIELD_SIZE.marital_status}>
              <div className="flex min-h-9 flex-wrap items-center gap-4">
                {MARITAL_STATUSES.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="emp-marital"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={form.marital_status === m}
                      onChange={() => set({ marital_status: m })}
                    />
                    <span className="text-sm text-foreground">{m}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Sex" size={FIELD_SIZE.sex}>
              <div className="flex min-h-9 flex-wrap items-center gap-4">
                {SEXES.map((sx) => (
                  <label key={sx} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="emp-sex"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={form.sex === sx}
                      onChange={() => set({ sex: sx })}
                    />
                    <span className="text-sm text-foreground">{sx}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Nationality" size={FIELD_SIZE.nationality} htmlFor="emp-nat">
              <Input
                uppercase
                id="emp-nat"
                value={form.nationality}
                onChange={(e) => set({ nationality: e.target.value })}
              />
            </Field>
            <Field label="Religion" size={FIELD_SIZE.religion} htmlFor="emp-rel">
              <Input
                uppercase
                id="emp-rel"
                value={form.religion}
                onChange={(e) => set({ religion: e.target.value })}
              />
            </Field>
          </DetailSection>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "dates",
            label: "Dates",
            icon: Calendar,
            done: done.dates,
            content: (
              <SectionBody title="Dates">
          {/* ---- Dates ----
              DOB and its derived Age moved here out of the header block: this
              section is where someone looking for a date looks, and the header
              was pairing DOB with Manager for no reason but to fill a row.
              It keeps a rail entry of its own rather than folding into Personal:
              only DOB is personal — joining, confirmation and filing are
              employment dates, and payroll looks all four up together. */}
          <DetailSection label="Dates" cols={12}>
            <Field label="DOB" size={FIELD_SIZE.dob} htmlFor="emp-dob">
              <Input
                id="emp-dob"
                type="date"
                value={form.dob}
                onChange={(e) => set({ dob: e.target.value })}
              />
            </Field>
            {/* Derived from DOB, so Tab skips it — via `skipTab`, which clones a
                real tabIndex onto the control, NOT a hand-written one here (the
                prop only applies when the child has none, so writing both would
                work by accident and defeat the point). LAYOUT.md §8. */}
            <Field label="Age" size={FIELD_SIZE.age} htmlFor="emp-age" skipTab>
              <Input id="emp-age" value={age ?? ""} readOnly />
            </Field>
            <Field label="Date of Joining" size={FIELD_SIZE.doj} htmlFor="emp-doj">
              <Input
                id="emp-doj"
                type="date"
                value={form.doj}
                onChange={(e) => set({ doj: e.target.value })}
              />
            </Field>
            <Field
              label="Date of Confirmation"
              size={FIELD_SIZE.date_of_confirmation}
              htmlFor="emp-doc"
            >
              <Input
                id="emp-doc"
                type="date"
                value={form.date_of_confirmation}
                onChange={(e) => set({ date_of_confirmation: e.target.value })}
              />
            </Field>
            <Field label="Date of Filing" size={FIELD_SIZE.date_of_filing} htmlFor="emp-dof">
              <Input
                id="emp-dof"
                type="date"
                value={form.date_of_filing}
                onChange={(e) => set({ date_of_filing: e.target.value })}
              />
            </Field>
          </DetailSection>

              </SectionBody>
            ),
          },
          {
            key: "statutory",
            label: "Statutory IDs",
            icon: IdCard,
            done: done.statutory,
            content: (
              <SectionBody title="Statutory IDs">
          {/* ---- Statutory IDs ----
              ESI(10) + UAN(12) + PAN(10) + Aadhaar(12) are four fixed-length
              document numbers, so they are four `sm` = one flush row. PF is
              listed last, out of its legacy position at the top: it is the one
              long free-form value here, and leading with it left six empty
              twelfths beside it before the row that matters. */}
          <DetailSection label="Statutory IDs" cols={12}>
            {/* "esi_ip", NOT "esi" — the two are easy to swap and only one is
                right here. `esi` is the 17-digit ESIC EMPLOYER code (the
                factory's); what an employee carries is the 10-digit Insurance
                (IP) number off their Pehchan card. */}
            <Field label="ESI No" size={FIELD_SIZE.esi_no} htmlFor="emp-esi">
              <ValidatedInput
                id="emp-esi"
                format="esi_ip"
                value={form.esi_no}
                onChange={(e) => set({ esi_no: e.target.value })}
              />
            </Field>
            <Field label="UAN" size={FIELD_SIZE.uan} htmlFor="emp-uan">
              <ValidatedInput
                id="emp-uan"
                format="uan"
                value={form.uan}
                onChange={(e) => set({ uan: e.target.value })}
              />
            </Field>
            <Field label="PAN No" size={FIELD_SIZE.pan_no} htmlFor="emp-pan">
              <ValidatedInput
                id="emp-pan"
                format="pan"
                value={form.pan_no}
                onChange={(e) => set({ pan_no: e.target.value })}
              />
            </Field>
            {/* The advisory is a fragment child of this Field, not a cell of its
                own — a sibling on the track would claim its own twelfth and push
                Aadhaar's row past 12. */}
            <Field label="Aadhar No" size={FIELD_SIZE.aadhar_no} htmlFor="emp-aadhar">
              <>
                <ValidatedInput
                  id="emp-aadhar"
                  // Shape-only on purpose. The check digit is reported by the note
                  // below as a WARNING, never a block: Aadhaar has been stored
                  // unvalidated until now, so an employee already on file may hold
                  // a number that fails it — and that must not stand between you
                  // and correcting their phone number. Switch this to
                  // "aadhaar_strict" to make it a hard block instead.
                  format="aadhaar"
                  value={form.aadhar_no}
                  onChange={(e) => set({ aadhar_no: e.target.value })}
                />
                {aadhaarCheckFails && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    Check digit doesn&apos;t match — verify this number with the employee.
                  </p>
                )}
              </>
            </Field>
            {/* Left unvalidated deliberately. A PF account number is a slashed
                establishment string (TN/MAS/12345/000/0001234) whose region and
                office segments vary in length and are re-issued as offices are
                renamed, so there is no one national shape to test — a regex here
                would only reject numbers that are correct. */}
            <Field label="PF No" size={FIELD_SIZE.pf_no} htmlFor="emp-pf">
              <Input
                uppercase
                id="emp-pf"
                value={form.pf_no}
                onChange={(e) => set({ pf_no: e.target.value })}
              />
            </Field>
          </DetailSection>

              </SectionBody>
            ),
          },
          {
            key: "bank",
            label: "Bank Details",
            icon: Landmark,
            done: done.bank,
            content: (
              <SectionBody title="Bank Details">
          {/* ---- Bank Details ---- */}
          <DetailSection label="Bank Details" cols={12}>
            <Field label="Pay Mode" size={FIELD_SIZE.pay_mode} htmlFor="emp-paymode">
              <Select
                id="emp-paymode"
                value={form.pay_mode}
                onChange={(e) => set({ pay_mode: e.target.value })}
              >
                {PAY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bank Name" size={FIELD_SIZE.bank_name} htmlFor="emp-bankname">
              <Input
                id="emp-bankname"
                uppercase
                value={form.bank_name}
                onChange={(e) => set({ bank_name: e.target.value })}
              />
            </Field>
            <Field label="Account No" size={FIELD_SIZE.bank_acc_no} htmlFor="emp-bankacc">
              <Input
                uppercase
                id="emp-bankacc"
                value={form.bank_acc_no}
                onChange={(e) => set({ bank_acc_no: e.target.value })}
              />
            </Field>
          </DetailSection>

              </SectionBody>
            ),
          },
          {
            key: "addresses",
            label: "Addresses",
            icon: MapPin,
            done: done.addresses,
            content: (
              <SectionBody title="Addresses">
                <div className="space-y-4">
          {/* ---- What used to be "General" ----
              One `cols={1}` section wrapping a hand-rolled `space-y-4` that
              re-implemented a layout system for 21 controls. LAYOUT.md §4 puts
              5-7 fields in a section, so it became three: the two addresses (6
              each) and the demographic remainder (7, now under Personal).

              The two addresses stay SEPARATE cards under one "Addresses" rail
              entry — they are peers, each already carried its own heading, and
              together they are 12 controls. The rail entry groups them; it does
              not merge them. */}
          <DetailSection label="Permanent Address" cols={12}>
            {addressFields("perm")}
          </DetailSection>

          <DetailSection
            label="Correspondence Address"
            cols={12}
            // The section header's own right-hand slot, which is where this
            // checkbox already sat visually — it belongs to the section, not to
            // the field track, and putting it on the track would cost a cell.
            action={
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={form.corr_same_as_perm}
                  onChange={(e) => set({ corr_same_as_perm: e.target.checked })}
                />
                <span className="text-xs text-foreground">Same as Permanent</span>
              </label>
            }
          >
            {form.corr_same_as_perm ? (
              <Field size="full">
                <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                  Uses the permanent address.
                </p>
              </Field>
            ) : (
              addressFields("corr")
            )}
          </DetailSection>

                </div>
              </SectionBody>
            ),
          },
        ]}
      />

      {/* Read-only view — the same record, nothing editable, and Edit in the
          footer hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow?.name ?? ""}
        subtitle={
          viewRow
            ? [
                viewRow.code,
                viewRow.designation_id ? desigLabel.get(viewRow.designation_id) : null,
                viewRow.department_id ? deptLabel.get(viewRow.department_id) : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
        status={
          viewRow && (
            <StatusPill tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}>
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}
