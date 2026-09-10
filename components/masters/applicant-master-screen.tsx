"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, SlidersHorizontal, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { Field, FIELD_WIDTH, FieldRow, type FieldWidth } from "@/components/ui/field";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { createApplicant, updateApplicant, deleteApplicant } from "@/lib/masters/applicant-actions";
import { PublishesBadge } from "@/components/masters/party-origin";
import { PARTY_ROLE } from "@/lib/masters/party-origin-text";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  SHIP_MODES,
  PAY_MODES,
  type Applicant,
  type ApplicantInput,
} from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  also_customer: boolean;
  also_consignee: boolean;
  country_id: string;
  // Address
  street: string;
  city_id: string;
  state_id: string;
  pin: string;
  address_country_id: string;
  land_line: string;
  mobile: string;
  /** null = "same as mobile" (tick on). "" = tick off, nothing typed yet. */
  whatsapp: string | null;
  email: string;
  web_site: string;
  // General
  currency_1: string;
  currency_2: string;
  currency_3: string;
  ship_mode: string;
  ship_type_id: string;
  pay_mode: string;
  payment_term_id: string;
  bank_id: string;
  ac_no: string;
};
/** What this applicant has published, and so what a delete here takes with
 *  it (0378). An Applicant is only ever a source — nothing publishes one. */
const applicantPublishes = (r: Applicant): string[] => [
  ...(r.also_customer ? [PARTY_ROLE.customer] : []),
  ...(r.also_consignee ? [PARTY_ROLE.consignee] : []),
];

const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  also_customer: false,
  also_consignee: false,
  country_id: "",
  street: "",
  city_id: "",
  state_id: "",
  pin: "",
  address_country_id: "",
  land_line: "",
  mobile: "",
  whatsapp: null,
  email: "",
  web_site: "",
  currency_1: "",
  currency_2: "",
  currency_3: "",
  ship_mode: "",
  ship_type_id: "",
  pay_mode: "",
  payment_term_id: "",
  bank_id: "",
  ac_no: "",
};

type ContactRow = {
  key: string;
  department_id: string;
  contact_name: string;
  designation_id: string;
  land_line: string;
  mobile: string;
  email_id: string;
  internal_department_id: string;
};
const blankContact = (key: string): ContactRow => ({
  key,
  department_id: "",
  contact_name: "",
  designation_id: "",
  land_line: "",
  mobile: "",
  email_id: "",
  internal_department_id: "",
});

// THE TWELFTHS TRACK IS GONE FROM THIS SCREEN. `FIELD_SIZE` and `SizedField`
// stood here until 2026-09-10, and they are deleted rather than left holding
// their last two sections: General was the final row on the track, and the note
// that used to sit here said why a map outliving its readers is the failure —
// "a key no call site reads would otherwise sit there looking authoritative".
//
// Every section states a WIDTH now: `IDENTITY_W`, `CONTACT_W`, `ADDRESS_W`,
// `COMM_W` and `GENERAL_W`, each with the arithmetic for its own row written
// above it.
//
// What the deleted map claimed for itself is worth keeping, because it is what
// the conversion overturned: "ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per
// row, edge to edge … the rest of the screen was cut down to match rather than
// each field being sized to its own data". A screen of one repeated width does
// read as a grid — and 3 of 12 is a share of the pane, so it was a grid of
// identical ~278px holes, with a three-letter currency code in the same box as
// a bank's full name. `GENERAL_W` carries the measurement that closed it.

/**
 * IDENTITY, SHRINK-WRAPPED (`erp-form-compact`) — the same conversion Notify,
 * Consignee, Our Bank, Vendor and Employee have already had, on the section that
 * names the record.
 *
 * ## What "one size, every field" cost here
 *
 * The note above is honest about the trade it made: `sm` everywhere, because the
 * client picked out one row as correct and the rest was cut to match. `sm` is 3
 * of 12, and 3 of 12 is a SHARE — ~278px in this pane on a 1366 laptop and
 * ~344px at 1920. So a Yes/No dropdown got the same box as a party's name, and
 * the "grid" that bought was a grid of identical holes. Narrowing the CONTROL
 * inside a twelfth changes nothing; the cell keeps its share and the value
 * floats in it. That is why the section leaves the track rather than picking
 * different shares.
 *
 * THIS WAS THE FIRST SECTION OFF THE TRACK and for a few hours the only one, so
 * this note used to end "the rest of the screen is still on `sm`". It is not any
 * more: Contact, Address, Communication and General followed the same day, each
 * with its own map, and `FIELD_SIZE` is deleted rather than left holding a
 * shrinking remainder. See the note where it used to stand.
 *
 * ## The widths, and none of them is new
 *
 *   code  144  Name, Country
 *   range 112  Also Customer, Also Consignee
 *   (none)     Inactive — a switch is not one of the widths
 *
 * EVERY STEP IS COPIED FROM CONSIGNEE'S OWN IDENTITY ROW rather than decided
 * here. That screen is the closest thing in this app to this one — a party
 * master in Associates with a name, a country and a two-option select — and it
 * settled `name: "code"` on a client instruction of 2026-09-09 about that exact
 * box ("140px asked for; 144 is the step"), `country_id: "code"` beside it, and
 * `also_notify: "range"` for the two-option select whose label sets the floor.
 * A second opinion on any of the three would be drift, not tailoring.
 *
 * Note this is the OPPOSITE ruling to the Employee master's Name, and
 * deliberately: that one is a PERSON's name and takes `name` (288). These are a
 * trading party's short name, which the client narrowed on purpose.
 *
 * INACTIVE TAKES NO `w` AT ALL, and that is rule 1 rather than an omission: a
 * switch is not among the vocabulary's widths, and an unsized `Field` in a flex
 * row is exactly as wide as what is in it. `Toggle` is a 36px track, an 8px gap
 * and the word "Inactive" — ~104px, measured below rather than named.
 *
 * DERIVED, so it can be checked against the pane. `FIELD_ROW` puts 12px between
 * cells:
 *
 *   New    144 + 144 + 112 + 112              =  512 + 3 x 12 = 548
 *   Edit   144 + 144 + 112 + 112 + ~104       =  616 + 4 x 12 = 664
 *
 * ONE LINE IN BOTH STATES, which is the point of putting the switch in the row:
 * it used to take a short second row of its own, because a lone 3-of-12 cell is
 * what a twelfths track leaves when a field is edit-only.
 */
const IDENTITY_W = {
  name: "code", //           a trading party's short name — Consignee's own step
  country_id: "code", //     a country name in a picker trigger
  also_customer: "range", // a two-option select; the label sets the floor
  also_consignee: "range", //
} satisfies Record<string, FieldWidth>;

