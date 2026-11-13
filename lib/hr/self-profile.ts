/**
 * MY PROFILE — WHAT A STAFF MEMBER MAY EDIT ON THEIR OWN RECORD.
 *
 * EVERYTHING EXCEPT THE PHOTO (user 2026-11-13: "in my profile, except profile photo, allow
 * them to edit all the details, from their own"; asked which fields to keep HR-only and offered
 * pay / bank / job: "open all except profile picture, only admin control"). This REVERSES the
 * 2026-10-01 rule, which offered the personal sections only and kept name, posting, pay, bank,
 * statutory, documents, references and nominee HR's. Restoring any of that needs a new decision
 * from the user, not a tidy-up.
 *
 * Declared ONCE and read by both halves, so they cannot disagree:
 *  - the editor's rail drops only `SELF_LOCKED_SECTIONS` (person-client.tsx), and the profile
 *    card shows the photo without Upload;
 *  - `updateMyProfile` (masters-actions.ts) writes every column except `SELF_LOCKED_COLUMNS`,
 *    and every list in `SELF_CHILDREN`, whatever the browser sends. The server half is the
 *    guard; the screen is the courtesy.
 *
 * Locked, and why each one:
 *  - `photo_url` — the user's one exception: the Admin controls the photograph.
 *  - `email` and `code` — not policy but plumbing: they are how a login FINDS its own record
 *    (lib/auth/self-service.ts, lib/hr/my-profile.ts match the login's email, then its employee
 *    code). Changing either would cut the person off from their own profile on the next load.
 */

import type { PersonSectionKey } from "@/app/(app)/hr/_person/person-sections";

/** Rail rows NOT offered on My Profile. None since 2026-11-13: every section is the person's. */
export const SELF_LOCKED_SECTIONS: ReadonlySet<PersonSectionKey> = new Set<PersonSectionKey>([]);

/** `staff` columns a self-save may NOT change — see above for each. */
export const SELF_LOCKED_COLUMNS: ReadonlySet<string> = new Set(["id", "photo_url", "email", "code"]);

/** Child lists a self-save may rewrite (keys of `StaffChildren`) — every staff list. Shifts
 *  are a worker section and never part of a staff save (masters-actions.ts says why). */
export const SELF_CHILDREN = [
  "family",
  "experience",
  "internalRefs",
  "nominations",
  "bankAccounts",
  "externalRefs",
  "emergencyContacts",
  "education",
  "technical",
  "languages",
] as const;
