import { redirect } from "next/navigation";

/**
 * MERGED INTO ACCESS CONTROL (user 2026-09-30: "role and permission and
 * permission override need to merge"). Roles are now the By Role tab of
 * Administration ▸ Access Control ▸ Access Control, over the screen-level
 * permission tree (0658).
 *
 * A REDIRECT, NEVER A DELETION — every bookmark still lands. Declared in
 * `REDIRECTED` in scripts/check-module-groups.mts, which asserts this page
 * and its `redirect(...)` target together.
 *
 * No `requirePermission` here: the target runs its own gate.
 */
export default function RolesPage() {
  redirect("/admin/access-control");
}
