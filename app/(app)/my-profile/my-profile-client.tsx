"use client";

import { useRouter } from "next/navigation";
import { PersonProfileView } from "@/app/(app)/hr/_person/person-profile-view";
import { loadMyStaffChildren } from "@/lib/hr/my-profile-actions";

type Named = { id: string; name: string };

/**
 * The Staff details view, as the person themselves sees it: no Back (there is
 * no list behind it), and its lists read through `loadMyStaffChildren`, which
 * only ever returns the caller's own record.
 *
 * EDIT (user 2026-11-13: "allow them to edit all the details, from their own",
 * except the photo — the Admin's). It opens the HR editor on the caller's own
 * record (`/hr/staff/<id>?open=<id>`), which offers every section and saves
 * through `updateMyProfile` (lib/hr/self-profile.ts). `editHref` is null when
 * the login cannot edit there (an Admin / HR keeps HR ▸ Staff instead).
 */
export function MyProfileClient({
  row,
  editHref,
  ...lists
}: {
  row: Record<string, unknown> & { id: string };
  editHref: string | null;
  locations: Named[];
  departments: Named[];
  divisions: Named[];
  categories: Named[];
  banks: Named[];
  designations: Named[];
}) {
  const router = useRouter();
  return (
    <PersonProfileView
      kind="staff"
      entity="Staff"
      row={row}
      {...lists}
      loadChildren={loadMyStaffChildren}
      onEdit={editHref ? () => router.push(editHref) : undefined}
      title="My Profile"
      breadcrumb="Your own details from the HR staff master"
    />
  );
}
