"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  PARENT_COLUMN,
  personInput,
  staffBankAccountInput,
  type PersonKind,
} from "@/lib/hr/types";

/**
 * EDITING A SALARY REGISTRY / BANK ACCOUNT FROM THE LIST.
 *
 * The two list screens began read-only, on the argument that the person's own
 * record is the one place these fields are written. The client overruled it
 * (2026-09-12: "from here itself i wanna fill up the details"), and the
 * argument's substance is kept a different way: these actions do not re-state
 * a single rule. The schemas are PICKED from `personInput` and
 * `staffBankAccountInput`, so the capitals transform, the IFSC regex, the money
 * coercion and the enum vocabularies are the same objects the record editor
 * validates against. A second copy is what would have drifted, not a second
 * screen.
 *
 * WHAT STAYS THE RECORD'S ALONE: creating a person, their identity, and every
 * field outside these two panes. This writes the pay heads, the ESI/PF block,
 * the pay mode and one bank account — nothing else.
 */
type Result = { ok: true } | { ok: false; error: string };

/** Both screens list staff and workers together, so both tables are writable. */
const TABLE: Record<PersonKind, "staff" | "workers"> = {
  staff: "staff",
  worker: "workers",
};

const salaryPatch = personInput.pick({
  stat_gross: true,
  stat_basic: true,
  stat_da: true,
  stat_hra: true,
  act_gross: true,
  act_basic: true,
  act_da: true,
  act_hra: true,
  esi_status: true,
  esi_no: true,
  esi_date_of_joining: true,
  esi_date_of_leaving: true,
  esi_dispensary: true,
  pf_status: true,
  pf_no: true,
  pf_date_of_joining: true,
  pf_date_of_leaving: true,
});
export type SalaryPatch = typeof salaryPatch._input;

const bankPatch = personInput.pick({ pay_mode: true });
export type BankPatch = typeof bankPatch._input;
export type BankAccountPatch = typeof staffBankAccountInput._input;

/**
 * `esi_applicable` / `pf_applicable` are NOT sent, and must not be: a trigger
 * derives them from the statuses (0536, extended to workers by 0553). Sending
 * one here would be a second writer of a derived column, which is how the two
 * come to disagree.
 */
export async function saveSalaryRegistry(
  kind: PersonKind,
  id: string,
  data: SalaryPatch,
): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = salaryPatch.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from(TABLE[kind])
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/salary-registry");
  return { ok: true };
}

/**
 * ONE ACCOUNT PER PERSON, written as delete-then-insert.
 *
 * The client cut the editor to a single account ("why we need to add more
 * account only one account needed"), so "replace whatever is there" is the
 * whole operation and there is no row id for the screen to carry. An account
 * with nothing in it is not saved at all rather than stored blank — the same
 * blank-row rule the child grids obey.
 *
 * `pay_mode` lives on the PERSON and the rest on `hr_bank_accounts`, so this
 * writes two tables. Not a transaction: PostgREST has no cross-table one, and
 * the failure it would guard against — the account saving while the pay mode
 * does not — leaves the operator on the same screen with both values still in
 * front of them, which the error toast names.
 */
export async function saveBankDetails(
  kind: PersonKind,
  id: string,
  person: BankPatch,
  account: BankAccountPatch,
): Promise<Result> {
  if (!(await can("hr_payroll", "edit"))) return { ok: false, error: "Forbidden" };
  const p = bankPatch.safeParse(person);
  if (!p.success) {
    return { ok: false, error: p.error.issues[0]?.message ?? "Validation failed" };
  }
  const a = staffBankAccountInput.safeParse(account);
  if (!a.success) {
    return { ok: false, error: a.error.issues[0]?.message ?? "Validation failed" };
  }

  const supabase = await createClient();
  const { error: personErr } = await supabase
    .from(TABLE[kind])
    .update(p.data)
    .eq("id", id);
  if (personErr) return { ok: false, error: personErr.message };

  const parent = PARENT_COLUMN[kind];
  const { error: delErr } = await supabase
    .from("hr_bank_accounts")
    .delete()
    .eq(parent, id);
  if (delErr) return { ok: false, error: delErr.message };

  const filled = Object.values(a.data).some(
    (v) => v !== null && v !== undefined && v !== "",
  );
  if (filled) {
    const { error: insErr } = await supabase
      .from("hr_bank_accounts")
      .insert({ ...a.data, [parent]: id, sno: 1 });
    if (insErr) return { ok: false, error: insErr.message };
  }
  revalidatePath("/hr/bank-details");
  return { ok: true };
}