/**
 * THE DETAILS CARD'S CAP (`erp-form-compact` rule 4).
 *
 * Narrowing the fields does not narrow the CARD. `DetailSection` is a block box
 * and goes on filling the pane, so without a cap the tightened row would trail
 * ~470px of empty card on a 1366 laptop and ~740px at 1920.
 *
 *   664      the Edit row, the longer of the two states
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 686  ->  44rem (704), 18px of slack
 *
 * The slack is deliberately small, and it is what holds the row on ONE line in
 * both states: the card must not be the thing that decides where the row breaks.
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit`. `DetailSection`'s root declares
 * `@container/section` — `container-type: inline-size`, hence inline-axis size
 * containment — so a content-sized cap on it resolves to zero and the card
 * collapses to its own caption. The Vendor master shipped exactly that bug on
 * its Category card and carries the full note; `child-grid.tsx` records two
 * earlier sightings of the same cycle.
 */
const IDENTITY_BOX_W = "max-w-[44rem]";

/**
 * THE CONTACT CARD'S FIELDS (`erp-form-compact` rules 1-3, inside the child).
 *
 * Seven fields on a `FieldGrid` — the same 12-column track, one element in — so
 * a Land Line and an Email ID were the same box, and both were a SHARE of a card
 * that was itself the width of the pane. `sm` there is ~278px per field on a
 * 1366 laptop and ~344px at 1920, for a designation nobody types past twenty
 * characters.
 *
 * EVERY STEP IS CONSIGNEE'S, and that is deliberate rather than lazy: its
 * contact card holds the SAME SEVEN FIELDS under the same seven labels, so any
 * difference here would be two masters disagreeing about one thing. Read
 * `CONTACT_FIELD_W` there for the argument; the short version is
 *
 *   code 144  Department, Contact Name, Designation, Internal Department,
 *             Land Line, Mobile
 *   name 288  Email ID — an address has no maximum, and it is the one field
 *             here that a `code` box would clip on ordinary values
 *
 * CONTACT NAME IS `code` (144) AND NOT `name` (288), which is the one line worth
 * pausing on. The Employee master gives a person's name 288 and is right to; the
 * rule there is "no schema maximum". Here the party's OWN name is 144 by a
 * client instruction of 2026-09-09, and a contact inside that party cannot be
 * wider than the party — a card whose Contact Name box is twice its parent's
 * Name box reads as a mistake. Consignee resolved it the same way and says so on
 * the line itself.
 *
 * DERIVED, and the fold is the shape the old comment described in twelfths:
 *
 *   line 1  144 + 144 + 144 + 144      =  576 + 3 x 12 = 600   who they are
 *   line 2  144 + 144 + 288            =  576 + 2 x 12 = 600   how to reach them
 *
 * The two lines come out identical at 600, which is luck rather than design and
 * is worth nothing on its own — but it is what lets ONE bound hold both, and
 * `CONTACT_BOX_W` below is that bound.
 */
const CONTACT_W = {
  department: "code",
  contact_name: "code", //        the party's own Name is 144 — see the note above
  designation: "code",
  internal_department: "code",
  land_line: "code",
  mobile: "code",
  email_id: "name", //            an address has no maximum
} satisfies Record<string, FieldWidth>;

/**
 * THE CONTACT GRID IS CAPPED TO THE FORM'S WIDTH, NOT THE SCREEN'S
 * (`erp-form-compact` rule 4).
 *
 * A cap on a WRAPPER, not on the grid. `ChildGrid` takes no `className` — only
 * `addClassName` and `bodyClassName` — so the cap goes on a plain `<div>` around
 * it, which is what `notify-master-screen.tsx` does with its own `CONTACTS_W`.
 *
 *   600      the line `CONTACT_W` above states, and both lines are 600
 *   + 2 x 8   the grid card's `GRID_FRAME` padding at `@2xl/editor:p-2`
 *   + 2 x 1   its border
 *   = 618  ->  40rem (640), leaving the row ~622px of content
 *
 * NOTHING ELSE BETWEEN THE CAP AND THE FIELDS COSTS WIDTH, which is worth
 * stating because it is not true of every grid: `flatRows` makes each record
 * `py-3` with no horizontal padding and no border of its own, and the ✕ sits in
 * the card's header row ABOVE the fields rather than beside them. So the only
 * chrome in the chain is the grid card's own frame.
 *
 * BOTH BOUNDS MATTER, and they are what hold the card to two lines rather than
 * to whatever the window happens to allow:
 *
 *   622 >= 600, so line 1 keeps all four pickers and line 2 keeps the three
 *               contact routes;
 *   622 <  756, so Land Line (600 + 12 + 144) cannot climb onto line 1 and
 *               leave Mobile and Email ID alone below it.
 *
 * Without that upper bound the card would change shape at some window width
 * nobody tested — the failure `IDENTITY_BOX_W` above and Consignee's own
 * `CONTACT_W` both exist to rule out.
 *
 * AT THE NARROW DENSITY the frame is `p-2.5` instead, so content is ~618 — still
 * over 600, and on a pane that small the cap has stopped binding anyway.
 */
const CONTACT_BOX_W = "max-w-[40rem]";

/**
 * THE ADDRESS CARD, SHRINK-WRAPPED (`erp-form-compact`; client 2026-09-10,
 * applicant address fields "properly compact tighten").
 *
 * Four fields at `size="sm"` is 3 of 12 each, and the map above says in writing
 * that this is the row the rest of the screen was cut down to MATCH: "The City /
 * State / Pin / Country row is the shape the client picked out as correct, so
 * the rest of the screen was cut down to match rather than each field being
 * sized to its own data". Four equal cells edge to edge does read as a grid —
 * and it is still a share of the pane rather than a measurement, so a six-digit
 * PIN and a street stood in the same ~278px box on a 1366 laptop and the same
 * ~344px at 1920. Narrowing the control inside a twelfth changes nothing: the
 * CELL keeps its share and the six digits float in it.
 *
 * NO HAND-TYPED PIXELS. Every step is one a sibling master's address block has
 * already settled — Consignee's `ADDRESS_W` is the same four fields:
 *
 *   name  288  Street. A postal line has no hard maximum, which is the test
 *              `FieldWidth` states.
 *   code  144  City and State, which is what Consignee, Customer and Vendor give
 *              this same pair of place pickers.
 *   range 112  Pin. Six digits, a hard maximum, and the 90-120 band this step
 *              exists for.
 *
 * STREET IS STILL A SINGLE-LINE `Input`, AND THE REASON HAS CHANGED. The old
 * note said a 3-row `Textarea` "would set the height of the whole row and leave
 * City / State / Pin floating above a band of empty space, since grid items in a
 * row share the tallest one's height" — a fact about a GRID, and this row is a
 * flex one now. What keeps the decision is `align="start"` below: a tall cell no
 * longer stretches its neighbours, but a 3-row box beside three 32px controls
 * still reads as one field having gone wrong. Stored values keep any newlines
 * they already have; an `<input>` simply renders them on one line.
 *
 *   288 + 144 + 144 + 112 = 688 + 3 x 12 = 724
 *
 * ONE LINE, and the same four fields in the same order — this row was never the
 * problem, only its units.
 */
const ADDRESS_W = {
  street: "name", //  a postal line — no schema maximum
  city_id: "code",
  state_id: "code",
  pin: "range", //    6 digits
} satisfies Record<string, FieldWidth>;

