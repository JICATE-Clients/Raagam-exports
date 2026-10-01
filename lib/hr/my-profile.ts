import "server-only";
import { requireUser } from "@/lib/auth/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getPersonChildren } from "@/lib/hr/masters-service";

/**
 * MY PROFILE — THE CALLER'S OWN HR ▸ STAFF RECORD, AND NOTHING ELSE
 * (user 2026-10-01: "if I give access to the staff it opens as Staff … it
 * should open as my profile").
 *
 * The problem it removes: the only way a staff member could see their own
 * details was HR ▸ Staff, and that permission opens the WHOLE master — every
 * colleague's salary, bank account and family. So My Profile needs no module
 * permission at all; any login reaches it, and it shows one record.
 *
 * ## WHO "ME" IS, DECIDED HERE AND ONLY HERE
 *
 * Resolved on the server from the session — never from an id the browser
 * sends, which is what makes the service-role read below safe: the row it
 * reads is always the caller's own. Matched the way the Users screen joins a
 * login to HR ▸ Staff (`app/(app)/admin/users/page.tsx`): the login's EMAIL to
 * `staff.email`, case-folded, then its `employee_code` to `staff.code`. A login
 * that matches neither has no profile, and the page says so plainly rather
 * than guessing.
 *
 * ## WHY THE SERVICE ROLE
 *
 * `staff_read` and the `hr_*` child tables are gated on hr_payroll:view AND
 * the current unit — the very permission a staff member should not need. RLS
 * cannot express "your own row" for them without a policy change on a dozen
 * HR tables; reading the ONE resolved record with the service role is the
 * narrow version of that, and every query below is pinned to its id.
 */
export type MyStaffRecord = { kind: "staff"; row: Record<string, unknown> & { id: string } };

export async function getMyStaffRecord(): Promise<MyStaffRecord | null> {
  const user = await requireUser();
  const s = await createClient();
  const { data: me } = await s
    .from("profiles")
    .select("email, employee_code")
    .eq("id", user.id)
    .maybeSingle();
  const email = (me as { email: string | null } | null)?.email?.trim().toLowerCase() || null;
  const code = (me as { employee_code: string | null } | null)?.employee_code?.trim() || null;
  if (!email && !code) return null;

  const admin = createAdminClient();
  const cols = "*, locations(name), designations(name)";
  if (email) {
    // `ilike` for the case-fold, with its wildcards ESCAPED: an email may hold
    // `_`, and an unescaped `_` matches any character — `a_b@x` would find
    // `axb@x`, which is somebody else's record.
    const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await admin.from("staff").select(cols).ilike("email", exact).limit(1).maybeSingle();
    if (data) return { kind: "staff", row: data as MyStaffRecord["row"] };
  }
  if (code) {
    const { data } = await admin.from("staff").select(cols).eq("code", code).limit(1).maybeSingle();
    if (data) return { kind: "staff", row: data as MyStaffRecord["row"] };
  }
  return null;
}

/** The record's family, bank, experience … lists — for the caller's own record only. */
export async function getMyStaffChildren() {
  const mine = await getMyStaffRecord();
  if (!mine) return null;
  return getPersonChildren("staff", mine.row.id, createAdminClient());
}
