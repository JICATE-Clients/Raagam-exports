/**
 * JKKN Bug Reporter — the two facts both consumers need.
 *
 * The SDK widget (`components/bug-reporter-wrapper.tsx`) and the "My bug
 * reports" item in the topbar user menu have to agree on ONE question: is this
 * install actually registered on the Bug Reporter platform? If they disagree,
 * the failure is specific and confusing — a menu item pointing at a vendor
 * portal for an app that was never registered, which 404s on someone else's
 * domain. So the test lives here, once, rather than being written twice.
 */

const apiKey = process.env.NEXT_PUBLIC_BUG_REPORTER_API_KEY;
const apiUrl = process.env.NEXT_PUBLIC_BUG_REPORTER_API_URL;

/**
 * True only when real credentials are present — both a key and a URL that are
 * no longer the `REPLACE_ME` placeholder.
 *
 * Deliberately NOT a check on the key's prefix. The platform issues `br_…` keys
 * today, and hard-coding that would let a format change on their side silently
 * disable the widget across the whole app.
 */
export const bugReporterConfigured =
  !!apiKey &&
  !!apiUrl &&
  !apiKey.includes("REPLACE_ME") &&
  !apiUrl.includes("REPLACE_ME");

/**
 * Where the platform hosts the reporter-facing portal, and which app it shows.
 *
 * Both are here rather than inline in the menu so that renaming the app on the
 * platform, or moving the portal off vercel.app, is one edit in one file. The
 * env var means a self-hosted deployment needs no code change at all — the same
 * shape the two credential vars above already use.
 */
const PORTAL_BASE =
  process.env.NEXT_PUBLIC_BUG_REPORTER_PORTAL_URL ??
  "https://jkkn-centralized-bug-reporter.vercel.app";
const PORTAL_APP = "raagam-export";

/**
 * The portal link for one reporter. `email` is the same value the SDK receives
 * as `userContext.email`, which is what the portal keys a person's reports on.
 *
 * `encodeURIComponent` is not defensive boilerplate here: the value is an email,
 * so it contains `@` in every single case.
 *
 * SECURITY, ACCEPTED AND DEFERRED (client 2026-08-04, "the raagam signed user
 * can manage bugs now, after will restrict it"). This parameter is built in the
 * browser, so a signed-in operator can edit it in the address bar and read
 * another person's reports — which on this app can include screenshots of
 * customer and costing data. Everyone who can reach it is already an
 * authenticated staff member, and the vendor documents the plain link as
 * appropriate for internal tools.
 *
 * Closing it needs three things we do not have, all from the vendor: the signing
 * algorithm and the exact string that gets signed, the name of the signature
 * query parameter, and a shared secret (which must then be read server-side
 * only — never `NEXT_PUBLIC_`). Their portal also has a "Require signed links"
 * switch that has to be turned on, or a signed link changes nothing.
 */
export function bugPortalUrl(email: string): string {
  return `${PORTAL_BASE}/portal/${PORTAL_APP}?u=${encodeURIComponent(email)}`;
}
