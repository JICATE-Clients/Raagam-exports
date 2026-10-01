"use client";

import { PersonProfileView } from "@/app/(app)/hr/_person/person-profile-view";
import { loadMyStaffChildren } from "@/lib/hr/my-profile-actions";

type Named = { id: string; name: string };

/**
 * The Staff details view, as the person themselves sees it: no Back (there is
 * no list behind it), no Edit (view-only for now — the user's 2026-10-01
 * decision), and its lists read through `loadMyStaffChildren`, which only ever
 * returns the caller's own record.
 */
export function MyProfileClient({
  row,
  ...lists
}: {
  row: Record<string, unknown> & { id: string };
  locations: Named[];
  departments: Named[];
  divisions: Named[];
  categories: Named[];
  banks: Named[];
  designations: Named[];
}) {
  return (
    <PersonProfileView
      kind="staff"
      entity="Staff"
      row={row}
      {...lists}
      loadChildren={loadMyStaffChildren}
      title="My Profile"
      breadcrumb="Your own details from the HR staff master"
    />
  );
}
