import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getLocations } from "@/lib/hr/masters-service";
import { listDepartments } from "@/lib/masters/department-service";
import { listDivisions } from "@/lib/masters/division-service";
import { listEmployeeCategories } from "@/lib/masters/employee-category-service";
import { listHostelCategories } from "@/lib/masters/hostel-category-service";
import { listBanks } from "@/lib/masters/bank-service";
import { listDesignations } from "@/lib/masters/designation-service";
import { isInactive } from "@/lib/masters/inactive";
import { getOwnStaffRow } from "@/lib/hr/own-profile";
import type { StaffRow } from "@/lib/hr/masters-service";
import PersonClient from "../../_person/person-client";

// The browser tab. Only a regular staff member is ever served this page (an
// Admin or HR is redirected to the list), so it is always their own profile.
export const metadata = { title: "My Profile" };

/**
 * MY PROFILE — a regular staff member's own record (user 2026-10-01). The HR
 * sidebar points "My Profile" here for anyone who holds HR access but no HR
 * role (`AppUser.myStaffId`, lib/auth/self-service.ts). It opens read-only;
 * Edit offers only the personal sections and saves through `updateMyProfile`.
 *
 * Only ever the caller's OWN record: any other id is sent back to theirs, and
 * an Admin or HR — who keep the list, and open a record from it — is sent to
 * the list. So this route can never become a way to read or edit someone
 * else's row by changing the URL.
 */
export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("hr_payroll", "view");
  const { id } = await params;
  const mine = user.myStaffId;
  if (!mine) redirect("/hr/staff");
  if (id !== mine) redirect(`/hr/staff/${mine}`);

  const [own, locations, departments, divisions, categories, hostelCategories, banks, designations] =
    await Promise.all([
      getOwnStaffRow(),
      getLocations(),
      listDepartments(),
      listDivisions(),
      listEmployeeCategories(),
      listHostelCategories(),
      listBanks(),
      listDesignations(),
    ]);
  // `myStaffId` was resolved from this very row moments ago; a miss means it
  // was deleted in between, and the list (which will now not redirect) says so.
  if (!own) redirect("/hr/staff");

  // Same option shape as the Staff screen — `inactive` travels, the control
  // decides (AGENTS.md ▸ "Disabled rows").
  const opt = <T extends { id: string }>(rows: T[], label: (r: T) => string | null) =>
    rows.map((r) => ({ id: r.id, name: label(r) ?? "—", inactive: isInactive(r as never) }));

  // The unit is offered from the row's own join too: such a login usually holds
  // no unit, so the locations list may not carry it, and Location would go blank.
  const ownLoc = own.locations as { name: string | null } | null;
  const locs = [...locations];
  if (typeof own.location_id === "string" && ownLoc?.name && !locs.some((l) => l.id === own.location_id)) {
    locs.push({ id: own.location_id, code: "", name: ownLoc.name } as (typeof locs)[number]);
  }

  // No wrapper: `PersonClient` page-mounts its editor and needs the `h-full`
  // chain to `<main>` (see the Staff list page).
  return (
    <PersonClient
      kind="staff"
      rows={[]}
      selfRow={own as unknown as StaffRow}
      locations={locs}
      departments={opt(departments, (d) => d.name ?? d.short_name)}
      divisions={opt(divisions, (d) => d.division_name)}
      categories={opt(categories, (c) => c.name)}
      hostelCategories={opt(hostelCategories, (h) => h.name)}
      banks={opt(banks, (b) => b.name)}
      designations={opt(designations, (d) => d.name)}
    />
  );
}
