"use server";

/**
 * LOGINS FROM THE HR MASTER, WITH A WELCOME EMAIL (user 2026-09-30).
 *
 *   createUserFromStaff    — "Send welcome mail" on a staff member with NO
 *                            login yet: name, email and code come from HR ▸
 *                            Staff (the `staff` table, user 2026-09-30),
 *                            a TEMPORARY password is generated, the login is
 *                            created and (with `sendWelcome`) the mail goes out.
 *   resendWelcome          — the same button on an employee who HAS a login: a
 *                            NEW temporary password, emailed again.
 *
 * THERE IS NO "NEW USER" FORM (user 2026-09-30, screenshot 3143: "only we need
 * fetch from hr master"). The Users screen lists the HR master; a login is only
 * ever made from an employee row, so a login and a person cannot disagree.
 *
 * SENDING IS A BUTTON FOR NOW ("create trigger button in ui after it we can
 * automate"). `AUTO_WELCOME_ON_CREATE` is the switch for sending on any create
 * without being asked — the hook for the automation to come.
 *   setOwnPassword         — the user's first sign-in replaces the temporary one.
 *
 * THE ADMIN NEVER TYPES A PASSWORD AND, WHEN THE MAIL GOES OUT, NEVER SEES ONE.
 * Only when email is not configured (or the send fails) is the temporary
 * password handed back — once — so the admin can pass it on; the user must
 * change it at first sign-in either way (0659 `must_change_password`).
 *
 * No `export type` here — a "use server" module that re-exports a type
 * crashes at runtime.
 */

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can, forgetAppUser, requireUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";
import { welcomeEmail } from "@/lib/email/welcome";

/** Flip to true to email the welcome mail the moment a login is created. */
const AUTO_WELCOME_ON_CREATE = false;

type Fail = { ok: false; error: string };
type Delivered = {
  ok: true;
  email: string;
  /** The login's id — set by createUserFromStaff, so a caller can go on to
   *  assign it a role (Users ▸ bulk Assign role). */
  userId?: string;
  /** The welcome mail went out. */
  emailed: boolean;
  /** Why it did not, in words for the admin. */
  emailProblem?: string;
  /** ONLY when the mail did not go out — shown once so it can be passed on. */
  tempPassword?: string;
};

/** 12 characters from a set with no look-alikes (no 0/O, 1/l/I), at least one
 *  of each class — readable from an email, strong enough for a first sign-in. */
function tempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const sym = "@#$%&*";
  const all = upper + lower + digit + sym;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function deliver(to: string, name: string | null, password: string, resent: boolean): Promise<Omit<Delivered, "ok" | "email">> {
  const mail = welcomeEmail({ name, email: to, password, resent });
  const res = await sendEmail({ to, ...mail });
  if (res.sent) return { emailed: true };
  return {
    emailed: false,
    tempPassword: password,
    emailProblem:
      res.reason === "not_configured"
        ? "Email is not configured (RESEND_API_KEY / EMAIL_FROM), so no mail was sent."
        : `The email could not be sent (${res.detail ?? "unknown error"}).`,
  };
}

export async function createUserFromStaff(input: {
  staffId: string;
  locationId?: string | null;
  /** Email the welcome mail as part of creating the login. */
  sendWelcome?: boolean;
}): Promise<Delivered | Fail> {
  if (!(await can("system_admin", "create"))) return { ok: false, error: "Forbidden" };
  // Service role, after the permission check above: `staff_read` would also
  // demand hr_payroll:view and the current unit (see app/(app)/admin/users/page.tsx).
  const admin = createAdminClient();
  const { data: row, error: rowErr } = await admin
    .from("staff")
    .select("id, code, name, email, is_active, blocked, location_id")
    .eq("id", input.staffId)
    .maybeSingle();
  if (rowErr) return { ok: false, error: rowErr.message };
  const e = row as { id: string; code: string | null; name: string | null; email: string | null; is_active: boolean | null; blocked: boolean | null; location_id: string | null } | null;
  if (!e) return { ok: false, error: "That staff member no longer exists." };
  if (e.is_active === false || e.blocked) return { ok: false, error: `${e.name ?? "This staff member"} is inactive in HR & Payroll ▸ People ▸ Staff.` };
  const email = (e.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `${e.name ?? "This staff member"} has no valid email in HR & Payroll ▸ People ▸ Staff — add it there first.` };
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id, email, employee_code")
    .or(`email.ilike.${email}${e.code ? `,employee_code.eq.${e.code}` : ""}`)
    .limit(1);
  if ((existing ?? []).length > 0) return { ok: false, error: `A login already exists for ${email}.` };

  const password = tempPassword();
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: e.name },
  });
  if (authError || !authData.user) return { ok: false, error: authError?.message ?? "Could not create the login." };

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: authData.user.id,
      email,
      full_name: e.name,
      employee_code: e.code,
      // The staff member's own unit, unless the caller named one.
      default_location_id: input.locationId || e.location_id || null,
      is_active: true,
      is_super_admin: false,
      must_change_password: true,
    },
    { onConflict: "id" },
  );
  if (profileError) return { ok: false, error: profileError.message };

  const delivery = input.sendWelcome || AUTO_WELCOME_ON_CREATE
    ? await deliver(email, e.name, password, false)
    : { emailed: false };
  await writeAudit({
    action: "user.created",
    entityType: "profile",
    entityId: authData.user.id,
    metadata: { email, staff_id: e.id, emailed: delivery.emailed },
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin/access-control");
  return { ok: true, email, userId: authData.user.id, ...delivery };
}

export async function resendWelcome(userId: string): Promise<Delivered | Fail> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };
  const admin = createAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, full_name, is_active, is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const p = prof as { id: string; email: string | null; full_name: string | null; is_active: boolean; is_super_admin: boolean } | null;
  if (!p?.email) return { ok: false, error: "That user has no email." };
  if (!p.is_active) return { ok: false, error: "That login is deactivated." };
  if (p.is_super_admin) return { ok: false, error: "A super admin's password is not reset from here." };

  const password = tempPassword();
  const { error: pwErr } = await admin.auth.admin.updateUserById(p.id, { password });
  if (pwErr) return { ok: false, error: pwErr.message };
  await admin.from("profiles").update({ must_change_password: true }).eq("id", p.id);

  const email = p.email.trim().toLowerCase();
  const delivery = await deliver(email, p.full_name, password, true);
  await writeAudit({
    action: "user.welcome_resent",
    entityType: "profile",
    entityId: p.id,
    metadata: { email, emailed: delivery.emailed },
  });
  revalidatePath("/admin/users");
  return { ok: true, email, ...delivery };
}

