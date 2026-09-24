"use client";

import {
  Briefcase,
  CalendarDays,
  ClipboardList,
  Clock,
  Fingerprint,
  GraduationCap,
  FileCheck,
  Contact,
  FileText,
  HeartHandshake,
  Home,
  Languages,
  PhoneCall,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon
} from "lucide-react";

import type { PersonKind } from "@/lib/hr/types";

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
  | "employment"
  | "statutory"
  | "shifts"
  | "addresses"
  | "personal"
  | "documents"
  | "education"
  | "languages"
  | "background"
  | "family"
  | "experience"
  | "reference"
  | "external-refs"
  | "emergency"
  | "internal-ref"
  | "nomination"
  | "detail-person"
  | "detail-posting"
  | "employment-engagement"
  | "employment-worker-terms-and-wages"
  | "employment-card-and-facilities"
  | "employment-service-dates"
  | "statutory-tax"
  | "statutory-worker-category"
  | "personal-basics"
  | "personal-physical"
  | "personal-medical"
  | "documents-document-numbers"
  | "documents-copies-collected"
  | "documents-licences-held"
  | "documents-verification"
  | "education-schooling"
  | "education-technical-training"
  | "background-how-they-joined"
  | "background-home-and-family"
  | "background-conduct-and-achievements";

/**
 * ONE RAIL FOR BOTH. The client asked for a worker's record to be the staff
 * record ("all other things are exactly same from staff", 2026-09-09) — only
 * the Detail tab differs, and it differs by adding fields, not sections. Two
 * copies of this list would have drifted the first time either changed.
 *
 * Read it through `personSections(kind)`, never directly: Shifts is a worker
 * row only (see there).
 */
const ALL_SECTIONS: {
  key: PersonSectionKey;
  label: string;
  icon: LucideIcon;
  /** Indented under the row above — see the four Detail sub-rows below. */
  sub?: boolean;
  /** Owns no pane — clicking it opens its first child. */
  groupOnly?: boolean;
}[] = [
  /*
   * EVERY HEADING IS A ROW (client 2026-09-22: "every heading should be in the
   * left side"). A pane that used to hold several headed groups is now a
   * group-only parent — it owns no pane, clicking it opens its first child —
   * and each heading is a child row whose pane is the flat run of fields that
   * stood under it. The rail is the only place a name appears; no pane draws a
   * heading of its own.
   *
   * ORDER IS THE NESTING: `sub` indents a row under the nearest non-sub row
   * above it, so a parent's children must follow it directly.
   */
  { key: "detail", label: "Identity", icon: FileText, groupOnly: true },
  { key: "detail-person", label: "Person", icon: FileText, sub: true },
  { key: "detail-posting", label: "Posting", icon: FileText, sub: true },
  { key: "employment", label: "Job & Wages", icon: ClipboardList, groupOnly: true },
  { key: "employment-engagement", label: "Engagement", icon: ClipboardList, sub: true },
  // WORKERS ONLY — filtered out for staff by `personSections`.
  { key: "employment-worker-terms-and-wages", label: "Worker Terms & Wages", icon: ClipboardList, sub: true },
  // Joining, probation, confirmation, leaving: the dates of the JOB. Date of
  // birth went to About the Person ▸ Basics, and with that "Key Dates" had no
  // reason to be a category of its own (2026-09-22).
  { key: "employment-service-dates", label: "Service Dates", icon: CalendarDays, sub: true },
  { key: "employment-card-and-facilities", label: "Facilities", icon: ClipboardList, sub: true },
  { key: "statutory", label: "Tax & Category", icon: FileCheck, groupOnly: true },
  { key: "statutory-tax", label: "Tax", icon: FileCheck, sub: true },
  { key: "statutory-worker-category", label: "Worker Category", icon: FileCheck, sub: true },
  // Dated spells, not a field on Identity — see `hr_shift_assignments` (0554).
  // WORKERS ONLY — filtered out for staff by `personSections` below.
  { key: "shifts", label: "Shift Assignment", icon: Clock },
  // Both addresses on one pane, side by side (client 2026-09-16).
  { key: "addresses", label: "Address", icon: Home },
  { key: "personal", label: "About the Person", icon: UserRound, groupOnly: true },
  { key: "personal-basics", label: "Basics", icon: UserRound, sub: true },
  { key: "personal-physical", label: "Physical", icon: UserRound, sub: true },
  { key: "personal-medical", label: "Medical", icon: UserRound, sub: true },
  { key: "documents", label: "ID & Documents", icon: Fingerprint, groupOnly: true },
  { key: "documents-document-numbers", label: "Document Numbers", icon: Fingerprint, sub: true },
  { key: "documents-copies-collected", label: "Copies Collected", icon: Fingerprint, sub: true },
  { key: "documents-licences-held", label: "Licences Held", icon: Fingerprint, sub: true },
  { key: "documents-verification", label: "Verification", icon: Fingerprint, sub: true },
  { key: "education", label: "Education & Training", icon: GraduationCap, groupOnly: true },
  { key: "education-schooling", label: "Schooling", icon: GraduationCap, sub: true },
  { key: "education-technical-training", label: "Technical Training", icon: GraduationCap, sub: true },
  { key: "languages", label: "Languages Known", icon: Languages },
  { key: "background", label: "Background", icon: ClipboardList, groupOnly: true },
  { key: "background-how-they-joined", label: "How They Joined", icon: ClipboardList, sub: true },
  { key: "background-home-and-family", label: "Home & Family", icon: ClipboardList, sub: true },
  { key: "background-conduct-and-achievements", label: "Conduct & Achievements", icon: ClipboardList, sub: true },
  { key: "family", label: "Family Members", icon: Users },
  { key: "experience", label: "Previous Employment", icon: Briefcase },
  { key: "reference", label: "References", icon: Contact, groupOnly: true },
  { key: "external-refs", label: "Outside References", icon: UsersRound, sub: true },
  { key: "emergency", label: "Emergency Contacts", icon: PhoneCall, sub: true },
  { key: "internal-ref", label: "Inside the Company", icon: Contact, sub: true },
  { key: "nomination", label: "Nominee", icon: HeartHandshake },

];

