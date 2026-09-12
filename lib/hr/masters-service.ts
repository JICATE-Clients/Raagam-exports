import { withCreators } from "@/lib/created-by";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PARENT_COLUMN, type PersonKind } from "./types";
import type {
  Contractor,
  Worker,
  Staff,
  PayrollSettings,
  StaffFamilyMember,
  StaffWorkExperience,
  StaffInternalReference,
  StaffNomination,
  StaffBankAccountRow,
  StaffExternalReference,
  StaffEmergencyContact,
  HrShiftAssignment,
} from "./types";

// ---------- shaped rows ----------

export interface WorkerRow extends Worker {
  contractor_name: string | null;
  location_name: string | null;
  /** Resolved from `designation_id`, as on `StaffRow` (0553). */
  designation_name: string | null;
}

export interface ContractorRow extends Contractor {
  location_name: string | null;
}

export interface StaffRow extends Staff {
  location_name: string | null;
  /** Resolved from `designation_id` — the row itself holds only the id (0548). */
  designation_name: string | null;
}

export interface LocationOption {
  id: string;
  code: string | null;
  name: string;
}

export interface OrderOption {
  id: string;
  order_number: string;
}

// ---------- workers ----------

export async function listWorkers(): Promise<WorkerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workers")
    .select(
      // `*` for the reason `listStaff` gives: 0553 put 74 more columns on this
      // table, and a hand-written list that OMITS a column is silently a
      // smaller row with no error anywhere.
      "*, contractors(name), locations(name), designations(name)",
    )
    .order("name");
  if (error) throw new Error(error.message);
  /**
   * `withCreators` RESOLVES THE NAME; THE COLUMN ALONE SHOWS A DASH.
   * AGENTS.md ▸ "Created Date / Created User": the screen already splices the
   * two columns in (`withCreatedColumns`), and `creatorName()` refuses to print
   * anything uuid-shaped — so without this call the column is present, wired,
   * and empty in every row. Not an error, not a missing column, just blank.
   * `select("*")` already brings `created_by`, so this is the only half missing.
   */
  return withCreators(
    ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const con = r.contractors as { name: string } | null;
      const loc = r.locations as { name: string } | null;
      const desig = r.designations as { name: string } | null;
      return {
        ...(r as unknown as Worker),
        contractor_name: con?.name ?? null,
        location_name: loc?.name ?? null,
        designation_name: desig?.name ?? null,
      };
    }),
  );
}

export async function getWorker(id: string): Promise<Worker | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Worker | null) ?? null;
}

// ---------- contractors ----------

export async function listContractors(): Promise<ContractorRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contractors")
    .select(
      `id, code, name, contact_person, phone, location_id, is_active,
       created_at, updated_at,
       locations(name)`,
    )
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const loc = r.locations as { name: string } | null;
    return {
      ...(r as unknown as Contractor),
      location_name: loc?.name ?? null,
    };
  });
}

// ---------- staff ----------

/**
 * A staff member's four child lists, for the editor.
 *
 * FETCHED ONLY WHEN A RECORD IS OPENED, not joined onto `listStaff`. The list
 * screen shows none of this, and embedding four one-to-many relations would
 * make every page load carry every family member of every employee.
 */
export async function getPersonChildren(
  kind: PersonKind,
  id: string,
): Promise<{
  family: StaffFamilyMember[];
  experience: StaffWorkExperience[];
  internalRefs: StaffInternalReference[];
  nominations: StaffNomination[];
  bankAccounts: StaffBankAccountRow[];
  externalRefs: StaffExternalReference[];
  emergencyContacts: StaffEmergencyContact[];
  shifts: HrShiftAssignment[];
  education: Record<string, unknown>[];
  technical: Record<string, unknown>[];
  languages: Record<string, unknown>[];
}> {
  const supabase = await createClient();
  // ONE COLUMN NAME, DECIDED ONCE. The seven `hr_*` tables take either a
  // `staff_id` or a `worker_id` (0553) — spelling that choice at each of the
  // seven queries is seven chances to use the wrong one.
  const parent = PARENT_COLUMN[kind];
  const pick = (table: string) =>
    supabase.from(table).select("*").eq(parent, id).order("sno");
  const [
    family,
    experience,
    internalRefs,
    nominations,
    bankAccounts,
    externalRefs,
    emergencyContacts,
    shifts,
    education,
    technical,
    languages,
  ] = await Promise.all([
      pick("hr_family_members"),
      pick("hr_work_experience"),
      pick("hr_internal_references"),
      pick("hr_nominations"),
      pick("hr_bank_accounts"),
      pick("hr_external_references"),
      pick("hr_emergency_contacts"),
      pick("hr_shift_assignments"),
      pick("hr_education"),
      pick("hr_technical_details"),
      pick("hr_languages"),
    ]);
  const firstError =
    family.error ??
    experience.error ??
    internalRefs.error ??
    nominations.error ??
    bankAccounts.error ??
    externalRefs.error ??
    emergencyContacts.error ??
    shifts.error ??
    education.error ??
    technical.error ??
    languages.error;
  if (firstError) throw new Error(firstError.message);
  return {
    family: (family.data ?? []) as StaffFamilyMember[],
    experience: (experience.data ?? []) as StaffWorkExperience[],
    internalRefs: (internalRefs.data ?? []) as StaffInternalReference[],
    nominations: (nominations.data ?? []) as StaffNomination[],
    bankAccounts: (bankAccounts.data ?? []) as StaffBankAccountRow[],
    externalRefs: (externalRefs.data ?? []) as StaffExternalReference[],
    emergencyContacts: (emergencyContacts.data ?? []) as StaffEmergencyContact[],
    shifts: (shifts.data ?? []) as HrShiftAssignment[],
    education: education.data ?? [],
    technical: technical.data ?? [],
    languages: languages.data ?? [],
  };
}

export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    // `*` RATHER THAN A COLUMN LIST, and that is a deliberate reversal. The
    // list here named twelve columns; 0534 added forty-one more, and every one
    // of them would have arrived `undefined` on the editor with no error
    // anywhere — a hand-written select that names a column is checked by
    // Postgres, but one that OMITS a column is silently a smaller row.
    //
    // A named list earns its place where the row is wide and the screen needs
    // little of it. This screen is the opposite: the Detail tab reads nearly
    // every column, so the list would have to name them all, and then the next
    // migration has to remember to come here too.
    .select("*, locations(name), designations(name)")
    .order("name");
  if (error) throw new Error(error.message);
  /**
   * `withCreators` RESOLVES THE NAME; THE COLUMN ALONE SHOWS A DASH.
   * AGENTS.md ▸ "Created Date / Created User": the screen already splices the
   * two columns in (`withCreatedColumns`), and `creatorName()` refuses to print
   * anything uuid-shaped — so without this call the column is present, wired,
   * and empty in every row. Not an error, not a missing column, just blank.
   * `select("*")` already brings `created_by`, so this is the only half missing.
   */
  return withCreators(
    ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const loc = r.locations as { name: string } | null;
      const desig = r.designations as { name: string } | null;
      return {
        ...(r as unknown as Staff),
        location_name: loc?.name ?? null,
        designation_name: desig?.name ?? null,
      };
    }),
  );
}

// ---------- settings ----------

export async function getSettings(): Promise<PayrollSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_settings")
    .select("*")
    .maybeSingle();
  return (data as PayrollSettings | null) ?? null;
}

// ---------- pickers ----------

export async function getLocations(): Promise<LocationOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationOption[];
}

export async function getOrdersForPicker(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .order("order_number", { ascending: false });
  return (data ?? []) as OrderOption[];
}
