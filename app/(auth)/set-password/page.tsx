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
 *
 * `?reset=1` is the FORGOT-PASSWORD landing: the emailed recovery link signs
 * the user in through `/auth/callback` and sends them here to choose a new one.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const user = await requireUser();
  const reset = (await searchParams).reset === "1";
  if (!reset && !user.mustChangePassword) redirect("/");
  return <SetPasswordForm email={user.email} reset={reset} />;
}
