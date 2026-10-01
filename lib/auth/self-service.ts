import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./types";

/**
 * "MY PROFILE" — WHO IS A REGULAR STAFF MEMBER (user 2026-10-01).
 *
 * The HR sidebar's Staff row is the whole staff list for an Admin or HR, and
 * the person's OWN record — labelled "My Profile", at /hr/staff/<their id> —
 * for everyone else. Decided by ROLE, as asked:
 *
 *  - a Super Admin, or a login whose ROLE grants HR & Payroll view
 *    (Administrator, HR Manager, HR Executive, …) → the list;
 *  - any other login that can open HR and whose email is on a staff record
 *    → My Profile, read-only;
 *  - a login with no staff record keeps what it had — there is no profile to
 *    send it to.
 *
 * ROLE, NOT `my_permissions()`: that unions email access in, and email access
 * is exactly how a regular staff member is given the Staff screen (Sripriya).
 * Counting it would make every such person "HR".
 *
 * Read with the SERVICE ROLE, by the user's own id and verified email only:
 * `staff_read` needs the current unit, and a self-service login usually holds
 * none — which is why their Staff table read "No staff yet".
 *
 * Costs nothing for anyone who cannot open HR (the common case): both lookups
 * run only for a non-super-admin holding hr_payroll:view.
 */
export async function resolveMyStaffId(opts: {
  userId: string;
  email: string | null;
  isSuperAdmin: boolean;
  permissions: PermissionKey[];
}): Promise<string | null> {
  if (opts.isSuperAdmin || !opts.permissions.includes("hr_payroll:view")) return null;
  const email = opts.email?.trim().toLowerCase();
  if (!email) return null;

  const admin = createAdminClient();
  const { data: held, error: heldErr } = await admin
    .from("user_roles")
    .select("role_id")
    .eq("user_id", opts.userId);
  if (heldErr) return null; // unknown → today's behaviour (the list), never a lock-out
  const roleIds = ((held ?? []) as { role_id: string }[]).map((r) => r.role_id);

  if (roleIds.length > 0) {
    const { data: hr, error: hrErr } = await admin
      .from("role_permissions")
      .select("role_id, permissions!inner(module, action)")
      .in("role_id", roleIds)
      .eq("permissions.module", "hr_payroll")
      .eq("permissions.action", "view")
      .limit(1);
    if (hrErr) return null;
    if ((hr ?? []).length > 0) return null; // Admin / HR by role → the list
  }

  const { data: staff, error: staffErr } = await admin
    .from("staff")
    .select("id")
    // `ilike` for case only — `%`, `_` and `\` escaped so an address is never a pattern.
    .ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c))
    .order("created_at")
    .limit(1);
  if (staffErr) return null;
  return ((staff ?? [])[0] as { id: string } | undefined)?.id ?? null;
}
