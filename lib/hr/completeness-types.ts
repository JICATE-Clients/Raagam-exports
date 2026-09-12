/**
 * THE PURE HALF OF `completeness-service.ts` — the row shape and the two
 * "done" rules, with no server import.
 *
 * Split out because the list client needs both, and the service is
 * `server-only`: a client component importing it — even for a type and two
 * pure functions — fails the webpack build while `tsc` stays clean, which is
 * exactly how this was found. Keeping the predicates HERE rather than copying
 * them into the client is the point: the screen's "pending" and any server
 * reader's "pending" must be one definition.
 */

import type { StatutoryStatus } from "@/lib/hr/types";

export type PersonCompleteness = {
  id: string;
  kind: "staff" | "worker";
  code: string | null;
  name: string;
  departmentId: string | null;
  isActive: boolean;
  /** Salary Registry */
  statGross: number;
  actGross: number;
  esiStatus: string | null;
  pfStatus: string | null;
  /** Bank Account */
  payMode: string | null;
  bankAccounts: number;
  /** The bank MASTER id — the page resolves the name, for the reason below. */
  bankId: string | null;
  branch: string | null;
  acNo: string | null;
  ifsc: string | null;
  /**
   * AGENTS.md ▸ "Created Date / Created User": every listing shows who made the
   * row and when. Snake_case on purpose — `withCreators` and
   * `withCreatedColumns` read exactly these keys, and a camelCase copy would
   * give the right column with a dash in every row.
   */
  created_at: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  /**
   * THE EDITABLE VALUES, carried on the row so the sheet opens filled without a
   * second round trip (client 2026-09-12: "if i want to chaange the details i
   * will be able to edit").
   *
   * Snake_case and grouped exactly as the two server actions take them, so the
   * sheet hands back what it was given rather than re-mapping field by field —
   * a re-map is where a column quietly stops being saved.
   */
  salary: SalaryValues;
  account: AccountValues;
};

/** The pay heads and the ESI / PF block — `saveSalaryRegistry`'s input. */
export type SalaryValues = {
  stat_gross: number;
  stat_basic: number;
  stat_da: number;
  stat_hra: number;
  act_gross: number;
  act_basic: number;
  act_da: number;
  act_hra: number;
  esi_status: StatutoryStatus;
  esi_no: string | null;
  esi_date_of_joining: string | null;
  esi_date_of_leaving: string | null;
  esi_dispensary: string | null;
  pf_status: StatutoryStatus;
  pf_no: string | null;
  pf_date_of_joining: string | null;
  pf_date_of_leaving: string | null;
};

/** One `hr_bank_accounts` row — `saveBankDetails`'s account half. */
export type AccountValues = {
  bank_type: string | null;
  bank_id: string | null;
  ac_type: string | null;
  ac_no: string | null;
  ifsc_code: string | null;
  branch: string | null;
};

/** A salary registry is "done" once an actual gross has been entered. */
export function salaryDone(r: PersonCompleteness): boolean {
  return r.actGross > 0 || r.statGross > 0;
}

/**
 * A bank account is "done" once there is a row carrying an account number.
 *
 * Counting ROWS alone would have been wrong: `ChildGrid` opens with one blank
 * row by standing rule, and the save side drops it, so "has a row" and "has an
 * account" are different facts. The account number is the field the row exists
 * for.
 */
export function bankDone(r: PersonCompleteness): boolean {
  return !!r.acNo?.trim();
}
