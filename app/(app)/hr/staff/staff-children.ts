"use server";

import { can } from "@/lib/auth/server";
import { getStaffChildren as read } from "@/lib/hr/masters-service";
import type {
  StaffFamilyMember,
  StaffWorkExperience,
  StaffInternalReference,
  StaffNomination,
  StaffBankAccountRow,
  StaffExternalReference,
  StaffEmergencyContact,
} from "@/lib/hr/types";

/**
 * A SERVER ACTION AROUND `getStaffChildren`, because the editor is a CLIENT
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
export async function getStaffChildren(staffId: string): Promise<{
  family: StaffFamilyMember[];
  experience: StaffWorkExperience[];
  internalRefs: StaffInternalReference[];
  nominations: StaffNomination[];
  bankAccounts: StaffBankAccountRow[];
  externalRefs: StaffExternalReference[];
  emergencyContacts: StaffEmergencyContact[];
}> {
  if (!(await can("hr_payroll", "view"))) {
    return {
      family: [],
      experience: [],
      internalRefs: [],
      nominations: [],
      bankAccounts: [],
      externalRefs: [],
      emergencyContacts: [],
    };
  }
  return read(staffId);
}