/** The signed-in user replaces their password (and so clears the first-login gate). */
export async function setOwnPassword(input: { password: string; confirm: string }): Promise<{ ok: true } | Fail> {
  const user = await requireUser();
  const pw = input.password ?? "";
  if (pw.length < 8) return { ok: false, error: "Use at least 8 characters." };
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return { ok: false, error: "Use letters and at least one number." };
  if (pw !== input.confirm) return { ok: false, error: "The two passwords do not match." };

  const s = await createClient();
  const { error } = await s.auth.updateUser({ password: pw });
  if (error) return { ok: false, error: error.message };
  const admin = createAdminClient();
  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);
  await forgetAppUser();
  await writeAudit({ action: "user.password_set", entityType: "profile", entityId: user.id });
  return { ok: true };
}

/**
 * THE STATUS SWITCH on the Users list — a login switched off cannot sign in.
 *
 * Two halves, because `profiles.is_active` alone only empties the user's
 * permissions (`has_permission` reads it) while still letting them sign in to
 * a screen full of refusals: the Auth user is BANNED as well, which is what
 * actually stops the sign-in. Switching back on lifts the ban.
 */
export async function setLoginActive(userId: string, active: boolean): Promise<{ ok: true } | Fail> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };
  const me = await requireUser();
  if (me.id === userId) return { ok: false, error: "You cannot switch off your own login." };
  const admin = createAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!prof) return { ok: false, error: "That login no longer exists." };
  if ((prof as { is_super_admin: boolean }).is_super_admin) {
    return { ok: false, error: "A super admin's login is not switched off from here." };
  }
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (banErr) return { ok: false, error: banErr.message };
  const { error: upErr } = await admin.from("profiles").update({ is_active: active }).eq("id", userId);
  if (upErr) return { ok: false, error: upErr.message };
  await writeAudit({
    action: active ? "user.activated" : "user.deactivated",
    entityType: "profile",
    entityId: userId,
    metadata: { email: (prof as { email: string | null }).email },
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin/access-control");
  return { ok: true };
}

/**
 * DELETE A USER — the bin on Access Control ▸ By User (user 2026-09-30:
 * "delete should remove the user login also"). Removes their personal email
 * access and their login.
 *
 * A LOGIN THAT MADE RECORDS CANNOT BE ERASED, AND THAT IS THE DATABASE BEING
 * RIGHT. ~200 tables stamp `created_by` → profiles with no cascade, so Auth's
 * delete is refused the moment the person has entered anything — and erasing
 * who made a record would be a lie in an audit column (AGENTS.md "Created
 * Date / Created User"). So the delete is tried, and when it is refused the
 * login is RETIRED instead: banned (cannot sign in), switched off, every role
 * and grant removed. The answer says which happened.
 */
export async function deleteUserLogin(userId: string): Promise<{ ok: true; retired: boolean } | Fail> {
  if (!(await can("system_admin", "delete"))) return { ok: false, error: "Forbidden" };
  const me = await requireUser();
  if (me.id === userId) return { ok: false, error: "You cannot delete your own login." };
  const admin = createAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, full_name, is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const p = prof as { id: string; email: string | null; full_name: string | null; is_super_admin: boolean } | null;
  if (!p) return { ok: false, error: "That login no longer exists." };
  if (p.is_super_admin) return { ok: false, error: "A super admin's login is not deleted from here." };
  const email = p.email?.trim().toLowerCase() ?? null;

  // Personal access is keyed by EMAIL, not the login, so nothing cascades to
  // it — clear it first either way, or it would wait for the next login made
  // on that address. Direct deletes as service role: the history table keeps
  // the record of what they held.
  if (email) {
    await admin.from("user_screen_permissions").delete().eq("user_email", email);
    await admin.from("user_permissions").delete().eq("user_email", email);
    await admin.from("user_access").delete().eq("user_email", email);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (!delErr) {
    await writeAudit({ action: "user.deleted", entityType: "profile", entityId: userId, metadata: { email } });
    revalidatePath("/admin/users");
    revalidatePath("/admin/access-control");
    return { ok: true, retired: false };
  }

  // Refused (the login made records): retire it instead.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (banErr) return { ok: false, error: banErr.message };
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error: upErr } = await admin.from("profiles").update({ is_active: false }).eq("id", userId);
  if (upErr) return { ok: false, error: upErr.message };
  await writeAudit({
    action: "user.retired",
    entityType: "profile",
    entityId: userId,
    metadata: { email, reason: delErr.message },
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin/access-control");
  return { ok: true, retired: true };
}
