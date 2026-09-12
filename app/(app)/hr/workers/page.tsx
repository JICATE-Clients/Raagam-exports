import { requirePermission, can } from "@/lib/auth/server";
import {
  listWorkers,
  listContractors,
  getLocations,
} from "@/lib/hr/masters-service";
import { listDepartments } from "@/lib/masters/department-service";
import { listDivisions } from "@/lib/masters/division-service";
import { listEmployeeCategories } from "@/lib/masters/employee-category-service";
import { listHostelCategories } from "@/lib/masters/hostel-category-service";
import { listBanks } from "@/lib/masters/bank-service";
import { listDesignations } from "@/lib/masters/designation-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { isInactive } from "@/lib/masters/inactive";
import PersonClient from "../_person/person-client";

export default async function WorkersPage() {
  await requirePermission("hr_payroll", "view");

  const [
    workers,
    contractors,
    locations,
    departments,
    divisions,
    categories,
    hostelCategories,
    banks,
    designations,
    lookups,
    canCreate,
    canExport,
    canDelete,
  ] = await Promise.all([
    listWorkers(),
    listContractors(),
    getLocations(),
    listDepartments(),
    listDivisions(),
    listEmployeeCategories(),
    listHostelCategories(),
    listBanks(),
    listDesignations(),
    listConfigLookups(),
    can("hr_payroll", "create"),
    can("hr_payroll", "export"),
    can("hr_payroll", "delete"),
  ]);

  /**
   * THE OPTION LISTS CARRY `inactive`, THEY ARE NOT FILTERED HERE — the same
   * rule `staff/page.tsx` states, for the same reason. AGENTS.md ▸ "Disabled
   * rows": a switched-off master row must not be offered, but the one a record
   * already holds has to survive or a filled field shows as empty and the next
   * save blanks the FK. The flag travels; the control decides.
   */
  const opt = <T extends { id: string }>(
    rows: T[],
    label: (r: T) => string | null,
  ) =>
    rows.map((r) => ({
      id: r.id,
      name: label(r) ?? "—",
      inactive: isInactive(r as never),
    }));

  /**
   * NO WRAPPER AND NO `PageHeader` HERE. `PersonClient` page-mounts its editor
   * (`mount="page"`), which needs `h-full` to resolve against
   * `<main className="flex-1 overflow-y-auto">` in app/(app)/layout.tsx — a
   * `space-y-4` div between the two breaks that chain and strands the footer.
   * The list branch draws the header itself; the edit branch replaces it with
   * an identity band. Same shape as `/orders/garment-orders`.
   */
  return (
    <PersonClient
      kind="worker"
      rows={workers}
      locations={locations}
      departments={opt(departments, (d) => d.name ?? d.short_name)}
      divisions={opt(divisions, (d) => d.division_name)}
      categories={opt(categories, (c) => c.name)}
      hostelCategories={opt(hostelCategories, (h) => h.name)}
      banks={opt(banks, (b) => b.name)}
      designations={opt(designations, (d) => d.name)}
      shiftCategories={opt(
        // `config_lookups` is one table of many kinds; the shift rows are the
        // ones `work_timing_lines` also points at, so an assignment names the
        // same shift a Work Timing does.
        lookups.filter((l) => l.kind === "shift_category"),
        (l) => l.name,
      )}
      contractors={opt(contractors, (c) => c.name)}
      canCreate={canCreate}
      canExport={canExport}
      canDelete={canDelete}
    />
  );
}