/**
 * AND THE COMMUNICATION CARD BESIDE IT — five controls that were five more `sm`
 * cells, so a Web site URL had exactly the room a land line did.
 *
 *   code  144  Land Line. It prints as 0422-2345678, ~100px of Inter at 14px
 *              plus the input's own padding, so `range` would clip it.
 *   term  176  Mobile and WhatsApp. The step is paid for by the CONTROL rather
 *              than the value: each holds its input AND a `ContactChip` in a
 *              flex beside it, so at `code` the number would be squeezed by a
 *              fixed 28px button. That is Consignee's stated reason for the
 *              identical step on the identical pair.
 *   name  288  E-Mail and Web site. Neither has a schema maximum, and a URL is
 *              the longest free text on this screen.
 *
 * MOBILE AND WHATSAPP TAKE THEIR WIDTH THROUGH `cellClassName`, NOT A `Field`.
 * `MobileWhatsAppFields` is a fragment of TWO siblings with no wrapper element —
 * that missing wrapper is the whole point of the component — so there is nothing
 * for a `Field` to wrap and the class goes to each half instead. It used to be
 * the literal `"@lg/section:col-span-3"`, which is a col-span and therefore
 * INERT in a flex row: left alone, the pair would have kept a class that says
 * nothing and rendered at whatever their content came to. `FIELD_WIDTH[…]` is
 * what replaces it, and it is not the interpolation that prop's own comment
 * warns about — the class string is a value read out of a map, and `w-44` is
 * written literally in `field.tsx` where Tailwind scans it.
 *
 * DERIVED, and this card folds where the record does — the phones, then the
 * online addresses:
 *
 *   144 + 176 + 176  =  496 + 2 x 12 = 520   land line, mobile, WhatsApp
 *   288 + 288        =  576 + 1 x 12 = 588   e-mail, web site
 */
const COMM_W = {
  land_line: "code", //  0422-2345678, wider than `range` holds
  contact: "term", //    Mobile and WhatsApp: input + ContactChip
  email: "name", //      no schema maximum
  web_site: "name", //   the longest free text on this screen
} satisfies Record<string, FieldWidth>;

/**
 * ONE CAP FOR BOTH CARDS (`erp-form-compact` rule 4), for the reason
 * `employee-master-screen.tsx`'s `PERSONAL_BOX_W` states about its own pair: the
 * two sit in a stack under a single rail entry, and capping each to its own
 * longest line would leave two bordered boxes of different widths one above the
 * other, which reads as a mistake rather than as two sections.
 *
 *   724       the longer of the two, the Address line
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 746  ->  47rem (752), 6px of slack
 *
 * IT IS ALSO WHAT FIXES COMMUNICATION'S FOLD. Content is 730 inside the cap, and
 * E-Mail joining the phones would need 520 + 12 + 288 = 820 — so the break holds
 * at every window this app runs in, and anywhere up to ~820 is the range to check
 * before widening this constant. Uncapped, both cards fill the pane and E-Mail
 * climbs onto line 1 at 1920 and not at 1366, which is a layout that depends on
 * the reader's monitor.
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit` — `DetailSection`'s root declares
 * `@container/section`, so a content-sized cap on it resolves to zero and the
 * card collapses. `IDENTITY_BOX_W` above carries the longer version of that note.
 */
const ADDRESS_BOX_W = "max-w-[47rem]";

/**
 * THE GENERAL RAIL ENTRY'S TWO CARDS, SHRINK-WRAPPED — the last of this screen
 * to leave the twelfths track.
 *
 * NINE FIELDS THAT WERE NINE IDENTICAL SHARES, and this is the group where that
 * cost most: a three-letter currency CODE, an 8-option Pay Mode enum and a
 * bank's full name each stood in the same ~278px box on a 1366 laptop.
 *
 * EVERY STEP IS ALREADY WRITTEN DOWN — six of these nine appear by name in
 * `erp-form-compact`'s own band table, and the sibling masters state the rest:
 *
 *   range 112  Currency 1/2/3 and Ship Mode. All four are in the skill's
 *              "short options 90-120" row by name, and Customer's converted map
 *              gives these same four fields these same values.
 *   code  144  Ship Type and Pay Mode — the skill's "selects 140-170" row, and
 *              Customer and Employee both landed here ("Bank / Cash, as
 *              Customer's own Pay Mode").
 *   term  176  Payment Terms and A/c No, for two different reasons. Consignee
 *              and Vendor each carry the same one-line note on the first —
 *              "60 DAYS FROM BL DATE" clipped at `code` — and Our Bank and
 *              Vendor measured the second at 18 digits, the schema's own
 *              maximum.
 *   party 200  Bank. This IS the step's definition, not an application of it:
 *              `lib/ui/sizes.ts` says "a trading party's name in a picker
 *              trigger: a bank, an agent, a branch", and Consignee's own
 *              `bank_id` is where it was first needed.
 *
 * WHERE THE SIBLINGS DISAGREE, THE MAJORITY AND THE SKILL AGREE WITH EACH OTHER.
 * Consignee gives Ship Type and Pay Mode `range` and its currencies `num` (72);
 * Customer gives all three the wider step. The skill's band table sides with
 * Customer on each, so this screen does too rather than inventing a third
 * answer — and 72 is below what a picker TRIGGER can show with its own button
 * on it.
 *
 * DERIVED, and Shipping & Payment keeps the 4 + 2 reading its own comment states
 * — how the goods move and how they are paid for, then the bank the money lands
 * in:
 *
 *   Currencies  112 + 112 + 112              =  336 + 2 x 12 = 360
 *   Ship & Pay  112 + 144 + 144 + 176        =  576 + 3 x 12 = 612
 *               200 + 176                    =  376 + 1 x 12 = 388
 */
const GENERAL_W = {
  currency: "range", //         a 3-letter code in a picker trigger, all three
  ship_mode: "range", //        a short enum
  ship_type_id: "code",
  pay_mode: "code", //          Bank / Cash, as Customer's and Employee's
  payment_term_id: "term", //   "60 DAYS FROM BL DATE" clipped at `code`
  bank_id: "party", //          a bank's name in a picker TRIGGER — the step's own case
  ac_no: "term", //             18 digits, the schema's own maximum
} satisfies Record<string, FieldWidth>;

/**
 * ONE CAP FOR BOTH GENERAL CARDS, the same call `ADDRESS_BOX_W` above makes for
 * the same reason: the two sit in a stack under a single rail entry, and capping
 * each to its own longest line would leave two bordered boxes of different
 * widths one above the other, which reads as a mistake rather than as two
 * sections.
 *
 *   612       the longest line of the two cards (Ship & Payment, line 1)
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 634  ->  41rem (656), 22px of slack
 *
 * CURRENCIES IS THE CARD THAT PAYS FOR THIS, and it is worth saying so plainly:
 * 360 of content in a 656 box trails ~274px. The alternative was a 24rem card
 * sitting directly above a 41rem one, which is the shape the rule above rejects.
 * Three narrow pickers reading as a short row inside a full-width section is a
 * section that looks deliberate; two cards of different widths looks like one of
 * them went wrong.
 *
 * IT IS ALSO WHAT FIXES THE SHIPPING FOLD. Content is 634 inside the cap, and
 * Bank joining line 1 would need 612 + 12 + 200 = 824 — so the 4 + 2 break holds
 * everywhere, and ~824 is the number to check before widening this constant.
 *
 * A DEFINITE LENGTH, NEVER `max-w-fit` — see `IDENTITY_BOX_W` above for why a
 * container-query root cannot be sized from its own content.
 */
