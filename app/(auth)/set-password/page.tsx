import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { SetPasswordForm } from "./set-password-form";

/**
 * FIRST SIGN-IN: CHOOSE YOUR OWN PASSWORD (0659, user 2026-09-30).
 *
 * A new login is created from the HR master and its temporary password is
 * emailed; the app layout sends that login here until it has replaced it.
 * Lives in the (auth) group, outside the app shell — the layout's redirect
 * would otherwise loop — and still behind the proxy's session gate.
 */
export default async function SetPasswordPage() {
  const user = await requireUser();
  if (!user.mustChangePassword) redirect("/");
  return <SetPasswordForm email={user.email} />;
}
