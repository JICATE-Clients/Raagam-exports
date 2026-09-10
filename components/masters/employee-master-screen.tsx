"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, IdCard, Landmark, MapPin, TriangleAlert, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { LocationPicker } from "@/components/masters/location-picker";
import { EmployeePicker } from "@/components/masters/employee-picker";
import { createEmployee, updateEmployee, deleteEmployee } from "@/lib/masters/employee-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { AADHAAR_RE } from "@/lib/validation/formats";
import { isAadhaarChecksumValid } from "@/lib/validation/aadhaar";
import {
  GUARDIAN_RELATIONS,
  SPOUSE_TYPES,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  MARITAL_STATUSES,
  SEXES,
  PAY_MODES,
  type Employee,
  type EmployeeInput,
  type EmployeeLocation,
  type EmployeeRef,
} from "@/lib/masters/employee-types";
import { DetailSection } from "@/components/masters/detail-section";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { fmtDate } from "@/lib/format";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = {
  code: string;
  name: string;
  guardian_relation: string;
  guardian_name: string;
  category_id: string;
  department_id: string;
  location_id: string;
  designation_id: string;
  team_id: string;
  manager_id: string;
  dob: string;
  inactive: boolean;
  // Permanent Address
  perm_addr1: string;
  perm_addr2: string;
  perm_addr3: string;
  perm_pin: string;
  perm_phone: string;
  perm_mobile: string;
  // Correspondence Address
  corr_same_as_perm: boolean;
  corr_addr1: string;
  corr_addr2: string;
  corr_addr3: string;
  corr_pin: string;
  corr_phone: string;
  corr_mobile: string;
  photo_url: string | null;
  // personal
  email: string;
  qualification: string;
  blood_group: string;
  marital_status: string;
  sex: string;
  nationality: string;
  religion: string;
  // 0277 — employment & statutory
  doj: string;
  emp_type: string;
  mobile: string;
  father_name: string;
  mother_name: string;
  spouse_name: string;
  pf_no: string;
  esi_no: string;
  uan: string;
  pan_no: string;
  aadhar_no: string;
  pay_mode: string;
  bank_name: string;
  bank_acc_no: string;
  // 0279 — enrichment
  spouse_type: string;
  date_of_confirmation: string;
  date_of_filing: string;
  employee_type: string;
};
const BLANK: Form = {
  code: "",
  name: "",
  guardian_relation: "S/O",
  guardian_name: "",
  category_id: "",
  department_id: "",
  location_id: "",
  designation_id: "",
  team_id: "",
  manager_id: "",
  dob: "",
  inactive: false,
  photo_url: null,
  perm_addr1: "",
  perm_addr2: "",
  perm_addr3: "",
  perm_pin: "",
  perm_phone: "",
  perm_mobile: "",
  corr_same_as_perm: false,
  corr_addr1: "",
  corr_addr2: "",
  corr_addr3: "",
  corr_pin: "",
  corr_phone: "",
  corr_mobile: "",
  email: "",
  qualification: "",
  blood_group: "",
  marital_status: "Single",
  sex: "Male",
  nationality: "",
  religion: "",
  doj: "",
  emp_type: "",
  mobile: "",
  father_name: "",
  mother_name: "",
  spouse_name: "",
  pf_no: "",
  esi_no: "",
  uan: "",
  pan_no: "",
  aadhar_no: "",
  pay_mode: "Bank",
  bank_name: "",
  bank_acc_no: "",
  spouse_type: "",
  date_of_confirmation: "",
  date_of_filing: "",
  employee_type: "S",
};

/** Whole-year age from a YYYY-MM-DD DOB string (legacy shows an auto Age box). */
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * One address, written the way an address is written, for the read-only view.
 *
 * The six columns behind it would be six label→value rows — "Address line 2",
 * "Pin Code" — which is a database dump of the one thing on this record every
 * reader can already parse at a glance. The street lines stack, the PIN closes
 * the last of them, and the two numbers sit underneath. Returns null when the
 * block is empty, so the caller can decide whether the section is worth showing.
 */
function AddressBlock({
  title,
  lines,
  pin,
  phone,
  mobile,
}: {
  title: string;
  lines: (string | null)[];
  pin: string | null;
  phone: string | null;
  mobile: string | null;
}) {
  const street = lines.map((l) => l?.trim()).filter((l): l is string => !!l);
  const contact = [
    phone?.trim() ? `Phone ${phone.trim()}` : null,
    mobile?.trim() ? `Mobile ${mobile.trim()}` : null,
  ].filter(Boolean);
  if (street.length === 0 && !pin?.trim() && contact.length === 0) return null;
  return (
    <div className="text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <address className="mt-1 not-italic text-foreground">
        {street.map((l, i) => (
          // Index key: two lines of one address can legitimately read the same
          // ("2ND FLOOR" twice), and nothing here reorders.
          <div key={`${i}-${l}`}>{l}</div>
        ))}
        {pin?.trim() && <div>{pin.trim()}</div>}
      </address>
      {contact.length > 0 && (
        <p className="mt-1 text-muted-foreground">{contact.join(" · ")}</p>
      )}
    </div>
  );
}

/** The two blocks that repeat the six address controls. */
type AddrPrefix = "perm" | "corr";
/** A real key of `Form` — `perm_addr1`, `corr_pin`, … */
type AddrKey = `${AddrPrefix}_${"addr1" | "addr2" | "addr3" | "pin" | "phone" | "mobile"}`;

// THE TWELFTHS TRACK IS GONE FROM THIS SCREEN. `FIELD_SIZE`, `SizedField` and
// `AddrField` stood here until 2026-09-10, and they are deleted rather than left
// holding their last section: Address was the final row on the track, and a map
// with one reader is what the note that used to sit here warned about — "a key
// that no call site reads would otherwise sit there looking authoritative". A
// map that no longer sizes anything is that failure one step further on.
//
// Every section states a WIDTH now: `IDENTITY_W`, `PERSONAL_W`, `OTHER_W`,
// `DATES_W`, `STATUTORY_W`, `BANK_W` and `ADDRESS_W`, each with the arithmetic
// for its own row written above it.
//
// What the deleted map said about Address is kept in `ADDRESS_W`'s note below,
// because that measurement is what condemns it rather than merely what it used
// to be.

/**
 * IDENTITY, SHRINK-WRAPPED (`erp-form-compact`) — the same conversion Notify,
 * Consignee, Our Bank and Vendor took, on the section that names the record.
 *
 * Ten fields on a 12-column track is four rows of shares, and a share is a
 * fraction of the pane rather than a measurement of anything in the box: at
 * `sm` (3 of 12) a picked Department stood ~278px wide on a 1366 laptop and
 * ~344px at 1920, and so did Location, and so did Team, and a 3-character
 * Relation had a seventh of the row to itself. Narrowing the CONTROL inside a
 * twelfth changes nothing — the cell keeps its share and the value floats in
 * the hole — so the section leaves the track for `FieldRow` + `Field w=`.
 *
 * NO HAND-TYPED PIXELS: every width is a step of the vocabulary in
 * `lib/ui/sizes.ts`.
 *
 *   code  144  ID, Category, Department, Designation, Location, Team
 *   name  288  Name, Guardian Name
 *   party 200  Manager
 *   hug    88  Relation
 *
 * THE TWO NAMES STAY AT `name` (288), which is the step this app gives free
 * text and the answer `FieldWidth`'s own test gives: does the schema guarantee a
 * maximum? A person's name does not. Notify's Contact Name — a person's name in
 * a text box, the closest thing in this app to these two — is 288 for exactly
 * this reason. The 144 that Notify, Consignee and Vendor give their NAME field
 * is not the same case and must not be copied here: those are a trading party's
 * short name, narrowed on a client instruction of 2026-09-09 about that box.
 *
 * MANAGER IS `party` (200) BECAUSE IT IS A PICKER TRIGGER, which is the whole of
 * that step's definition — a short proper noun that `term` clips and `name`
 * oversizes, rendered as a trigger rather than as a typing surface. It is the
 * one field here holding a name that nobody types.
 *
 * RELATION IS `hug` (88), THE FLOOR, and it is the label that sets it rather
 * than the value: "S/O" needs ~68px of select including its chevron, while the
 * word "Relation" at Inter 600 12px is what the cell may not go under. `num`
 * (72) would fit the value and wrap the label, which on an `align="start"` row
 * drops the control a line below every other control beside it.
 *
 * DERIVED, so the fold is arithmetic rather than luck. `FIELD_ROW` puts 12px
 * between cells, and the section's own cap (below) is what holds the two lines:
 *
 *   line 1  144 + 144 + 288 + 88 + 288        =  952 + 4 x 12 = 1000
 *   line 2  200 + 144 + 144 + 144 + 144       =  776 + 4 x 12 =  824
 *           + the Inactive switch, edit only  = ~100 + 12      =  936
 *
 * TWO LINES, AND THEY ARE THE TWO QUESTIONS THE SECTION ASKS — who the person is
 * (id, category, name, guardian), then where they work (manager, department,
 * designation, location, team). The twelfths needed four rows to say that and
 * still left the fourth holding one switch across all twelve columns.
 */
