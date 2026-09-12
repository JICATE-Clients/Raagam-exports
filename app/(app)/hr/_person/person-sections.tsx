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
  Info,
  Home,
  Landmark,
  Languages,
  Mailbox,
  Paperclip,
  PhoneCall,
  PiggyBank,
  ShieldCheck,
  ToggleLeft,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
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
  | "dates"
  | "statutory"
  | "status"
  | "pay-statutory"
  | "pay-actual"
  | "esi"
  | "pf"
  | "perm-address"
  | "corr-address"
  | "personal"
  | "identifiers"
  | "enclosure"
  | "education"
  | "languages"
  | "background"
  | "other-details"
  | "external-refs"
  | "emergency"
  | "internal-ref"
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
  { key: "detail", label: "Detail", icon: FileText },
  /**
   * THE FOUR THAT USED TO BE HEADINGS INSIDE DETAIL (client 2026-09-11: "in
   * detail the 3 lines can be there, under the details other all heading can
   * show in left side bar under the detail like employement dtas and all so if
   * i click from the left side only those regarding fields can show").
   *
   * Detail was ~700 lines of one pane — the identity block plus Employment,
   * Dates, Statutory and Status stacked under `GroupHeading`s. Each is now its
   * own rail row, indented with `sub`, so opening one shows only its fields.
   * Detail keeps exactly the three identity rows it opens on.
   *
   * ORDER IS THE NESTING (`sub` indents; it does not declare a parent), so
   * these four must stay directly beneath Detail. Their `GroupHeading`s are
   * dropped inside the panes: the rail row now says the name, and repeating it
   * as a heading is the duplication the de-clutter rule removes elsewhere.
   */
  { key: "employment", label: "Employment", icon: ClipboardList, sub: true },
  { key: "dates", label: "Dates", icon: CalendarDays, sub: true },
  { key: "statutory", label: "Statutory", icon: FileCheck, sub: true },
  { key: "status", label: "Status", icon: ToggleLeft, sub: true },
  // Dated spells, not a field on Detail — see `hr_shift_assignments` (0554).
  // WORKERS ONLY — filtered out for staff by `personSections` below.
  { key: "shifts", label: "Shifts", icon: Clock },
  /**
   * SALARY REGISTRY IS A CATEGORY, NOT A PANE (client 2026-09-11: "now do the
   * same for all fields in left side bar like a detail").
   *
   * Detail could keep a pane because it had content of its own — the identity
   * block, which sits under no heading. This one is nothing BUT its four
   * groups, so a pane here would be an empty screen with a footer; `groupOnly`
   * makes the row open Pay - Statutory instead. Same for General and Reference
   * below. That is one rule, not three exceptions: a parent shows whatever is
   * not in a child, and where that is nothing it becomes pure navigation.
   */
  { key: "salary-registry", label: "Salary Registry", icon: Wallet, groupOnly: true },
  // Both panels hold Basic / DA / HRA / Others, so these two labels are the
  // only thing saying which set a figure belongs to — they were load-bearing as
  // headings and stay load-bearing as rail rows.
  { key: "pay-statutory", label: "Pay — Statutory", icon: Wallet, sub: true },
  { key: "pay-actual", label: "Pay — Actual", icon: Wallet, sub: true },
  { key: "esi", label: "ESI Details", icon: ShieldCheck, sub: true },
  { key: "pf", label: "PF Details", icon: PiggyBank, sub: true },
  // "Bank Account", not "Bank Account Details" (client 2026-09-09). The rail is
  // 228px and truncates — the longer label rendered as "Bank Account …", so the
  // word that got cut was the one word carrying no information anyway.
  { key: "bank", label: "Bank Account", icon: Landmark },
  { key: "general", label: "General", icon: Contact, groupOnly: true },
  { key: "perm-address", label: "Permanent Address", icon: Home, sub: true },
  { key: "corr-address", label: "Correspondence Address", icon: Mailbox, sub: true },
  { key: "personal", label: "Personal", icon: UserRound, sub: true },
  { key: "identifiers", label: "Identifiers", icon: Fingerprint, sub: true },
  /**
   * THE FIVE POPUPS LEGACY HANGS OFF GENERAL (client 2026-09-12, five
   * screenshots: "we missed this 5 child in general add these i want all fields
   * from here") — EDP4 reaches them through buttons scattered across the tab;
   * here they are rail rows, so nothing is behind a button an operator has to
   * know about.
   *
   * "Details" and "Other Details" are legacy's own two names for two different
   * popups, which is unusable as a pair of rail labels. They are named for what
   * they hold instead: how someone reached us and their household, and their
   * physical particulars and documents.
   */
  { key: "enclosure", label: "Enclosure", icon: Paperclip, sub: true },
  { key: "education", label: "Education & Technical", icon: GraduationCap, sub: true },
  { key: "languages", label: "Languages", icon: Languages, sub: true },
  { key: "background", label: "Background", icon: ClipboardList, sub: true },
  { key: "other-details", label: "Other Details", icon: Info, sub: true },
  { key: "family", label: "Family Details", icon: Users },
  { key: "experience", label: "Work Experience", icon: Briefcase },
  { key: "reference", label: "Reference", icon: Contact, groupOnly: true },
  { key: "external-refs", label: "External References", icon: UsersRound, sub: true },
  { key: "emergency", label: "Emergency Contacts", icon: PhoneCall, sub: true },
  { key: "internal-ref", label: "Internal Reference", icon: Contact, sub: true },
  { key: "nomination", label: "Nomination", icon: HeartHandshake },
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
  return kind === "worker"
    ? ALL_SECTIONS
    : ALL_SECTIONS.filter((s) => s.key !== "shifts");
}
