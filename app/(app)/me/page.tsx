import { redirect } from "next/navigation";

/**
 * `/me` WAS MY PROFILE'S FIRST ADDRESS (0670, 2026-10-01). It moved to
 * `/my-profile` the same day ("my profile, no need of 'me'"), and a URL that
 * has been handed out keeps working — a redirect, never a 404.
 */
export default function MeRedirect() {
  redirect("/my-profile");
}
