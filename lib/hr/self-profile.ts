/**
 * MY PROFILE — WHAT A STAFF MEMBER MAY EDIT ON THEIR OWN RECORD (user
 * 2026-10-01: "add edit button", personal details only).
 *
 * Declared ONCE and read by both halves, so they cannot disagree:
 *  - the editor shows only `SELF_SECTION_KEYS` in its rail (person-client.tsx);
 *  - `updateMyProfile` (masters-actions.ts) writes only `SELF_COLUMNS` and
 *    `SELF_CHILDREN`, whatever the browser sends. The server half is the
 *    guard; the rail is the courtesy.
 *
 * HR's to set, and so absent on purpose: name, code, designation, department,
 * location, status, every pay / bank / PF / ESI / tax field, document numbers,
 * references, nominee — and EMAIL, which is not merely HR's: it is how the
 * login finds this record (lib/auth/self-service.ts), so changing it would cut
 * the person off from their own profile.
 */

import type { PersonSectionKey } from "@/app/(app)/hr/_person/person-sections";

/** Rail rows offered on My Profile — a group row is kept when any child is. */
export const SELF_SECTION_KEYS: ReadonlySet<PersonSectionKey> = new Set<PersonSectionKey>([
  "addresses",
  "personal",
  "personal-basics",
  "personal-physical",
  "personal-medical",
  "education",
  "education-schooling",
  "education-technical-training",
  "languages",
  "background",
  "background-home-and-family",
  "family",
  "reference",
  "emergency",
]);

/** `staff` columns a self-save may change — what those sections hold, plus the photo. */
export const SELF_COLUMNS = [
  // Address
  "perm_address1", "perm_address2", "perm_address3", "perm_city", "perm_pin", "perm_phone",
  "corr_same_as_permanent",
  "corr_address1", "corr_address2", "corr_address3", "corr_city", "corr_pin", "corr_phone",
  // About the person — basics (no email: see above)
  "date_of_birth", "stated_age", "gender", "marital_status", "mother_tongue",
  "nationality", "place_of_birth", "religion",
  // Physical
  "blood_group", "eye_sight", "height_cm", "weight_kg", "identification_mark_1", "identification_mark_2",
  // Medical
  "handicap_details", "major_operation", "operation_details", "physique_illness", "willing_donate_blood",
  // Schooling
  "qualification",
  // Home & family
  "dependants", "earning_members", "house_type", "no_of_children", "occupation",
  "only_earning_member", "properties_owned",
  // The photo the profile card uploads
  "photo_url",
] as const;

/** Child lists a self-save may rewrite (keys of `StaffChildren`). */
export const SELF_CHILDREN = ["family", "emergencyContacts", "education", "technical", "languages"] as const;