const IDENTITY_W = {
  code: "code", //               EMP0142, and room for a legacy id
  category_id: "code", //        STAFF / WORKER
  name: "name", //               a person's name — no schema maximum
  guardian_relation: "hug", //   S/O · D/O · W/O · C/O; the LABEL is the floor
  guardian_name: "name", //      a person's name, as above
  manager_id: "party", //        a name in a picker TRIGGER, never typed
  department_id: "code", //      the four pickers read as one band, so one step
  designation_id: "code",
  location_id: "code",
  team_id: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE DETAILS CARD'S CAP (`erp-form-compact` rule 4) — and here it does a second
 * job: it is what DECIDES the fold above.
 *
 * Narrowing the fields does not narrow the card. `DetailSection` is a block box
 * and goes on filling the pane — content = min(viewport - 192 rail, 1440 cap) -
 * 32 padding, i.e. 1142 on a 1366 laptop and 1408 at 1920 — so without a cap the
 * tightened fields would trail ~140px of empty card on the laptop and ~400px on
 * the desktop, AND the row would fold in a different place on each: at 1408 the
 * Manager picker joins line 1 and the section reads as a different layout on a
 * different desk. A layout that depends on the reader's monitor is not a layout.
 *
 *   1000      line 1, the longest of the two
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 1022  ->  65rem (1040), 18px of slack
 *
 * The slack is deliberately small: at 1040 the cap leaves room for line 1 and
 * NOT for Manager (1000 + 12 + 200 = 1212), so the fold is fixed at every window
 * this app runs in. Widening this constant past ~1230 would silently move it.
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit`. `DetailSection`'s root declares
 * `@container/section` — `container-type: inline-size`, hence inline-axis size
 * containment — so a content-sized cap on it resolves to zero and the card
 * collapses. The Vendor master carries the same note beside its own Category
 * card, and `child-grid.tsx` records two earlier sightings of the same cycle.
 */
const IDENTITY_BOX_W = "max-w-[65rem]";

/**
 * PERSONAL, SHRINK-WRAPPED (`erp-form-compact`) — the second section of this
 * screen to leave the twelfths track, on the same day and for the same reason.
 *
 * Six fields on `cols={12}` is two rows of shares, and the row itself recorded
 * how badly that fits: `spouse_type` was `xs` "S/O · D/O · W/O" and `mobile` was
 * `xs` with the comment "10 digits ≈ 80px, so `xs` is generous already" — an
 * `xs` cell being ~182px in a 1180px sheet and ~282px in this pane. The map knew
 * the values were small and had nothing smaller to say. Narrowing the CONTROL
 * inside a twelfth changes nothing; the cell keeps its share.
 *
 * NO HAND-TYPED PIXELS: every width is a step of `lib/ui/sizes.ts`.
 *
 *   hug   88   Spouse Type — the LABEL is the floor, as Identity's Relation
 *   code 144   Employee Type (Staff / Temporary), Mobile
 *   name 288   Spouse Name, Father Name, Mother Name
 *
 * THE THREE NAMES STAY AT `name` (288) and that is the same ruling Identity
 * made two cards up: a person's name has no maximum the schema guarantees, so
 * `FieldWidth`'s own test gives 288. `spouse_name` was `md` here for a reason
 * that has just evaporated — "it shares a row with three others" is an argument
 * about closing a twelve-column row, and there is no row to close any more.
 *
 * MOBILE IS `code` (144), the step Consignee's converted map already gives a
 * mobile number. Ten digits need ~80px; the extra is the label and the fact that
 * a second opinion on a phone-number width is the drift the vocabulary exists to
 * stop.
 *
 * DERIVED, so the fold is arithmetic rather than luck. `FIELD_ROW` puts 12px
 * between cells:
 *
 *   line 1  144 + 88 + 288 + 144        =  664 + 3 x 12 = 700
 *   line 2  288 + 288                   =  576 + 1 x 12 = 588
 *
 * Two lines, and they are the two things the card says: who the employee is to
 * the payroll (type, spouse, contact), then who their parents are.
 */
const PERSONAL_W = {
  employee_type: "code", //  Staff / Temporary
  spouse_type: "hug", //     S/O · D/O · W/O; the LABEL is the floor
  spouse_name: "name", //    a person's name — no schema maximum
  mobile: "code", //         10 digits, as Consignee's converted map
  father_name: "name", //    a person's name, as above
  mother_name: "name", //
} satisfies Record<string, FieldWidth>;

/**
 * OTHER DETAILS, THE SAME CONVERSION — the card that sits under Personal in the
 * same rail entry, so the two are converted together or the rail entry shows one
 * shrink-wrapped card above one full-width one.
 *
 *   hug   88   Blood Group — "O+VE" is four characters; the label sets the floor
 *   code 144   Nationality, Religion (INDIAN, HINDU)
 *   term 176   Qualification (M.SC (TEXTILES)), Sex (two radios)
 *   name 288   E-Mail, Marital Status (three radios)
 *
 * THE TWO RADIO ROWS ARE SIZED BY THEIR CONTENT, NOT BY THEIR LABEL, and that is
 * the one place here where the vocabulary is answering a different question. A
 * radio row cannot shrink the way text can — the old map said exactly that — so
 * the step has to hold the widest it can be: Single · Married · Divorced is
 * ~248px of radios, gaps and words, which `name` holds and `party` (200) would
 * wrap; Male · Female is ~142px, which `term` holds.
 *
 * E-MAIL IS `name` (288) for `FieldWidth`'s stated test: an address has no
 * maximum. It was `lg` (6 of 12, ~570px in this pane) and is the field this card
 * was leaving the most air around.
 *
 *   line 1  288 + 176 + 88              =  552 + 2 x 12 = 576
 *   line 2  288 + 176 + 144 + 144       =  752 + 3 x 12 = 788
 *
 * THE ORDER IS THE OPERATOR'S, NOT THE ARITHMETIC'S. Nationality and Religion
 * would pack line 1 tighter if they were moved up, and they are not moved: the
 * card has read E-Mail · Qualification · Blood Group / Marital Status · Sex ·
 * Nationality · Religion since it was written, and reordering fields to flatter
 * a wrap is a change the operator notices and the layout does not need.
 */
const OTHER_W = {
  email: "name", //          an address — no schema maximum
  qualification: "term", //  B.E (MECH), M.SC (TEXTILES)
  blood_group: "hug", //     O+VE; the LABEL is the floor
  marital_status: "name", // three radios inline — sized by the radios
  sex: "term", //            two radios inline
  nationality: "code", //    INDIAN
  religion: "code", //       HINDU
} satisfies Record<string, FieldWidth>;

/**
 * ONE CAP FOR BOTH CARDS (`erp-form-compact` rule 4) — and one is what matters
 * here, because the two sit in a `space-y-4` stack under a single rail entry.
 * Capping each to its own longest line would leave two bordered boxes of
 * different widths one above the other, which reads as a mistake rather than as
 * two sections.
 *
 *   788      the longest line of the two cards (Other Details, line 2)
 *   + 2 x 10  `DetailSection`'s `p-2.5`
 *   + 2 x 1   its border
 *   = 810  ->  52rem (832), 22px of slack
 *
 * IT IS ALSO WHAT FIXES BOTH FOLDS, on every monitor rather than on the one this
 * was written on. Content is 810 inside the cap, and each fold is decided by a
 * line that cannot take one more field:
 *
 *   Personal  700 fits; + 12 + 288 (Father Name) = 1000 does not
 *   Other     576 fits; + 12 + 288 (Marital Status) = 876 does not
 *
 * So widening this constant past ~876 would silently pull Marital Status up onto
 * line 1 and change what the card looks like without changing any field. The
 * 22px of slack is deliberately small for that reason, and line 2 of Other
 * Details is what consumes most of it.
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit` — `DetailSection`'s root declares
 * `@container/section`, so a content-sized cap on it resolves to zero and the
 * card collapses. `IDENTITY_BOX_W` above carries the longer version of that note.
 */
const PERSONAL_BOX_W = "max-w-[52rem]";

/**
 * DATES, SHRINK-WRAPPED (`erp-form-compact`; client 2026-09-10, "in date fields
 * compact tighten properly align") — the fourth section of this screen to leave
 * the twelfths track, and the one where the surplus was widest.
 *
 * Five fields on `cols={12}` is `3 + 2 + 3 + 4`, then Filing alone on a second
 * line of four. In this pane a `sm` is ~285px and an `md` ~380px, so a box that
 * renders TEN CHARACTERS and can never render more was given three or four times
 * the room it can use — and the map above admitted as much twice, in writing:
 * "a native `<input type="date">` renders ~9-10 characters" and "the 0279 pair
 * take `md` together: 4 closes the DOB row exactly". The second is the tell. Both
 * dates were sized to make a row of twelfths add up, which is arithmetic about the
 * TRACK rather than a measurement of anything in the box.
 *
 * A DATE'S WIDTH IS THE BROWSER'S, NOT OURS, AND THAT IS WHAT FIXES IT AT `code`.
 * `<input type="date">` renders in the browser's own locale (AGENTS.md, "Dates"),
 * so the page cannot shorten what it draws: Chrome paints `dd/mm/yyyy` — 83.2px
 * of Inter at 14px, 95.1px at the 16px this app keeps on mobile to stop iOS
 * zooming — plus its `::-webkit-calendar-picker-indicator`, about 20px, which
 * this app styles but never hides. Against `Input`'s own `px-2.5` and borders
 * (22px) that is ~125px on the desktop and ~137px on a phone.
 *
 *   code  144   DOB, Joining, Confirmation, Filing. THE FLOOR RATHER THAN A
 *               CHOICE: `range` (112) leaves 90px of content and clips the
 *               picker button off a control whose only affordance it is. 144
 *               clears the desktop by 19px and the mobile text by 7px.
 *   num    72   Age — derived from DOB, `readOnly`, three digits at most. The one
 *               field on this row that is not a date and not the browser's.
 *
 * ALL FOUR DATES TAKE THE SAME STEP, deliberately. They are the same control
 * drawing the same ten characters, so a per-field width here could only come from
 * the LABEL — and none of the four needs it: "Date of Confirmation", the longest
 * label on the row, is 120.7px of Inter 600 at 12px inside 144. That is also why
 * `hug` (88, the label floor) is not on this row: no cell is being squeezed to
 * where its label decides the width.
 *
 * DERIVED, and it is ONE LINE — the fold the twelfths forced is gone:
 *
 *   144 + 72 + 144 + 144 + 144 = 648 + 4 x 12 = 696
 *
 * The old shape put Filing on a line of its own with two thirds of it empty,
 * which read as a field that had been forgotten rather than as the fourth of four
 * dates. Payroll looks all four up together; they now sit together.
 */
const DATES_W = {
  dob: "code", //                   dd/mm/yyyy + Chrome's picker button
  age: "num", //                    derived, readOnly, 3 digits
  doj: "code",
  date_of_confirmation: "code", //  the longest label, 120.7px inside 144
  date_of_filing: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE DATES CARD'S CAP (`erp-form-compact` rule 4) — the same derivation
 * `IDENTITY_BOX_W` and `PERSONAL_BOX_W` above carry, and read either of those for
 * the note on why this is a definite length and never `max-w-fit`
 * (`DetailSection`'s root is `@container/section`, so a content-sized cap on it
 * resolves to zero and the card collapses).
 *
 *   696       the row above
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 718  ->  46rem (736), 18px of slack
 *
 * THERE IS NOTHING FOR THE SLACK TO PULL UP, which is what makes this the one cap
 * on the screen with no ceiling to respect: the row is every field the section
 * has, so no width between 718 and the pane's 1142 changes the layout — it only
 * changes how much empty card trails Filing. The two caps above are pinned from
 * both sides because a sixth field was waiting to climb onto their first line.
 */
const DATES_BOX_W = "max-w-[46rem]";

/**
 * AND THE PHOTO CARD IS CAPPED TO ITS UPLOADER, for the same reason one card up:
 * a 1142px card holding an 80px thumbnail is rule 4's defect at its plainest.
 *
 * `PhotoUpload` is a fixed 80px preview, a `gap-4`, and a column holding two
 * `sm` buttons over the line "JPG, PNG, or WebP. Max 2 MB." — that hint is the
 * widest thing in the column at ~175px of Inter 12px:
 *
 *   80 + 16 + 175 = 271, + 2 x 10 padding + 2 border = 293  ->  20rem (320)
 *
 * THE ONE ESTIMATE ON THIS SCREEN, so it takes the generous end: nothing here
 * folds, and a cap 30px over the content costs a sliver of grey while one 10px
 * under would wrap the hint onto two lines.
 */
const PHOTO_BOX_W = "max-w-[20rem]";

/**
 * STATUTORY IDS, SHRINK-WRAPPED (`erp-form-compact`) — five document numbers on
 * one line, and the same row Vendor ▸ Registration and Consignee ▸ Registration
 * already settled.
 *
 * They were four `sm` cells (3 of 12 each) plus a `lg` PF on a second line, so a
 * TEN-DIGIT ESI number stood in a ~278px box on a 1366 laptop and ~344px at
 * 1920 — three times the width of the value it can hold — and PF opened a second
 * row that left half of itself empty. A share is not a measurement, and a
 * narrower control inside a twelfth leaves the cell at its share.
 *
 * FOUR OF THEM TAKE ONE STEP, AND THAT IS THE POINT. ESI is 10 digits, UAN and
 * Aadhaar 12, PAN exactly 10 characters — at Inter 14px the widest of those is
 * ~98px of glyphs plus the input's own `px-3`, so `code` (144) holds every one
 * and `range` (112) would clip the twelve-digit pair. Giving ESI or PAN the
 * narrower step because their own value is shorter is the ragged edge
 * `REGISTRATION_W` refuses in writing on two other screens: a row of
 * identifiers reads as one band, and 32px of raggedness buys nothing.
 *
 * PF IS THE ODD ONE OUT AND TAKES `name` (288), by the test `FieldWidth` states:
 * does the schema guarantee a maximum? An establishment string like
 * TN/MAS/12345/000/0001234 has region and office segments that vary in length
 * and are re-issued when offices are renamed — the same fact that leaves it
 * unvalidated at the call site. NOT `party` (200), which is close to its typical
 * length but is reserved in `lib/ui/sizes.ts` for a picker TRIGGER and says so:
 * reaching for it to widen a typing surface is "size to the data".
 *
 *   144 + 144 + 144 + 144 + 288  =  864 + 4 x 12 = 912
 *
 * ONE LINE, and it is the same 912 Vendor ▸ Registration derives from the same
 * shape — four identifiers and one free-text field. Two screens reaching the
 * same number from the same steps is the vocabulary working.
 */
const STATUTORY_W = {
  esi_no: "code", //     10 digits
  uan: "code", //        12 digits
  pan_no: "code", //     exactly 10 characters
  aadhar_no: "code", //  12 digits — the four read as one band, so one step
  pf_no: "name", //      a slashed establishment string with no fixed shape
} satisfies Record<string, FieldWidth>;

/**
 * AND THE CARD IS CAPPED TO THAT ROW (`erp-form-compact` rule 4):
 *
 *   912       the row above
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 934  ->  59rem (944), 10px of slack
 *
 * A definite length, never `max-w-fit` — see `IDENTITY_BOX_W` above for why a
 * container-query root cannot be sized from its own content.
 */
const STATUTORY_BOX_W = "max-w-[59rem]";

/**
 * BANK DETAILS, SHRINK-WRAPPED (`erp-form-compact`) — three fields that were a
 * 2 + 6 + 4 split of twelve, so every one of them was sized by its SHARE of the
 * pane rather than by what it holds.
 *
 * What that cost: on a 1366 laptop the pane is 1142px, so "Bank" and "Cash" —
 * the only two values Pay Mode has — sat in a ~190px `<Select>`, and Account No
 * took ~380px for eighteen digits. At 1920 both grew by a third again. A
 * fraction cannot be made compact: narrowing the control inside a twelfth leaves
 * the CELL at its share and the value floating in the hole. So the section
 * leaves the track for `FieldRow` + `Field w=`.
 *
 * NO HAND-TYPED PIXELS. All three land on a step, and two of the three are
 * settled by what the SAME VALUE already takes elsewhere in this app rather than
 * by measuring this screen against its own data:
 *
 *   code  144   Pay Mode — the step Customer's own Pay Mode takes
 *               (`GENERAL_W.pay_mode`), and the field the `erp-form-compact`
 *               band table names there too. `range` (112) would hold both of
 *               this one's words, and taking it would mean the same question is
 *               asked in two widths on two screens — the drift
 *               `lib/ui/sizes.ts` exists to stop, for 32px.
 *   term  176   Account No — the step Our Bank's Details row derives for the
 *               same value, from the measurement in `OUR_BANK_W`: an 18-digit
 *               account is ~151px of Inter 14px and `code` holds about fourteen
 *               digits, so this is a floor rather than a preference.
 *   name  288   Bank Name — free text by the test `FieldWidth` states: does the
 *               schema guarantee a maximum? Both text columns here are
 *               `nullableText` in `employee-types.ts`, and only the account
 *               number has a real-world ceiling to derive one from.
 *
 * BANK NAME IS 288 HERE AND 112 ON OUR BANK, AND THAT IS NOT THE DRIFT THE
 * PARAGRAPH ABOVE REFUSES. Read `OUR_BANK_W`'s own note: that screen states the
 * test still says 288, and narrows anyway because EIGHT fields have to fit a
 * `Sheet` capped at 1180px — at `code` its row is 1206px and does not fit at any
 * gap, so its four unbounded fields take the step below and "STATE BANK OF
 * INDIA" scrolls inside its own box. That narrowing is DERIVED FROM THAT PANE.
 * This card has THREE fields and a `MasterFullScreen` pane, so there is no such
 * arithmetic to obey, and copying the number without the constraint that forced
 * it would be sizing to the data with none of the reason.
 *
 *   144 + 176 + 288  =  608 + 2 x 12 = 632
 *
 * ONE LINE, at every width this app runs in — the pane is 1142 on a 1366 laptop
 * and 1408 at 1920 (`MasterFullScreen`: min(viewport — 192 rail, 1440) — 32),
 * and 632 is inside the narrower of the two nearly twice over.
 */
const BANK_W = {
  pay_mode: "code", //      Bank / Cash, as Customer's own Pay Mode
  bank_acc_no: "term", //   up to 18 digits, as Our Bank's Account No
  bank_name: "name", //     free text: `nullableText`, no schema maximum
} satisfies Record<string, FieldWidth>;

/**
 * AND THE CARD IS CAPPED TO THAT ROW (`erp-form-compact` rule 4). Narrowing the
 * fields does not narrow the card: `DetailSection` is a block box and goes on
 * filling the pane, so without this the 632px of controls sit in the left half
 * of a 1408px box and the surplus reads as a hole — the same complaint one card
 * wider than the one this pass started from.
 *
 *   632       the row above
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 654  ->  42rem (672), 18px of slack
 *
 * ROUNDED UP A WHOLE REM RATHER THAN TO THE 656 THAT JUST FITS. The row has no
 * second line to fold onto, so a cap 2px short would not merely tighten it — it
 * would push Bank Name onto a line of its own, and sub-pixel rounding is not
 * something a layout should be decided by.
 *
 * A definite length, never `max-w-fit` — see `IDENTITY_BOX_W` above for why a
 * container-query root cannot be sized from its own content.
 */
const BANK_BOX_W = "max-w-[42rem]";

/**
 * ADDRESSES, SHRINK-WRAPPED (`erp-form-compact`; client 2026-09-10, "in
 * Addresses field properly align compact tighten") — the LAST section of this
 * screen to leave the twelfths track, and the only one that pays for its shape
 * twice, since Permanent and Correspondence render the same six controls.
 *
 * The deleted `FIELD_SIZE` gave each of the three postal lines `lg`, 6 of 12, so
 * ~571px on a 1366 laptop and ~704px at 1920 — and it gave PIN, Phone and Mobile
 * `xs`, the SMALLEST share that track can express, which is still ~190px for six
 * digits. That is `FieldWidth`'s own founding measurement turning up on this
 * screen: "`xs` is the floor of that scale and still renders ~182px in an 1180px
 * sheet". Narrowing the control inside a twelfth would have changed nothing —
 * the CELL keeps its share and the six digits float in it — so the section
 * leaves the track for `FieldRow` + `Field w=`.
 *
 * NO NEW OPINIONS AND NO HAND-TYPED PIXELS: every step here is the one the
 * Consignee and Vendor address blocks already settled. A third answer for a PIN
 * box is exactly the drift `lib/ui/sizes.ts` exists to stop.
 *
 *   name  288  Address line 1-3. A postal line has no hard maximum, which is the
 *              test `FieldWidth` states, so it takes the step this app gives free
 *              text — the same `name` Consignee's Street takes.
 *   range 112  Pin Code. Six digits, a hard maximum, and the 90-120 band `range`
 *              was added for; Consignee, Customer, Notify and Vendor each state
 *              this same value for this same field.
 *   code  144  Phone and Mobile. A land line prints as 0422-2345678 — ~100px of
 *              Inter at 14px plus the input's own padding and borders — so
 *              `range` would clip it, and the pair reads as one band, so one
 *              step covers both. NOT Consignee's `term` (176) for Mobile: that
 *              step is paid for there by a `ContactChip` sharing the cell, and
 *              these two are bare inputs with nothing beside them.
 *
 * DERIVED, AND THE FOLD IS THE ONE THE RECORD ALREADY MAKES. One `FieldRow`, two
 * lines, and `ADDRESS_BOX_W` below is what fixes where they break:
 *
 *   line 1  288 + 288 + 288 + 112  =  976 + 3 x 12 = 1012   the address itself
 *   line 2  144 + 144              =  288 + 1 x 12 =  300   how to reach it
 *
 * `AddressBlock` — the read-only view at the top of this file — has always
 * grouped them exactly so: the three lines and the PIN inside one `<address>`,
 * then Phone and Mobile on a `<p>` beneath it. The editor now folds where the
 * record itself folds, instead of wherever twelve columns happened to run out.
 *
 * `mobile` rather than the old map's `addr_mobile`. That prefix existed only to
 * keep this key clear of Personal's own Mobile in ONE flat screen-wide map; a
 * per-section map has no such collision to dodge, and `PERSONAL_W.mobile` states
 * the same `code` two cards up.
 */
const ADDRESS_W = {
  addr1: "name", //  a postal line — no schema maximum, as Consignee's Street
  addr2: "name",
  addr3: "name",
  pin: "range", //   6 digits
  phone: "code", //  0422-2345678, wider than `range` holds
  mobile: "code", // 10 digits; the pair reads as one band, so one step
} satisfies Record<string, FieldWidth>;

/**
 * AND BOTH CARDS ARE CAPPED TO THAT ROW (`erp-form-compact` rule 4) — one
 * constant with two readers, the way `PERSONAL_BOX_W` serves two cards, because
 * Permanent and Correspondence are the same six fields and a different width on
 * each would read as two different forms rather than one repeated.
 *
 *   1012      line 1, the longer of the two
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 1034  ->  65rem (1040), 6px of slack
 *
 * IT DECIDES THE FOLD RATHER THAN MERELY TRIMMING THE CARD. Phone joining line 1
 * would need 1012 + 12 + 144 = 1168, so the break holds at every window this app
 * runs in and at any cap up to ~1156 — that is the number to check before
 * widening this constant. Uncapped, the card fills the pane (1142 on a 1366
 * laptop, 1408 at 1920) and Phone sits on line 1 at the desk with the larger
 * monitor and line 2 at the other, which is the fault `IDENTITY_BOX_W` states in
 * one line: a layout that depends on the reader's monitor is not a layout.
 *
 * A definite length, never `max-w-fit` — see `IDENTITY_BOX_W` above for why a
 * container-query root cannot be sized from its own content.
 */
const ADDRESS_BOX_W = "max-w-[65rem]";

/**
 * CRUD for the legacy "Employee" master (Associates). A flat (single-row)
 * record, edited in a `MasterFullScreen` — the left section rail customer,
 * vendor and applicant already use.
 *
 * At 43 fields this is the biggest form in Associates and the one that most
 * needed the rail: it was ONE scroll, and LAYOUT.md §5 puts anything past ~15
 * fields on a rail. Six entries, one shown at a time:
 *
 *   Identity      the old untitled header block (ID · Name · guardian ·
 *                 Category/Department/Location/Designation/Team ⓘ · Manager ⓘ ·
 *                 Inactive) + Photo
 *   Personal      family & contact + the demographic "Other Details"
 *   Dates         DOB + derived Age · joining · confirmation · filing
 *   Statutory IDs ESI · UAN · PAN · Aadhaar · PF
 *   Bank Details  pay mode · bank · account
 *   Addresses     Permanent + Correspondence
 *
 * Six rather than the eight the sections map to one-for-one: Photo is one
 * control and a face is identity, and "Other Details" is personal by any
 * reading — both would have been rail entries the eye has to rule out.
 *
 * Every ⓘ field lists stored data: Category/Department/Designation/Team via the
 * shared LookupDialogPicker (config_lookups, with Add/Modify); Location via the
 * locations master and Manager via the employees master (both select-only).
 */
export function EmployeeMasterScreen({
  rows,
  categories,
  departments,
  designations,
  teams,
  locations,
  perms,
}: {
  rows: Employee[];
  categories: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  teams: ConfigLookup[];
  locations: EmployeeLocation[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  /** The row being READ. Null = the view sheet is closed. */
  const [viewRow, setViewRow] = useState<Employee | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // The ID, NEVER the name. Two workers legitimately share a name, and a live
  // duplicate error HOLDS THE CURSOR (data-dup-error, see the keyboard contract)
  // -- checking `name` here would cage the operator on a perfectly correct value.
  // The employee ID is the identity the payroll and attendance records key on.
  //
  // spell-suggest: exempt -- follows from the same fact. The suggestion strip
  // attaches to whichever field the duplicate check guards, and that field here
  // is an ID: "did you mean EMP0142?" is not a spelling correction, it is a
  // guess at somebody else's employee. The name field, where a chip WOULD make
  // sense, is deliberately unguarded for the reason above.
  const dupError = useDuplicateName({
    table: "employees",
    name: form.code,
    nameColumn: "code",
    label: "employee ID",
    excludeId: editId ?? undefined,
    enabled: !!form.code.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.code,
  });
  const setAddr = (key: AddrKey, value: string) => set({ [key]: value } as Partial<Form>);

  /**
   * The six controls of ONE address block. Permanent and Correspondence were
   * byte-identical markup differing only in a `perm_`/`corr_` key prefix, so a
   * fix to one (these inputs were placeholder-only, with no <Label> at all)
   * had to be made twice or it silently applied to half the screen.
   *
   * It takes the prefix and nothing else: each block's title and its "Same as
   * Permanent" checkbox belong to the `DetailSection` around it, not in here.
   *
   * IT MUST NOT MIRROR VALUES. `corr_same_as_perm` only hides this block —
   * nothing copies `perm_*` into `corr_*` while typing; `submit()` substitutes
   * at save time and the corr_* state stays as the user last left it. Reading
   * `perm_*` here when the box is ticked would look like the same behaviour and
   * would quietly overwrite a correspondence address the moment it was unticked.
   */
  function addressFields(prefix: AddrPrefix) {
    return (
      /* ONE `FieldRow`, laid out by WIDTHS — `ADDRESS_W` at the top of this file
         carries the arithmetic and `ADDRESS_BOX_W` fixes the fold.

         `align="start"`, NOT `FieldRow`'s default `items-end`, and Pin Code is
         why: it and Mobile are `ValidatedInput`s, which draw their error on a
         `<p>` BELOW the control. That is the choice `erp-form-compact` rule 4
         states — `items-end` is for a LABEL that outgrows its narrow box,
         `items-start` for a field that grows DOWNWARDS — and on an `items-end`
         row a mistyped PIN would lift its own label, and only its own, above the
         five beside it. No label on this row wraps: "Address line 1" has 288px
         and "Pin Code" is ~55px of Inter 600 inside 112. */
      <FieldRow align="start">
        <Field label="Address line 1" w={ADDRESS_W.addr1} htmlFor={`emp-${prefix}-addr1`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr1`}
            value={form[`${prefix}_addr1`]}
            onChange={(e) => setAddr(`${prefix}_addr1`, e.target.value)}
          />
        </Field>
        <Field label="Address line 2" w={ADDRESS_W.addr2} htmlFor={`emp-${prefix}-addr2`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr2`}
            value={form[`${prefix}_addr2`]}
            onChange={(e) => setAddr(`${prefix}_addr2`, e.target.value)}
          />
        </Field>
        <Field label="Address line 3" w={ADDRESS_W.addr3} htmlFor={`emp-${prefix}-addr3`}>
          <Input
            uppercase
            id={`emp-${prefix}-addr3`}
            value={form[`${prefix}_addr3`]}
            onChange={(e) => setAddr(`${prefix}_addr3`, e.target.value)}
          />
        </Field>
        <Field label="Pin Code" w={ADDRESS_W.pin} htmlFor={`emp-${prefix}-pin`}>
          <ValidatedInput
            id={`emp-${prefix}-pin`}
            format="pincode"
            value={form[`${prefix}_pin`]}
            onChange={(e) => setAddr(`${prefix}_pin`, e.target.value)}
          />
        </Field>
        <Field label="Phone" w={ADDRESS_W.phone} htmlFor={`emp-${prefix}-phone`}>
          <Input
            uppercase
            id={`emp-${prefix}-phone`}
            value={form[`${prefix}_phone`]}
            onChange={(e) => setAddr(`${prefix}_phone`, e.target.value)}
          />
        </Field>
        <Field label="Mobile" w={ADDRESS_W.mobile} htmlFor={`emp-${prefix}-mobile`}>
          <ValidatedInput
            id={`emp-${prefix}-mobile`}
            format="mobile"
            value={form[`${prefix}_mobile`]}
            onChange={(e) => setAddr(`${prefix}_mobile`, e.target.value)}
          />
        </Field>
      </FieldRow>
    );
  }

  const managerPool: EmployeeRef[] = useMemo(
    () => rows.map((r) => ({ id: r.id, code: r.code, name: r.name, inactive: r.inactive })),
    [rows],
  );
  const deptLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of departments) m.set(d.id, d.name);
    return m;
  }, [departments]);
  const desigLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of designations) m.set(d.id, d.name);
    return m;
  }, [designations]);
  // The four the list columns never needed, built for the read-only view from
  // the props this screen is already given — a uuid must never reach the page.
  const catLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const teamLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    return m;
  }, [teams]);
  const locLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name);
    return m;
  }, [locations]);
  /** Managers resolve out of the employee list itself — same pool the picker uses. */
  const empLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of rows) m.set(e.id, e.name);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    // Baseline for `dirty` — see the note beside the `pristine` state below.
    setPristine(JSON.stringify(BLANK));
    setOpen(true);
  }
  function openEdit(r: Employee) {
    setEditId(r.id);
    const nextForm: Form = {
      code: r.code ?? "",
      name: r.name,
      guardian_relation: r.guardian_relation ?? "S/O",
      guardian_name: r.guardian_name ?? "",
      category_id: r.category_id ?? "",
      department_id: r.department_id ?? "",
      location_id: r.location_id ?? "",
      designation_id: r.designation_id ?? "",
      team_id: r.team_id ?? "",
      manager_id: r.manager_id ?? "",
      dob: r.dob ?? "",
      inactive: r.inactive,
      photo_url: r.photo_url ?? null,
      perm_addr1: r.perm_addr1 ?? "",
      perm_addr2: r.perm_addr2 ?? "",
      perm_addr3: r.perm_addr3 ?? "",
      perm_pin: r.perm_pin ?? "",
      perm_phone: r.perm_phone ?? "",
      perm_mobile: r.perm_mobile ?? "",
      corr_same_as_perm: r.corr_same_as_perm,
      corr_addr1: r.corr_addr1 ?? "",
      corr_addr2: r.corr_addr2 ?? "",
      corr_addr3: r.corr_addr3 ?? "",
      corr_pin: r.corr_pin ?? "",
      corr_phone: r.corr_phone ?? "",
      corr_mobile: r.corr_mobile ?? "",
      email: r.email ?? "",
      qualification: r.qualification ?? "",
      blood_group: r.blood_group ?? "",
      marital_status: r.marital_status ?? "Single",
      sex: r.sex ?? "Male",
      nationality: r.nationality ?? "",
      religion: r.religion ?? "",
      doj: r.doj ?? "",
      emp_type: r.emp_type ?? "",
      mobile: r.mobile ?? "",
      father_name: r.father_name ?? "",
      mother_name: r.mother_name ?? "",
      spouse_name: r.spouse_name ?? "",
      pf_no: r.pf_no ?? "",
      esi_no: r.esi_no ?? "",
      uan: r.uan ?? "",
      pan_no: r.pan_no ?? "",
      aadhar_no: r.aadhar_no ?? "",
      pay_mode: r.pay_mode ?? "Bank",
      bank_name: r.bank_name ?? "",
      bank_acc_no: r.bank_acc_no ?? "",
      spouse_type: r.spouse_type ?? "",
      date_of_confirmation: r.date_of_confirmation ?? "",
      date_of_filing: r.date_of_filing ?? "",
      employee_type: r.employee_type ?? "S",
    };
    setForm(nextForm);
    setPristine(JSON.stringify(nextForm));
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const sameCorr = form.corr_same_as_perm;
      const payload: EmployeeInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        guardian_relation: (form.guardian_relation as EmployeeInput["guardian_relation"]) || null,
        guardian_name: form.guardian_name.trim() || null,
        category_id: form.category_id || null,
        department_id: form.department_id || null,
        location_id: form.location_id || null,
        designation_id: form.designation_id || null,
        team_id: form.team_id || null,
        manager_id: form.manager_id || null,
        dob: form.dob || null,
        inactive: form.inactive,
        photo_url: form.photo_url,
        perm_addr1: form.perm_addr1.trim() || null,
        perm_addr2: form.perm_addr2.trim() || null,
        perm_addr3: form.perm_addr3.trim() || null,
        perm_pin: form.perm_pin.trim() || null,
        perm_phone: form.perm_phone.trim() || null,
        perm_mobile: form.perm_mobile.trim() || null,
        corr_same_as_perm: sameCorr,
        corr_addr1: (sameCorr ? form.perm_addr1 : form.corr_addr1).trim() || null,
        corr_addr2: (sameCorr ? form.perm_addr2 : form.corr_addr2).trim() || null,
        corr_addr3: (sameCorr ? form.perm_addr3 : form.corr_addr3).trim() || null,
        corr_pin: (sameCorr ? form.perm_pin : form.corr_pin).trim() || null,
        corr_phone: (sameCorr ? form.perm_phone : form.corr_phone).trim() || null,
        corr_mobile: (sameCorr ? form.perm_mobile : form.corr_mobile).trim() || null,
        email: form.email.trim() || null,
        qualification: form.qualification.trim() || null,
        blood_group: form.blood_group.trim() || null,
        marital_status: (form.marital_status as EmployeeInput["marital_status"]) || null,
        sex: (form.sex as EmployeeInput["sex"]) || null,
        nationality: form.nationality.trim() || null,
        religion: form.religion.trim() || null,
        doj: form.doj || null,
        emp_type: form.emp_type.trim() || null,
        mobile: form.mobile.trim() || null,
        father_name: form.father_name.trim() || null,
        mother_name: form.mother_name.trim() || null,
        spouse_name: form.spouse_name.trim() || null,
        pf_no: form.pf_no.trim() || null,
        esi_no: form.esi_no.trim() || null,
        uan: form.uan.trim() || null,
        pan_no: form.pan_no.trim() || null,
        aadhar_no: form.aadhar_no.trim() || null,
        pay_mode: (form.pay_mode as EmployeeInput["pay_mode"]) || null,
        bank_name: form.bank_name.trim() || null,
        bank_acc_no: form.bank_acc_no.trim() || null,
        spouse_type: (form.spouse_type as EmployeeInput["spouse_type"]) || null,
        date_of_confirmation: form.date_of_confirmation || null,
        date_of_filing: form.date_of_filing || null,
        employee_type: (form.employee_type as EmployeeInput["employee_type"]) || "S",
        is_draft: asDraft,
      };
      const res = editId ? await updateEmployee(editId, payload) : await createEmployee(payload);
      if (res.ok) {
        success(editId ? "Employee updated." : "Employee added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Employee) {
    startTransition(async () => {
      const res = await deleteEmployee(r.id);
      if (res.ok) {
        success(deletedToast("Employee", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /**
   * The record as a reader wants it, for `RecordViewSheet`. The six sections
   * are the six rail entries of the editor above, in the same order and under
   * the same names, so the view and the form tell the same story about where a
   * field lives.
   *
   * Nothing is fetched: `rows` already carries all 43 columns — the list only
   * ever showed 6 of them. Empty values and all-empty sections are dropped by
   * the sheet, so a record is never a wall of "—"; that is also why `fmtDate`
   * is guarded rather than called on a null (it returns "—", which the sheet
   * would read as a value worth printing).
   */
  function viewSections(r: Employee): ViewSection[] {
    const age = ageFromDob(r.dob ?? "");
    const guardian = [r.guardian_relation, r.guardian_name].filter(Boolean).join(" ").trim();
    const spouse = [r.spouse_type, r.spouse_name].filter(Boolean).join(" ").trim();
    const empType = r.employee_type
      ? (EMPLOYEE_TYPE_LABELS[r.employee_type as keyof typeof EMPLOYEE_TYPE_LABELS] ?? r.employee_type)
      : null;

    const perm = (
      <AddressBlock
        title="Permanent"
        lines={[r.perm_addr1, r.perm_addr2, r.perm_addr3]}
        pin={r.perm_pin}
        phone={r.perm_phone}
        mobile={r.perm_mobile}
      />
    );
    // "Same as permanent" is worth saying out loud — a blank block would read
    // as "we never asked", which is the opposite of what the tick means.
    const corr = r.corr_same_as_perm ? (
      <p className="text-sm text-muted-foreground">Correspondence address is the same as permanent.</p>
    ) : (
      <AddressBlock
        title="Correspondence"
        lines={[r.corr_addr1, r.corr_addr2, r.corr_addr3]}
        pin={r.corr_pin}
        phone={r.corr_phone}
        mobile={r.corr_mobile}
      />
    );
    const hasPerm = !!(
      r.perm_addr1 ||
      r.perm_addr2 ||
      r.perm_addr3 ||
      r.perm_pin ||
      r.perm_phone ||
      r.perm_mobile
    );
    const hasCorr =
      r.corr_same_as_perm ||
      !!(r.corr_addr1 || r.corr_addr2 || r.corr_addr3 || r.corr_pin || r.corr_phone || r.corr_mobile);

    return [
      {
        label: "Identity",
        pairs: [
          ["Employee ID", r.code],
          ["Category", r.category_id ? catLabel.get(r.category_id) : null],
          ["Guardian", guardian],
          ["Manager", r.manager_id ? empLabel.get(r.manager_id) : null],
          ["Department", r.department_id ? deptLabel.get(r.department_id) : null],
          ["Designation", r.designation_id ? desigLabel.get(r.designation_id) : null],
          ["Location", r.location_id ? locLabel.get(r.location_id) : null],
          ["Team", r.team_id ? teamLabel.get(r.team_id) : null],
        ],
        // Only when there is one — passing `content` unconditionally would keep
        // this section on screen for a record with nothing in it.
        content: r.photo_url ? (
          <div className="mt-3 h-24 w-24 overflow-hidden rounded-lg border border-border bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase
                storage public URL, same as the editor's PhotoUpload preview. */}
            <img src={r.photo_url} alt={`Photo of ${r.name}`} className="h-full w-full object-cover" />
          </div>
        ) : undefined,
      },
      {
        label: "Personal",
        pairs: [
          ["Employee Type", empType],
          ["Spouse", spouse],
          ["Mobile", r.mobile],
          ["Father Name", r.father_name],
          ["Mother Name", r.mother_name],
          ["E-Mail", r.email],
          ["Qualification", r.qualification],
          ["Blood Group", r.blood_group],
          ["Marital Status", r.marital_status],
          ["Sex", r.sex],
          ["Nationality", r.nationality],
          ["Religion", r.religion],
        ],
      },
      {
        label: "Dates",
        pairs: [
          // Age beside the date it comes from, the way the editor shows it —
          // on its own row it would look like a stored field.
          ["Date of Birth", r.dob ? `${fmtDate(r.dob)}${age != null ? ` · ${age} yrs` : ""}` : null],
          ["Date of Joining", r.doj ? fmtDate(r.doj) : null],
          ["Date of Confirmation", r.date_of_confirmation ? fmtDate(r.date_of_confirmation) : null],
          ["Date of Filing", r.date_of_filing ? fmtDate(r.date_of_filing) : null],
        ],
      },
      {
        label: "Statutory IDs",
        pairs: [
          ["ESI No", r.esi_no],
          ["UAN", r.uan],
          ["PAN No", r.pan_no],
          ["Aadhar No", r.aadhar_no],
          ["PF No", r.pf_no],
        ],
      },
      {
        label: "Bank Details",
        pairs: [
          ["Pay Mode", r.pay_mode],
          ["Bank Name", r.bank_name],
          ["Account No", r.bank_acc_no],
        ],
      },
      {
        label: "Addresses",
        content:
          hasPerm || hasCorr ? (
            <div className="space-y-3">
              {hasPerm && perm}
              {hasCorr && corr}
            </div>
          ) : undefined,
      },
    ];
  }

  const columns: Column<Employee>[] = [
    { header: "ID", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Designation",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.designation_id ? (desigLabel.get(r.designation_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Department",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.department_id ? (deptLabel.get(r.department_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.inactive ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active";
        return <StatusPill tone={tone}>{text}</StatusPill>;
      },
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  const age = ageFromDob(form.dob);

  // Aadhaar's 12th digit is a Verhoeff check digit over the other 11 — it catches
  // a mistyped or transposed digit that the 12-digit shape rule never will. Held
  // back until the shape itself is valid so it can't nag mid-typing, and shown as
  // an advisory rather than an error (see the field below for why).
  const aadhaarCheckFails = useMemo(() => {
    const v = form.aadhar_no.trim();
    return AADHAAR_RE.test(v) && !isAadhaarChecksumValid(v);
  }, [form.aadhar_no]);

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed employee — 43 fields,
   * the longest form in Associates — would take it silently.
   *
   * Whole-object compare against the record as loaded, the shape applicant and
   * company-profile use: `set` spreads, so key order is stable and the two
   * strings differ only when a value does. Cheaper than threading a
   * `setDirty(true)` through every one of this form's handlers, and it cannot be
   * forgotten on a new one.
   *
   * `useState`, NOT a ref: the baseline changes on an EVENT (opening the
   * editor), and a value read during render has to be state or React never
   * knows to re-render — the `● Unsaved` badge would go stale.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: with the editor CLOSED, `pristine` is still "" while the
  // blank form stringifies to a real object, so this would read dirty forever
  // and arm the reload guard on a list page with nothing to lose — permanently
  // blocking the silent PWA auto-update (found on consignee, 2026-07-29).
  const dirty = open && JSON.stringify(form) !== pristine;
  useUnsavedGuard(dirty || isPending);

  // NAME first, unlike applicant/customer where `code` is a short name. An
  // employee's code is a sequential ID (EMP0142), so taking it would print the
  // same "EM" block on every record in the master — the one thing an avatar
  // must not do. Code stays as the fallback for a record saved without a name.
  const initials = (form.name || form.code || "?").slice(0, 2).toUpperCase();

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form. Fields that
  // BLANK gives a value (employee_type, marital_status, sex, pay_mode) are left
  // out: they are true from the moment the form opens, so counting them would
  // light a dot that never means anything.
  const done = {
    identity: !!(
      form.name.trim() ||
      form.code.trim() ||
      form.category_id ||
      form.department_id ||
      form.designation_id ||
      form.location_id ||
      form.team_id ||
      form.manager_id ||
      form.guardian_name.trim() ||
      form.photo_url
    ),
    personal: !!(
      form.spouse_type ||
      form.spouse_name.trim() ||
      form.mobile.trim() ||
      form.father_name.trim() ||
      form.mother_name.trim() ||
      form.email.trim() ||
      form.qualification.trim() ||
      form.blood_group.trim() ||
      form.nationality.trim() ||
      form.religion.trim()
    ),
    dates: !!(form.dob || form.doj || form.date_of_confirmation || form.date_of_filing),
    statutory: !!(
      form.esi_no.trim() ||
      form.uan.trim() ||
      form.pan_no.trim() ||
      form.aadhar_no.trim() ||
      form.pf_no.trim()
    ),
    bank: !!(form.bank_name.trim() || form.bank_acc_no.trim()),
    addresses: !!(
      form.perm_addr1.trim() ||
      form.perm_addr2.trim() ||
      form.perm_addr3.trim() ||
      form.perm_pin.trim() ||
      form.perm_phone.trim() ||
      form.perm_mobile.trim() ||
      form.corr_same_as_perm ||
      form.corr_addr1.trim() ||
      form.corr_addr2.trim() ||
      form.corr_addr3.trim() ||
      form.corr_pin.trim() ||
      form.corr_phone.trim() ||
      form.corr_mobile.trim()
    ),
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Employee
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No employees yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No employees yet.
          </div>
        ) : (
          filtered.map((r) => (
            // Tapping a card OPENS THE VIEW, not the editor. A phone has no room
            // for a row of actions beside the name, and a nested <button> inside
            // this one is invalid markup — so the card carries the read, and Edit
            // is one tap further on in the view's footer (gated on `canEdit`
            // there). It also un-breaks the card for a read-only user, for whom
            // this handler previously did nothing at all.
            <button
              key={r.id}
              type="button"
              onClick={() => setViewRow(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.designation_id ? ` · ${desigLabel.get(r.designation_id) ?? ""}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "employee"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled employee",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </>
          ),
          // Employee ID first — it is what a payroll clerk searches by and the
          // only value on the record that is unique to the eye. Then where they
          // sit: designation, then department.
          meta: (
            <>
              <span>
                {form.code ? (
                  <span className="font-mono font-semibold text-foreground">{form.code}</span>
                ) : (
                  "No employee ID"
                )}
              </span>
              {form.designation_id && desigLabel.get(form.designation_id) && (
                <span>· {desigLabel.get(form.designation_id)}</span>
              )}
              {form.department_id && deptLabel.get(form.department_id) && (
                <span>· {deptLabel.get(form.department_id)}</span>
              )}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save employee",
          canSave: !!form.name.trim() && !dupError,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          draftLabel: "Save as Draft",
          isPending,
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
              <SectionBody title="Identity">
                {/* The untitled header block of the old single-scroll form. It
                    was a bare `FieldGrid` — the 12-col track minus the chrome —
                    because it carried the record's identity and a titled card
                    around it would have been noise above the sections. Under the
                    rail the block IS a section, so it takes a `DetailSection
                    cols={12}`: same track (both render `FIELD_TRACK`), so no
                    field moves, and it now sits beside Photo as a peer rather
                    than floating above it.
                    Photo joins it here rather than taking a seventh rail entry
                    of its own for ONE control — a face is identity. The
                    `space-y-4` is the gap the old single-scroll form put between
                    every section; without it two bordered cards meet flush. */}
                <div className="space-y-4">
                {/* ONE `FieldRow`, laid out by WIDTHS — `IDENTITY_W` at the top
                    of this file carries the arithmetic, and `IDENTITY_BOX_W` is
                    what fixes the fold at the same place on every monitor.
                    `cols={1}`: the row below is the only row this card has to
                    stack, and it is not on the twelfths track any more.

                    `align="start"`, not `FieldRow`'s default `items-end`: ID
                    renders a `DuplicateError` BELOW its control, and bottom
                    alignment measures from the bottom of that — so the first
                    colliding employee number would lift the ID box clear of the
                    four beside it while the operator is still in the row. The
                    opposite hazard (a label too wide for its cell, wrapping to
                    two lines) is what `hug` (88px) exists to rule out; every
                    label here fits its box on one line. */}
                <DetailSection label="Details" cols={1} className={IDENTITY_BOX_W}>
                  <FieldRow align="start">
                    <Field label="ID" w={IDENTITY_W.code} htmlFor="emp-code">
                      <Input
                        uppercase
                        id="emp-code"
                        value={form.code}
                        onChange={(e) => set({ code: e.target.value })}
                        {...dupFieldProps(dupError, "emp-code")}
                      />
                      <DuplicateError error={dupError} id="emp-code" />
                    </Field>
                    {/* The label is `Field`'s, so it lines up with the inputs beside it;
                        `compact` stops the picker rendering a second one of its own.
                        The perms are the host screen's, exactly as Team below already
                        passed them — without them the picker renders as a plain
                        dropdown and Category is the one code list on this form that
                        cannot be extended from the form that needs it. */}
                    <Field label="Category" w={IDENTITY_W.category_id}>
                      <LookupDialogPicker
                        kind="employee_category"
                        label="Category"
                        options={categories}
                        value={form.category_id || null}
                        onChange={(id) => set({ category_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Name" required w={IDENTITY_W.name} htmlFor="emp-name">
                      <Input
                        id="emp-name"
                        uppercase
                        value={form.name}
                        onChange={(e) => set({ name: e.target.value })}
                        required
                      />
                    </Field>

                    {/* Guardian (S/O …) — was a hard-coded `grid-cols-[7rem_1fr]`, a
                        third width system fighting the track. `xs` is the same idea
                        expressed in the one the rest of the screen uses. */}
                    <Field label="Relation" w={IDENTITY_W.guardian_relation} htmlFor="emp-grel">
                      <Select
                        id="emp-grel"
                        value={form.guardian_relation}
                        onChange={(e) => set({ guardian_relation: e.target.value })}
                      >
                        {GUARDIAN_RELATIONS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Guardian Name" w={IDENTITY_W.guardian_name} htmlFor="emp-gname">
                      <Input
                        id="emp-gname"
                        uppercase
                        value={form.guardian_name}
                        onChange={(e) => set({ guardian_name: e.target.value })}
                      />
                    </Field>
                    <Field label="Manager" w={IDENTITY_W.manager_id}>
                      <EmployeePicker
                        employees={managerPool}
                        value={form.manager_id || null}
                        onChange={(id) => set({ manager_id: id ?? "" })}
                        excludeId={editId}
                        compact
                      />
                    </Field>

                    <Field label="Department" w={IDENTITY_W.department_id}>
                      <LookupDialogPicker
                        kind="department"
                        label="Department"
                        options={departments}
                        value={form.department_id || null}
                        onChange={(id) => set({ department_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Designation" w={IDENTITY_W.designation_id}>
                      <LookupDialogPicker
                        kind="designation"
                        label="Designation"
                        options={designations}
                        value={form.designation_id || null}
                        onChange={(id) => set({ designation_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Location" w={IDENTITY_W.location_id}>
                      <LocationPicker
                        locations={locations}
                        value={form.location_id || null}
                        onChange={(id) => set({ location_id: id ?? "" })}
                        compact
                      />
                    </Field>
                    <Field label="Team" w={IDENTITY_W.team_id}>
                      <LookupDialogPicker
                        kind="team"
                        label="Team"
                        options={teams}
                        value={form.team_id || null}
                        onChange={(id) => set({ team_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>

                    {/* `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch Order
                        Entry uses) — the identical swap Country, Destination and Notify
                        made, and from the SAME component, so no two masters can drift
                        apart. It is still a real `<input type="checkbox">` underneath
                        (`components/ui/toggle.tsx` says why at length), so `isFieldLike()`
                        still counts it and Tab, Enter-advance and the arrows all reach it.

                        `label=""` RESERVES the label row rather than drawing one: a cell
                        with no label at all collapses it and lifts the switch ~16px above
                        the labelled fields beside it. The switch renders its own word, so
                        a `label="Inactive"` here would draw the name twice. */}
                    {editId && (
                      /* NO `w`, and no `size="full"` either: that prop is a col-span,
                         which is inert in a flex row — it would have packed the switch
                         inline anyway, but reading as though it claimed a line. An
                         unsized `Field` in a flex row is exactly as wide as what is in
                         it, and a switch is not one of the widths. */
                      <Field label="">
                        <Toggle
                          id="emp-inactive"
                          label="Inactive"
                          checked={form.inactive}
                          onChange={(inactive) => set({ inactive })}
                        />
                      </Field>
                    )}
                  </FieldRow>
                </DetailSection>

                {/* Capped to its uploader, not to the pane — `PHOTO_BOX_W`
                    above derives it. */}
                <DetailSection label="Photo" className={PHOTO_BOX_W}>
                  <PhotoUpload
                    value={form.photo_url}
                    onChange={(url) => set({ photo_url: url })}
                    disabled={!perms.canEdit}
                  />
                </DetailSection>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "personal",
            label: "Personal",
            icon: Users,
            done: done.personal,
            content: (
              <SectionBody title="Personal">
                {/* Two cards, so the `space-y-4` the old single-scroll form put
                    between every section is kept here rather than letting two
                    bordered cards meet flush. "Other Details" joins Personal
                    instead of taking a rail entry of its own: blood group,
                    religion, nationality and marital status ARE personal, and a
                    rail reading "Personal · Other Details" would make anyone
                    open both to find out which held what. */}
                <div className="space-y-4">
          {/* ONE `FieldRow`, laid out by WIDTHS — `PERSONAL_W` at the top of
              this file carries the arithmetic and `PERSONAL_BOX_W` fixes the
              fold at the same place on every monitor. `cols={1}`: the row is the
              only child this card stacks, and it is not on the twelfths track
              any more.

              `align="start"`, not the default `items-end`: Mobile is a
              `ValidatedInput`, which renders its message BELOW the control, and
              bottom alignment measures from the bottom of that — so a half-typed
              number would lift the Mobile box clear of the three beside it while
              the operator is still in the row. The opposite hazard, a label too
              wide for its cell, is what `hug` (88px) rules out: every label here
              fits its box on one line. */}
          <DetailSection label="Personal" cols={1} className={PERSONAL_BOX_W}>
            <FieldRow align="start">
              <Field label="Employee Type" w={PERSONAL_W.employee_type} htmlFor="emp-employee-type">
                <Select
                  id="emp-employee-type"
                  value={form.employee_type}
                  onChange={(e) => set({ employee_type: e.target.value })}
                >
                  {EMPLOYEE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYEE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Spouse Type" w={PERSONAL_W.spouse_type} htmlFor="emp-spouse-type">
                <Select
                  id="emp-spouse-type"
                  value={form.spouse_type}
                  onChange={(e) => set({ spouse_type: e.target.value })}
                >
                  <option value=""></option>
                  {SPOUSE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Spouse Name" w={PERSONAL_W.spouse_name} htmlFor="emp-spouse-name">
                <Input
                  id="emp-spouse-name"
                  uppercase
                  value={form.spouse_name}
                  onChange={(e) => set({ spouse_name: e.target.value })}
                />
              </Field>
              <Field label="Mobile" w={PERSONAL_W.mobile} htmlFor="emp-mobile">
                <ValidatedInput
                  id="emp-mobile"
                  format="mobile"
                  value={form.mobile}
                  onChange={(e) => set({ mobile: e.target.value })}
                />
              </Field>
              <Field label="Father Name" w={PERSONAL_W.father_name} htmlFor="emp-father">
                <Input
                  id="emp-father"
                  uppercase
                  value={form.father_name}
                  onChange={(e) => set({ father_name: e.target.value })}
                />
              </Field>
              <Field label="Mother Name" w={PERSONAL_W.mother_name} htmlFor="emp-mother">
                <Input
                  id="emp-mother"
                  uppercase
                  value={form.mother_name}
                  onChange={(e) => set({ mother_name: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>

          {/* "Other Details", not "Personal Details" — the section above already
              owns "Personal", and two near-identical titles on one form is worse
              than a plain one. Moved up from the foot of the old scroll to sit
              under the same rail entry as the section it belongs with. */}
          <DetailSection label="Other Details" cols={1} className={PERSONAL_BOX_W}>
            {/* `align="start"` for the same reason as the card above — E-Mail is
                the `ValidatedInput` here. See `OTHER_W` for the widths and
                `PERSONAL_BOX_W` for why both cards share one cap. */}
            <FieldRow align="start">
              <Field label="E-Mail" w={OTHER_W.email} htmlFor="emp-email">
                <ValidatedInput
                  id="emp-email"
                  format="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
              <Field label="Qualification" w={OTHER_W.qualification} htmlFor="emp-qual">
                <Input
                  uppercase
                  id="emp-qual"
                  value={form.qualification}
                  onChange={(e) => set({ qualification: e.target.value })}
                />
              </Field>
              <Field label="Blood Group" w={OTHER_W.blood_group} htmlFor="emp-blood">
                <Input
                  uppercase
                  id="emp-blood"
                  value={form.blood_group}
                  onChange={(e) => set({ blood_group: e.target.value })}
                />
              </Field>

              {/* BOTH RADIO ROWS CARRY `Input`'S OWN HEIGHT PAIR, `min-h-9
                  @2xl/editor:min-h-8`, so they centre on the same control height as
                  the boxes beside them at BOTH densities. It read `min-h-9` alone
                  and the comment said "the same 36px control height as the inputs"
                  — which stopped being true inside an editor: `Input` is `h-9
                  @2xl/editor:h-8`, and `MasterFullScreen` declares that container,
                  so every box on this card is 32px and these two rows stood 4px
                  taller. Invisible under `items-end`, which measured from the
                  bottom; visible the moment the row went `align="start"` for the
                  ValidatedInput above. */}
              <Field label="Marital Status" w={OTHER_W.marital_status}>
                <div className="flex min-h-9 flex-wrap items-center gap-4 @2xl/editor:min-h-8">
                  {MARITAL_STATUSES.map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="emp-marital"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.marital_status === m}
                        onChange={() => set({ marital_status: m })}
                      />
                      <span className="text-sm text-foreground">{m}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Sex" w={OTHER_W.sex}>
                <div className="flex min-h-9 flex-wrap items-center gap-4 @2xl/editor:min-h-8">
                  {SEXES.map((sx) => (
                    <label key={sx} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="radio"
                        name="emp-sex"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.sex === sx}
                        onChange={() => set({ sex: sx })}
                      />
                      <span className="text-sm text-foreground">{sx}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Nationality" w={OTHER_W.nationality} htmlFor="emp-nat">
                <Input
                  uppercase
                  id="emp-nat"
                  value={form.nationality}
                  onChange={(e) => set({ nationality: e.target.value })}
                />
              </Field>
              <Field label="Religion" w={OTHER_W.religion} htmlFor="emp-rel">
                <Input
                  uppercase
                  id="emp-rel"
                  value={form.religion}
                  onChange={(e) => set({ religion: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "dates",
            label: "Dates",
            icon: Calendar,
            done: done.dates,
            content: (
              <SectionBody title="Dates">
          {/* ---- Dates ----
              DOB and its derived Age moved here out of the header block: this
              section is where someone looking for a date looks, and the header
              was pairing DOB with Manager for no reason but to fill a row.
              It keeps a rail entry of its own rather than folding into Personal:
              only DOB is personal — joining, confirmation and filing are
              employment dates, and payroll looks all four up together. */}
          {/* `cols={1}`: the fields are NOT on the twelfths track any more, so the
              section has one child — the `FieldRow` below, which packs them by
              WIDTH. `DATES_BOX_W` caps the card to that row (rule 4), or the card
              goes on filling the pane and trails ~440px of empty border past
              Filing. */}
          <DetailSection label="Dates" cols={1} className={DATES_BOX_W}>
            {/* `items-end`, `FieldRow`'s default, and this row is the case that
                default is FOR: not one of the five renders a hint or an error
                below its control — four are native date boxes and Age is
                `readOnly` — so there is no bottom edge to be pushed down, and no
                reason to reach for `align="start"`. Nothing wraps its label
                either, so the two alignments would in fact draw the same row
                today; `items-end` is the one that stays correct if a label or a
                validation message is ever added. */}
            <FieldRow>
            <Field label="DOB" w={DATES_W.dob} htmlFor="emp-dob">
              <Input
                id="emp-dob"
                type="date"
                value={form.dob}
                onChange={(e) => set({ dob: e.target.value })}
              />
            </Field>
            {/* Derived from DOB, so Tab skips it — via `skipTab`, which clones a
                real tabIndex onto the control, NOT a hand-written one here (the
                prop only applies when the child has none, so writing both would
                work by accident and defeat the point). LAYOUT.md §8. */}
            <Field label="Age" w={DATES_W.age} htmlFor="emp-age" skipTab>
              <Input id="emp-age" value={age ?? ""} readOnly />
            </Field>
            <Field label="Date of Joining" w={DATES_W.doj} htmlFor="emp-doj">
              <Input
                id="emp-doj"
                type="date"
                value={form.doj}
                onChange={(e) => set({ doj: e.target.value })}
              />
            </Field>
            <Field label="Date of Confirmation" w={DATES_W.date_of_confirmation} htmlFor="emp-doc">
              <Input
                id="emp-doc"
                type="date"
                value={form.date_of_confirmation}
                onChange={(e) => set({ date_of_confirmation: e.target.value })}
              />
            </Field>
            <Field label="Date of Filing" w={DATES_W.date_of_filing} htmlFor="emp-dof">
              <Input
                id="emp-dof"
                type="date"
                value={form.date_of_filing}
                onChange={(e) => set({ date_of_filing: e.target.value })}
              />
            </Field>
            </FieldRow>
          </DetailSection>

              </SectionBody>
            ),
          },
          {
            key: "statutory",
            label: "Statutory IDs",
            icon: IdCard,
            done: done.statutory,
            content: (
              <SectionBody title="Statutory IDs">
          {/* ---- Statutory IDs ----
              ESI(10) + UAN(12) + PAN(10) + Aadhaar(12) are four fixed-length
              document numbers and PF is the one free-form value, so they are
              four `code` cells and a `name` — ONE line, laid out by width.
              `STATUTORY_W` and `STATUTORY_BOX_W` at the top of this file carry
              the arithmetic. PF is still listed last, out of its legacy position
              at the top: leading with the long value used to leave six empty
              twelfths beside it before the row that mattered, and off the track
              it would still put the widest box first and step down.

              `align="start"`, NOT `FieldRow`'s default `items-end`, and this row
              is the clearest case for it on the screen: four of the five are
              `ValidatedInput`s, which render their format message BELOW the
              control, and Aadhaar carries a check-digit advisory under it as
              well. Bottom alignment measures from the bottom of whatever is
              there — so the first half-typed UAN would lift its box clear of the
              four beside it, WHILE the operator is still in the row, and the
              amber Aadhaar note would do it again on a value that saves. Top
              alignment leaves every control on one line and lets the messages
              hang below where they belong.

              `cols={1}` because the `FieldRow` is the only row this card has to
              stack; the twelfths are gone. */}
          <DetailSection label="Statutory IDs" cols={1} className={STATUTORY_BOX_W}>
            <FieldRow align="start">
              {/* "esi_ip", NOT "esi" — the two are easy to swap and only one is
                  right here. `esi` is the 17-digit ESIC EMPLOYER code (the
                  factory's); what an employee carries is the 10-digit Insurance
                  (IP) number off their Pehchan card. */}
              <Field label="ESI No" w={STATUTORY_W.esi_no} htmlFor="emp-esi">
                <ValidatedInput
                  id="emp-esi"
                  format="esi_ip"
                  value={form.esi_no}
                  onChange={(e) => set({ esi_no: e.target.value })}
                />
              </Field>
              <Field label="UAN" w={STATUTORY_W.uan} htmlFor="emp-uan">
                <ValidatedInput
                  id="emp-uan"
                  format="uan"
                  value={form.uan}
                  onChange={(e) => set({ uan: e.target.value })}
                />
              </Field>
              <Field label="PAN No" w={STATUTORY_W.pan_no} htmlFor="emp-pan">
                <ValidatedInput
                  id="emp-pan"
                  format="pan"
                  value={form.pan_no}
                  onChange={(e) => set({ pan_no: e.target.value })}
                />
              </Field>
              {/* The advisory is a fragment child of this Field, not a cell of its
                  own — a sibling would pack inline as a SIXTH cell of the row and
                  stand beside Aadhaar rather than under it. (On the old twelfths
                  track the same mistake read differently: it claimed its own
                  twelfth and pushed the row past 12.) */}
              <Field label="Aadhar No" w={STATUTORY_W.aadhar_no} htmlFor="emp-aadhar">
                <>
                  <ValidatedInput
                    id="emp-aadhar"
                    // Shape-only on purpose. The check digit is reported by the note
                    // below as a WARNING, never a block: Aadhaar has been stored
                    // unvalidated until now, so an employee already on file may hold
                    // a number that fails it — and that must not stand between you
                    // and correcting their phone number. Switch this to
                    // "aadhaar_strict" to make it a hard block instead.
                    format="aadhaar"
                    value={form.aadhar_no}
                    onChange={(e) => set({ aadhar_no: e.target.value })}
                  />
                  {aadhaarCheckFails && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="h-4 w-4 shrink-0" />
                      Check digit doesn&apos;t match — verify this number with the employee.
                    </p>
                  )}
                </>
              </Field>
              {/* Left unvalidated deliberately. A PF account number is a slashed
                  establishment string (TN/MAS/12345/000/0001234) whose region and
                  office segments vary in length and are re-issued as offices are
                  renamed, so there is no one national shape to test — a regex here
                  would only reject numbers that are correct. */}
              <Field label="PF No" w={STATUTORY_W.pf_no} htmlFor="emp-pf">
                <Input
                  uppercase
                  id="emp-pf"
                  value={form.pf_no}
                  onChange={(e) => set({ pf_no: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>

              </SectionBody>
            ),
          },
          {
            key: "bank",
            label: "Bank Details",
            icon: Landmark,
            done: done.bank,
            content: (
              <SectionBody title="Bank Details">
                {/* ONE `FieldRow`, laid out by WIDTHS — `BANK_W` at the top of
                    this file carries the three steps and where each one comes
                    from, and `BANK_BOX_W` stops the card running on past them.
                    `cols={1}`: the row below is the only row this card has to
                    stack, and it is not on the twelfths track any more.

                    `FieldRow`'s default `items-end`, not `align="start"`:
                    nothing in this row renders anything BELOW its control —
                    these are a plain `<Select>` and two plain `<Input>`s, with
                    no `ValidatedInput` message, no `DuplicateError` and no
                    spell-suggest strip. The hazard that IS present is the other
                    one, and `items-end` is its answer: "Account No" is the
                    longest label here, a narrow window is where a label wraps,
                    and bottom alignment is what then keeps its box on the row's
                    line instead of dropping it below the two beside it. */}
                <DetailSection label="Bank Details" cols={1} className={BANK_BOX_W}>
                  <FieldRow>
                    <Field label="Pay Mode" w={BANK_W.pay_mode} htmlFor="emp-paymode">
                      <Select
                        id="emp-paymode"
                        value={form.pay_mode}
                        onChange={(e) => set({ pay_mode: e.target.value })}
                      >
                        {PAY_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Account No" w={BANK_W.bank_acc_no} htmlFor="emp-bankacc">
                      <Input
                        uppercase
                        id="emp-bankacc"
                        value={form.bank_acc_no}
                        onChange={(e) => set({ bank_acc_no: e.target.value })}
                      />
                    </Field>
                    {/* LAST, WHERE IT USED TO BE SECOND. The row packs left to
                        right by width now, so the one field with no schema
                        maximum goes on the end: the two bounded values keep a
                        shared left edge with every other row in this editor, and
                        the widest box is the one nearest the slack. */}
                    <Field label="Bank Name" w={BANK_W.bank_name} htmlFor="emp-bankname">
                      <Input
                        id="emp-bankname"
                        uppercase
                        value={form.bank_name}
                        onChange={(e) => set({ bank_name: e.target.value })}
                      />
                    </Field>
                  </FieldRow>
                </DetailSection>
              </SectionBody>
            ),
          },
          {
            key: "addresses",
            label: "Addresses",
            icon: MapPin,
            done: done.addresses,
            content: (
              <SectionBody title="Addresses">
                <div className="space-y-4">
          {/* ---- What used to be "General" ----
              One `cols={1}` section wrapping a hand-rolled `space-y-4` that
              re-implemented a layout system for 21 controls. LAYOUT.md §4 puts
              5-7 fields in a section, so it became three: the two addresses (6
              each) and the demographic remainder (7, now under Personal).

              The two addresses stay SEPARATE cards under one "Addresses" rail
              entry — they are peers, each already carried its own heading, and
              together they are 12 controls. The rail entry groups them; it does
              not merge them. */}
          {/* `cols={1}`, because the `FieldRow` inside is the only row either card
              has to place — the twelfths track these two ran on is gone from this
              screen entirely (see the note where `FIELD_SIZE` used to stand).
              `ADDRESS_BOX_W` is the cap, one string on both cards. */}
          <DetailSection label="Permanent Address" cols={1} className={ADDRESS_BOX_W}>
            {addressFields("perm")}
          </DetailSection>

          <DetailSection
            label="Correspondence Address"
            cols={1}
            className={ADDRESS_BOX_W}
            // The section header's own right-hand slot, which is where this
            // checkbox already sat visually — it belongs to the section, not to
            // the field track, and putting it on the track would cost a cell.
            action={
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  checked={form.corr_same_as_perm}
                  onChange={(e) => set({ corr_same_as_perm: e.target.checked })}
                />
                <span className="text-xs text-foreground">Same as Permanent</span>
              </label>
            }
          >
            {form.corr_same_as_perm ? (
              /* NO `Field` WRAPPER. `size="full"` is a col-span, and `cols={1}`
                 is a stack with no track for it to span — the same inert prop the
                 Inactive switch's note records one section up. A `Field` would
                 also reserve a label row above a sentence that has no label,
                 pushing it 14px down inside a card it is the only thing in. */
              <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                Uses the permanent address.
              </p>
            ) : (
              addressFields("corr")
            )}
          </DetailSection>

                </div>
              </SectionBody>
            ),
          },
        ]}
      />

      {/* Read-only view — the same record, nothing editable, and Edit in the
          footer hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow?.name ?? ""}
        subtitle={
          viewRow
            ? [
                viewRow.code,
                viewRow.designation_id ? desigLabel.get(viewRow.designation_id) : null,
                viewRow.department_id ? deptLabel.get(viewRow.department_id) : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
        status={
          viewRow && (
            <StatusPill tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}>
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}
