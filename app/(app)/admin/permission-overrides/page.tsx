import { redirect } from "next/navigation";

/**
 * MERGED INTO ACCESS CONTROL (user 2026-09-30). Approved-order corrections
 * (the permission overrides, 0650–0657) are now a section of each person's
 * access on the By User tab of Administration ▸ Access Control ▸ Access
 * Control; the grant screen itself is `permission-overrides-screen.tsx`,
 * rendered there with `forEmail`.
 *
 * A REDIRECT, NEVER A DELETION — every bookmark still lands. Declared in
 * `REDIRECTED` in scripts/check-module-groups.mts.
 *
 * No gate here: the target runs its own.
 */
export default function PermissionOverridesPage() {
  redirect("/admin/access-control?tab=users");
}
