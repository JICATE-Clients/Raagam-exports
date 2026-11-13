import { redirect } from "next/navigation";

/**
 * MERGED INTO USERS (user 2026-11-13: "user access control look much
 * cluttered … set up an organized one"). User Permissions was a second list of
 * the same people as Users — its Status switch meant "email access" where
 * Users' meant "login", and its bin deleted the login. A person's roles, units
 * and extra screens are now one editor on Administration ▸ Users & Access ▸
 * Users; `?user=<email>` still opens that person.
 *
 * A REDIRECT, NEVER A DELETION — every bookmark still lands. Declared in
 * `REDIRECTED` in scripts/check-module-groups.mts. No gate here: the target
 * runs its own.
 */
export default async function UserPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { user } = await searchParams;
  if (user) redirect(`/admin/users?user=${encodeURIComponent(user)}`);
  redirect("/admin/users");
}
