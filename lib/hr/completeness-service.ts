import "server-only";

import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { PersonCompleteness } from "@/lib/hr/completeness-types";
import type { StatutoryStatus } from "@/lib/hr/types";

export type { PersonCompleteness } from "@/lib/hr/completeness-types";

/**
 * WHO STILL OWES A SALARY REGISTRY OR A BANK ACCOUNT.
 *
 * Both of these are sections INSIDE a person's record, which means the only way
 * to find out who has not filled one in was to open all of them one at a time.
 * The client asked for the two to reach the HR sidebar in their own right
 * (2026-09-11: "salary registry and bank details comes as fields in here also,
 * so that they can see how many is pending to fill in the details") — the point
 * being the COUNT, not a second place to edit from.
 *
 * ## ONE QUERY SHAPE FOR BOTH SCREENS
 *
 * Salary and bank completeness are the same question asked of the same people,
 * so one row type answers both and each screen reads the half it shows. Two
 * services would have meant two definitions of "who counts", and the first
 * divergence would be invisible: both screens would still render a plausible
 * number.
 */
/**
 * NO POSTGREST EMBED HERE, ON PURPOSE.
 *
 * `workers` carries TWO foreign keys to `departments` since 0553
 * (`department_id` and `prod_dept_id`), so `departments(name)` on this table is
 * a 300 rather than a join — AGENTS.md ▸ "A SECOND FK BREAKS EVERY EXISTING
 * EMBED". The department name is resolved by the page from its own
 * `listDepartments()` call instead, which cannot go ambiguous however many
 * more department columns either table grows.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. Every `error` below is thrown
 * rather than swallowed into `?? []` — on a screen whose whole output is a
 * COUNT, a swallowed failure reads as "nobody is pending", which is a real and
 * unremarkable answer and so gets believed.
 */
export async function listPeopleCompleteness(): Promise<PersonCompleteness[]> {
  const supabase = await createClient();

  const [staffRes, workerRes, bankRes] = await Promise.all([
    supabase
      .from("staff")
      .select(
        "id, code, name, department_id, is_active, stat_gross, act_gross, esi_status, pf_status, pay_mode, created_at, created_by, stat_gross, stat_basic, stat_da, stat_hra, act_gross, act_basic, act_da, act_hra, esi_status, esi_no, esi_date_of_joining, esi_date_of_leaving, esi_dispensary, pf_status, pf_no, pf_date_of_joining, pf_date_of_leaving",
      )
      .order("code"),
    supabase
      .from("workers")
      .select(
        "id, code, name, department_id, is_active, stat_gross, act_gross, esi_status, pf_status, pay_mode, created_at, created_by, stat_gross, stat_basic, stat_da, stat_hra, act_gross, act_basic, act_da, act_hra, esi_status, esi_no, esi_date_of_joining, esi_date_of_leaving, esi_dispensary, pf_status, pf_no, pf_date_of_joining, pf_date_of_leaving",
      )
      .order("code"),
    supabase
      .from("hr_bank_accounts")
      .select("staff_id, worker_id, bank_id, branch, ac_no, ifsc_code, bank_type, ac_type"),
  ]);

  if (staffRes.error) throw new Error(staffRes.error.message);
  if (workerRes.error) throw new Error(workerRes.error.message);
  if (bankRes.error) throw new Error(bankRes.error.message);

  /**
   * The FIRST account carrying a number wins. The editor was cut back to one
   * account per person on the client's instruction ("why we need to add more
   * account only one account needed"), but the table still permits several —
   * so this picks rather than assuming, and a stray extra row cannot make the
   * screen show a blank bank for somebody who has one.
   */
  type Acc = {
    bank_id: string | null;
    branch: string | null;
    ac_no: string | null;
    ifsc_code: string | null;
    bank_type: string | null;
    ac_type: string | null;
  };
  const byStaff = new Map<string, Acc[]>();
  const byWorker = new Map<string, Acc[]>();
  for (const b of bankRes.data ?? []) {
    const acc = {
      bank_id: b.bank_id,
      branch: b.branch,
      ac_no: b.ac_no,
      ifsc_code: b.ifsc_code,
      bank_type: b.bank_type,
      ac_type: b.ac_type,
    };
    const into = b.staff_id ? byStaff : byWorker;
    const key = (b.staff_id ?? b.worker_id) as string | null;
    if (!key) continue;
    into.set(key, [...(into.get(key) ?? []), acc]);
  }

  const shape = (
    row: Record<string, unknown>,
    kind: "staff" | "worker",
    accounts: Acc[],
  ): PersonCompleteness => {
    const filled = accounts.find((a) => a.ac_no?.trim()) ?? accounts[0];
    return {
      id: row.id as string,
      kind,
      code: (row.code as string | null) ?? null,
      name: (row.name as string) ?? "",
      departmentId: (row.department_id as string | null) ?? null,
      isActive: row.is_active !== false,
      statGross: Number(row.stat_gross ?? 0),
      actGross: Number(row.act_gross ?? 0),
      esiStatus: (row.esi_status as string | null) ?? null,
      pfStatus: (row.pf_status as string | null) ?? null,
      payMode: (row.pay_mode as string | null) ?? null,
      bankAccounts: accounts.length,
      bankId: filled?.bank_id ?? null,
      branch: filled?.branch ?? null,
      acNo: filled?.ac_no ?? null,
      ifsc: filled?.ifsc_code ?? null,
      created_at: (row.created_at as string | null) ?? null,
      created_by: (row.created_by as string | null) ?? null,
      salary: {
        stat_gross: Number(row.stat_gross ?? 0),
        stat_basic: Number(row.stat_basic ?? 0),
        stat_da: Number(row.stat_da ?? 0),
        stat_hra: Number(row.stat_hra ?? 0),
        act_gross: Number(row.act_gross ?? 0),
        act_basic: Number(row.act_basic ?? 0),
        act_da: Number(row.act_da ?? 0),
        act_hra: Number(row.act_hra ?? 0),
        esi_status: (row.esi_status as StatutoryStatus) ?? "No",
        esi_no: (row.esi_no as string | null) ?? null,
        esi_date_of_joining: (row.esi_date_of_joining as string | null) ?? null,
        esi_date_of_leaving: (row.esi_date_of_leaving as string | null) ?? null,
        esi_dispensary: (row.esi_dispensary as string | null) ?? null,
        pf_status: (row.pf_status as StatutoryStatus) ?? "No",
        pf_no: (row.pf_no as string | null) ?? null,
        pf_date_of_joining: (row.pf_date_of_joining as string | null) ?? null,
        pf_date_of_leaving: (row.pf_date_of_leaving as string | null) ?? null,
      },
      account: {
        bank_type: filled?.bank_type ?? null,
        bank_id: filled?.bank_id ?? null,
        ac_type: filled?.ac_type ?? null,
        ac_no: filled?.ac_no ?? null,
        ifsc_code: filled?.ifsc_code ?? null,
        branch: filled?.branch ?? null,
      },
    };
  };

  // `withCreators` turns `created_by` into a name via `creator_names()` — a
  // PostgREST embed on `profiles` would resolve to null for every row made by
  // someone else (`profiles_read_own`).
  return withCreators([
    ...(staffRes.data ?? []).map((r) =>
      shape(r, "staff", byStaff.get(r.id as string) ?? []),
    ),
    ...(workerRes.data ?? []).map((r) =>
      shape(r, "worker", byWorker.get(r.id as string) ?? []),
    ),
  ]);
}
