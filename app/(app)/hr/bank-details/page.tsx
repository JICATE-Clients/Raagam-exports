import { requirePermission } from "@/lib/auth/server";
import { listPeopleCompleteness } from "@/lib/hr/completeness-service";
import { listDepartments } from "@/lib/masters/department-service";
import { listBanks } from "@/lib/masters/bank-service";
import CompletenessClient from "../_completeness/completeness-client";

/**
 * Bank Details — the COUNT of who still owes one, not a second editor.
 *
 * Requested straight into the HR sidebar (client 2026-09-11: "salary registry
 * and bank details comes as fields in here also, so that they can see how many
 * is pending to fill in the details"). The fields themselves stay on the
 * person's record, which is where every rule about them lives.
 *
 * The department and bank NAMES are resolved here rather than embedded in the
 * query — `workers` has two FKs to `departments` since 0553, so a PostgREST
 * embed on it is ambiguous. `completeness-service.ts` carries the reasoning.
 */
export default async function BankDetailsPage() {
  await requirePermission("hr_payroll", "view");

  const [rows, departments, banks] = await Promise.all([
    listPeopleCompleteness(),
    listDepartments(),
    listBanks(),
  ]);

  const named = <T extends { id: string }>(
    list: T[],
    label: (r: T) => string | null,
  ) => list.map((r) => ({ id: r.id, name: label(r) ?? "—" }));

  return (
    <CompletenessClient
      kind="bank"
      rows={rows}
      departments={named(departments, (d) => d.name ?? d.short_name)}
      banks={named(banks, (b) => b.name)}
    />
  );
}
