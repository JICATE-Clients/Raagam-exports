"use server";

import { can } from "@/lib/auth/server";
import { getPersonChildren as read } from "@/lib/hr/masters-service";
import { getOwnStaffRow, isOwnProfileOnly } from "@/lib/hr/own-profile";
import { createAdminClient } from "@/lib/supabase/server";
import type { PersonKind } from "@/lib/hr/types";
import type {
  StaffFamilyMember,
  StaffWorkExperience,
  StaffInternalReference,
  StaffNomination,
  StaffBankAccountRow,
  StaffExternalReference,
  StaffEmergencyContact,
  HrShiftAssignment,
} from "@/lib/hr/types";

/**
 * A SERVER ACTION AROUND `getPersonChildren`, because the editor is a CLIENT
 * component and the service is `server-only`.
 *
 * The four lists are not on the list query — `listStaff` returns every staff
 * member, and joining four one-to-many relations onto it would make the list
 * page load every family member of every employee to render a table that shows
 * none of them. They are fetched when a record is opened instead, which is what
 * needs a callable entry point from the client.
 *
 * IT RE-CHECKS THE PERMISSION. RLS already gates the tables, so this is not the
 * only guard — but a server action is a public HTTP endpoint, and one that
 * answers before checking is one an unauthorised caller can time. Failing
 * closed with empty lists rather than throwing keeps the editor usable for
 * someone who may read the staff row but not its details.
 */
export async function getPersonChildren(kind: PersonKind, id: string): Promise<{
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
  const none = {
    family: [],
    experience: [],
    internalRefs: [],
    nominations: [],
    bankAccounts: [],
    externalRefs: [],
    emergencyContacts: [],
    shifts: [],
    education: [],
    technical: [],
    languages: [],
  };
  if (!(await can("hr_payroll", "view"))) return none;
  /* MY PROFILE (lib/auth/self-service.ts): only the caller's own staff record, read with the
     service role — `staff_read` wants a unit such a login usually lacks. Any
     other id answers with the same empty lists as a refused permission. */
  if (await isOwnProfileOnly()) {
    const own = kind === "staff" ? await getOwnStaffRow() : null;
    if (!own || own.id !== id) return none;
    return read(kind, id, createAdminClient());
  }
  return read(kind, id);
}