/**
 * THE RAIL FOR ONE KIND OF PERSON — the only way to read the list.
 *
 * Shifts is a WORKER row and not a staff one (client 2026-09-11: "remove shifts
 * for staff"). That restores the original split: a worker's record was asked for
 * as the staff record plus "some fields … like shifts and all" (2026-09-09), so
 * Shifts was always the worker's addition — it reached the staff rail only
 * because one flat array fed both screens.
 *
 * ## FILTERED HERE, NOT HIDDEN AT THE CALL SITE
 *
 * The rail and `sectionValidity` each map this list, so a screen-level `if`
 * would have to be written twice and kept in agreement — and the half that gets
 * forgotten is the validity one, where a section nobody can open still counts
 * toward what is blocking Save. One filter, both readers.
 *
 * ## `hr_shift_assignments.staff_id` STAYS
 *
 * 0554 gave the table both parents on purpose ("shifts are mostly a worker
 * thing, but a supervisor…"), with its own exclusion constraint and index on
 * the staff side. This is a change to what the SCREEN offers, not a statement
 * that a staff shift is now invalid data, so the column is left alone.
 *
 * Which makes the save side the part that had to be got right, and it is not
 * "send an empty list": `replacePersonChildren` deletes before it checks that
 * list, so an empty one would have DELETED the spells of any staff member who
 * had them, from a screen that no longer shows them. It skips the table
 * outright for staff instead.
 */
export function personSections(kind: PersonKind) {
  const workerOnly = new Set<PersonSectionKey>(["shifts", "employment-worker-terms-and-wages"]);
  return kind === "worker"
    ? ALL_SECTIONS
    : ALL_SECTIONS.filter((s) => !workerOnly.has(s.key));
}
