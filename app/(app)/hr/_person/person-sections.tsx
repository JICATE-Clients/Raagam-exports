"use client";

import {
  Briefcase,
  Clock,
  Contact,
  FileText,
  HeartHandshake,
  Landmark,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * THE PERSON RECORD'S SECTION RAIL — staff and workers both. — the list down the left of the editor.
 *
 * ## WHY THIS IS THE RAIL AND NOT THE APP SIDEBAR
 *
 * The ask was for these to hang under Staff in the sidebar (client 2026-09-07).
 * They cannot: an app-nav row carries no record. A row called "Family Details"
 * under HR would have to mean the family details of WHICH staff member — there
 * is no answer until someone has opened one. `AGENTS.md` also caps the sidebar
 * at two levels, but the record-context problem is the real one.
 *
 * The section rail IS a left-hand list and it belongs to one open record, so the
 * shape asked for exists exactly as described, one level in:
 *
 *   HR ▸ People ▸ Staff        the list, in the app sidebar
 *     └ Detail · Salary Registry · Bank Account · General ·
 *       Family Details · Work Experience · Reference · Nomination
 *
 * ## THERE IS NO "STAFF" ROW, AND THAT REVERSES A STANDING RULE
 *
 * The operator's first rail rule (`raagam-screen-layout`) is: THE SCREEN'S OWN
 * NAME IS THE FIRST RAIL ROW — a record's header fields are a section, not a
 * band above the rail. This rail had one, and the client removed it: "this staff
 * no need remove it. we can directly starts from details" (2026-09-07).
 *
 * That is a deliberate exception, not an oversight, and it is safe here for a
 * reason worth writing down: the rule exists so a screen cannot hand-roll a
 * header band of `div > Label + Input` pairs, which are invisible to
 * `useRequiredHold` — that is how "Name *" ends up a star with nothing behind
 * it. This screen has no band at all; the identity fields moved INTO Detail as
 * ordinary `Field`s, so the hold still works. If a header band ever reappears
 * above the rail, this exception is what has to be revisited.
 *
 * ## EIGHT SECTIONS
 *
 * Legacy Staff carries eight tabs and the client kept six of them — Internal
 * Verification and Increment were excluded ("no need of other two"). They are
 * absent rather than commented out: a commented-out section is a decision the
 * next reader has to make again, and it has been made.
 *
 * Salary Registry and Bank Account are NOT legacy tabs. They were asked
 * for on 2026-09-07 ("after details add two more fields which are salary
 * registry and bank account details") and sit directly after Detail, which is
 * where the client placed them.
 */
export type PersonSectionKey =
  | "detail"
  | "shifts"
  | "salary-registry"
  | "bank"
  | "general"
  | "family"
  | "experience"
  | "reference"
  | "nomination";

/**
 * ONE RAIL FOR BOTH. The client asked for a worker's record to be the staff
 * record ("all other things are exactly same from staff", 2026-09-09) — only
 * the Detail tab differs, and it differs by adding fields, not sections. Two
 * copies of this list would have drifted the first time either changed.
 */
export const PERSON_SECTIONS: {
  key: PersonSectionKey;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "detail", label: "Detail", icon: FileText },
  // Dated spells, not a field on Detail — see `hr_shift_assignments` (0554).
  { key: "shifts", label: "Shifts", icon: Clock },
  { key: "salary-registry", label: "Salary Registry", icon: Wallet },
  // "Bank Account", not "Bank Account Details" (client 2026-09-09). The rail is
  // 228px and truncates — the longer label rendered as "Bank Account …", so the
  // word that got cut was the one word carrying no information anyway.
  { key: "bank", label: "Bank Account", icon: Landmark },
  { key: "general", label: "General", icon: Contact },
  { key: "family", label: "Family Details", icon: Users },
  { key: "experience", label: "Work Experience", icon: Briefcase },
  { key: "reference", label: "Reference", icon: Contact },
  { key: "nomination", label: "Nomination", icon: HeartHandshake },
];
