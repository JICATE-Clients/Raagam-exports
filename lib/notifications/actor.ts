import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * WHO RAISED AN ALERT (0814, user 2026-11-06: "make it customised — their
 * profile"). The face on the bell and on the Windows / phone pop-up.
 *
 * The actor is the SIGNED-IN person when `notify()` runs, read from the
 * session's JWT (`getClaims`, verified locally — the same read `lib/audit.ts`
 * makes on every save). That is right for every alert a person's action
 * raises: Karthik submits a PO, Karthik is who the MD sees. A sweep or a cron
 * job has no session, so the actor is null and the alert wears its module's
 * icon instead — which is the truth: nobody did it.
 *
 * The photo follows `findMyStaff`'s ONE "which staff row is this login" rule
 * (`lib/hr/my-profile.ts`, also `lib/comms/photos.ts`): `profiles.email` =
 * `staff.email` case-folded, else `employee_code` = `staff.code` exactly. The
 * ROW is chosen first and its photo read second, so the sidebar dock, Pulse and
 * the bell can never show three different faces.
 *
 * Never throws: a missing name or photo is initials, never a lost alert.
 */
export type NotificationActor = { id: string; name: string | null; photo: string | null };

/** The signed-in user's id, or null outside a request (cron, sweep). */
export async function sessionUserId(): Promise<string | null> {
  try {
    const s = await createClient();
    const { data } = await s.auth.getClaims();
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

export async function resolveActor(userId: string | null | undefined): Promise<NotificationActor | null> {
  if (!userId) return null;
  try {
    const admin = createAdminClient();
    const { data: p } = await admin
      .from("profiles")
      .select("full_name, email, employee_code")
      .eq("id", userId)
      .maybeSingle();
    const prof = p as { full_name: string | null; email: string | null; employee_code: string | null } | null;
    const email = prof?.email?.trim().toLowerCase() || null;
    const code = prof?.employee_code?.trim() || null;

    type StaffFace = { name: string | null; photo_url: string | null };
    let staff: StaffFace | null = null;
    if (email) {
      // `ilike` for the case-fold, wildcards ESCAPED (an email may hold `_`).
      const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data } = await admin.from("staff").select("name, photo_url").ilike("email", exact).limit(1).maybeSingle();
      staff = (data as StaffFace | null) ?? null;
    }
    if (!staff && code) {
      const { data } = await admin.from("staff").select("name, photo_url").eq("code", code).limit(1).maybeSingle();
      staff = (data as StaffFace | null) ?? null;
    }

    const name = prof?.full_name?.trim() || staff?.name?.trim() || prof?.email?.split("@")[0] || null;
    return { id: userId, name, photo: staff?.photo_url?.trim() || null };
  } catch {
    return { id: userId, name: null, photo: null };
  }
}