const GENERAL_BOX_W = "max-w-[41rem]";

/**
 * Master-detail CRUD for the legacy "Applicant" master (Associates): a header
 * (Name · Inactive · Also Customer · Also Consignee · Country) + two tabs
 * (Address | General) + a Contact child grid.
 *
 * City / State and the grid's Department / Designation / Internal Department are
 * config_lookups pickers (searchable dialog + Add/Modify); both Country fields
 * reuse the shared CountryPicker.
 */
export function ApplicantMasterScreen({
  rows,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  currencies,
  banks,
  shipTypes,
  paymentTerms,
  perms,
}: {
  rows: Applicant[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  internalDepartments: ConfigLookup[];
  currencies: Currency[];
  banks: Bank[];
  shipTypes: ConfigLookup[];
  paymentTerms: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const isdOf = useIsdLookup(countries);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** The record being LOOKED at — read-only, never the editor's record. */
  const [viewRow, setViewRow] = useState<Applicant | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  /**
   * ONE BLANK CONTACT, ALWAYS (`erp-table-default-row`). An editable grid is a
   * typing surface, not a list of results: the operator opening Contacts expects
   * a caret, not a "+ Add contact" button to find first — which is what the
   * legacy RP screens they are migrating from all do.
   *
   * THIS INITIALISER IS THE THIRD OF THE RULE'S THREE STATEMENTS AND IT WAS THE
   * ONE MISSING. `openAdd` has seeded a row since this master was built, so a NEW
   * applicant was always right; what was empty was an EXISTING one with no stored
   * contacts (fixed in `openEdit` below) and this `useState`, which was `[]`.
   *
   * It is belt-and-braces rather than dead code: every path that opens the editor
   * runs one of those two handlers today, so the seed here is what keeps the rule
   * true for a path added later that forgets to.
   *
   * SAFE TO SEED BECAUSE THE SAVE SIDE DROPS IT, and the drop is on the SERVER:
   * `normalizeContacts` in `applicant-actions.ts` keeps a row only if one of its
   * seven fields has content, then renumbers `sno`. That is what makes the seeded
   * row scaffolding rather than data — and it is also why every key
   * `blankContact` stamps must stay `""`: a "helpful" default would turn its
   * clause in that OR-chain into the constant `true` and insert a phantom contact
   * naming nobody (the MBA bug `scripts/check-blank-row-filter.mts` exists for).
   *
   * No cell in this grid is `required`, so the seeded row holds no cursor — the
   * rule's own condition for seeding an OPTIONAL child grid.
   *
   * THE KEY IS A LITERAL, NOT `newKey()`, and that is not a shortcut — an
   * initialiser runs during RENDER and `newKey` reads `keySeq.current`, which
   * `react-hooks/refs` rejects ("Cannot access refs during render"). Customer and
   * Consignee seed the same way for the same reason and their notes say so.
   *
   * `"seed0"` rather than `"c0"`: keys only have to be unique within the array,
   * and THIS screen's sequence issues `c0`, `c1`, … — so the obvious literal is
   * the one key that CAN collide, which is the trap the siblings avoid only
   * because their sequences happen to use a different prefix (`k…` beside `ct0`).
   * Nothing here may issue a key matching `c<digits>` except that sequence.
   */
  const [contacts, setContacts] = useState<ContactRow[]>(() => [blankContact("seed0")]);
  /** A sequence, never the array index: `landOnAddedRow` finds a new row by
   *  DIFFING the grid's fields before and after, and `ChildGrid` keys its rows,
   *  so an index reused after a remove makes both wrong. */
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  // The server has guarded this since the master was built (applicant-actions.ts);
  // the screen simply never said so until the operator pressed Save.
  const dupError = useDuplicateName({
    table: "applicants",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    // No curated vocabulary, and there can never be one: these are the names of
    // real trading parties. Rows only — which is exactly the useful check here,
    // catching "ABC TEXTILES" typed beside an existing "ABC TEXTILE".
    seed: [],
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);
  const cityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.id, c.name);
    return m;
  }, [cities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    const blankContacts = [blankContact(newKey())];
    setForm(BLANK);
    setContacts(blankContacts);
    // Baseline for `dirty`. A brand-new applicant starts clean even though it
    // already holds one empty contact row — that row is scaffolding the form
    // put there, not something the user typed.
    setPristine(JSON.stringify({ form: BLANK, contacts: blankContacts }));
    setOpen(true);
  }
  function openEdit(r: Applicant) {
    setEditId(r.id);
    // One visible Country field now feeds both stored columns (see the Address
    // section below) — `country_id` is authoritative (it is what the list
    // column, header chip and read-only view all resolve), so it wins; a row
    // saved before this fix that only ever had `address_country_id` filled in
    // still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    const nextForm: HeaderForm = {
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      also_customer: r.also_customer,
      also_consignee: r.also_consignee,
      country_id: countryId,
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: countryId,
      land_line: r.land_line ?? "",
      mobile: r.mobile ?? "",
      // NOT `?? ""` — a stored NULL is the "same as mobile" state.
      whatsapp: r.whatsapp,
      email: r.email ?? "",
      web_site: r.web_site ?? "",
      currency_1: r.currency_1 ?? "",
      currency_2: r.currency_2 ?? "",
      currency_3: r.currency_3 ?? "",
      ship_mode: r.ship_mode ?? "",
      ship_type_id: r.ship_type_id ?? "",
      pay_mode: r.pay_mode ?? "",
      payment_term_id: r.payment_term_id ?? "",
      bank_id: r.bank_id ?? "",
      ac_no: r.ac_no ?? "",
    };
    const nextContacts: ContactRow[] = r.contacts.map((c) => ({
        key: newKey(),
        department_id: c.department_id ?? "",
        contact_name: c.contact_name ?? "",
        designation_id: c.designation_id ?? "",
        land_line: c.land_line ?? "",
        mobile: c.mobile ?? "",
        email_id: c.email_id ?? "",
      internal_department_id: c.internal_department_id ?? "",
    }));
    /**
     * `[]` MEANS "NO CONTACTS YET", WHICH IS THE STATE THE BLANK ROW IS FOR
     * (`erp-table-default-row`, statement 2). An applicant stored without
     * contacts used to open on an empty grid and a button, while a brand-new one
     * opened on a row — the same section behaving two ways for a reason the
     * operator cannot see.
     *
     * ONE ARRAY, READ TWICE: the fallback row has to reach `setPristine` as well,
     * or `dirty` compares a seeded row against a baseline of none and the editor
     * opens reading "unsaved changes" — which `useUnsavedGuard` then honours by
     * holding off the silent auto-reload on work nobody has touched. `openAdd`
     * above keeps its own `blankContacts` local for exactly this reason.
     */
    const openContacts = nextContacts.length ? nextContacts : [blankContact(newKey())];
    setForm(nextForm);
    setContacts(openContacts);
    setPristine(JSON.stringify({ form: nextForm, contacts: openContacts }));
    setOpen(true);
  }

  function addContact() {
    setContacts((cs) => [...cs, blankContact(newKey())]);
  }
  function setContactAt(key: string, patch: Partial<ContactRow>) {
    setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function removeContact(key: string) {
    setContacts((cs) => cs.filter((c) => c.key !== key));
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: ApplicantInput = {
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        also_customer: form.also_customer,
        also_consignee: form.also_consignee,
        country_id: form.country_id || null,
        street: form.street.trim() || null,
        city_id: form.city_id || null,
        state_id: form.state_id || null,
        pin: form.pin.trim() || null,
        address_country_id: form.address_country_id || null,
        land_line: form.land_line.trim() || null,
        mobile: form.mobile.trim() || null,
        // "" collapses to null — an empty WhatsApp box means "same as mobile".
        whatsapp: form.whatsapp?.trim() || null,
        email: form.email.trim() || null,
        web_site: form.web_site.trim() || null,
        currency_1: form.currency_1 || null,
        currency_2: form.currency_2 || null,
        currency_3: form.currency_3 || null,
        ship_mode: form.ship_mode || null,
        ship_type_id: form.ship_type_id || null,
        pay_mode: form.pay_mode || null,
        payment_term_id: form.payment_term_id || null,
        bank_id: form.bank_id || null,
        ac_no: form.ac_no.trim() || null,
        is_draft: asDraft,
        contacts: contacts.map((c, i) => ({
          sno: i + 1,
          department_id: c.department_id || null,
          contact_name: c.contact_name || null,
          designation_id: c.designation_id || null,
          land_line: c.land_line || null,
          mobile: c.mobile || null,
          email_id: c.email_id || null,
          internal_department_id: c.internal_department_id || null,
        })),
      };
      const res = editId ? await updateApplicant(editId, payload) : await createApplicant(payload);
      if (res.ok) {
        success(editId ? "Applicant updated." : "Applicant added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Applicant) {
    startTransition(async () => {
      const res = await deleteApplicant(r.id);
      if (res.ok) {
        success(deletedToast("Applicant", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /** An id → its name, for any of the lists this screen is handed. Small lists
      and ONE record on screen, so it resolves on demand instead of building
      half a dozen maps. */
  const nameOf = (options: { id: string; name: string }[], id: string | null) =>
    (id ? options.find((o) => o.id === id)?.name : null) ?? null;
  /** Ship Type is the one list whose code is a term of the trade, so the view
      echoes exactly what the picker offered — "FREE ON BOARD (FOB)". */
  const shipTypeOf = (id: string | null) => {
    const o = id ? shipTypes.find((s) => s.id === id) : null;
    return o ? lookupLabel("ship_type", o) : null;
  };
  /** Currencies key off `code`, not id — the row stores the code itself. */
  const currencyName = (code: string | null) =>
    code ? (currencies.find((c) => c.code === code)?.name ?? code) : null;

  /**
   * The record as a reader wants it, laid out the way the editor's rail reads:
   * Identity · Address (Address + Communication) · Contacts · General
   * (Currencies + Shipping & Payment). Every FK is resolved to a NAME here — a
   * uuid on screen tells the reader nothing — from the same lists the editor's
   * pickers are handed, so nothing is fetched.
   */
  function viewSections(r: Applicant): ViewSection[] {
    const filled = r.contacts.filter(
      (c) =>
        c.contact_name ||
        c.department_id ||
        c.designation_id ||
        c.internal_department_id ||
        c.land_line ||
        c.mobile ||
        c.email_id,
    );
    const sections: ViewSection[] = [
      {
        label: "Identity",
        pairs: [
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? null) : null],
          // Yes AND No both say something here — "this applicant is not also a
          // customer" is an answer, not a blank.
          ["Also Customer", r.also_customer ? "Yes" : "No"],
          ["Also Consignee", r.also_consignee ? "Yes" : "No"],
        ],
      },
      {
        label: "Address",
        // No "Country" pair here — it lived under Identity above until the
        // single-Country-field fix (2026-07-31); `address_country_id` is kept
        // in sync with `country_id` and would only repeat that line.
        pairs: [
          ["Street", r.street],
          ["City", r.city_id ? (cityLabel.get(r.city_id) ?? null) : null],
          ["State", nameOf(states, r.state_id)],
          ["Pin", r.pin],
        ],
      },
      {
        label: "Communication",
        pairs: [
          ["Land Line", r.land_line],
          ["Mobile", r.mobile],
          // A stored NULL means "the mobile IS the WhatsApp number" (0353).
          // Left blank it would read as "not provided" — the opposite.
          ["WhatsApp", r.whatsapp ?? (r.mobile ? "Same as mobile" : null)],
          ["E-Mail", r.email],
          ["Web site", r.web_site],
        ],
      },
    ];
    // A section with `content` is never auto-hidden, so a record with no
    // contacts drops the card here rather than showing an empty one. Each
    // contact is three short lines — who they are, then how to reach them —
    // because seven label→value rows apiece would bury everything around it.
    if (filled.length > 0) {
      sections.push({
        label: "Contacts",
        content: (
          <ul className="space-y-2.5 text-sm">
            {filled.map((c) => {
              const role = [
                nameOf(designations, c.designation_id),
                nameOf(departments, c.department_id),
                nameOf(internalDepartments, c.internal_department_id),
              ]
                .filter(Boolean)
                .join(" · ");
              const reach = [c.land_line, c.mobile, c.email_id].filter(Boolean).join(" · ");
              return (
                <li key={c.id} className="border-t border-border pt-2.5 first:border-0 first:pt-0">
                  <div className="font-medium text-foreground">
                    {c.contact_name || <span className="text-muted-foreground">Unnamed contact</span>}
                  </div>
                  {role && <div className="text-muted-foreground">{role}</div>}
                  {reach && <div className="text-muted-foreground">{reach}</div>}
                </li>
              );
            })}
          </ul>
        ),
      });
    }
    sections.push(
      {
        label: "Currencies",
        pairs: [
          ["Currency 1", currencyName(r.currency_1)],
          ["Currency 2", currencyName(r.currency_2)],
          ["Currency 3", currencyName(r.currency_3)],
        ],
      },
      {
        label: "Shipping & Payment",
        pairs: [
          // Ship / pay mode are fixed lists stored as their own label — nothing
          // to resolve, unlike the two config_lookups beside them.
          ["Ship Mode", r.ship_mode],
          ["Ship Type", shipTypeOf(r.ship_type_id)],
          ["Pay Mode", r.pay_mode],
          ["Payment Terms", nameOf(paymentTerms, r.payment_term_id)],
          ["Bank", nameOf(banks, r.bank_id)],
          ["A/c No.", r.ac_no],
        ],
      },
    );
    return sections;
  }

  const columns: Column<Applicant>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <PublishesBadge roles={applicantPublishes(r)} />
        </span>
      ),
    },
    {
      header: "Country",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.country_id ? (countryLabel.get(r.country_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "City",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.city_id ? (cityLabel.get(r.city_id) ?? "—") : "—"}
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

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed applicant would take
   * it silently.
   *
   * Whole-object compare against the record as loaded, the same shape
   * company-profile-screen uses: `set` spreads, so key order is stable and the
   * two strings differ only when a value does. Cheaper than threading a
   * `setDirty(true)` through every one of this form's handlers, and it cannot be
   * forgotten on a new one.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: with the editor CLOSED, `pristine` is still "" while the
  // blank form stringifies to a real object, so this would read dirty forever
  // and arm the reload guard on a list page with nothing to lose — permanently
  // blocking the silent PWA auto-update (found on consignee, 2026-07-29).
  const dirty = open && JSON.stringify({ form, contacts }) !== pristine;
  useUnsavedGuard(dirty || isPending);

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form.
  const done = {
    identity: !!(form.name.trim() || form.country_id),
    address: !!(
      form.street.trim() ||
      form.city_id ||
      form.state_id ||
      form.pin.trim() ||
      form.address_country_id ||
      form.land_line.trim() ||
      form.mobile.trim() ||
      form.email.trim() ||
      form.web_site.trim()
    ),
    contacts: contacts.some(
      (c) => c.contact_name.trim() || c.department_id || c.designation_id || c.email_id.trim(),
    ),
    general: !!(
      form.currency_1 ||
      form.currency_2 ||
      form.currency_3 ||
      form.ship_mode ||
      form.pay_mode ||
      form.bank_id ||
      form.ac_no.trim()
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
          placeholder="Search applicant…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Applicant
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No applicants yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No applicants yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.country_id ? ` · ${countryLabel.get(r.country_id) ?? ""}` : ""}
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
            <span className="font-semibold text-foreground">{form.name.trim() || "applicant"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled applicant",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </>
          ),
          meta: (
            <>
              <span>
                {form.code ? (
                  <span className="font-mono font-semibold text-foreground">{form.code}</span>
                ) : (
                  "No short name"
                )}
              </span>
              {form.country_id && countryLabel.get(form.country_id) && (
                <span>· {countryLabel.get(form.country_id)}</span>
              )}
              {form.also_customer && <span>· Also customer</span>}
              {form.also_consignee && <span>· Also consignee</span>}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save applicant",
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
                {/* ONE `FieldRow`, laid out by WIDTHS — `IDENTITY_W` at the top
                    of this file carries the arithmetic and `IDENTITY_BOX_W` caps
                    the card. `cols={1}`: the row is the only child this card
                    stacks, and it is not on the twelfths track any more.

                    `align="start"`, not the default `items-end`: Name renders a
                    `DuplicateError` and a `SpellSuggestHint` BELOW its control,
                    and bottom alignment measures from the bottom of those — so
                    the first colliding applicant name would lift the Name box
                    clear of the three beside it while the operator is still
                    typing in it. The opposite hazard, a label too wide for its
                    cell, does not arise: "Also Consignee" is the longest here at
                    ~85px in a 112px box. */}
                <DetailSection label="Details" cols={1} className={IDENTITY_BOX_W}>
                  <FieldRow align="start">
                    <Field label="Name" w={IDENTITY_W.name} required htmlFor="ap-name">
                      <Input
                        id="ap-name"
                        uppercase
                        value={form.name}
                        onChange={(e) => set({ name: e.target.value })}
                        required
                        // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                        onKeyDown={nameSuggest.onKeyDown}
                        {...dupFieldProps(dupError, "ap-name")}
                      />
                      <DuplicateError error={dupError} id="ap-name" />
                      <SpellSuggestHint
                        suggestions={nameSuggest.suggestions}
                        existing={nameSuggest.existing}
                        activeIndex={nameSuggest.activeIndex}
                        duplicate={!!dupError}
                        onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                      />
                    </Field>
                    {/* `compact` on every picker below: each one prints its own <Label>
                        unless told not to, so without it the field is labelled twice. */}
                    {/* The ONLY Country field on this form now (client complaint
                        2026-07-31: two boxes both labelled "Country" read as a
                        duplicate). It writes BOTH `country_id` and
                        `address_country_id` — see the Address section below,
                        which used to carry its own picker for the second column. */}
                    <Field label="Country" w={IDENTITY_W.country_id} required>
                      <CountryPicker
                        countries={countries}
                        value={form.country_id || null}
                        onChange={(id) => set({ country_id: id, address_country_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Also Customer" w={IDENTITY_W.also_customer} htmlFor="ap-alsocust">
                      <Select
                        id="ap-alsocust"
                        value={form.also_customer ? "yes" : "no"}
                        onChange={(e) => set({ also_customer: e.target.value === "yes" })}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </Field>
                    <Field label="Also Consignee" w={IDENTITY_W.also_consignee} htmlFor="ap-alsocons">
                      <Select
                        id="ap-alsocons"
                        value={form.also_consignee ? "yes" : "no"}
                        onChange={(e) => set({ also_consignee: e.target.value === "yes" })}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </Field>
                    {/* THE SWITCH FOLLOWS ALSO CONSIGNEE ON THE SAME LINE, so New and
                        Edit differ by one CELL rather than by a row. It used to take a
                        short second row of its own — which is what a twelfths track
                        forces, since a lone 3-of-12 cell leaves nine columns of blank
                        beside it — and a content-width row simply ends after it.

                        The objection to putting it in the track was real: a bare switch
                        has no <Label> above it, so it would align to its neighbours'
                        LABELS rather than their controls. `Toggle`'s own `min-h-9` and
                        the `label=""` below are the two halves of the answer, and
                        Consignee's Identity row carries the same pair.

                        `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch Order
                        Entry uses) — the identical swap Country, Destination and Notify
                        made, and from the SAME component, so no two masters can drift
                        apart. It is still a real `<input type="checkbox">` underneath
                        (`components/ui/toggle.tsx` says why at length), so `isFieldLike()`
                        still counts it and Tab, Enter-advance and the arrows all reach it.

                        `label=""` RESERVES the label row rather than drawing one: a cell
                        with no label at all collapses it and lifts the switch ~16px above
                        the labelled fields beside it. The switch renders its own word, so
                        a `label="Inactive"` here would draw the name twice.

                        NO `w`: a switch is not one of the vocabulary's widths, and an
                        unsized `Field` in a flex row is exactly as wide as what is in
                        it. */}
                    {editId && (
                      <Field label="">
                        <Toggle
                          id="ap-inactive"
                          label="Inactive"
                          checked={form.inactive}
                          onChange={(inactive) => set({ inactive })}
                        />
                      </Field>
                    )}
                  </FieldRow>
                </DetailSection>
              </SectionBody>
            ),
          },
          {
            key: "address",
            label: "Address",
            icon: MapPin,
            done: done.address,
            content: (
              <SectionBody title="Address">
                {/* Ten fields, so two titled groups rather than one long one
                (LAYOUT.md §4: 5-7 per section) — where the applicant IS,
                then how to reach them. */}
                {/* ONE `FieldRow`, laid out by WIDTHS — `ADDRESS_W` at the top of
                    this file carries the arithmetic and `ADDRESS_BOX_W` caps both
                    cards of this rail entry to it. `cols={1}`, because that row is
                    the only child either section places now.

                    `align="start"`, NOT `FieldRow`'s default `items-end`: Pin is a
                    `ValidatedInput` and draws its error on a `<p>` BELOW the
                    control. That is `erp-form-compact` rule 4's choice —
                    `items-end` is for a LABEL that outgrows its narrow box,
                    `start` for a field that grows DOWNWARDS. No label on this row
                    wraps: "Street" has 288px and "Pin" is ~22px inside 112. */}
                <DetailSection label="Address" cols={1} className={ADDRESS_BOX_W}>
                  <FieldRow align="start">
                    {/* A single-line Input, not the 3-row Textarea this used to
                        be. See `ADDRESS_W` for why that decision survives the
                        move off the grid: `align="start"` means a tall cell no
                        longer stretches its neighbours, but a 3-row box beside
                        three 32px controls still reads as one field having gone
                        wrong. Stored values keep any newlines they already have
                        — an <input> just renders them on one line. */}
                    <Field label="Street" w={ADDRESS_W.street} htmlFor="ap-street">
                      <Input
                        uppercase
                        id="ap-street"
                        value={form.street}
                        onChange={(e) => set({ street: e.target.value })}
                      />
                    </Field>
                    <Field label="City" w={ADDRESS_W.city_id}>
                      <LookupDialogPicker
                        kind="city"
                        label="City"
                        options={cities}
                        value={form.city_id || null}
                        onChange={(id) => set({ city_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </Field>
                    <Field label="State" w={ADDRESS_W.state_id}>
                      <StatePicker
                        label="State"
                        options={states}
                        value={form.state_id || null}
                        onChange={(id) => set({ state_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Pin" w={ADDRESS_W.pin} htmlFor="ap-pin">
                      <ValidatedInput
                        id="ap-pin"
                        format="pincode"
                        value={form.pin}
                        onChange={(e) => set({ pin: e.target.value })}
                      />
                    </Field>
                    {/* The Address section used to carry its OWN Country field
                        bound to `address_country_id`, right beside Identity's
                        `country_id` one — the same country, asked twice. The
                        column still exists in the DB (data-io round-trips it,
                        and old rows may only have this one filled in) but it is
                        now written from the single Identity Country picker
                        above, not from a visible field here. Do not add this
                        field back without re-reading that picker's comment
                        first. */}
                  </FieldRow>
                </DetailSection>

                {/* The second card of the same rail entry, on the same cap — see
                    `COMM_W` for the widths and `ADDRESS_BOX_W` for why one
                    constant serves both. `align="start"` again: E-Mail and Web
                    site are `ValidatedInput`s, and WhatsApp carries its "Same as
                    mobile" tick below its input. */}
                <DetailSection label="Communication" cols={1} className={ADDRESS_BOX_W}>
                  <FieldRow align="start">
                    <Field label="Land Line" w={COMM_W.land_line} htmlFor="ap-landline">
                      <Input
                        id="ap-landline"
                        value={form.land_line}
                        onChange={(e) => set({ land_line: e.target.value })}
                      />
                    </Field>
                    {/* Two siblings, not one — the pair has no wrapper element
                        to hang a width on, so each cell takes it through
                        `cellClassName`. Both label themselves, hence no <Field>
                        around them.

                        It was `"@lg/section:col-span-3"`, which is a col-span
                        and so is INERT in a flex row: left alone the pair would
                        have kept a class that says nothing. `FIELD_WIDTH[…]` is
                        the width instead, and it is not the interpolation that
                        prop's own comment warns about — the string is read out
                        of a map, and `w-44` is written literally in `field.tsx`
                        where Tailwind scans it. See `COMM_W`. */}
                    <MobileWhatsAppFields
                      idPrefix="ap"
                      mobile={form.mobile}
                      whatsapp={form.whatsapp}
                      isdCode={isdOf.get(form.address_country_id) ?? null}
                      onMobileChange={(v) => set({ mobile: v })}
                      onWhatsAppChange={(v) => set({ whatsapp: v })}
                      cellClassName={FIELD_WIDTH[COMM_W.contact]}
                    />
                    <Field label="E-Mail" w={COMM_W.email} htmlFor="ap-email">
                      <ValidatedInput
                        id="ap-email"
                        format="email"
                        value={form.email}
                        onChange={(e) => set({ email: e.target.value })}
                      />
                    </Field>
                    <Field label="Web site" w={COMM_W.web_site} htmlFor="ap-web">
                      <ValidatedInput
                        id="ap-web"
                        format="website"
                        value={form.web_site}
                        onChange={(e) => set({ web_site: e.target.value })}
                      />
                    </Field>
                  </FieldRow>
                </DetailSection>
              </SectionBody>
            ),
          },
          {
            key: "contacts",
            label: "Contacts",
            icon: Users,
            done: done.contacts,
            content: (
              <SectionBody title="Contacts">
                {/* Seven fields per contact — past the ~5 a table row can hold,
                so stacked cards with a `FieldRow` inside (LAYOUT.md §6). It was a
                `FieldGrid` until 2026-09-10; see `CONTACT_W`.
                Replaces a hand-rolled card list with its own header band,
                remove button and `max-h-56` scroller; the pager is what
                replaces that scroller (client 2026-07-25 — no scroll-in-a-box)
                and `gridKeyNav` now comes with the grid rather than being
                wired by hand. Four of the fields were labelled by
                PLACEHOLDER, which disappears the moment anyone types; they
                carry real labels now (LAYOUT.md §7). */}
                {/* THE CAP GOES ON A WRAPPER — `ChildGrid` takes no `className`,
                    only `addClassName` and `bodyClassName`. See `CONTACT_BOX_W`
                    for the arithmetic and for why nothing between this div and
                    the fields costs the row any width. */}
                <div className={CONTACT_BOX_W}>
                  <ChildGrid<ContactRow>
                    lockExisting
                    label="Contact"
                    rows={contacts}
                    onAdd={addContact}
                    onRemove={(c) => removeContact(c.key)}
                    addLabel="+ Add contact"
                    forceCards
                    flatRows
                    pageSize={3}
                    // Paged cards all look alike; the name says which one this is.
                    rowSummary={(c) =>
                      c.contact_name || <span className="text-muted-foreground">New contact</span>
                    }
                    // `forceCards` + `renderMobileRow` mean these never render; they
                    // are the fallback if this grid is ever switched to a table.
                    columns={[
                      { header: "Contact Name", cell: (c) => c.contact_name },
                      { header: "Mobile", cell: (c) => c.mobile },
                    ]}
                    // ONE `FieldRow`, laid out by WIDTHS — `CONTACT_W` above carries
                    // the arithmetic and `CONTACT_BOX_W` fixes the fold at the same
                    // place on every monitor. It was a `FieldGrid`, i.e. the same
                    // 12-column track one element in, so every field here was a
                    // share of a card that was the width of the pane.
                    //
                    // `align="start"`, not the default `items-end`: Mobile and Email
                    // ID are `ValidatedInput`s and draw their format message on a
                    // `<p>` BELOW the control, so bottom alignment would lift either
                    // box out of its line the moment a value is half-typed. No label
                    // on this row wraps — "Internal Department" is the longest at
                    // ~118px inside 144.
                    //
                    // Who the contact is, then how to reach them. Tab follows this
                    // reading order, so reordering the JSX reorders the keyboard path.
                    renderMobileRow={(c) => (
                      <FieldRow align="start">
                        <Field label="Department" w={CONTACT_W.department}>
                          <LookupDialogPicker
                            kind="department"
                            label="Department"
                            options={departments}
                            value={c.department_id || null}
                            onChange={(id) => setContactAt(c.key, { department_id: id })}
                            canCreate={perms.canCreate}
                            canEdit={perms.canEdit}
                            canDelete={perms.canDelete}
                            compact
                          />
                        </Field>
                        <Field
                          label="Contact Name"
                          w={CONTACT_W.contact_name}
                          htmlFor={`ap-${c.key}-name`}
                        >
                          <Input
                            id={`ap-${c.key}-name`}
                            uppercase
                            value={c.contact_name}
                            onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                          />
                        </Field>
                        <Field label="Designation" w={CONTACT_W.designation}>
                          <LookupDialogPicker
                            kind="designation"
                            label="Designation"
                            options={designations}
                            value={c.designation_id || null}
                            onChange={(id) => setContactAt(c.key, { designation_id: id })}
                            canCreate={perms.canCreate}
                            canEdit={perms.canEdit}
                            canDelete={perms.canDelete}
                            compact
                          />
                        </Field>
                        <Field
                          label="Internal Department"
                          w={CONTACT_W.internal_department}
                        >
                          <LookupDialogPicker
                            kind="internal_department"
                            label="Internal Department"
                            options={internalDepartments}
                            value={c.internal_department_id || null}
                            onChange={(id) =>
                              setContactAt(c.key, { internal_department_id: id })
                            }
                            canCreate={perms.canCreate}
                            canEdit={perms.canEdit}
                            compact
                          />
                        </Field>
                        <Field
                          label="Land Line"
                          w={CONTACT_W.land_line}
                          htmlFor={`ap-${c.key}-landline`}
                        >
                          <Input
                            id={`ap-${c.key}-landline`}
                            value={c.land_line}
                            onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                          />
                        </Field>
                        <Field
                          label="Mobile"
                          w={CONTACT_W.mobile}
                          htmlFor={`ap-${c.key}-mobile`}
                        >
                          <ValidatedInput
                            id={`ap-${c.key}-mobile`}
                            format="mobile"
                            value={c.mobile}
                            onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                          />
                        </Field>
                        <Field
                          label="Email ID"
                          w={CONTACT_W.email_id}
                          htmlFor={`ap-${c.key}-email`}
                        >
                          <ValidatedInput
                            id={`ap-${c.key}-email`}
                            format="email"
                            value={c.email_id}
                            onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                          />
                        </Field>
                      </FieldRow>
                    )}
                  />
                </div>
              </SectionBody>
            ),
          },
          {
            key: "general",
            label: "General",
            icon: SlidersHorizontal,
            done: done.general,
            content: (
              <SectionBody title="General">
                {/* The three currency slots are one legacy concept and nothing
                else belongs beside them, so this row is three wide by nature
                — not by inheriting a default. */}
                <DetailSection label="Currencies" cols={1} className={GENERAL_BOX_W}>
                <FieldRow>
                <Field label="Currency 1" w={GENERAL_W.currency}>
                <CurrencyPicker
                label="Currency 1"
                currencies={currencies}
                value={form.currency_1 || null}
                onChange={(code) => set({ currency_1: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="Currency 2" w={GENERAL_W.currency}>
                <CurrencyPicker
                label="Currency 2"
                currencies={currencies}
                value={form.currency_2 || null}
                onChange={(code) => set({ currency_2: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="Currency 3" w={GENERAL_W.currency}>
                <CurrencyPicker
                label="Currency 3"
                currencies={currencies}
                value={form.currency_3 || null}
                onChange={(code) => set({ currency_3: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                </FieldRow>
                </DetailSection>

                {/* How the goods move and how they are paid for — the four terms
                on one row, then the bank the money lands in. */}
                <DetailSection label="Shipping & Payment" cols={1} className={GENERAL_BOX_W}>
                {/* `align="start"`: A/c No is a `ValidatedInput` and draws its error
                    below the control. `GENERAL_W` carries the widths, `GENERAL_BOX_W`
                    the cap and the 4 + 2 fold. */}
                <FieldRow align="start">
                <Field label="Ship Mode" w={GENERAL_W.ship_mode} htmlFor="ap-shipmode">
                <Select
                id="ap-shipmode"
                value={form.ship_mode}
                onChange={(e) => set({ ship_mode: e.target.value })}
                >
                <option value=""></option>
                {SHIP_MODES.map((m) => (
                <option key={m} value={m}>
                {m}
                </option>
                ))}
                </Select>
                </Field>
                <Field label="Ship Type" w={GENERAL_W.ship_type_id}>
                <LookupDialogPicker
                kind="ship_type"
                label="Ship Type"
                options={shipTypes}
                value={form.ship_type_id || null}
                onChange={(id) => set({ ship_type_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="Pay Mode" w={GENERAL_W.pay_mode} htmlFor="ap-paymode">
                <Select
                id="ap-paymode"
                value={form.pay_mode}
                onChange={(e) => set({ pay_mode: e.target.value })}
                >
                <option value=""></option>
                {PAY_MODES.map((m) => (
                <option key={m} value={m}>
                {m}
                </option>
                ))}
                </Select>
                </Field>
                <Field label="Payment Terms" w={GENERAL_W.payment_term_id}>
                <PaymentTermPicker
                label="Payment Terms"
                options={paymentTerms}
                value={form.payment_term_id || null}
                onChange={(id) => set({ payment_term_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                compact
                />
                </Field>
                <Field label="Bank" w={GENERAL_W.bank_id}>
                <BankPicker
                banks={banks}
                value={form.bank_id || null}
                onChange={(id) => set({ bank_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="A/c No." w={GENERAL_W.ac_no} htmlFor="ap-acno">
                <ValidatedInput
                id="ap-acno"
                format="account"
                value={form.ac_no}
                onChange={(e) => set({ ac_no: e.target.value })}
                />
                </Field>
                </FieldRow>
                </DetailSection>
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
        status={
          viewRow && (
            <StatusPill
              tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}
            >
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}
