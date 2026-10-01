import { UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth/server";
import { getMyStaffRecord } from "@/lib/hr/my-profile";
import { getLocations } from "@/lib/hr/masters-service";
import { listDepartments } from "@/lib/masters/department-service";
import { listDivisions } from "@/lib/masters/division-service";
import { listEmployeeCategories } from "@/lib/masters/employee-category-service";
import { listBanks } from "@/lib/masters/bank-service";
import { listDesignations } from "@/lib/masters/designation-service";
import { PageHeader } from "@/components/ui/page-header";
import { MyProfileClient } from "./my-profile-client";

/**
 * MY PROFILE (user 2026-10-01) — the signed-in person's own HR ▸ Staff record,
 * read-only, in the same layout the Staff details page uses.
 *
 * `requireUser`, NOT `requirePermission`: every login reaches this page, and
 * that is the point — a staff member must not need HR ▸ Staff (which opens
 * every colleague's record) to see their own. The record is resolved on the
 * server from the session (`lib/hr/my-profile.ts`); nothing in the URL names it.
 *
 * The option lists only turn ids into names. They are read with the caller's
 * own access; a master they cannot read shows its id's place as "—" rather
 * than failing the page.
 */
export default async function MyProfilePage() {
  const user = await requireUser();
  const mine = await getMyStaffRecord();

  if (!mine) {
    return (
      <div className="space-y-4">
        <PageHeader title="My Profile" description="Your own details from the HR staff master." />
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-5">
          <UserRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">No staff record is linked to this login yet.</p>
            <p className="text-muted-foreground">
              Your login ({user.email ?? "no email"}) does not match an employee in HR &amp; Payroll ▸ People ▸
              Staff. Ask HR to put this email on your staff record and your profile will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [locations, departments, divisions, categories, banks, designations] = await Promise.all([
    safe(getLocations()),
    safe(listDepartments()),
    safe(listDivisions()),
    safe(listEmployeeCategories()),
    safe(listBanks()),
    safe(listDesignations()),
  ]);
  const named = <T extends { id: string }>(rows: T[], label: (r: T) => string | null | undefined) =>
    rows.map((r) => ({ id: r.id, name: label(r) ?? "—" }));

  return (
    <MyProfileClient
      row={mine.row}
      locations={named(locations as { id: string; name?: string | null }[], (l) => l.name)}
      departments={named(departments, (d) => d.name ?? d.short_name)}
      divisions={named(divisions, (d) => d.division_name)}
      categories={named(categories, (c) => c.name)}
      banks={named(banks, (b) => b.name)}
      designations={named(designations, (d) => d.name)}
    />
  );
}
